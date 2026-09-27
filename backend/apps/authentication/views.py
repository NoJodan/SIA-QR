import uuid

from django.contrib.auth import logout as django_logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    Student,
    User,
    UserRole,
)


class SessionAuthentication401(SessionAuthentication):
    """SessionAuthentication estándar (CON enforcement CSRF) pero con
    cabecera WWW-Authenticate para que DRF devuelva 401 (no 403)
    cuando no hay sesión Google."""

    def authenticate_header(self, request):
        return 'Session realm="SIA-QR"'


class IsAdminUserRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_ADMIN
        )


def _ensure_professor_profile(user, email=""):
    """Crea el perfil Professor si falta (usado al promover tardíamente)."""
    try:
        return user.professor_profile
    except Exception:
        pass
    try:
        return Professor.objects.get(user=user)
    except Professor.DoesNotExist:
        pass
    base = (email or user.email or "Profesor").split("@")[0].strip() or "Profesor"
    return Professor.objects.create(
        user=user,
        employee_code=f"PROV-{uuid.uuid4().hex[:6].upper()}",
        first_name=base[:100],
        last_name="Docente",
        department=None,
    )


def reconcile_professor_role(user):
    """M2: promueve a PROFESSOR si el email está en la whitelist aunque el
    usuario se haya registrado antes como STUDENT. Solo promueve, nunca
    degrada (la degradación es acción explícita del DELETE admin)."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "role", None) == UserRole.ROLE_ADMIN:
        return False
    try:
        whitelisted = AuthorizedProfessorEmail.objects.filter(
            email__iexact=(user.email or "").strip().lower()
        ).exists()
    except Exception:
        return False
    if not whitelisted:
        return False
    changed = False
    if user.role != UserRole.ROLE_PROFESSOR:
        user.role = UserRole.ROLE_PROFESSOR
        user.save(update_fields=["role", "updated_at"])
        changed = True
    _ensure_professor_profile(user, email=user.email)
    return changed


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@ensure_csrf_cookie
def csrf_view(request):
    """C1: fija la cookie `csrftoken` para el SPA (axios withXSRFToken)."""
    return Response({"detail": "CSRF cookie fijada"}, status=status.HTTP_200_OK)


@api_view(["GET", "PATCH"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user
    # M2: reconcilia rol contra la whitelist en cada lectura de perfil.
    reconcile_professor_role(user)
    user.refresh_from_db()

    if request.method == "PATCH":
        if user.role == UserRole.ROLE_PROFESSOR:
            return _patch_professor(request, user)
        if user.role == UserRole.ROLE_STUDENT:
            return _patch_student(request, user)
        return Response(
            {"error": "Tu rol no permite editar el perfil"},
            status=status.HTTP_403_FORBIDDEN,
        )

    return Response(_me_payload(user))


def _me_payload(user):
    data = {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
    }

    if user.role == UserRole.ROLE_PROFESSOR:
        prof = getattr(user, "professor_profile", None)
        try:
            if prof is None:
                prof = Professor.objects.get(user=user)
        except Exception:
            prof = None
        data.update({
            "employee_code": prof.employee_code if prof else None,
            "first_name": prof.first_name if prof else "",
            "last_name": prof.last_name if prof else "",
            "department": prof.department if prof else "",
        })

    if user.role == UserRole.ROLE_STUDENT:
        try:
            student = user.student_profile
            data.update({
                "student_code": student.student_code,
                "document_number": student.document_number,
                "first_name": student.first_name,
                "last_name": student.last_name,
                "needs_profile": False,
            })
        except Exception:
            try:
                student = Student.objects.get(user=user)
                data.update({
                    "student_code": student.student_code,
                    "document_number": student.document_number,
                    "first_name": student.first_name,
                    "last_name": student.last_name,
                    "needs_profile": False,
                })
            except Student.DoesNotExist:
                data.update({
                    "student_code": None,
                    "document_number": None,
                    "first_name": "",
                    "last_name": "",
                    # M1: el perfil NO se autocrea; el estudiante debe
                    # completarlo vía PATCH antes de marcar (412 si falta).
                    "needs_profile": True,
                })

    return data


def _patch_professor(request, user):
    prof = getattr(user, "professor_profile", None)
    if prof is None:
        try:
            prof = Professor.objects.get(user=user)
        except Professor.DoesNotExist:
            return Response(
                {"error": "Perfil de profesor no encontrado"},
                status=status.HTTP_404_NOT_FOUND,
            )

    employee_code = str(request.data.get("employee_code") or "").strip()
    if not employee_code:
        return Response(
            {"error": "El código de empleado es obligatorio"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(employee_code) > 50:
        return Response(
            {"error": "El código de empleado no puede superar 50 caracteres"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if Professor.objects.filter(employee_code=employee_code).exclude(pk=prof.pk).exists():
        return Response(
            {"error": "Ese código de empleado ya está asignado a otro profesor"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    fields = ["employee_code"]
    if "department" in request.data:
        department = str(request.data.get("department") or "").strip()
        if len(department) > 100:
            return Response(
                {"error": "El departamento no puede superar 100 caracteres"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        prof.department = department or None
        fields.append("department")

    prof.employee_code = employee_code
    prof.save(update_fields=fields)
    user.refresh_from_db()
    return Response(_me_payload(user))


def _patch_student(request, user):
    """M1: registro inicial real del estudiante (RF-EST-03). Crea o actualiza
    el perfil con documento/código reales; unicidad con 409 legible."""
    student_code = str(request.data.get("student_code") or "").strip()
    document_number = str(request.data.get("document_number") or "").strip()
    first_name = str(request.data.get("first_name") or "").strip()
    last_name = str(request.data.get("last_name") or "").strip()

    errors = {}
    if not student_code:
        errors["student_code"] = "El código estudiantil es obligatorio."
    elif len(student_code) > 50:
        errors["student_code"] = "No puede superar 50 caracteres."
    if not document_number:
        errors["document_number"] = "El número de documento es obligatorio."
    elif len(document_number) > 50:
        errors["document_number"] = "No puede superar 50 caracteres."
    if not first_name:
        errors["first_name"] = "El nombre es obligatorio."
    elif len(first_name) > 100:
        errors["first_name"] = "No puede superar 100 caracteres."
    if not last_name:
        errors["last_name"] = "El apellido es obligatorio."
    elif len(last_name) > 100:
        errors["last_name"] = "No puede superar 100 caracteres."
    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        existing = Student.objects.get(user=user)
        me_qs = Student.objects.exclude(pk=existing.pk)
    except Student.DoesNotExist:
        existing = None
        me_qs = Student.objects.all()
    if me_qs.filter(student_code__iexact=student_code).exists():
        return Response(
            {"student_code": "Ese código estudiantil ya está registrado por otra cuenta."},
            status=status.HTTP_409_CONFLICT,
        )
    if me_qs.filter(document_number__iexact=document_number).exists():
        return Response(
            {"document_number": "Ese número de documento ya está registrado por otra cuenta."},
            status=status.HTTP_409_CONFLICT,
        )

    if existing is None:
        Student.objects.create(
            user=user,
            student_code=student_code,
            document_number=document_number,
            first_name=first_name,
            last_name=last_name,
        )
    else:
        existing.student_code = student_code
        existing.document_number = document_number
        existing.first_name = first_name
        existing.last_name = last_name
        existing.save(update_fields=["student_code", "document_number", "first_name", "last_name"])
    user.refresh_from_db()
    return Response(_me_payload(user))


@api_view(["POST"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAuthenticated])
def logout_view(request):
    django_logout(request)
    return Response({"detail": "Sesión cerrada exitosamente"}, status=status.HTTP_200_OK)


@api_view(["GET", "POST", "DELETE"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAdminUserRole])
def professors_whitelist(request):
    if request.method == "GET":
        emails = AuthorizedProfessorEmail.objects.all().order_by("-created_at")
        data = [
            {"id": str(item.id), "email": item.email, "created_at": item.created_at}
            for item in emails
        ]
        return Response(data, status=status.HTTP_200_OK)

    if request.method == "POST":
        email = request.data.get("email", "").strip().lower()
        if not email or "@" not in email:
            return Response({"error": "Correo electrónico inválido"}, status=status.HTTP_400_BAD_REQUEST)

        obj, created = AuthorizedProfessorEmail.objects.get_or_create(email=email)
        if not created:
            return Response({"error": "El correo ya está en la lista blanca"}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {"id": str(obj.id), "email": obj.email, "created_at": obj.created_at},
            status=status.HTTP_201_CREATED,
        )

    if request.method == "DELETE":
        email = (request.data.get("email") or request.query_params.get("email", "")).strip().lower()
        if not email:
            return Response({"error": "Email requerido para eliminar"}, status=status.HTTP_400_BAD_REQUEST)

        deleted_count, _ = AuthorizedProfessorEmail.objects.filter(email=email).delete()
        if deleted_count == 0:
            return Response({"error": "Correo no encontrado en la lista blanca"}, status=status.HTTP_404_NOT_FOUND)

        # Regla: Cuando se elimine un correo (DELETE), busca al User asociado.
        # Si existe, cámbiale el role a ROLE_STUDENT y guarda.
        User.objects.filter(email__iexact=email).update(role=UserRole.ROLE_STUDENT)

        return Response({"detail": "Correo eliminado y rol actualizado si correspondía"}, status=status.HTTP_200_OK)
