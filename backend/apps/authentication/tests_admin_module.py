"""Tests del módulo Administrador: listado de estudiantes y limpieza total.

Fixtures: admin autorizado (PURGE_ADMIN_EMAIL), otro admin, 1 profesor con
perfil, 3 estudiantes con perfil, curso/grupo/clase/sesión QR/asistencia.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academic.models import AcademicGroup, Course, ScheduledClass
from apps.attendance.models import Attendance, AttendanceSession, AuditLog, SystemConfig
from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    Student,
    User,
    UserRole,
)
from apps.authentication.views import PURGE_ADMIN_EMAIL

STUDENT_FIELDS = {
    "id",
    "user_id",
    "student_code",
    "document_number",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone_number",
    "address",
    "created_at",
}


class AdminModuleTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(email=PURGE_ADMIN_EMAIL, password="x")
        self.other_admin = User.objects.create_superuser(email="admin2@ut.edu.co", password="x")

        self.prof_user = User.objects.create_user(
            email="prof@ut.edu.co",
            google_sub="sub-prof",
            role=UserRole.ROLE_PROFESSOR,
        )
        self.prof = Professor.objects.create(
            user=self.prof_user,
            employee_code="UT-001",
            first_name="Ana",
            last_name="Perez",
        )
        AuthorizedProfessorEmail.objects.create(email="whitelist@ut.edu.co")
        SystemConfig.objects.create(config_key="ALLOWED_DOMAIN", config_value="ut.edu.co")
        self.audit = AuditLog.objects.create(
            actor=self.admin, event_type="login_success", resource="user:test"
        )

        self.course = Course.objects.create(code="MAT-101", name="Matematicas")
        self.group = AcademicGroup.objects.create(
            course=self.course,
            professor=self.prof,
            group_code="01",
            term_period="2026-1",
        )
        self.sched = ScheduledClass.objects.create(
            group=self.group,
            title="Clase 1",
            start_time=timezone.now() + timedelta(hours=1),
            duration_minutes=60,
        )
        self.session = AttendanceSession.objects.create(
            scheduled_class=self.sched,
            token_hash="hash-admin-1",
            expires_at=timezone.now() + timedelta(minutes=30),
            is_active=True,
        )

        self.students = []
        for code, document, first, last in (
            ("202600000001", "1000001", "Laura", "Gomez"),
            ("202600000002", "1000002", "Carlos", "Ramirez"),
            ("202600000003", "1000003", "Diana", "Zapata"),
        ):
            user = User.objects.create_user(
                email=f"{first.lower()}@ut.edu.co",
                google_sub=f"sub-{code}",
                role=UserRole.ROLE_STUDENT,
            )
            self.students.append(
                Student.objects.create(
                    user=user,
                    student_code=code,
                    document_number=document,
                    first_name=first,
                    last_name=last,
                )
            )
        Attendance.objects.create(
            session=self.session,
            student=self.students[0],
            ip_address="127.0.0.1",
            user_agent="test-agent",
        )

        self.client = APIClient()

    def test_listado_admin_paginado_con_campos(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/auth/admin/students/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 3)
        row = resp.data["results"][0]
        self.assertEqual(set(row.keys()), STUDENT_FIELDS)
        self.assertEqual(row["full_name"], "Laura Gomez")
        self.assertEqual(row["email"], "laura@ut.edu.co")
        self.assertEqual(row["student_code"], "202600000001")
        self.assertEqual(row["user_id"], str(self.students[0].user_id))

    def test_listado_rechaza_profesor_y_estudiante(self):
        for user in (self.prof_user, self.students[0].user):
            client = APIClient()
            client.force_login(user)
            resp = client.get("/api/auth/admin/students/")
            self.assertEqual(resp.status_code, 403)

    def test_busqueda_por_apellido(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/auth/admin/students/", {"search": "Ramirez"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["first_name"], "Carlos")

    def test_busqueda_por_codigo_documento_y_correo(self):
        self.client.force_login(self.admin)
        for term, expected_email in (
            ("202600000003", "diana@ut.edu.co"),
            ("1000001", "laura@ut.edu.co"),
            ("carlos@ut.edu.co", "carlos@ut.edu.co"),
        ):
            resp = self.client.get("/api/auth/admin/students/", {"search": term})
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.data["count"], 1)
            self.assertEqual(resp.data["results"][0]["email"], expected_email)

    def test_clear_users_autorizado_borra_y_preserva(self):
        self.client.force_login(self.admin)
        resp = self.client.post("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.data,
            {
                "students": 3,
                "professors": 1,
                "groups": 1,
                "classes": 1,
                "sessions": 1,
                "attendances": 1,
                "courses": 1,
            },
        )
        self.assertEqual(User.objects.filter(role__in=[UserRole.ROLE_PROFESSOR, UserRole.ROLE_STUDENT]).count(), 0)
        self.assertEqual(Student.objects.count(), 0)
        self.assertEqual(Professor.objects.count(), 0)
        self.assertEqual(AcademicGroup.objects.count(), 0)
        self.assertEqual(ScheduledClass.objects.count(), 0)
        self.assertEqual(AttendanceSession.objects.count(), 0)
        self.assertEqual(Attendance.objects.count(), 0)
        self.assertEqual(Course.objects.count(), 0)

        # Preservados.
        self.assertTrue(User.objects.filter(pk=self.other_admin.pk).exists())
        self.assertTrue(AuthorizedProfessorEmail.objects.filter(email="whitelist@ut.edu.co").exists())
        self.assertTrue(SystemConfig.objects.filter(config_key="ALLOWED_DOMAIN").exists())
        self.assertTrue(AuditLog.objects.filter(pk=self.audit.pk).exists())
        self.assertTrue(
            AuditLog.objects.filter(event_type="admin_clear_users", actor=self.admin).exists()
        )

    def test_clear_users_otro_admin_403_sin_borrar(self):
        self.client.force_login(self.other_admin)
        resp = self.client.post("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(
            resp.data["error"],
            "Solo el administrador autorizado puede ejecutar esta acción.",
        )
        self.assertEqual(Student.objects.count(), 3)
        self.assertEqual(User.objects.filter(role=UserRole.ROLE_PROFESSOR).count(), 1)
        self.assertEqual(Professor.objects.count(), 1)
        self.assertEqual(AcademicGroup.objects.count(), 1)
        self.assertEqual(ScheduledClass.objects.count(), 1)
        self.assertEqual(AttendanceSession.objects.count(), 1)
        self.assertEqual(Attendance.objects.count(), 1)
        self.assertEqual(Course.objects.count(), 1)

    def test_clear_users_profesor_403(self):
        self.client.force_login(self.prof_user)
        resp = self.client.post("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Student.objects.count(), 3)
        self.assertEqual(Professor.objects.count(), 1)

    def test_clear_users_csrf_requerido_403_sin_borrar(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin)
        resp = client.post("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Student.objects.count(), 3)
        self.assertEqual(Professor.objects.count(), 1)
        self.assertEqual(AcademicGroup.objects.count(), 1)
        self.assertTrue(User.objects.filter(pk=self.prof_user.pk).exists())

    def test_clear_users_anonimo_401_sin_borrar(self):
        resp = APIClient().post("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 401)
        self.assertEqual(Student.objects.count(), 3)
        self.assertEqual(Professor.objects.count(), 1)
        self.assertEqual(AcademicGroup.objects.count(), 1)

    def test_clear_users_get_405(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/api/auth/admin/clear-users/")

        self.assertEqual(resp.status_code, 405)

    def test_clear_users_idempotente(self):
        self.client.force_login(self.admin)
        first = self.client.post("/api/auth/admin/clear-users/")
        second = self.client.post("/api/auth/admin/clear-users/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            second.data,
            {
                "students": 0,
                "professors": 0,
                "groups": 0,
                "classes": 0,
                "sessions": 0,
                "attendances": 0,
                "courses": 0,
            },
        )
