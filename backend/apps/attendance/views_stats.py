from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance.permissions import IsProfessorOrAdmin
from apps.attendance.stats import StatsFilterSerializer, build_stats
from apps.authentication.views import SessionAuthentication401


class SummaryStatsView(APIView):
    """GET /api/attendance/stats/ — resumen del profesor o global (admin)."""

    authentication_classes = [SessionAuthentication401]
    permission_classes = [IsAuthenticated, IsProfessorOrAdmin]

    def get(self, request):
        serializer = StatsFilterSerializer(data=request.query_params)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        return Response(
            build_stats(
                request.user,
                serializer.validated_data["period"],
                serializer.validated_data.get("course_id"),
                serializer.validated_data.get("professor_id"),
            )
        )
