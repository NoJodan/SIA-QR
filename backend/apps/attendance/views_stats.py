from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance.stats import StatsFilterSerializer, build_stats
from apps.authentication.models import UserRole
from apps.authentication.views import SessionAuthentication401


class IsProfessor(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_PROFESSOR
        )


class ProfessorSummaryStatsView(APIView):
    """GET /api/attendance/stats/ — resumen del profesor autenticado."""

    authentication_classes = [SessionAuthentication401]
    permission_classes = [IsAuthenticated, IsProfessor]

    def get(self, request):
        serializer = StatsFilterSerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        return Response(
            build_stats(
                request.user,
                serializer.validated_data["period"],
                serializer.validated_data.get("course_id"),
            )
        )
