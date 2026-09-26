from django.contrib.auth import logout as django_logout
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    User,
    UserRole,
)


class CsrfExemptSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        return  # No hacer chequeo CSRF


class IsAdminUserRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_ADMIN
        )


@api_view(["GET", "PATCH"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user

    if request.method == "PATCH":
        if user.role != UserRole.ROLE_PROFESSOR:
            return Response(
                {"error": "Solo el rol profesor puede editar su perfil"},
                status=status.HTTP_403_FORBIDDEN,
            )

        prof = getattr(user, "professor_profile", None)
        if prof is None:
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

    data = {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
    }

    if user.role == UserRole.ROLE_PROFESSOR:
        prof = getattr(user, "professor_profile", None)
        data.update({
            "employee_code": prof.employee_code if prof else None,
            "first_name": prof.first_name if prof else "",
            "last_name": prof.last_name if prof else "",
            "department": prof.department if prof else "",
        })

    return Response(data)


@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
def logout_view(request):
    django_logout(request)
    return Response({"detail": "Sesión cerrada exitosamente"}, status=status.HTTP_200_OK)


@api_view(["GET", "POST", "DELETE"])
@authentication_classes([CsrfExemptSessionAuthentication])
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

