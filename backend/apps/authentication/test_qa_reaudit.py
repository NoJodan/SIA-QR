"""Regresión re-auditoría QA (B1-B4, m2)."""

from django.test import TestCase
from rest_framework.test import APIClient
from allauth.socialaccount.models import SocialAccount

from apps.authentication.models import Student, User


def _mk_student_user(email, uid, given="Test", family="User", name=None):
    u = User.objects.create_user(email=email, google_sub=uid, role="ROLE_STUDENT")
    extra = {"given_name": given, "family_name": family}
    if name is not None:
        extra = {"name": name}
    SocialAccount.objects.create(user=u, provider="google", uid=uid, extra_data=extra)
    return u


def _payload(code="EST-X", doc="DOC-X", phone="+57 300 123 4567", addr="Calle 1 #2-3"):
    return {
        "student_code": code,
        "document_number": doc,
        "phone_number": phone,
        "address": addr,
    }


class B2PhoneDigitsTests(TestCase):
    def test_spaces_only_is_400(self):
        u = _mk_student_user("b2a@ut.edu.co", "b2a")
        c = APIClient()
        c.force_login(u)
        r = c.patch("/api/auth/me/", _payload(phone="       "), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("phone_number", r.data)

    def test_dashes_only_is_400(self):
        u = _mk_student_user("b2b@ut.edu.co", "b2b")
        c = APIClient()
        c.force_login(u)
        r = c.patch("/api/auth/me/", _payload(phone="-------"), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("phone_number", r.data)

    def test_valid_colombian_phone_is_201_or_200(self):
        u = _mk_student_user("b2c@ut.edu.co", "b2c")
        c = APIClient()
        c.force_login(u)
        r = c.patch("/api/auth/me/", _payload(phone="+57 300 123 4567"), format="json")
        self.assertIn(r.status_code, (200, 201))


class B3MononymTests(TestCase):
    def test_single_word_google_name_does_not_block(self):
        u = _mk_student_user("mad@ut.edu.co", "mad", name="Madonna")
        c = APIClient()
        c.force_login(u)
        r = c.patch("/api/auth/me/", _payload(code="EST-MAD", doc="DOC-MAD"), format="json")
        self.assertEqual(r.status_code, 200)
        st = Student.objects.get(user=u)
        self.assertEqual(st.first_name, "Madonna")
        self.assertTrue(st.last_name)


class B4IncompleteProfileTests(TestCase):
    def test_null_phone_means_needs_profile(self):
        u = User.objects.create_user(
            email="old@ut.edu.co", google_sub="old", role="ROLE_STUDENT"
        )
        Student.objects.create(
            user=u, student_code="EST-OLD", document_number="DOC-OLD",
            first_name="Viejo", last_name="Est", phone_number=None, address=None,
        )
        c = APIClient()
        c.force_login(u)
        r = c.get("/api/auth/me/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.get("needs_profile"))

    def test_null_phone_mark_is_412(self):
        import hashlib
        from datetime import timedelta
        from django.utils import timezone
        from apps.academic.models import AcademicGroup, Course, ScheduledClass
        from apps.attendance.models import AttendanceSession
        from apps.authentication.models import Professor

        prof_u = User.objects.create_user(
            email="p@ut.edu.co", google_sub="p", role="ROLE_PROFESSOR"
        )
        prof = Professor.objects.create(
            user=prof_u, employee_code="EMP-P", first_name="A", last_name="B"
        )
        course = Course.objects.create(code="C-P", name="Curso")
        group = AcademicGroup.objects.create(
            course=course, professor=prof, group_code="01", term_period="2026-1"
        )
        clase = ScheduledClass.objects.create(
            group=group, title="C", start_time=timezone.now(),
            duration_minutes=60, modality="PRESENTIAL", status="IN_PROGRESS",
        )
        raw = "tok-b4-1"
        AttendanceSession.objects.create(
            scheduled_class=clase,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=10),
            is_active=True,
        )
        u = User.objects.create_user(
            email="old2@ut.edu.co", google_sub="old2", role="ROLE_STUDENT"
        )
        Student.objects.create(
            user=u, student_code="EST-OLD2", document_number="DOC-OLD2",
            first_name="V", last_name="E", phone_number=None, address="Alguna",
        )
        c = APIClient()
        c.force_login(u)
        r = c.post("/api/attendance/mark/", {"token": raw}, format="json")
        self.assertEqual(r.status_code, 412)
        self.assertTrue(r.data.get("needs_profile"))


class B1AtomicityTests(TestCase):
    def test_double_create_same_code_second_is_409_never_500(self):
        u1 = _mk_student_user("b1a@ut.edu.co", "b1a", given="A", family="One")
        u2 = _mk_student_user("b1b@ut.edu.co", "b1b", given="B", family="Two")
        c1, c2 = APIClient(), APIClient()
        c1.force_login(u1)
        c2.force_login(u2)
        r1 = c1.patch(
            "/api/auth/me/", _payload(code="EST-RACE", doc="DOC-1"), format="json"
        )
        self.assertIn(r1.status_code, (200, 201))
        r2 = c2.patch(
            "/api/auth/me/", _payload(code="EST-RACE", doc="DOC-2"), format="json"
        )
        self.assertEqual(r2.status_code, 409)
        self.assertNotEqual(r2.status_code, 500)

    def test_same_user_double_patch_never_500(self):
        u = _mk_student_user("b1c@ut.edu.co", "b1c")
        c = APIClient()
        c.force_login(u)
        for _ in range(2):
            r = c.patch(
                "/api/auth/me/", _payload(code="EST-SAME", doc="DOC-SAME"),
                format="json",
            )
            self.assertIn(r.status_code, (200, 201, 409))
            self.assertNotEqual(r.status_code, 500)


class M2AddressLimitTests(TestCase):
    def test_address_over_500_is_400(self):
        u = _mk_student_user("m2@ut.edu.co", "m2")
        c = APIClient()
        c.force_login(u)
        r = c.patch("/api/auth/me/", _payload(addr="x" * 501), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("address", r.data)
