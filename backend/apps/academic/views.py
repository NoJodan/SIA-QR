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

from apps.academic.models import AcademicGroup, ClassStatus, Course, ScheduledClass
from apps.academic.pagination import StandardResultsPagination
from apps.academic.permissions import IsProfessor
from apps.academic.serializers import (
    AcademicGroupSerializer,
    AcademicGroupWriteSerializer,
    ScheduledClassSerializer,
)
from apps.authentication.views import IsAdminUserRole, SessionAuthentication401

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
        return Response(out)

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
        return ScheduledClass.objects.filter(group=self.get_group()).order_by("start_time")

    def perform_create(self, serializer):
        serializer.save(group=self.get_group(), status=ClassStatus.SCHEDULED)


def _revoke_active_sessions(clase):
    """C3: al cerrar una clase (COMPLETED/CANCELLED) revoca sus QR activos."""
    from apps.attendance.models import AttendanceSession

    if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
        AttendanceSession.objects.filter(
            scheduled_class=clase, is_active=True
        ).update(is_active=False)


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
        _revoke_active_sessions(clase)


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
        return ScheduledClass.objects.filter(group_id=self.kwargs["group_id"]).order_by("start_time")


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
        _revoke_active_sessions(clase)


# --- Núcleo QR (Plan v2) ---
class ClassSessionCreateView(generics.GenericAPIView):
    """A1: genera una sesión QR single-activa sobre una clase existente."""

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def post(self, request, group_id, class_id):
        from apps.attendance.serializers import SessionCreateSerializer
        from apps.attendance.services import generate_session

        prof = getattr(request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)
        clase = get_object_or_404(ScheduledClass, pk=class_id, group=group)

        if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
            return Response(
                {"error": f"No se puede generar QR en una clase {clase.status}."},
                status=status.HTTP_409_CONFLICT,
            )

        ser = SessionCreateSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        try:
            result = generate_session(
                clase, ttl_override=ser.validated_data.get("qr_duration_minutes")
            )
        except (IntegrityError, ValidationError):
            # M3/C2: colisión de token o carrera de single-active -> 409
            # reintentable en el frontend (nunca 500).
            return Response(
                {"error": "No se pudo generar el código QR, intenta de nuevo."},
                status=status.HTTP_409_CONFLICT,
            )
        except Exception:
            # m3: cualquier otro fallo (claim/select_for_update, BD) -> 503
            # reintentable con log (nunca 500 crudo).
            logger.exception("generate_session falló (A1 group=%s class=%s)", group_id, class_id)
            return Response(
                {"error": "Servicio no disponible, intenta de nuevo."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
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
        )


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
    """QR automático: sesión vigente de la clase sin botón manual.

    GET groups/<group_id>/classes/<class_id>/current-session/ (profesor dueño):

    - 200 live: hay sesión válida (reusada) o se creó/rotó en ventana.
      `attend_url`/`token_raw` solo vienen cuando la sesión se creó en este
      request; en reuso el token crudo ya no existe (solo su hash) y
      `attend_url` es None — el frontend conserva el QR cacheado por
      `session_id` (mismo dispositivo/pestaña, sessionStorage) o rota con
      POST .../current-session/rotate/ para mostrarlo en este dispositivo
      (workaround M1: revoca la anterior y devuelve un `attend_url` nuevo).
    - 202 pending: falta para el inicio ({status SCHEDULED, starts_in_s}).
    - 410 finished: clase cerrada o fuera de ventana (con cierre perezoso a
      COMPLETED + revocación de QR activos).
    - 409: colisión/carrera sin sesión válida que reusar (reintentable).
    - 503: fallo inesperado del ensure (reintentable, con log; nunca 500).
    - 404 si el grupo/clase no existe o es de otro profesor.

    GET puro (sin CSRF) + `Cache-Control: no-store` (polling cada 10s).
    A1 manual (`ClassSessionCreateView`) se mantiene como fallback interno.
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
    """M1 (opción b): "Mostrar en este dispositivo".

    POST groups/<group_id>/classes/<class_id>/current-session/rotate/
    (profesor dueño, CON CSRF por ser mutación):

    - Revoca la sesión activa previa (`generate_session` single-active) y
      devuelve una sesión NUEVA con `attend_url` mostrable en este
      navegador/proyector. Es el workaround documentado al reuso live con
      `attend_url: null` (hash irreversible): en vez de un aviso muerto, la
      UI ofrece esta acción de rotación (RF-PROF-06 proyectar).
    - 201 live: {session_id, token_raw, attend_url, expires_at, ttl_minutes}.
    - 202 pending: aún fuera de ventana (no rota nada).
    - 410 finished: clase cerrada o ventana pasada (cierre perezoso).
    - 409/503: colisión/carrera o fallo inesperado (reintentables, nunca 500).
    - 404 si el grupo/clase no existe o es de otro profesor.
    """

    authentication_classes = _AUTH
    permission_classes = _PERMS

    def post(self, request, group_id, class_id):
        from apps.academic.services import (
            class_window,
            get_early_grace_seconds,
            should_auto_start,
        )
        from apps.attendance.serializers import SessionCreateSerializer
        from apps.attendance.services import generate_session

        prof = getattr(request.user, "professor_profile", None)
        group = get_object_or_404(AcademicGroup, pk=group_id, professor=prof)
        clase = get_object_or_404(ScheduledClass, pk=class_id, group=group)

        if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
            return Response(
                {"state": "finished", "status": clase.status, "reason": "closed"},
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
                _close_class(clase)
            except Exception:
                logger.exception("rotate: cierre perezoso falló (class=%s)", class_id)
            return Response(
                {
                    "state": "finished",
                    "status": ClassStatus.COMPLETED,
                    "reason": "window_elapsed",
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

        ser = SessionCreateSerializer(data=request.data or {})
        ser.is_valid(raise_exception=True)
        try:
            result = generate_session(
                clase, ttl_override=ser.validated_data.get("qr_duration_minutes")
            )
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
        return Response(
            {
                "state": "live",
                "session_id": str(result["session"].id),
                "token_raw": result["token_raw"],
                "attend_url": result["attend_url"],
                "expires_at": result["expires_at"],
                "ttl_minutes": result["ttl_minutes"],
                "status": clase.status,
                "rotated": True,
            },
            status=status.HTTP_201_CREATED,
            headers={"Cache-Control": "no-store"},
        )
