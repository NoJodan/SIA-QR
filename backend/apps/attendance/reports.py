"""Módulo de reportes de asistencia (RF-PROF-09 / RF-ADM-04).

Todo vive en ``apps.attendance`` (no hay app nueva): el filtro, la
construcción del queryset y los exportadores XLSX/PDF. La vista está en
``views_reports.py`` y la ruta en ``urls.py`` (``reports/``).
"""

import io
import re
import unicodedata
import uuid as uuid_mod
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.academic.models import ClassModality, ClassStatus
from apps.authentication.models import UserRole

BOGOTA_TZ = ZoneInfo("America/Bogota")

#: Tope de filas para descarga XLSX (el preview JSON va paginado).
MAX_EXPORT_ROWS = 5000
#: Tope menor para PDF: una sola Table en memoria (riesgo OOM con 5000).
#: El PDF legible ronda 400 filas; 1000 es el máximo operativo.
MAX_PDF_ROWS = 1000
#: Rango máximo permitido entre fecha inicial y final (días, inclusivo).
MAX_RANGE_DAYS = 366
#: Tope de clases por filtro `class_id` (evita N SELECTs de pertenencia).
MAX_CLASS_IDS = 50


class MultipleUUIDField(serializers.Field):
    """Acepta un UUID o una lista de UUIDs (``class_id`` multivalor).

    Tolera un valor único, lista/tupla y cadenas separadas por comas.
    """

    default_error_messages = {
        "invalid": "Identificador de clase inválido.",
        "too_many": "Puedes filtrar por un máximo de 50 clases.",
    }

    def to_internal_value(self, data):
        if data is None or data == "":
            return []
        items = data if isinstance(data, (list, tuple)) else [data]
        expanded = []
        for item in items:
            if item is None:
                continue
            if isinstance(item, str) and "," in item:
                expanded.extend([p.strip() for p in item.split(",") if p.strip()])
            elif isinstance(item, str):
                if item.strip():
                    expanded.append(item.strip())
            else:
                expanded.append(item)
        result = []
        for value in expanded:
            try:
                result.append(uuid_mod.UUID(str(value)))
            except (ValueError, AttributeError, TypeError):
                self.fail("invalid")
        result = list(dict.fromkeys(result))
        if len(result) > MAX_CLASS_IDS:
            self.fail("too_many")
        return result

    def to_representation(self, value):
        return [str(v) for v in value]


class HasLocationField(serializers.Field):
    """Normaliza ``has_location`` a ``true``/``false``/``all``."""

    default_error_messages = {
        "invalid": "Valor inválido para ubicación (true, false o all).",
    }

    _MAP = {
        "true": "true",
        "1": "true",
        "si": "true",
        "sí": "true",
        "yes": "true",
        "false": "false",
        "0": "false",
        "no": "false",
        "all": "all",
        "todos": "all",
        "todas": "all",
    }

    def to_internal_value(self, data):
        if data is None or data == "":
            return "all"
        if isinstance(data, bool):
            return "true" if data else "false"
        key = str(data).strip().lower()
        if key not in self._MAP:
            self.fail("invalid")
        return self._MAP[key]

    def to_representation(self, value):
        return value


class ReportFilterSerializer(serializers.Serializer):
    """Filtros del reporte. Todo opcional; errores 400 en español."""

    course_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        error_messages={"invalid": "Identificador de curso inválido."},
    )
    group_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        error_messages={"invalid": "Identificador de grupo inválido."},
    )
    class_id = MultipleUUIDField(required=False)
    session_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        error_messages={"invalid": "Identificador de sesión inválido."},
    )
    date_from = serializers.DateField(
        required=False,
        input_formats=["%Y-%m-%d"],
        error_messages={"invalid": "Formato de fecha inválido, usa AAAA-MM-DD."},
    )
    date_to = serializers.DateField(
        required=False,
        input_formats=["%Y-%m-%d"],
        error_messages={"invalid": "Formato de fecha inválido, usa AAAA-MM-DD."},
    )
    registered_from = serializers.DateField(
        required=False,
        input_formats=["%Y-%m-%d"],
        error_messages={"invalid": "Formato de fecha inválido, usa AAAA-MM-DD."},
    )
    registered_to = serializers.DateField(
        required=False,
        input_formats=["%Y-%m-%d"],
        error_messages={"invalid": "Formato de fecha inválido, usa AAAA-MM-DD."},
    )
    document = serializers.CharField(required=False, allow_blank=True, max_length=50)
    student_code = serializers.CharField(required=False, allow_blank=True, max_length=50)
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
    class_status = serializers.ChoiceField(
        required=False,
        choices=[c for c, _ in ClassStatus.choices],
        error_messages={"invalid_choice": "Estado de clase inválido."},
    )
    modality = serializers.ChoiceField(
        required=False,
        choices=[c for c, _ in ClassModality.choices],
        error_messages={"invalid_choice": "Modalidad inválida."},
    )
    professor_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        error_messages={"invalid": "Identificador de profesor inválido."},
    )
    has_location = HasLocationField(required=False)
    format = serializers.CharField(
        required=False,
        allow_blank=True,
        default="json",
        max_length=10,
    )

    def validate_format(self, value):
        norm = str(value or "json").strip().lower() or "json"
        if norm not in ("json", "xlsx", "pdf"):
            raise serializers.ValidationError(
                "Formato inválido (json, xlsx o pdf)."
            )
        return norm

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to:
            if date_from > date_to:
                raise serializers.ValidationError(
                    {"date_from": "La fecha inicial no puede ser posterior a la final."}
                )
            # Inclusivo: (to - from).days + 1 son los días cubiertos.
            if (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
                raise serializers.ValidationError(
                    {"date_to": "El rango de fechas no puede superar 366 días."}
                )
        reg_from = attrs.get("registered_from")
        reg_to = attrs.get("registered_to")
        if reg_from and reg_to:
            if reg_from > reg_to:
                raise serializers.ValidationError(
                    {
                        "registered_from": (
                            "La fecha inicial de registro no puede ser "
                            "posterior a la final."
                        )
                    }
                )
            if (reg_to - reg_from).days + 1 > MAX_RANGE_DAYS:
                raise serializers.ValidationError(
                    {
                        "registered_to": (
                            "El rango de fechas de registro no puede superar 366 días."
                        )
                    }
                )
        return attrs


def _day_bounds(day, end=False):
    """Convierte un ``date`` a aware en America/Bogota (inicio/fin del día)."""
    moment = datetime.combine(day, time.max if end else time.min)
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, BOGOTA_TZ)
    return moment


def build_report_queryset(validated, user):
    """Construye el queryset del reporte según rol y filtros.

    - Profesor: solo marcaciones de sus grupos. Filtrar por grupo/clase/
      sesión ajenos responde 403; ``professor_id`` es solo admin (403).
    - ``course_id`` ajeno NO responde 403: los cursos son compartidos entre
      profesores, así que el filtro se aplica dentro de los grupos propios
      y un curso ajeno simplemente devuelve 200 vacío. Se documenta para
      no confundirlo con el 403 de grupo/clase/sesión.
    - Admin: todo, con filtro opcional por ``professor_id``.
    """
    from apps.academic.models import AcademicGroup, ScheduledClass
    from apps.attendance.models import Attendance, AttendanceSession
    from apps.authentication.models import Professor

    is_admin = getattr(user, "role", None) == UserRole.ROLE_ADMIN
    is_professor = getattr(user, "role", None) == UserRole.ROLE_PROFESSOR

    qs = Attendance.objects.all()

    professor_id = validated.get("professor_id")
    if professor_id and not is_admin:
        raise PermissionDenied("No tienes permiso para filtrar por profesor.")

    if is_professor:
        qs = qs.filter(session__scheduled_class__group__professor__user=user)
        group_id = validated.get("group_id")
        if group_id:
            group = AcademicGroup.objects.select_related("professor__user").filter(
                pk=group_id
            ).first()
            if group is not None and group.professor.user_id != user.id:
                raise PermissionDenied("No tienes acceso a ese grupo.")
        class_ids = validated.get("class_id") or []
        if class_ids:
            owned = set(
                ScheduledClass.objects.filter(
                    pk__in=class_ids, group__professor__user=user
                ).values_list("pk", flat=True)
            )
            if len(owned) != len(class_ids):
                raise PermissionDenied("No tienes acceso a una o más clases.")
        session_id = validated.get("session_id")
        if session_id:
            session = AttendanceSession.objects.select_related(
                "scheduled_class__group__professor__user"
            ).filter(pk=session_id).first()
            if (
                session is not None
                and session.scheduled_class.group.professor.user_id != user.id
            ):
                raise PermissionDenied("No tienes acceso a esa sesión.")
    elif is_admin and professor_id:
        if not Professor.objects.filter(pk=professor_id).exists():
            return Attendance.objects.none()
        qs = qs.filter(session__scheduled_class__group__professor_id=professor_id)

    if validated.get("course_id"):
        qs = qs.filter(session__scheduled_class__group__course_id=validated["course_id"])
    if validated.get("group_id"):
        qs = qs.filter(session__scheduled_class__group_id=validated["group_id"])
    if validated.get("class_id"):
        qs = qs.filter(session__scheduled_class_id__in=validated["class_id"])
    if validated.get("session_id"):
        qs = qs.filter(session_id=validated["session_id"])
    if validated.get("class_status"):
        qs = qs.filter(session__scheduled_class__status=validated["class_status"])
    if validated.get("modality"):
        qs = qs.filter(session__scheduled_class__modality=validated["modality"])

    document = (validated.get("document") or "").strip()
    if document:
        qs = qs.filter(student__document_number__icontains=document)
    student_code = (validated.get("student_code") or "").strip()
    if student_code:
        qs = qs.filter(student__student_code__icontains=student_code)
    search = (validated.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(student__first_name__icontains=search)
            | Q(student__last_name__icontains=search)
            | Q(student__document_number__icontains=search)
            | Q(student__student_code__icontains=search)
            | Q(student__user__email__icontains=search)
        )

    if validated.get("date_from"):
        qs = qs.filter(
            session__scheduled_class__start_time__gte=_day_bounds(validated["date_from"])
        )
    if validated.get("date_to"):
        qs = qs.filter(
            session__scheduled_class__start_time__lte=_day_bounds(
                validated["date_to"], end=True
            )
        )
    if validated.get("registered_from"):
        qs = qs.filter(registered_at__gte=_day_bounds(validated["registered_from"]))
    if validated.get("registered_to"):
        qs = qs.filter(
            registered_at__lte=_day_bounds(validated["registered_to"], end=True)
        )

    has_location = validated.get("has_location") or "all"
    if has_location == "true":
        qs = qs.filter(latitude__isnull=False, longitude__isnull=False)
    elif has_location == "false":
        qs = qs.filter(Q(latitude__isnull=True) | Q(longitude__isnull=True))

    return qs.select_related(
        "student__user",
        "session__scheduled_class__group__course",
        "session__scheduled_class__group__professor__user",
    ).order_by("registered_at", "id")


def report_row(attendance):
    """Serializa una marcación a la fila JSON del reporte."""
    student = getattr(attendance, "student", None)
    session = getattr(attendance, "session", None)
    clase = getattr(session, "scheduled_class", None) if session else None
    group = getattr(clase, "group", None) if clase else None
    course = getattr(group, "course", None) if group else None
    email = getattr(getattr(student, "user", None), "email", None)
    full_name = ""
    if student is not None:
        full_name = f"{student.first_name} {student.last_name}".strip()
    return {
        "id": str(attendance.id),
        "student_name": full_name,
        "student_code": getattr(student, "student_code", None),
        "document_number": getattr(student, "document_number", None),
        "email": email,
        "course_code": getattr(course, "code", None),
        "course_name": getattr(course, "name", None),
        "group_id": str(group.id) if group else None,
        "group_code": getattr(group, "group_code", None),
        "term_period": getattr(group, "term_period", None),
        "class_id": str(clase.id) if clase else None,
        "class_title": getattr(clase, "title", None),
        "class_start_time": getattr(clase, "start_time", None),
        "modality": getattr(clase, "modality", None),
        "class_status": getattr(clase, "status", None),
        "session_id": str(session.id) if session else None,
        "registered_at": attendance.registered_at,
        "has_location": (
            attendance.latitude is not None and attendance.longitude is not None
        ),
    }


#: Filas de datos de la planilla FO-P06-F08 (filas 6-27 del XLSX).
_PLANILLA_ROWS = 22
#: Recursos de la plantilla institucional (A4 apaisada, escala 55 %).
_PLANILLA_DIR = Path(__file__).resolve().parent / "resources"
_PLANILLA_TEMPLATE = _PLANILLA_DIR / "planilla_asistencia.xlsx"
_PLANILLA_LOGO = _PLANILLA_DIR / "logo_ut.png"
_PLANILLA_SHEET = "FO-P06-F08"
#: Etiquetas de cabecera; los guiones bajos son la línea de escritura.
_PLANILLA_LABELS = {
    "A3": "AREA:  _____________________________",
    "B3": "PROGRAMA: ____________________________",
    "E3": "CURSO:  ____________________________",
    "F3": "CÓDIGO: ______________",
    "A4": "SEMESTRE: _________________________",
    "B4": "GRUPO: ____________  ",
    "D4": "AULA No. ______________",
    "E4": "SEDE: ________________________________",
    "F4": "FECHA.: _______________",
}
#: Geometría nominal del bloque en mm (403,1 x 288,9 mm), tomada del XLSX.
_PDF_COL_MM = (79.726, 33.626, 38.567, 50.295, 92.894, 54.0, 54.0)
_PDF_ROW_MM = (9.525, 16.933, 5.715, 11.22, 12.7) + (10.583,) * _PLANILLA_ROWS


def _safe_cell(value):
    """Evita que Excel/Sheets evalúe el texto como fórmula (=, +, -, @)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def _fill_label(label, value):
    """Reemplaza la primera línea de guiones bajos por el dato (vacío: la deja)."""
    if not value:
        return label
    return re.sub(r"_+", lambda _match: str(value), label, count=1)


def _sort_text(text):
    """Clave alfabética sin acentos: ``Álvarez`` ordena antes que ``Zeta``."""
    return (
        unicodedata.normalize("NFKD", text or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


def _planilla_values(block):
    """Datos de cabecera de la planilla (vacío si el reporte no tiene clases)."""
    if block is None:
        return {}
    return {
        "E3": block["course_name"],
        "F3": block["course_code"],
        "B4": block["group_code"],
        "F4": timezone.localtime(block["start_time"], BOGOTA_TZ).strftime(
            "%d/%m/%Y"
        ),
    }


def _planilla_pages(queryset):
    """Agrupa las marcaciones por clase y las reparte en páginas de 22 filas.

    Devuelve ``[(clase, filas), ...]`` ordenado por ``start_time`` y, dentro
    de cada clase, por apellido/nombre. Sin marcaciones devuelve una planilla
    en blanco (``clase`` = ``None``).
    """
    blocks = {}
    for attendance in queryset.iterator(chunk_size=1000):
        clase = attendance.session.scheduled_class
        block = blocks.get(clase.id)
        if block is None:
            group = clase.group
            block = blocks[clase.id] = {
                "id": clase.id,
                "start_time": clase.start_time,
                "course_name": group.course.name,
                "course_code": group.course.code,
                "group_code": group.group_code,
                "rows": [],
            }
        student = attendance.student
        row = report_row(attendance)
        block["rows"].append(
            (
                (_sort_text(student.last_name), _sort_text(student.first_name)),
                [
                    row["student_name"] or "",
                    row["document_number"] or "",
                    row["student_code"] or "",
                    student.phone_number or "",
                    student.address or "",
                    row["email"] or "",
                    timezone.localtime(
                        attendance.registered_at, BOGOTA_TZ
                    ).strftime("%H:%M"),
                ],
            )
        )

    pages = []
    ordered = sorted(blocks.values(), key=lambda b: (b["start_time"], b["id"]))
    for block in ordered:
        rows = [row for _key, row in sorted(block["rows"], key=lambda item: item[0])]
        for start in range(0, len(rows), _PLANILLA_ROWS):
            pages.append((block, rows[start:start + _PLANILLA_ROWS]))
    return pages or [(None, [])]


def _planilla_header(ws, block, page, total):
    """Rellena la cabecera institucional y el número de página."""
    values = _planilla_values(block)
    for coordinate, label in _PLANILLA_LABELS.items():
        ws[coordinate] = _safe_cell(_fill_label(label, values.get(coordinate)))
    ws["G1"] = f"Página {page} de {total}"


def _planilla_rows(ws, rows):
    """Escribe las filas de la página respetando el estilo de la plantilla."""
    # La columna 4 es el teléfono: un "+57..." legítimo no debe llevar apóstrofo.
    protected = (1, 2, 3, 5, 6)
    for offset, values in enumerate(rows):
        for column, value in enumerate(values, start=1):
            if value:
                ws.cell(row=6 + offset, column=column).value = (
                    _safe_cell(value) if column in protected else value
                )


def _planilla_logo(ws):
    """Añade el logo UT sobre A1 (copy_worksheet no copia imágenes)."""
    from openpyxl.drawing.image import Image
    from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
    from openpyxl.drawing.xdr import XDRPositiveSize2D

    logo = Image(str(_PLANILLA_LOGO))
    # Posición y tamaño del logo en la plantilla original (EMU).
    logo.anchor = OneCellAnchor(
        _from=AnchorMarker(col=0, colOff=952500, row=0, rowOff=54329),
        ext=XDRPositiveSize2D(899583, 875594),
    )
    ws.add_image(logo)


def export_xlsx(queryset):
    """Genera el XLSX institucional: una hoja FO-P06-F08 por página."""
    from openpyxl import load_workbook
    from openpyxl.worksheet.properties import PageSetupProperties

    pages = _planilla_pages(queryset)
    wb = load_workbook(_PLANILLA_TEMPLATE)
    template = wb[_PLANILLA_SHEET]
    template._images.clear()
    sheets = []
    for _ in pages:
        # copy_worksheet copia celdas, estilos, merges y página, no imágenes.
        sheets.append(template if not sheets else wb.copy_worksheet(template))
    total = len(sheets)

    for index, ws in enumerate(sheets, start=1):
        ws.title = f"Página {index}"
        ws.print_area = "A1:G27"
        # Ajustar a 1x1 garantiza una sola página A4 apaisada por hoja.
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
        _planilla_logo(ws)
        block, rows = pages[index - 1]
        _planilla_header(ws, block, index, total)
        _planilla_rows(ws, rows)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _pdf_wrap(pdf, text, font, size, max_width):
    """Parte el texto en líneas que quepan en ``max_width`` sin cortar palabras."""
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and pdf.stringWidth(candidate, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def _pdf_text(
    pdf,
    text,
    x,
    y,
    width,
    height,
    font,
    size,
    color,
    align="left",
    valign="middle",
    underline=False,
    wrap=False,
):
    """Texto de una celda de la planilla (``y`` y ``height``: base y alto)."""
    text = str(text or "")
    if not text:
        return
    pad = size * 0.12
    pdf.saveState()
    clip = pdf.beginPath()
    clip.rect(x, y, width, height)
    pdf.clipPath(clip, stroke=0, fill=0)
    pdf.setFillColor(color)
    pdf.setFont(font, size)
    lines = (
        _pdf_wrap(pdf, text, font, size, width - 2 * pad)
        if wrap
        else text.split("\n")
    )
    line_height = size * 1.15
    if valign == "bottom":
        baseline = y + size * 0.25 - (len(lines) - 1) * line_height
    else:
        baseline = (
            y
            + height / 2
            - size * 0.35
            + (len(lines) - 1) * line_height / 2
        )
    for index, line in enumerate(lines):
        line_baseline = baseline - index * line_height
        text_width = pdf.stringWidth(line, font, size)
        if align == "center":
            left = x + (width - text_width) / 2
        elif align == "right":
            left = x + width - pad - text_width
        else:
            left = x + pad
        pdf.drawString(left, line_baseline, line)
        if underline:
            pdf.setStrokeColor(color)
            pdf.setLineWidth(size * 0.05)
            pdf.line(
                left,
                line_baseline - size * 0.12,
                left + text_width,
                line_baseline - size * 0.12,
            )
    pdf.restoreState()


def _pdf_page(pdf, block, rows, page, total, col_x, row_y, block_w, block_h, logo):
    """Dibuja una planilla completa en coordenadas nominales (sin escalar)."""
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    bold = "Helvetica-Bold"
    regular = "Helvetica"
    black = colors.black
    columns = "ABCDEFG"

    # Rejilla: fina interior, banda gruesa bajo las filas 1-4 y marco exterior.
    pdf.setStrokeColor(black)
    pdf.setLineWidth(0.5)
    for y in row_y[1:-1]:
        pdf.line(col_x[0], y, col_x[-1], y)
    # Cabecera A1:F4 fusionada: las verticales interiores solo existen en la
    # tabla (desde el borde superior de la fila 5). El bloque G1:G4 va aparte.
    for x in col_x[1:-1]:
        pdf.line(x, row_y[4], x, row_y[-1])
    pdf.line(col_x[6], row_y[0], col_x[6], row_y[4])
    pdf.setLineWidth(1.6)
    for boundary in (1, 2, 3, 4):
        pdf.line(col_x[0], row_y[boundary], col_x[-1], row_y[boundary])
    pdf.setLineWidth(1.0)
    pdf.rect(0, 0, block_w, block_h, stroke=1, fill=0)

    # Logo UT sobre A1:A2 (misma posición que la plantilla).
    pdf.drawImage(
        logo,
        col_x[0] + 26.38 * mm,
        row_y[0] - 1.51 * mm - 24.31 * mm,
        width=24.98 * mm,
        height=24.31 * mm,
        mask="auto",
    )

    def cell(
        coordinate,
        text,
        font=bold,
        size=12,
        color=black,
        align="left",
        valign="middle",
        underline=False,
        wrap=False,
        span=1,
    ):
        column = columns.index(coordinate[0])
        row = int(coordinate[1:])
        _pdf_text(
            pdf,
            text,
            col_x[column],
            row_y[row],
            col_x[column + span] - col_x[column],
            row_y[row - 1] - row_y[row],
            font,
            size,
            color,
            align,
            valign,
            underline,
            wrap,
        )

    values = _planilla_values(block)
    labels = {
        coordinate: _fill_label(text, values.get(coordinate))
        for coordinate, text in _PLANILLA_LABELS.items()
    }

    cell(
        "B1",
        "PLANIFICACIÓN, DESARROLLO Y VERIFICACIÓN DE LA LABOR ACADÉMICA ",
        size=14,
        color=colors.HexColor("#006600"),
        align="center",
        span=5,
    )
    cell(
        "B2",
        "CONTROL ASISTENCIA ESTUDIANTES",
        size=14,
        color=colors.HexColor("#FF0000"),
        align="center",
        span=5,
    )
    cell("G1", f"Página {page} de {total}", align="center")
    cell("G2", "Código: FO-P06-F08", align="center")
    cell("G3", "Versión: 06", align="center")
    cell("G4", "Fecha Aprobación:\n24-08-2024", align="center")

    # A3/A4 y D4 se recortan en su columna; B3 y B4 desbordan sobre C/D,
    # que están vacías en la plantilla.
    cell("A3", labels["A3"], valign="bottom")
    cell("B3", labels["B3"], valign="bottom", span=3)
    cell("E3", labels["E3"], valign="bottom")
    cell("F3", labels["F3"], valign="bottom")
    cell("A4", labels["A4"], valign="bottom")
    cell("B4", labels["B4"], valign="bottom", span=2)
    cell("D4", labels["D4"], valign="bottom")
    cell("E4", labels["E4"], valign="bottom")
    cell("F4", labels["F4"], valign="bottom")

    for coordinate, text, size, align in (
        ("A5", "NOMBRE ESTUDIANTE", 12, "center"),
        ("B5", "DOCUMENTO IDENTIFICACIÓN", 11, "left"),
        ("C5", "CÓDIGO", 12, "left"),
        ("D5", "TELEFONO ", 10, "center"),
        ("E5", "DIRECCIÓN", 12, "center"),
        ("F5", "CORREO ELECTRÓNICO", 12, "center"),
        ("G5", "FIRMA", 12, "center"),
    ):
        cell(coordinate, text, size=size, align=align, wrap=True)

    signature = colors.HexColor("#0000FF")
    for offset, values_row in enumerate(rows):
        for column, value in enumerate(values_row):
            cell(
                f"{columns[column]}{6 + offset}",
                value,
                font=regular,
                size=10 if column == 5 else 12,
                color=signature if column == 6 else black,
                align="center" if column == 6 else "left",
                underline=column == 6,
            )


def export_pdf(queryset, validated=None):
    """Genera el PDF institucional FO-P06-F08 (A4 apaisada, 1 página por bloque)."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as pdf_canvas

    pages = _planilla_pages(queryset)
    width, height = landscape(A4)
    margin = 10 * mm
    block_w = sum(_PDF_COL_MM) * mm
    block_h = sum(_PDF_ROW_MM) * mm
    # Transformación uniforme: el bloque nominal (403 x 289 mm) cabe completo.
    scale = min((width - 2 * margin) / block_w, (height - 2 * margin) / block_h)
    origin_x = (width - block_w * scale) / 2
    origin_y = (height - block_h * scale) / 2

    col_x = [0.0]
    for value in _PDF_COL_MM:
        col_x.append(col_x[-1] + value * mm)
    row_y = [block_h]
    for value in _PDF_ROW_MM:
        row_y.append(row_y[-1] - value * mm)

    buffer = io.BytesIO()
    pdf = pdf_canvas.Canvas(buffer, pagesize=(width, height), pageCompression=1)
    pdf.setTitle("Reporte de asistencia SIA-QR")
    logo = ImageReader(str(_PLANILLA_LOGO))
    total = len(pages)
    for page, (block, rows) in enumerate(pages, start=1):
        pdf.saveState()
        pdf.translate(origin_x, origin_y)
        pdf.scale(scale, scale)
        _pdf_page(pdf, block, rows, page, total, col_x, row_y, block_w, block_h, logo)
        pdf.restoreState()
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()
