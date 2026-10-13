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


def _make_student(email, code="EST-QA", doc="DOC-QA"):
    user = User.objects.create_user(
        email=email, google_sub=f"sub-{email}", role="ROLE_STUDENT"
    )
    student = Student.objects.create(
        user=user, student_code=code, document_number=doc,
        first_name="Est", last_name="QA",
        phone_number="+57 300 123 4567", address="Calle 1 #2-3",
    )
    return user, student


class MarkGeoToleranceTests(TestCase):
    """RNF-06: la geo nunca bloquea la marcación (no 400 por decimales)."""

    def test_serializer_rounds_15_decimals(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        ser = MarkAttendanceSerializer(data={
            "token": "tok",
            "latitude": 4.123456789012345,
            "longitude": -75.123456789012345,
            "accuracy": 12.3456789,
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(str(ser.validated_data["latitude"]), "4.12345679")
        self.assertEqual(str(ser.validated_data["longitude"]), "-75.12345679")
        self.assertEqual(str(ser.validated_data["accuracy"]), "12.35")

    def test_serializer_accepts_str_geo(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        ser = MarkAttendanceSerializer(data={
            "token": "tok",
            "latitude": "4.123456789012345",
            "longitude": "-75.123456789012345",
            "accuracy": "3.14159",
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(str(ser.validated_data["latitude"]), "4.12345679")
        self.assertEqual(str(ser.validated_data["accuracy"]), "3.14")

    def test_serializer_null_empty_missing_pass(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        for geo in (
            {"latitude": None, "longitude": None, "accuracy": None},
            {"latitude": "", "longitude": "", "accuracy": ""},
            {},
        ):
            ser = MarkAttendanceSerializer(data={"token": "tok", **geo})
            self.assertTrue(ser.is_valid(), ser.errors)
            self.assertIsNone(ser.validated_data.get("latitude"))
            self.assertIsNone(ser.validated_data.get("longitude"))
            self.assertIsNone(ser.validated_data.get("accuracy"))

    def test_serializer_out_of_range_coerces_to_none(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        ser = MarkAttendanceSerializer(data={
            "token": "tok", "latitude": 91, "longitude": 200, "accuracy": -5,
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertIsNone(ser.validated_data.get("latitude"))
        self.assertIsNone(ser.validated_data.get("longitude"))
        self.assertIsNone(ser.validated_data.get("accuracy"))

    def test_serializer_garbage_coerces_to_none(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        ser = MarkAttendanceSerializer(data={
            "token": "tok", "latitude": "NaN", "longitude": "abc", "accuracy": "Infinity",
        })
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertIsNone(ser.validated_data.get("latitude"))
        self.assertIsNone(ser.validated_data.get("longitude"))
        self.assertIsNone(ser.validated_data.get("accuracy"))

    def test_serializer_token_still_strict(self):
        from apps.attendance.serializers import MarkAttendanceSerializer

        for bad in ("", "   "):
            ser = MarkAttendanceSerializer(data={"token": bad})
            self.assertFalse(ser.is_valid())
            self.assertIn("token", ser.errors)
        ser = MarkAttendanceSerializer(data={})
        self.assertFalse(ser.is_valid())
        self.assertIn("token", ser.errors)


class MarkAttendanceGeoMatrixTests(TestCase):
    """Matriz POST /api/attendance/mark/ con/sin geo y códigos de estado."""

    def _mark(self, email, raw, payload_extra=None, code="EST-M", doc="DOC-M"):
        user, _ = _make_student(email, code=code, doc=doc)
        client = APIClient()
        client.force_login(user)
        body = {"token": raw}
        if payload_extra:
            body.update(payload_extra)
        return client.post("/api/attendance/mark/", body, format="json")

    def test_mark_with_precise_geo_is_201(self):
        _, _, group = _make_prof_group(email="geoprof@ut.edu.co")
        _, raw = _make_session(_make_class(group))
        resp = self._mark("geo1@ut.edu.co", raw, {
            "latitude": 4.123456789012345,
            "longitude": -75.1234567890123,
            "accuracy": 12.3456789,
        }, code="EST-G1", doc="DOC-G1")
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.data.get("already_marked"))

    def test_mark_without_geo_is_201(self):
        _, _, group = _make_prof_group(email="nogeo@ut.edu.co")
        _, raw = _make_session(_make_class(group))
        resp = self._mark("geo2@ut.edu.co", raw,
                          {"latitude": None, "longitude": None, "accuracy": None},
                          code="EST-G2", doc="DOC-G2")
        self.assertEqual(resp.status_code, 201)

    def test_mark_with_long_accuracy_is_201(self):
        _, _, group = _make_prof_group(email="accprof@ut.edu.co")
        _, raw = _make_session(_make_class(group))
        resp = self._mark("geo3@ut.edu.co", raw, {
            "latitude": 4.5, "longitude": -75.5, "accuracy": 9.87654321,
        }, code="EST-G3", doc="DOC-G3")
        self.assertEqual(resp.status_code, 201)

    def test_mark_invalid_token_is_404(self):
        resp = self._mark("geo4@ut.edu.co", "token-inexistente",
                          code="EST-G4", doc="DOC-G4")
        # Sin sesión existente el flujo llega a token->404 (el perfil existe).
        self.assertEqual(resp.status_code, 404)

    def test_mark_expired_is_410(self):
        _, _, group = _make_prof_group(email="expprof@ut.edu.co")
        session, raw = _make_session(_make_class(group))
        session.expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["expires_at"])
        resp = self._mark("geo5@ut.edu.co", raw, code="EST-G5", doc="DOC-G5")
        self.assertEqual(resp.status_code, 410)

    def test_mark_without_profile_is_412(self):
        _, _, group = _make_prof_group(email="noprof@ut.edu.co")
        _, raw = _make_session(_make_class(group))
        user = User.objects.create_user(
            email="sinperfil@ut.edu.co", google_sub="sub-sinperfil",
            role="ROLE_STUDENT",
        )
        client = APIClient()
        client.force_login(user)
        resp = client.post("/api/attendance/mark/", {"token": raw}, format="json")
        self.assertEqual(resp.status_code, 412)

    def test_mark_duplicate_is_200_already_marked(self):
        _, _, group = _make_prof_group(email="dupprof@ut.edu.co")
        _, raw = _make_session(_make_class(group))
        user, _ = _make_student("geo6@ut.edu.co", code="EST-G6", doc="DOC-G6")
        client = APIClient()
        client.force_login(user)
        first = client.post("/api/attendance/mark/",
                            {"token": raw, "latitude": 4.123456789012345,
                             "longitude": -75.1234567890123, "accuracy": 5.55555},
                            format="json")
        self.assertEqual(first.status_code, 201)
        second = client.post("/api/attendance/mark/", {"token": raw}, format="json")
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data.get("already_marked"))

    def test_mark_closed_class_is_409(self):
        _, _, group = _make_prof_group(email="closedprof@ut.edu.co")
        _, raw = _make_session(_make_class(group, status=ClassStatus.COMPLETED))
        resp = self._mark("geo7@ut.edu.co", raw, code="EST-G7", doc="DOC-G7")
        self.assertEqual(resp.status_code, 409)


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
        from allauth.socialaccount.models import SocialAccount

        student_user = User.objects.create_user(
            email="newstu@ut.edu.co", google_sub="sub-new", role="ROLE_STUDENT"
        )
        SocialAccount.objects.create(
            user=student_user, provider="google", uid="sub-new",
            extra_data={"given_name": "Real", "family_name": "Estudiante"},
        )
        client = APIClient()
        client.force_login(student_user)
        resp = client.patch(
            "/api/auth/me/",
            {"student_code": "EST-REAL-1", "document_number": "123456",
             "phone_number": "+57 300 123 4567", "address": "Calle 1 #2-3",
             "first_name": "Real", "last_name": "Estudiante"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data.get("needs_profile"))
        self.assertEqual(Student.objects.get(user=student_user).document_number, "123456")

    def test_patch_student_duplicate_is_409(self):
        from allauth.socialaccount.models import SocialAccount

        u1 = User.objects.create_user(email="s1@ut.edu.co", google_sub="s1", role="ROLE_STUDENT")
        Student.objects.create(
            user=u1, student_code="EST-DUP", document_number="DOC-DUP",
            first_name="A", last_name="B", phone_number="+57 300 111 1111",
            address="Dir 1",
        )
        u2 = User.objects.create_user(email="s2@ut.edu.co", google_sub="s2", role="ROLE_STUDENT")
        SocialAccount.objects.create(
            user=u2, provider="google", uid="s2",
            extra_data={"given_name": "C", "family_name": "D"},
        )
        client = APIClient()
        client.force_login(u2)
        resp = client.patch(
            "/api/auth/me/",
            {"student_code": "EST-DUP", "document_number": "DOC-OTHER",
             "phone_number": "+57 300 222 2222", "address": "Dir 2",
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
