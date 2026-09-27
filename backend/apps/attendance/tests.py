"""Tests de regresión QA v2 (C2, C3, M1, M2, M3)."""

import hashlib
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academic.models import (
    AcademicGroup,
    ClassStatus,
    Course,
    ScheduledClass,
)
from apps.attendance.models import AttendanceSession
from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    Student,
    User,
)


def _make_prof_group(email="prof@ut.edu.co"):
    user = User.objects.create_user(email=email, google_sub=f"sub-{email}", role="ROLE_PROFESSOR")
    prof = Professor.objects.create(
        user=user, employee_code=f"EMP-{email[:3].upper()}", first_name="Ana", last_name="Perez"
    )
    course = Course.objects.create(code=f"C-{email[:3].upper()}", name="Curso QA")
    group = AcademicGroup.objects.create(
        course=course, professor=prof, group_code="01", term_period="2026-1"
    )
    return user, prof, group


def _make_class(group, status=ClassStatus.IN_PROGRESS):
    return ScheduledClass.objects.create(
        group=group,
        title="Clase QA",
        start_time=timezone.now(),
        duration_minutes=60,
        qr_duration_minutes=10,
        modality="PRESENTIAL",
        status=status,
    )


def _make_session(clase, active=True):
    raw = f"tok-{clase.id}-{AttendanceSession.objects.count()}"
    return AttendanceSession.objects.create(
        scheduled_class=clase,
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(minutes=10),
        is_active=active,
    ), raw


class SingleActiveConstraintTests(TestCase):
    def test_two_active_sessions_same_class_violates_constraint(self):
        _, _, group = _make_prof_group()
        clase = _make_class(group)
        _make_session(clase)
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            _make_session(clase)

    def test_generate_session_keeps_single_active(self):
        from apps.attendance.services import generate_session

        _, _, group = _make_prof_group(email="prof2@ut.edu.co")
        clase = _make_class(group, status=ClassStatus.SCHEDULED)
        generate_session(clase)
        generate_session(clase)
        self.assertEqual(
            AttendanceSession.objects.filter(scheduled_class=clase, is_active=True).count(), 1
        )


class ClosedClassTests(TestCase):
    def test_generate_session_on_completed_class_is_409(self):
        user, _, group = _make_prof_group(email="prof3@ut.edu.co")
        clase = _make_class(group, status=ClassStatus.COMPLETED)
        client = APIClient()
        client.force_login(user)
        resp = client.post(f"/api/academic/groups/{group.id}/classes/{clase.id}/sessions/", {})
        self.assertEqual(resp.status_code, 409)

    def test_mark_on_cancelled_class_is_409(self):
        _, _, group = _make_prof_group(email="prof4@ut.edu.co")
        clase = _make_class(group, status=ClassStatus.CANCELLED)
        session, raw = _make_session(clase)
        student_user = User.objects.create_user(
            email="stu@ut.edu.co", google_sub="sub-stu", role="ROLE_STUDENT"
        )
        Student.objects.create(
            user=student_user, student_code="EST-1", document_number="DOC-1",
            first_name="Est", last_name="Uno",
        )
        client = APIClient()
        client.force_login(student_user)
        resp = client.post("/api/attendance/mark/", {"token": raw}, format="json")
        self.assertEqual(resp.status_code, 409)

    def test_resolve_on_completed_class_is_410(self):
        _, _, group = _make_prof_group(email="prof5@ut.edu.co")
        clase = _make_class(group, status=ClassStatus.COMPLETED)
        _, raw = _make_session(clase)
        student_user = User.objects.create_user(
            email="stu2@ut.edu.co", google_sub="sub-stu2", role="ROLE_STUDENT"
        )
        client = APIClient()
        client.force_login(student_user)
        resp = client.get("/api/attendance/resolve/", {"token": raw})
        self.assertEqual(resp.status_code, 410)


class StudentProfileTests(TestCase):
    def test_mark_without_profile_is_412_needs_profile(self):
        _, _, group = _make_prof_group(email="prof6@ut.edu.co")
        clase = _make_class(group)
        _, raw = _make_session(clase)
        student_user = User.objects.create_user(
            email="noprofile@ut.edu.co", google_sub="sub-np", role="ROLE_STUDENT"
        )
        client = APIClient()
        client.force_login(student_user)
        resp = client.post("/api/attendance/mark/", {"token": raw}, format="json")
        self.assertEqual(resp.status_code, 412)
        self.assertTrue(resp.data.get("needs_profile"))

    def test_patch_student_profile_creates_real_profile(self):
        student_user = User.objects.create_user(
            email="newstu@ut.edu.co", google_sub="sub-new", role="ROLE_STUDENT"
        )
        client = APIClient()
        client.force_login(student_user)
        resp = client.patch(
            "/api/auth/me/",
            {"student_code": "EST-REAL-1", "document_number": "123456",
             "first_name": "Real", "last_name": "Estudiante"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data.get("needs_profile"))
        self.assertEqual(Student.objects.get(user=student_user).document_number, "123456")

    def test_patch_student_duplicate_is_409(self):
        u1 = User.objects.create_user(email="s1@ut.edu.co", google_sub="s1", role="ROLE_STUDENT")
        Student.objects.create(
            user=u1, student_code="EST-DUP", document_number="DOC-DUP",
            first_name="A", last_name="B",
        )
        u2 = User.objects.create_user(email="s2@ut.edu.co", google_sub="s2", role="ROLE_STUDENT")
        client = APIClient()
        client.force_login(u2)
        resp = client.patch(
            "/api/auth/me/",
            {"student_code": "EST-DUP", "document_number": "DOC-OTHER",
             "first_name": "C", "last_name": "D"},
            format="json",
        )
        self.assertEqual(resp.status_code, 409)


class ProfessorReconcileTests(TestCase):
    def test_me_promotes_late_whitelisted_student(self):
        user = User.objects.create_user(
            email="late@ut.edu.co", google_sub="sub-late", role="ROLE_STUDENT"
        )
        AuthorizedProfessorEmail.objects.create(email="late@ut.edu.co")
        client = APIClient()
        client.force_login(user)
        resp = client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["role"], "ROLE_PROFESSOR")
        user.refresh_from_db()
        self.assertEqual(user.role, "ROLE_PROFESSOR")
        self.assertTrue(Professor.objects.filter(user=user).exists())
