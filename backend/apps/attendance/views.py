import hashlib

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academic.models import ClassStatus
from apps.academic.pagination import StandardResultsPagination
from apps.attendance.models import Attendance, AttendanceSession
from apps.attendance.permissions import IsOwnerProfessor
from apps.attendance.serializers import (
    AttendanceListSerializer,
    MarkAttendanceSerializer,
)
from apps.authentication.models import Student, UserRole
from apps.authentication.views import SessionAuthentication401

_AUTH = [SessionAuthentication401]


class Auth401Mixin:
    """Sin sesión Google -> 401 (no 403) en endpoints de estudiante."""

    def permission_denied(self, request, message=None, code=None):
        if not request.user or not request.user.is_authenticated:
            raise NotAuthenticated(detail="Se requiere iniciar sesión.")
        super().permission_denied(request, message, code)


def _hash_token(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _client_ip(request):
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return (request.META.get("REMOTE_ADDR") or "")[:45]


def _get_student_profile(user):
    """M1: retorna el perfil Student existente o None (sin autocrear
    datos sintéticos). Si falta, el mark responde 412 needs_profile."""
    profile = getattr(user, "student_profile", None)
    if profile is not None:
        try:
            return Student.objects.get(pk=profile.pk)
        except Student.DoesNotExist:
            pass
    try:
        return Student.objects.get(user=user)
    except Student.DoesNotExist:
        return None


def _class_is_closed(clase):
    return getattr(clase, "status", None) in (ClassStatus.COMPLETED, ClassStatus.CANCELLED)


def _session_payload(session, already_marked=False, needs_profile=False):
    clase = session.scheduled_class
    group = clase.group
    return {
        "session_id": str(session.id),
        "expires_at": session.expires_at,
        "is_active": session.is_active,
        "already_marked": already_marked,
        "needs_profile": needs_profile,
        "class": {
            "id": str(clase.id),
            "title": clase.title,
            "status": clase.status,
            "modality": clase.modality,
            "start_time": clase.start_time,
        },
        "group": {
            "id": str(group.id),
            "group_code": group.group_code,
            "course_name": group.course.name if hasattr(group, "course") else None,
        },
    }


class SessionAttendanceListView(generics.ListAPIView):
    """A2: lista paginada de marcaciones (profesor dueño, sin lat/long exactas)."""

    authentication_classes = _AUTH
    permission_classes = [IsAuthenticated, IsOwnerProfessor]
    serializer_class = AttendanceListSerializer
    pagination_class = StandardResultsPagination

    def get_session(self):
        return get_object_or_404(
            AttendanceSession.objects.select_related(
                "scheduled_class__group__professor__user"
            ),
            pk=self.kwargs["session_id"],
        )

    def get_queryset(self):
        session = self.get_session()
        # Chequeo de dueño a nivel de vista (404 si no existe, 403 si es ajena).
        professor = session.scheduled_class.group.professor
        if professor.user_id != self.request.user.id:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("No tienes acceso a esta sesión.")
        return (
            Attendance.objects.filter(session=session)
            .select_related("student")
            .order_by("registered_at")
        )


class ResolveTokenView(Auth401Mixin, APIView):
    """B1: resuelve un token QR a su sesión/clase (requiere sesión Google)."""

    authentication_classes = _AUTH
    permission_classes = [IsAuthenticated]

    def get(self, request):
        raw = (request.query_params.get("token") or "").strip()
        if not raw:
            return Response(
                {"error": "El parámetro token es obligatorio."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            session = AttendanceSession.objects.select_related(
                "scheduled_class__group__course",
                "scheduled_class__group__professor",
            ).get(token_hash=_hash_token(raw))
        except AttendanceSession.DoesNotExist:
            return Response(
                {"error": "Token inválido."}, status=status.HTTP_404_NOT_FOUND
            )
        if not session.is_active or session.expires_at <= timezone.now():
            return Response(
                {"error": "El código QR expiró o fue revocado."},
                status=status.HTTP_410_GONE,
            )
        # C3: no resolver sesiones de clases finalizadas/canceladas.
        if _class_is_closed(session.scheduled_class):
            return Response(
                {"error": "La clase ya finalizó o fue cancelada."},
                status=status.HTTP_410_GONE,
            )
        already_marked = False
        needs_profile = False
        if request.user.role == UserRole.ROLE_STUDENT:
            student = _get_student_profile(request.user)
            if student is None:
                needs_profile = True
            else:
                already_marked = Attendance.objects.filter(
                    session=session, student=student
                ).exists()
        return Response(_session_payload(session, already_marked, needs_profile))


class MarkAttendanceView(Auth401Mixin, APIView):
    """B2: marca asistencia (idempotente, geo opcional, nunca 500)."""

    authentication_classes = _AUTH
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = MarkAttendanceSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if user.role != UserRole.ROLE_STUDENT:
            return Response(
                {"error": "Solo los estudiantes pueden marcar asistencia."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            session = AttendanceSession.objects.select_related(
                "scheduled_class"
            ).get(token_hash=_hash_token(ser.validated_data["token"]))
        except AttendanceSession.DoesNotExist:
            return Response(
                {"error": "Token inválido."}, status=status.HTTP_404_NOT_FOUND
            )
        if not session.is_active or session.expires_at <= timezone.now():
            return Response(
                {"error": "El código QR expiró o fue revocado."},
                status=status.HTTP_410_GONE,
            )
        # C3: rechaza marcaciones en clases finalizadas/canceladas.
        if _class_is_closed(session.scheduled_class):
            return Response(
                {"error": "La clase ya finalizó o fue cancelada, no se aceptan marcaciones."},
                status=status.HTTP_409_CONFLICT,
            )

        # M1: sin perfil real no hay marcación (412 + needs_profile).
        student = _get_student_profile(user)
        if student is None:
            return Response(
                {
                    "error": "Completa tu perfil de estudiante (código, documento y nombre) antes de marcar asistencia.",
                    "needs_profile": True,
                },
                status=status.HTTP_412_PRECONDITION_FAILED,
            )

        try:
            with transaction.atomic():
                attendance, created = Attendance.objects.get_or_create(
                    session=session,
                    student=student,
                    defaults={
                        "latitude": ser.validated_data.get("latitude"),
                        "longitude": ser.validated_data.get("longitude"),
                        "accuracy": ser.validated_data.get("accuracy"),
                        "ip_address": _client_ip(request),
                        "user_agent": (request.META.get("HTTP_USER_AGENT") or "")[:2000],
                    },
                )
        except IntegrityError:
            # Carrera: otro request creó la marcación primero -> idempotente.
            try:
                attendance = Attendance.objects.get(session=session, student=student)
                created = False
            except Attendance.DoesNotExist:
                return Response(
                    {"error": "No se pudo registrar la asistencia, intenta de nuevo."},
                    status=status.HTTP_409_CONFLICT,
                )
        except Exception:
            return Response(
                {"error": "No se pudo registrar la asistencia, intenta de nuevo."},
                status=status.HTTP_409_CONFLICT,
            )

        data = {
            "attendance_id": str(attendance.id),
            "session_id": str(session.id),
            "registered_at": attendance.registered_at,
            "already_marked": not created,
        }
        return Response(
            data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
