import logging
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

from django.db import IntegrityError, transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.academic.models import AcademicGroup, ClassModality, ClassStatus, Course, ScheduledClass
from apps.academic.pagination import StandardResultsPagination
from apps.academic.permissions import IsProfessor
from apps.academic.serializers import (
    AcademicGroupSerializer,
    AcademicGroupWriteSerializer,
    ClassGeofenceSerializer,
    ScheduledClassSerializer,
)
from apps.academic.services import reopen_completed_if_future, sync_class_statuses
from apps.authentication.views import IsAdminUserRole, SessionAuthentication401
from apps.attendance.services import log_event

BOGOTA_TZ = ZoneInfo("America/Bogota")
_AUTH = [SessionAuthentication401]
_PERMS = [IsAuthenticated, IsProfessor]
_ADMIN_PERMS = [IsAuthenticated, IsAdminUserRole]


def current_term():
    now = datetime.now(BOGOTA_TZ)
    return f"{now.year}-{'1' if now.month <= 6 else '2'}"


def get_professor(user):
    from apps.authentication.models import Professor

    return get_object_or_404(Professor, user=user)


def _filter_by_status(queryset, request):
    """Filtro opcional ?status= (valores de ClassStatus; inválido -> 400)."""
    value = (request.query_params.get("status") or "").strip()
    if not value:
        return queryset
    if value not in ClassStatus.values:
        raise ValidationError({"status": "Estado de clase inválido."})
    return queryset.filter(status=value)


class MyGroupsListView(generics.ListCreateAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    filter_backends = [SearchFilter]
    search_fields = ["course__name"]
    pagination_class = StandardResultsPagination

    def get_serializer_class(self):
        if self.request.method == "POST":
            return AcademicGroupWriteSerializer
        return AcademicGroupSerializer

    def get_queryset(self):
        prof = getattr(self.request.user, "professor_profile", None)
        if prof is None:
            return AcademicGroup.objects.none()
        return (
            AcademicGroup.objects.filter(professor=prof)
            .select_related("course", "professor", "professor__user")
            .annotate(classes_count=Count("classes"))
            .order_by("course__code", "group_code")
        )

    def create(self, request, *args, **kwargs):
        ser = AcademicGroupWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        name = ser.validated_data["name"]
        with transaction.atomic():
            base = slugify(name)[:12].upper() or "CURSO"
            course = Course.objects.create(
                code=f"{base}{uuid.uuid4().hex[:6].upper()}",
                name=name,
            )
            group = AcademicGroup.objects.create(
                course=course,
                professor=get_professor(request.user),
                group_code="01",
                term_period=current_term(),
            )
        out = AcademicGroupSerializer(group).data
        out["classes_count"] = 0
        log_event(
            request.user,
            "group_created",
            f"group:{group.id}",
            request=request,
            payload={"name": name},
        )
        return Response(out, status=status.HTTP_201_CREATED)


class MyGroupDetailView(generics.RetrieveUpdateDestroyAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    lookup_url_kwarg = "group_id"

    def get_serializer_class(self):
        if self.request.method == "GET":
            return AcademicGroupSerializer
        return AcademicGroupWriteSerializer

    def get_object(self):
        prof = getattr(self.request.user, "professor_profile", None)
        return get_object_or_404(
            AcademicGroup.objects.select_related("course", "professor", "professor__user"),
            pk=self.kwargs["group_id"],
            professor=prof,
        )

    def update(self, request, *args, **kwargs):
        group = self.get_object()
        ser = AcademicGroupWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        group.course.name = ser.validated_data["name"]
        group.course.save(update_fields=["name"])
        # GET-serializado para respuesta consistente; PATCH/PUT solo renombran
        out = AcademicGroupSerializer(group).data
        out["classes_count"] = group.classes.count()
        log_event(
            request.user,
            "group_updated",
            f"group:{group.id}",
            request=request,
            payload={"name": group.course.name},
        )
        return Response(out)

    def destroy(self, request, *args, **kwargs):
        from apps.attendance.models import Attendance

        group = self.get_object()
        if Attendance.objects.filter(session__scheduled_class__group=group).exists():
            return Response(
                {"error": "Tiene asistencias registradas; no se puede eliminar."},
                status=status.HTTP_409_CONFLICT,
            )
        group_id, group_name = group.id, group.course.name
        self.perform_destroy(group)
        log_event(
            request.user,
            "group_deleted",
            f"group:{group_id}",
            request=request,
            payload={"name": group_name},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_destroy(self, instance):
        course = instance.course
        instance.delete()  # CASCADE a scheduled_classes
        if not AcademicGroup.objects.filter(course=course).exists():
            course.delete()


class ScheduledClassListCreateView(generics.ListCreateAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    serializer_class = ScheduledClassSerializer
    filter_backends = [SearchFilter]
    search_fields = ["title"]
    pagination_class = StandardResultsPagination

    def get_group(self):
        prof = getattr(self.request.user, "professor_profile", None)
        # 404 si el grupo no existe o pertenece a otro profesor
        return get_object_or_404(AcademicGroup, pk=self.kwargs["group_id"], professor=prof)

    def get_queryset(self):
        base = ScheduledClass.objects.filter(group=self.get_group())
        try:
            sync_class_statuses(base)
        except Exception:
            # Degradación: el listado sigue con el estado persistido, no 500.
            logger.exception("sync_class_statuses falló (group=%s)", self.kwargs["group_id"])
        return _filter_by_status(base.order_by("start_time"), self.request)

    def perform_create(self, serializer):
        clase = serializer.save(group=self.get_group(), status=ClassStatus.SCHEDULED)
        log_event(
            self.request.user,
            "class_created",
            f"class:{clase.id}",
            request=self.request,
        )


class ScheduledClassDetailView(generics.RetrieveUpdateDestroyAPIView):
    authentication_classes = _AUTH
    permission_classes = _PERMS
    serializer_class = ScheduledClassSerializer
    lookup_url_kwarg = "class_id"

    def get_group(self):
        prof = getattr(self.request.user, "professor_profile", None)
        return get_object_or_404(AcademicGroup, pk=self.kwargs["group_id"], professor=prof)

    def get_object(self):
        return get_object_or_404(ScheduledClass, pk=self.kwargs["class_id"], group=self.get_group())

    def perform_update(self, serializer):
        clase = serializer.save()
        reopen_completed_if_future(clase)
        log_event(
            self.request.user,
            "class_updated",
            f"class:{clase.id}",
            request=self.request,
        )

    def destroy(self, request, *args, **kwargs):
        from apps.attendance.models import Attendance

        clase = self.get_object()
        if Attendance.objects.filter(session__scheduled_class=clase).exists():
            return Response(
                {"error": "Tiene asistencias registradas; no se puede eliminar."},
                status=status.HTTP_409_CONFLICT,
            )
        class_id, title = clase.id, clase.title
        self.perform_destroy(clase)
        log_event(
            request.user,
            "class_deleted",
            f"class:{class_id}",
            request=request,
            payload={"title": title},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClassGeofenceView(generics.GenericAPIView):
    """Rango del salón: fija (o reubica) la referencia GPS de una clase
    presencial. Solo aplica a PRESENTIAL; se "apaga" solo al finalizar la
    clase (geofence_active se deriva del status, sin cron ni tareas).

    POST .../geofence/ (profesor dueño, CON CSRF por ser mutación):
    - 200: rango fijado/actualizado (idempotente: un POST posterior
      sobrescribe la ubicación, útil para reintentar si falló el GPS de la
      instantánea o si el profesor se movió de salón).
    - 400: modalidad no presencial, o sin coordenadas utilizables (permiso
      denegado/no soportado).
    - 409: clase finalizada o cancelada.
    - 404 si el grupo/clase no existe o es de otro profesor.

    GET sobre la misma ruta devuelve el estado (sin coordenadas)."""

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def get_clase(self, group_id, class_id):
        prof = getattr(self.request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)
        return get_object_or_404(ScheduledClass, pk=class_id, group=group)

    def _payload(self, clase):
        return {
            "geofence_active": clase.geofence_active,
            "geofence_radius_m": clase.geofence_radius_m,
            "geofence_activated_at": clase.geofence_activated_at,
            "status": clase.status,
            "modality": clase.modality,
        }

    def get(self, request, group_id, class_id):
        clase = self.get_clase(group_id, class_id)
        return Response(
            self._payload(clase),
            headers={"Cache-Control": "no-store"},
        )

    def post(self, request, group_id, class_id):
        clase = self.get_clase(group_id, class_id)

        if clase.modality != ClassModality.PRESENTIAL:
            return Response(
                {"error": "El rango de ubicación solo aplica a clases presenciales."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
            return Response(
                {"error": "La clase ya finalizó, no se puede activar el rango."},
                status=status.HTTP_409_CONFLICT,
            )

        ser = ClassGeofenceSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        lat = ser.validated_data.get("latitude")
        lng = ser.validated_data.get("longitude")
        if lat is None or lng is None:
            return Response(
                {"error": "No se pudo obtener tu ubicación, revisa el permiso del navegador."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        clase.geofence_lat = lat
        clase.geofence_lng = lng
        clase.geofence_activated_at = timezone.now()
        clase.save(update_fields=["geofence_lat", "geofence_lng", "geofence_activated_at", "updated_at"])
        return Response(ScheduledClassSerializer(clase).data)


# --- Vistas admin (solo lectura de cursos + edición de clases, sin post/delete) ---
class AdminGroupsListView(generics.ListAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = AcademicGroupSerializer
    filter_backends = [SearchFilter]
    search_fields = ["course__name"]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        return (
            AcademicGroup.objects.all()
            .select_related("course", "professor", "professor__user")
            .annotate(classes_count=Count("classes"))
            .order_by("course__name")
        )


class AdminGroupDetailView(generics.RetrieveAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = AcademicGroupSerializer
    lookup_url_kwarg = "group_id"

    def get_object(self):
        return get_object_or_404(
            AcademicGroup.objects.select_related("course", "professor", "professor__user").annotate(
                classes_count=Count("classes")
            ),
            pk=self.kwargs["group_id"],
        )


class AdminClassListView(generics.ListAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = ScheduledClassSerializer
    filter_backends = [SearchFilter]
    search_fields = ["title"]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        base = ScheduledClass.objects.filter(group_id=self.kwargs["group_id"])
        try:
            sync_class_statuses(base)
        except Exception:
            # Degradación: el listado sigue con el estado persistido, no 500.
            logger.exception("sync_class_statuses falló (group=%s)", self.kwargs["group_id"])
        return _filter_by_status(base.order_by("start_time"), self.request)


class AdminClassUpdateView(generics.RetrieveUpdateAPIView):
    authentication_classes = _AUTH
    permission_classes = _ADMIN_PERMS
    serializer_class = ScheduledClassSerializer
    lookup_url_kwarg = "class_id"
    http_method_names = ["get", "patch", "put", "head", "options"]

    def get_object(self):
        return get_object_or_404(
            ScheduledClass, pk=self.kwargs["class_id"], group_id=self.kwargs["group_id"]
        )

    def perform_update(self, serializer):
        clase = serializer.save()
        reopen_completed_if_future(clase)
        log_event(
            self.request.user,
            "class_updated",
            f"class:{clase.id}",
            request=self.request,
        )


# --- Núcleo QR (QR único; rotación manual explícita) ---
class InstantClassCreateView(generics.GenericAPIView):
    """B3: crea clase IN_PROGRESS 'al momento' + sesión QR en transacción atómica."""

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def post(self, request, group_id):
        from apps.attendance.serializers import SessionCreateSerializer
        from apps.attendance.services import generate_session

        prof = getattr(request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)

        ser = SessionCreateSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        ttl_override = ser.validated_data.get("qr_duration_minutes")

        title = str(request.data.get("title") or "").strip()
        if not title:
            now_local = datetime.now(BOGOTA_TZ)
            title = f"Clase inmediata {now_local.strftime('%H:%M')}"
        modality = request.data.get("modality") or "PRESENTIAL"
        if modality not in ("PRESENTIAL", "VIRTUAL"):
            return Response(
                {"error": "Modalidad inválida (PRESENTIAL o VIRTUAL)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Geocerca automática (solo presencial): coords tolerantes. Si no
        # llegan o son inválidas, la clase se crea igual sin rango (RNF-06:
        # el GPS nunca impide dar clase); el profesor puede reintentar con
        # el POST .../geofence/.
        geofence_lat = geofence_lng = None
        if modality == "PRESENTIAL":
            geo_ser = ClassGeofenceSerializer(
                data={
                    "latitude": request.data.get("geofence_latitude"),
                    "longitude": request.data.get("geofence_longitude"),
                    "accuracy": request.data.get("geofence_accuracy"),
                }
            )
            if geo_ser.is_valid():
                geofence_lat = geo_ser.validated_data.get("latitude")
                geofence_lng = geo_ser.validated_data.get("longitude")
        try:
            duration = int(request.data.get("duration_minutes") or 60)
        except (TypeError, ValueError):
            return Response(
                {"error": "duration_minutes debe ser un entero."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if duration <= 0:
            return Response(
                {"error": "duration_minutes debe ser mayor a 0."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            from django.utils import timezone as dj_timezone

            clase = ScheduledClass.objects.create(
                group=group,
                title=title[:150],
                start_time=dj_timezone.now(),
                duration_minutes=duration,
                modality=modality,
                status=ClassStatus.IN_PROGRESS,
                geofence_lat=geofence_lat,
                geofence_lng=geofence_lng,
                geofence_activated_at=dj_timezone.now() if geofence_lat is not None else None,
            )
            try:
                result = generate_session(clase, ttl_override=ttl_override)
            except (IntegrityError, ValidationError):
                # M3: colisión/carrera -> 409 reintentable (nunca 500).
                # Se marca para rollback del atomic exterior.
                transaction.set_rollback(True)
                return Response(
                    {"error": "No se pudo generar el código QR, intenta de nuevo."},
                    status=status.HTTP_409_CONFLICT,
                )
            except Exception:
                # m3: fallo inesperado del claim -> 503 reintentable con log.
                logger.exception("generate_session falló (B3 group=%s)", group_id)
                transaction.set_rollback(True)
                return Response(
                    {"error": "Servicio no disponible, intenta de nuevo."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            # Fix TTL instantánea (Opción B): persistir el ttl resuelto en la
            # clase antes de serializar, para no caer al default 10 cuando
            # ttl_override (1..120) difiere del default de system config.
            # m1: si el save falla, rollback + 503 (nunca serializar un TTL
            # en memoria divergente de la BD).
            try:
                clase.qr_duration_minutes = int(result["ttl_minutes"])
                clase.save(update_fields=["qr_duration_minutes", "updated_at"])
            except Exception:
                logger.exception("No se pudo persistir qr_duration_minutes (B3 group=%s)", group_id)
                transaction.set_rollback(True)
                return Response(
                    {"error": "Servicio no disponible, intenta de nuevo."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            # Releer lo persistido antes de serializar (evita divergencia).
            try:
                clase.refresh_from_db()
            except Exception:
                logger.exception("refresh_from_db falló tras persistir TTL (B3 group=%s)", group_id)

        log_event(
            request.user,
            "class_created",
            f"class:{clase.id}",
            request=request,
            payload={"instant": True, "session_id": str(result["session"].id)},
        )
        return Response(
            {
                "class": ScheduledClassSerializer(clase).data,
                "session": {
                    "session_id": str(result["session"].id),
                    "token_raw": result["token_raw"],
                    "attend_url": result["attend_url"],
                    "expires_at": result["expires_at"],
                    "ttl_minutes": result["ttl_minutes"],
                },
            },
            status=status.HTTP_201_CREATED,
        )


class ClassCurrentSessionView(generics.GenericAPIView):
    """QR automático: sesión vigente de la clase sin botón manual (QR único).

    GET groups/<group_id>/classes/<class_id>/current-session/ (profesor dueño):

    - 200 live: hay sesión válida (reusada) o se creó S1 en ventana.
      `attend_url`/`token_raw` solo vienen cuando la sesión se creó en este
      request; en reuso el token crudo ya no existe (solo su hash) y
      `attend_url` es None — el frontend conserva el QR cacheado por
      `session_id` (mismo dispositivo/pestaña, sessionStorage).
    - 202 pending: falta para el inicio ({status SCHEDULED, starts_in_s}).
    - 410 expired: el QR único expiró dentro de la ventana
      ({state expired, reason qr_expired, session_id, expires_at, status}).
      Sin auto-rotación: no se genera S2.
    - 410 finished: clase cerrada o fuera de ventana (con cierre perezoso a
      COMPLETED + revocación de QR activos). Incluye `session_id` de la última
      sesión (puede ser None) para listar sus marcaciones ya terminada.
    - 409: colisión/carrera sin sesión válida que reusar (reintentable).
    - 503: fallo inesperado del ensure (reintentable, con log; nunca 500).
    - 404 si el grupo/clase no existe o es de otro profesor.

    GET puro (sin CSRF) + `Cache-Control: no-store` (polling cada 10s).
    Para mostrar el QR en otro dispositivo está la rotación manual explícita
    (`ClassCurrentSessionRotateView`).
    """

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def get(self, request, group_id, class_id):
        from apps.academic.services import (
            _session_ttl_minutes,
            ensure_current_session,
            get_valid_session,
        )

        prof = getattr(request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)
        clase = get_object_or_404(ScheduledClass, pk=class_id, group=group)

        try:
            outcome = ensure_current_session(clase)
        except (IntegrityError, ValidationError):
            # Último recurso: reusar sesión válida si apareció (nunca 500).
            fresh = get_valid_session(clase, timezone.now())
            if fresh is not None:
                return Response(
                    {
                        "state": "live",
                        "session_id": str(fresh.id),
                        "attend_url": None,
                        "expires_at": fresh.expires_at,
                        "ttl_minutes": _session_ttl_minutes(fresh, clase),
                        "status": clase.status,
                    },
                    status=status.HTTP_200_OK,
                    headers={"Cache-Control": "no-store"},
                )
            return Response(
                {"error": "No se pudo generar el código QR, intenta de nuevo."},
                status=status.HTTP_409_CONFLICT,
                headers={"Cache-Control": "no-store"},
            )
        except Exception:
            # m3: fallo inesperado del ensure -> intenta reusar y si no hay
            # sesión válida responde 503 reintentable con log (nunca 500).
            logger.exception(
                "ensure_current_session falló (group=%s class=%s)", group_id, class_id
            )
            try:
                fresh = get_valid_session(clase, timezone.now())
            except Exception:
                fresh = None
            if fresh is not None:
                return Response(
                    {
                        "state": "live",
                        "session_id": str(fresh.id),
                        "attend_url": None,
                        "expires_at": fresh.expires_at,
                        "ttl_minutes": _session_ttl_minutes(fresh, clase),
                        "status": clase.status,
                    },
                    status=status.HTTP_200_OK,
                    headers={"Cache-Control": "no-store"},
                )
            return Response(
                {"error": "Servicio no disponible, intenta de nuevo."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
                headers={"Cache-Control": "no-store", "Retry-After": "10"},
            )

        kind = outcome["outcome"]
        if kind == "pending":
            return Response(
                {
                    "state": "pending",
                    "status": outcome["status"],
                    "starts_in_s": outcome["starts_in_s"],
                    "start_time": outcome["start_time"],
                },
                status=status.HTTP_202_ACCEPTED,
                headers={"Cache-Control": "no-store"},
            )
        if kind == "finished":
            return Response(
                {
                    "state": "finished",
                    "status": outcome["status"],
                    "reason": outcome["reason"],
                    "session_id": outcome.get("session_id"),
                },
                status=status.HTTP_410_GONE,
                headers={"Cache-Control": "no-store"},
            )
        if kind == "expired":
            return Response(
                {
                    "state": "expired",
                    "status": outcome["status"],
                    "reason": outcome.get("reason", "qr_expired"),
                    "session_id": outcome.get("session_id"),
                    "expires_at": outcome.get("expires_at"),
                },
                status=status.HTTP_410_GONE,
                headers={"Cache-Control": "no-store"},
            )

        # live
        session = outcome["session"]
        result = outcome.get("result")
        return Response(
            {
                "state": "live",
                "session_id": str(session.id),
                "token_raw": result["token_raw"] if result else None,
                "attend_url": result["attend_url"] if result else None,
                "expires_at": session.expires_at,
                "ttl_minutes": (
                    result["ttl_minutes"]
                    if result
                    else _session_ttl_minutes(session, clase)
                ),
                "status": clase.status,
            },
            status=status.HTTP_200_OK,
            headers={"Cache-Control": "no-store"},
        )


class ClassCurrentSessionRotateView(generics.GenericAPIView):
    """Rotación manual del QR (profesor dueño, CON CSRF por ser mutación).

    POST groups/<group_id>/classes/<class_id>/current-session/rotate/
    muestra el QR de nuevo en este dispositivo: genera una sesión nueva y
    revoca la anterior (single-active); cada rotación deja su fila en
    attendance_sessions para auditoría.

    - 201 live: {session_id, token_raw, attend_url, expires_at, ttl_minutes}
      (el token crudo solo existe en esta respuesta).
    - 202 pending: aún fuera de ventana (no rota nada).
    - 410 finished: clase cerrada o ventana pasada (cierre perezoso).
    - 409: fallo reintentable de generación (IntegrityError/ValidationError).
    - 409: otra rotación concurrente ya entregó su token (reintenta).
    - 503: fallo inesperado (con log, nunca 500).
    - 404 si el grupo/clase no existe o es de otro profesor.
    """

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def post(self, request, group_id, class_id):
        from apps.academic.services import (
            _last_session_id,
            class_window,
            get_early_grace_seconds,
            get_valid_session,
            should_auto_start,
        )

        prof = getattr(request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)
        clase = get_object_or_404(ScheduledClass, pk=class_id, group=group)

        # Sesión vigente ANTES de esperar el lock de la clase: si al entrar
        # cambió, otra rotación concurrente ya entregó su token y revocarlo
        # dejaría muerto el QR de esa respuesta.
        previous = get_valid_session(clase)

        with transaction.atomic():
            clase = get_object_or_404(
                ScheduledClass.objects.select_for_update(), pk=clase.pk
            )

            if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
                return Response(
                    {
                        "state": "finished",
                        "status": clase.status,
                        "reason": "closed",
                        "session_id": _last_session_id(clase),
                    },
                    status=status.HTTP_410_GONE,
                    headers={"Cache-Control": "no-store"},
                )

            try:
                in_window = should_auto_start(clase, timezone.now())
                start, end = class_window(clase)
            except Exception:
                logger.exception("rotate: ventana inválida (class=%s)", class_id)
                return Response(
                    {"error": "Servicio no disponible, intenta de nuevo."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    headers={"Cache-Control": "no-store", "Retry-After": "10"},
                )

            now = timezone.now()
            if now >= end:
                from apps.academic.services import _close_class

                try:
                    with transaction.atomic():
                        _close_class(clase)
                except Exception:
                    logger.exception("rotate: cierre perezoso falló (class=%s)", class_id)
                return Response(
                    {
                        "state": "finished",
                        "status": ClassStatus.COMPLETED,
                        "reason": "window_elapsed",
                        "session_id": _last_session_id(clase),
                    },
                    status=status.HTTP_410_GONE,
                    headers={"Cache-Control": "no-store"},
                )
            if not in_window:
                from datetime import timedelta as _td

                grace = get_early_grace_seconds()
                remaining = int(max(0, (start - _td(seconds=grace) - now).total_seconds()))
                # Fallback al inicio real si la gracia ya pasó pero now < start.
                remaining = max(remaining, int(max(0, (start - now).total_seconds())))
                return Response(
                    {
                        "state": "pending",
                        "status": clase.status,
                        "starts_in_s": remaining,
                        "start_time": start,
                    },
                    status=status.HTTP_202_ACCEPTED,
                    headers={"Cache-Control": "no-store"},
                )

            current = get_valid_session(clase)
            if current is not None and (
                previous is None or current.pk != previous.pk
            ):
                return Response(
                    {"error": "No se pudo generar el código QR, intenta de nuevo."},
                    status=status.HTTP_409_CONFLICT,
                    headers={"Cache-Control": "no-store"},
                )

            from apps.attendance.services import generate_session

            try:
                with transaction.atomic():
                    result = generate_session(clase)
            except (IntegrityError, ValidationError):
                return Response(
                    {"error": "No se pudo generar el código QR, intenta de nuevo."},
                    status=status.HTTP_409_CONFLICT,
                    headers={"Cache-Control": "no-store"},
                )
            except Exception:
                logger.exception("rotate: generate_session falló (class=%s)", class_id)
                return Response(
                    {"error": "Servicio no disponible, intenta de nuevo."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                    headers={"Cache-Control": "no-store", "Retry-After": "10"},
                )
            log_event(
                request.user,
                "qr_rotated",
                f"session:{result['session'].id}",
                request=request,
                payload={"class_id": str(clase.id), "ttl_minutes": result["ttl_minutes"]},
            )
            return Response(
                {
                    "session_id": str(result["session"].id),
                    "token_raw": result["token_raw"],
                    "attend_url": result["attend_url"],
                    "expires_at": result["expires_at"],
                    "ttl_minutes": result["ttl_minutes"],
                },
                status=status.HTTP_201_CREATED,
                headers={"Cache-Control": "no-store"},
            )
