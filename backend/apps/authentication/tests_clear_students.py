"""Tests del comando clear_students.

Fixtures: 2 students CON attendance + 1 student SIN perfil + 1 professor
+ 1 admin + curso/grupo/clase/sesion. Verifica borrado selectivo,
dry-run, e idempotencia.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from io import StringIO

from apps.academic.models import AcademicGroup, Course, ScheduledClass
from apps.attendance.models import Attendance, AttendanceSession, SystemConfig
from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    Student,
    UserRole,
)

User = get_user_model()


class ClearStudentsCommandTests(TestCase):
    def setUp(self):
        # Admin + professor (deben preservarse).
        self.admin = User.objects.create_superuser(
            email="admin@ut.edu.co", password="x",
        )
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

        # Curso/grupo/clase/sesion (deben preservarse intactos).
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
            token_hash="hash-abc-123",
            expires_at=timezone.now() + timedelta(minutes=30),
            is_active=True,
        )

        # 2 students CON perfil + attendance.
        self.students = []
        for i in (1, 2):
            u = User.objects.create_user(
                email=f"est{i}@ut.edu.co",
                google_sub=f"sub-est{i}",
                role=UserRole.ROLE_STUDENT,
            )
            s = Student.objects.create(
                user=u,
                student_code=f"EST-00{i}",
                document_number=f"DOC-00{i}",
                first_name=f"Est{i}",
                last_name="Uno",
            )
            Attendance.objects.create(
                session=self.session,
                student=s,
                ip_address="127.0.0.1",
                user_agent="test-agent",
            )
            self.students.append(u)

        # 1 student SIN perfil (needs_profile).
        self.no_profile = User.objects.create_user(
            email="sinperfil@ut.edu.co",
            google_sub="sub-sinperfil",
            role=UserRole.ROLE_STUDENT,
        )

    def test_clear_students_borra_solo_students_y_preserva_resto(self):
        session_id = self.session.pk
        token = self.session.token_hash
        out = StringIO()
        call_command("clear_students", "--yes", stdout=out)

        self.assertEqual(User.objects.filter(role=UserRole.ROLE_STUDENT).count(), 0)
        self.assertEqual(Student.objects.count(), 0)
        self.assertEqual(Attendance.objects.count(), 0)
        # Preservados.
        self.assertTrue(User.objects.filter(pk=self.prof_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())
        self.assertTrue(Professor.objects.filter(pk=self.prof.pk).exists())
        self.assertTrue(
            AuthorizedProfessorEmail.objects.filter(email="whitelist@ut.edu.co").exists()
        )
        self.assertTrue(Course.objects.filter(pk=self.course.pk).exists())
        self.assertTrue(AcademicGroup.objects.filter(pk=self.group.pk).exists())
        self.assertTrue(ScheduledClass.objects.filter(pk=self.sched.pk).exists())
        ses = AttendanceSession.objects.get(pk=session_id)
        self.assertEqual(ses.token_hash, token)
        self.assertTrue(SystemConfig.objects.filter(config_key="ALLOWED_DOMAIN").exists())

    def test_dry_run_no_borra(self):
        out = StringIO()
        call_command("clear_students", "--dry-run", stdout=out)
        self.assertEqual(User.objects.filter(role=UserRole.ROLE_STUDENT).count(), 3)
        self.assertEqual(Student.objects.count(), 2)
        self.assertEqual(Attendance.objects.count(), 2)

    def test_idempotencia_segunda_corrida_exit_0(self):
        call_command("clear_students", "--yes", stdout=StringIO())
        out = StringIO()
        call_command("clear_students", "--yes", stdout=out)  # 0 -> mensaje y exit 0
        self.assertIn("No hay estudiantes", out.getvalue())
        self.assertEqual(User.objects.filter(role=UserRole.ROLE_STUDENT).count(), 0)
