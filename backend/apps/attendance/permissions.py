from rest_framework.permissions import BasePermission

from apps.authentication.models import UserRole


class IsOwnerProfessor(BasePermission):
    """Solo el profesor dueño del grupo de la clase/sesión.

    Verifica vía session.scheduled_class.group.professor. Si la sesión
    aún no se resolvió (404 pendiente en la vista), permite pasar para que
    la vista devuelva el 404 correspondiente.
    """

    def _session_id(self, view):
        return (view.kwargs or {}).get("session_id")

    def has_permission(self, request, view):
        if not (
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_PROFESSOR
        ):
            return False
        session_id = self._session_id(view)
        if not session_id:
            return True
        try:
            from apps.attendance.models import AttendanceSession

            session = AttendanceSession.objects.select_related(
                "scheduled_class__group__professor__user"
            ).get(pk=session_id)
        except Exception:
            return True
        professor = session.scheduled_class.group.professor
        return professor.user_id == request.user.id

    def has_object_permission(self, request, view, obj):
        session = getattr(obj, "session", obj)
        professor = session.scheduled_class.group.professor
        return professor.user_id == request.user.id
