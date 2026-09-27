from rest_framework.permissions import BasePermission

from apps.authentication.models import UserRole


class IsProfessor(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_PROFESSOR
        )
