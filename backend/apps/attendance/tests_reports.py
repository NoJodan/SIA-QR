"""Tests del módulo de reportes (RF-PROF-09 / RF-ADM-04)."""

import base64
import hashlib
import io
import re
import zlib
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.academic.models import (
    AcademicGroup,
    ClassStatus,
    Course,
    ScheduledClass,
)
from apps.attendance.models import Attendance, AttendanceSession
from apps.authentication.models import (
    Professor,
    Student,
    User,
)

REPORT_URL = "/api/attendance/reports/"


def _rep_prof(email="reprof@ut.edu.co", code="EMP-REP"):
    user = User.objects.create_user(
        email=email, google_sub=f"sub-{email}", role="ROLE_PROFESSOR"
    )
    prof = Professor.objects.create(
        user=user, employee_code=code, first_name="Repo", last_name="Prof"
    )
    course = Course.objects.create(code=f"C-{code}", name="Curso Reporte")
    group = AcademicGroup.objects.create(
        course=course, professor=prof, group_code="01", term_period="2026-1"
    )
    return user, prof, group


def _rep_class(group, title="Clase Reporte", status=ClassStatus.COMPLETED):
    return ScheduledClass.objects.create(
        group=group,
        title=title,
        start_time=timezone.now() - timedelta(days=1),
        duration_minutes=60,
        qr_duration_minutes=10,
        modality="PRESENTIAL",
        status=status,
    )


def _rep_student(email, code, doc, first="Pena", last="Nino"):
    user = User.objects.create_user(
        email=email, google_sub=f"sub-{email}", role="ROLE_STUDENT"
    )
    student = Student.objects.create(
        user=user, student_code=code, document_number=doc,
        first_name=first, last_name=last,
        phone_number="+57 300 123 4567", address="Calle 1 #2-3",
    )
    return user, student


def _rep_session(clase, n=0):
    raw = f"rep-tok-{clase.id}-{n}-{AttendanceSession.objects.count()}"
    return AttendanceSession.objects.create(
        scheduled_class=clase,
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(minutes=10),
        is_active=False,
    )


def _rep_mark(session, student, lat=None, lon=None):
    return Attendance.objects.create(
        session=session, student=student,
        latitude=lat, longitude=lon, accuracy=None,
        ip_address="127.0.0.1", user_agent="qa",
    )


def _pdf_stream_text(content):
    """Texto de los streams de contenido (ASCII85 + Flate) del PDF."""
    parts = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", content, re.S):
        raw = match.group(1).strip()
        try:
            if raw.endswith(b"~>"):
                raw = base64.a85decode(raw, adobe=True)
            stream = zlib.decompress(raw)
        except (ValueError, zlib.error):
            continue
        if b"BT" in stream:
            parts.append(stream)
    # reportlab escribe los acentos como escapes octales (\323 = Ó en cp1252).
    text = re.sub(
        rb"\\([0-7]{1,3}|.)",
        lambda match: (
            bytes([int(match.group(1), 8)])
            if match.group(1)[:1].isdigit()
            else match.group(1)
        ),
        b"\n".join(parts),
    )
    return text.decode("cp1252", "replace")


class AttendanceReportTests(TestCase):
    def setUp(self):
        self.owner, self.owner_prof, self.group = _rep_prof()
        self.clase = _rep_class(self.group)
        self.session = _rep_session(self.clase)
        _, self.student = _rep_student(
            "munoz@ut.edu.co", "EST-N1", "DOC-N1",
            first="María Peña", last="Muñoz Niño",
        )
        _rep_mark(self.session, self.student, lat="4.5", lon="-75.5")

        self.other, _, self.other_group = _rep_prof(
            email="otro@ut.edu.co", code="EMP-OTR"
        )
        self.other_class = _rep_class(self.other_group, title="Clase Ajena")
        self.other_session = _rep_session(self.other_class, n=99)
        _, self.other_student = _rep_student(
            "otro-est@ut.edu.co", "EST-N2", "DOC-N2"
        )
        _rep_mark(self.other_session, self.other_student)

        self.admin = User.objects.create_user(
            email="adm@ut.edu.co", google_sub="sub-adm", role="ROLE_ADMIN"
        )
        self.owner_client = APIClient()
        self.owner_client.force_login(self.owner)
        self.other_client = APIClient()
        self.other_client.force_login(self.other)
        self.admin_client = APIClient()
        self.admin_client.force_login(self.admin)

    def test_anonymous_is_401(self):
        resp = APIClient().get(REPORT_URL)
        self.assertEqual(resp.status_code, 401)

    def test_student_is_403(self):
        stu_user, _ = _rep_student("solo-est@ut.edu.co", "EST-X", "DOC-X")
        client = APIClient()
        client.force_login(stu_user)
        resp = client.get(REPORT_URL)
        self.assertEqual(resp.status_code, 403)

    def test_prof_sees_only_own(self):
        resp = self.owner_client.get(REPORT_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        row = resp.data["results"][0]
        self.assertIn("Muñoz", row["student_name"])
        self.assertTrue(row["has_location"])

    def test_prof_forbidden_other_group(self):
        resp = self.owner_client.get(
            REPORT_URL, {"group_id": str(self.other_group.id)}
        )
        self.assertEqual(resp.status_code, 403)

    def test_prof_forbidden_other_session(self):
        resp = self.owner_client.get(
            REPORT_URL, {"session_id": str(self.other_session.id)}
        )
        self.assertEqual(resp.status_code, 403)

    def test_prof_cannot_filter_professor_id(self):
        resp = self.owner_client.get(
            REPORT_URL, {"professor_id": str(self.owner_prof.id)}
        )
        self.assertEqual(resp.status_code, 403)

    def test_admin_filters_by_professor(self):
        resp = self.admin_client.get(
            REPORT_URL, {"professor_id": str(self.owner_prof.id)}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        resp_all = self.admin_client.get(REPORT_URL)
        self.assertEqual(resp_all.data["count"], 2)

    def test_search_filters(self):
        resp = self.admin_client.get(REPORT_URL, {"search": "muñoz"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        resp = self.admin_client.get(REPORT_URL, {"document": "DOC-N2"})
        self.assertEqual(resp.data["count"], 1)

    def test_has_location_filter(self):
        resp = self.admin_client.get(REPORT_URL, {"has_location": "false"})
        self.assertEqual(resp.data["count"], 1)
        resp = self.admin_client.get(REPORT_URL, {"has_location": "true"})
        self.assertEqual(resp.data["count"], 1)

    def test_invalid_range_is_400_spanish(self):
        resp = self.admin_client.get(
            REPORT_URL, {"date_from": "2026-01-01", "date_to": "2024-01-01"}
        )
        self.assertEqual(resp.status_code, 400)
        resp = self.admin_client.get(
            REPORT_URL, {"date_from": "2024-01-01", "date_to": "2026-01-01"}
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("366", str(resp.data))

    def test_export_xlsx_headers_and_enie(self):
        resp = self.admin_client.get(
            REPORT_URL, {"format": "xlsx", "class_id": str(self.clase.id)}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(
            "spreadsheetml.sheet", resp["Content-Type"]
        )
        self.assertIn("attachment", resp["Content-Disposition"])
        self.assertIn("filename*=UTF-8", resp["Content-Disposition"])
        self.assertIn("siaqr_reporte_", resp["Content-Disposition"])
        wb = load_workbook(filename=io.BytesIO(resp.content))
        self.assertEqual(wb.sheetnames, ["Página 1"])
        ws = wb["Página 1"]
        headers = {
            "A5": "NOMBRE ESTUDIANTE",
            "B5": "DOCUMENTO IDENTIFICACIÓN",
            "C5": "CÓDIGO",
            "D5": "TELEFONO ",
            "E5": "DIRECCIÓN",
            "F5": "CORREO ELECTRÓNICO",
            "G5": "FIRMA",
        }
        for coordinate, expected in headers.items():
            self.assertEqual(ws[coordinate].value, expected, coordinate)
        self.assertEqual(ws["A6"].value, "María Peña Muñoz Niño")
        self.assertEqual(ws["B6"].value, "DOC-N1")
        self.assertEqual(ws["C6"].value, "EST-N1")
        self.assertEqual(ws["D6"].value, "+57 300 123 4567")
        self.assertEqual(ws["E6"].value, "Calle 1 #2-3")
        self.assertEqual(ws["F6"].value, "munoz@ut.edu.co")
        attendance = Attendance.objects.get(student=self.student)
        self.assertEqual(
            ws["G6"].value,
            timezone.localtime(attendance.registered_at).strftime("%H:%M"),
        )
        self.assertEqual(
            ws["F4"].value,
            "FECHA.: "
            + timezone.localtime(self.clase.start_time).strftime("%d/%m/%Y"),
        )
        self.assertEqual(ws["E3"].value, "CURSO:  Curso Reporte")
        self.assertEqual(ws["F3"].value, "CÓDIGO: C-EMP-REP")
        self.assertEqual(ws["B4"].value, "GRUPO: 01  ")
        self.assertEqual(ws["G1"].value, "Página 1 de 1")
        self.assertEqual(ws.print_area, "'Página 1'!$A$1:$G$27")
        self.assertEqual(ws.page_setup.orientation, "landscape")
        self.assertEqual(str(ws.page_setup.paperSize), "9")
        self.assertTrue(ws.sheet_properties.pageSetUpPr.fitToPage)
        self.assertEqual(len(ws._images), 1)
        self.assertEqual(
            {str(r) for r in ws.merged_cells.ranges},
            {"A1:A2", "B1:F1", "B2:F2"},
        )

    def test_xlsx_paginates_class_over_22_rows(self):
        for index in range(22):
            _, student = _rep_student(
                f"extra{index}@ut.edu.co",
                f"EST-X{index:02d}",
                f"DOC-X{index:02d}",
                first=f"Alumno{index:02d}",
                last=f"Zeta{index:02d}",
            )
            _rep_mark(self.session, student)
        resp = self.admin_client.get(
            REPORT_URL, {"format": "xlsx", "class_id": str(self.clase.id)}
        )
        self.assertEqual(resp.status_code, 200)
        wb = load_workbook(filename=io.BytesIO(resp.content))
        self.assertEqual(wb.sheetnames, ["Página 1", "Página 2"])
        self.assertEqual(wb["Página 1"]["G1"].value, "Página 1 de 2")
        self.assertEqual(wb["Página 2"]["G1"].value, "Página 2 de 2")
        first = [wb["Página 1"].cell(row=r, column=1).value for r in range(6, 28)]
        second = [wb["Página 2"].cell(row=r, column=1).value for r in range(6, 28)]
        self.assertEqual(len([value for value in first if value]), 22)
        self.assertEqual(len([value for value in second if value]), 1)
        self.assertIn("Zeta21", second[0])

    def test_xlsx_orders_by_last_name_without_accents(self):
        clase = _rep_class(self.group, title="Clase Acentos")
        session = _rep_session(clase, n=3)
        for index, (first, last) in enumerate(
            (("Ana", "Álvarez"), ("Bruno", "Óspina"), ("Carlos", "Zeta"))
        ):
            _, student = _rep_student(
                f"acento{index}@ut.edu.co",
                f"EST-A{index}",
                f"DOC-A{index}",
                first=first,
                last=last,
            )
            _rep_mark(session, student)
        resp = self.owner_client.get(
            REPORT_URL, {"format": "xlsx", "class_id": str(clase.id)}
        )
        ws = load_workbook(filename=io.BytesIO(resp.content))["Página 1"]
        self.assertEqual(
            [ws.cell(row=row, column=1).value for row in range(6, 9)],
            ["Ana Álvarez", "Bruno Óspina", "Carlos Zeta"],
        )

    def test_two_classes_global_page_numbers_and_headers(self):
        course = Course.objects.create(code="C-REP2", name="Curso Dos")
        group = AcademicGroup.objects.create(
            course=course,
            professor=self.owner_prof,
            group_code="02",
            term_period="2026-1",
        )
        second = _rep_class(group, title="Clase Dos")
        second.start_time = self.clase.start_time + timedelta(hours=1)
        second.save(update_fields=["start_time"])
        session = _rep_session(second, n=3)
        _, student = _rep_student(
            "dos@ut.edu.co", "EST-D2", "DOC-D2", first="Ana", last="Álvarez"
        )
        _rep_mark(session, student)

        resp = self.owner_client.get(REPORT_URL, {"format": "xlsx"})
        self.assertEqual(resp.status_code, 200)
        wb = load_workbook(filename=io.BytesIO(resp.content))
        self.assertEqual(wb.sheetnames, ["Página 1", "Página 2"])
        self.assertEqual(wb["Página 1"]["G1"].value, "Página 1 de 2")
        self.assertEqual(wb["Página 1"]["E3"].value, "CURSO:  Curso Reporte")
        self.assertEqual(wb["Página 2"]["G1"].value, "Página 2 de 2")
        self.assertEqual(wb["Página 2"]["E3"].value, "CURSO:  Curso Dos")

    def test_xlsx_empty_optional_fields(self):
        self.student.phone_number = None
        self.student.address = None
        self.student.save(update_fields=["phone_number", "address"])
        resp = self.admin_client.get(
            REPORT_URL, {"format": "xlsx", "class_id": str(self.clase.id)}
        )
        ws = load_workbook(filename=io.BytesIO(resp.content))["Página 1"]
        self.assertIsNone(ws["D6"].value)
        self.assertIsNone(ws["E6"].value)
        self.assertEqual(ws["A6"].value, "María Peña Muñoz Niño")

    def test_empty_report_keeps_one_blank_planilla(self):
        resp = self.admin_client.get(
            REPORT_URL, {"format": "xlsx", "search": "sin-resultados"}
        )
        self.assertEqual(resp.status_code, 200)
        wb = load_workbook(filename=io.BytesIO(resp.content))
        self.assertEqual(wb.sheetnames, ["Página 1"])
        ws = wb["Página 1"]
        self.assertEqual(ws["G1"].value, "Página 1 de 1")
        self.assertEqual(ws["A3"].value, "AREA:  _____________________________")
        self.assertIsNone(ws["A6"].value)

        resp = self.admin_client.get(
            REPORT_URL, {"format": "pdf", "search": "sin-resultados"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            len(re.findall(rb"/Type\s*/Page(?![s])", resp.content)), 1
        )

    def test_export_pdf_headers(self):
        resp = self.admin_client.get(REPORT_URL, {"format": "pdf"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertIn("attachment", resp["Content-Disposition"])
        self.assertIn("filename*=UTF-8", resp["Content-Disposition"])
        self.assertTrue(resp.content.startswith(b"%PDF"))
        media_box = re.search(
            rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)", resp.content
        )
        self.assertIsNotNone(media_box)
        self.assertGreater(float(media_box.group(1)), float(media_box.group(2)))

    def test_pdf_first_page_text(self):
        resp = self.owner_client.get(REPORT_URL, {"format": "pdf"})
        self.assertEqual(resp.status_code, 200)
        text = _pdf_stream_text(resp.content)
        self.assertIn(
            "PLANIFICACIÓN, DESARROLLO Y VERIFICACIÓN DE LA LABOR ACADÉMICA",
            text,
        )
        self.assertIn("CONTROL ASISTENCIA ESTUDIANTES", text)
        self.assertIn("CURSO:  Curso Reporte", text)
        self.assertIn("Página 1 de 1", text)

    def test_pdf_paginates_class_over_22_rows(self):
        for index in range(22):
            _, student = _rep_student(
                f"pdfextra{index}@ut.edu.co",
                f"EST-P{index:02d}",
                f"DOC-P{index:02d}",
            )
            _rep_mark(self.session, student)
        resp = self.admin_client.get(
            REPORT_URL, {"format": "pdf", "class_id": str(self.clase.id)}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            len(re.findall(rb"/Type\s*/Page(?![s])", resp.content)), 2
        )

    def test_export_cap_5000(self):
        with patch(
            "apps.attendance.views_reports.MAX_EXPORT_ROWS", 1
        ):
            resp = self.admin_client.get(REPORT_URL, {"format": "xlsx"})
            self.assertEqual(resp.status_code, 400)
            self.assertIn("ximo", str(resp.data))

    def test_pdf_escapes_user_input(self):
        # ALTO 1: search con <>&ñ no debe romper el Paragraph (antes 500).
        resp = self.admin_client.get(
            REPORT_URL, {"format": "pdf", "search": "<test>&ñ"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_format_case_insensitive(self):
        # BAJO 6: validate_format lower antes era muerto (ChoiceField 400).
        resp = self.admin_client.get(REPORT_URL, {"format": "XLSX"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("spreadsheetml.sheet", resp["Content-Type"])
        resp = self.admin_client.get(REPORT_URL, {"format": "PDF"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/pdf")
        resp = self.admin_client.get(REPORT_URL, {"format": "JSON"})
        self.assertEqual(resp.status_code, 200)

    def test_pdf_cap_lower_than_xlsx(self):
        # MEDIO 5: PDF capa a 1000 (XLSX sigue en 5000).
        from apps.attendance import reports as _reports

        self.assertLessEqual(_reports.MAX_PDF_ROWS, 1000)
        self.assertEqual(_reports.MAX_EXPORT_ROWS, 5000)
        with patch("apps.attendance.views_reports.MAX_PDF_ROWS", 1):
            resp = self.admin_client.get(REPORT_URL, {"format": "pdf"})
            self.assertEqual(resp.status_code, 400)
            self.assertIn("1", str(resp.data))
        # Con el mismo tope 1, xlsx con 2 filas también cae, pero con
        # topes reales el pdf cae antes: simula 2 filas con cap pdf=1.
        with patch("apps.attendance.views_reports.MAX_EXPORT_ROWS", 5):
            resp = self.admin_client.get(REPORT_URL, {"format": "xlsx"})
            self.assertEqual(resp.status_code, 200)

    def test_range_366_inclusive(self):
        # BAJO 11: 366 días inclusivos OK, 367 rechaza.
        resp = self.admin_client.get(
            REPORT_URL,
            {"date_from": "2024-01-01", "date_to": "2024-12-31"},
        )
        self.assertEqual(resp.status_code, 200)
        resp = self.admin_client.get(
            REPORT_URL,
            {"date_from": "2024-01-01", "date_to": "2025-01-01"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_course_ajeno_returns_empty_200(self):
        # BAJO 9: course_id ajeno no es 403 (cursos compartidos), es 200 vacío.
        from apps.academic.models import Course

        other_course = Course.objects.create(code="C-AJENO", name="Ajeno")
        resp = self.owner_client.get(
            REPORT_URL, {"course_id": str(other_course.id)}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 0)

    def test_ordering_deterministic(self):
        # BAJO 7: order_by registered_at + id es determinista.
        from apps.attendance.reports import build_report_queryset

        qs = build_report_queryset({}, self.admin)
        self.assertIn("id", str(qs.query.order_by))
