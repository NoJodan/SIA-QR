from django.urls import path

from apps.attendance.views import (
    AuditLogListView,
    MarkAttendanceView,
    ResolveTokenView,
    SessionAttendanceListView,
)
from apps.attendance.views_reports import AttendanceReportView

app_name = "attendance"

urlpatterns = [
    # A2: lista viva de marcaciones de una sesión (profesor dueño).
    path(
        "sessions/<uuid:session_id>/attendances/",
        SessionAttendanceListView.as_view(),
        name="session-attendances",
    ),
    # B1: resolver token QR (cualquier usuario autenticado).
    path("resolve/", ResolveTokenView.as_view(), name="resolve"),
    # B2: marcar asistencia (estudiante autenticado).
    path("mark/", MarkAttendanceView.as_view(), name="mark"),
    # Reportes agregados (profesor dueño / admin global): JSON + XLSX + PDF.
    path("reports/", AttendanceReportView.as_view(), name="reports"),
    # RF-ADM-07: consulta de auditoría (solo admin).
    path("audit-logs/", AuditLogListView.as_view(), name="audit-logs"),
]
