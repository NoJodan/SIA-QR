from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academic.pagination import StandardResultsPagination
from apps.attendance.permissions import IsProfessorOrAdmin
from apps.attendance.reports import (
    MAX_EXPORT_ROWS,
    MAX_PDF_ROWS,
    ReportFilterSerializer,
    build_report_queryset,
    export_pdf,
    export_xlsx,
    report_row,
)
from apps.authentication.views import SessionAuthentication401


class AttendanceReportView(APIView):
    """GET /api/attendance/reports/ — reporte de marcaciones.

    - Profesor: solo sus grupos (ajeno -> 403). Admin: todo + filtro profesor.
    - ``format=json`` (defecto): paginado Standard (10, máx 50).
    - ``format=xlsx``: descarga (tope 5000 filas); ``format=pdf``: tope
      menor 1000 filas (una sola Table en memoria, riesgo OOM con 5000;
      ~400 filas es lo legible). Superar el tope responde 400.
    - GET puro (sin CSRF); sin sesión -> 401.
    """

    authentication_classes = [SessionAuthentication401]
    permission_classes = [IsAuthenticated, IsProfessorOrAdmin]

    def get(self, request):
        # Preserva query params multivalor (?class_id=a&class_id=b).
        data = {}
        for key in request.query_params:
            values = request.query_params.getlist(key)
            data[key] = values if len(values) > 1 else values[0]
        ser = ReportFilterSerializer(data=data)
        if not ser.is_valid():
            return Response(ser.errors, status=400)
        try:
            qs = build_report_queryset(ser.validated_data, request.user)
        except PermissionDenied as exc:
            return Response({"error": str(exc)}, status=403)

        fmt = (ser.validated_data.get("format") or "json").lower()
        if fmt in ("xlsx", "pdf"):
            cap = MAX_PDF_ROWS if fmt == "pdf" else MAX_EXPORT_ROWS
            count = qs.count()
            if count > cap:
                return Response(
                    {
                        "error": (
                            f"El reporte supera el máximo de {cap} "
                            "registros, refine los filtros."
                        )
                    },
                    status=400,
                )
            stamp = timezone.localtime(timezone.now()).strftime("%Y%m%d_%H%M%S")
            if fmt == "xlsx":
                payload = export_xlsx(qs)
                filename = f"siaqr_reporte_{stamp}.xlsx"
                content_type = (
                    "application/vnd.openxmlformats-officedocument."
                    "spreadsheetml.sheet"
                )
            else:
                payload = export_pdf(qs, ser.validated_data)
                filename = f"siaqr_reporte_{stamp}.pdf"
                content_type = "application/pdf"
            response = HttpResponse(payload, content_type=content_type)
            response["Content-Disposition"] = (
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}'
            )
            return response

        paginator = StandardResultsPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        rows = [report_row(item) for item in page]
        return paginator.get_paginated_response(rows)
