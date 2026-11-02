import hashlib
import uuid
from datetime import datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academic.models import AcademicGroup, ClassStatus, Course, ScheduledClass
from apps.attendance.models import Attendance, AttendanceSession
from apps.attendance.reports import BOGOTA_TZ
from apps.attendance.stats import _growth, _period_windows
from apps.authentication.models import Professor, Student, User

STATS_URL = "/api/attendance/stats/"


class ProfessorSummaryStatsTests(TestCase):
    def setUp(self):
        self.professor = self._professor("stats-prof@ut.edu.co", "EMP-STATS")
        self.course = Course.objects.create(code="ST-101", name="Curso Stats")
        self.group = self._group(self.professor, self.course, "01")
        self.same_course_group = self._group(self.professor, self.course, "02")
        second_course = Course.objects.create(code="ST-102", name="Otro Curso Stats")
        self._group(self.professor, second_course, "01")

        current, previous = _period_windows("1m")
        self.current_class = self._class(self.group, current[0])
        self.previous_class = self._class(self.group, previous[0])
        self.previous_group_class = self._class(self.same_course_group, previous[1])
        self._class(self.group, current[1], status=ClassStatus.SCHEDULED)

        self.student_one = self._student("stats-student-1@ut.edu.co", "STU-101")
        self.student_two = self._student("stats-student-2@ut.edu.co", "STU-102")
        self.student_three = self._student("stats-student-3@ut.edu.co", "STU-103")
        self._mark(self.current_class, self.student_one)
        self._mark(self.current_class, self.student_one, session_index=2)
        self._mark(self.previous_class, self.student_two)
        self._mark(self.previous_group_class, self.student_three)

        self.other_professor = self._professor("other-stats@ut.edu.co", "EMP-OTHER-STATS")
        other_course = Course.objects.create(code="ST-201", name="Curso ajeno")
        other_group = self._group(self.other_professor, other_course, "01")
        other_class = self._class(other_group, current[1])
        other_student = self._student("other-student@ut.edu.co", "STU-201")
        self._mark(other_class, other_student)

        self.client = APIClient()
        self.client.force_login(self.professor.user)

    @staticmethod
    def _professor(email, code):
        user = User.objects.create_user(
            email=email, google_sub=f"sub-{email}", role="ROLE_PROFESSOR"
        )
        return Professor.objects.create(
            user=user, employee_code=code, first_name="Stats", last_name="Professor"
        )

    @staticmethod
    def _group(professor, course, code):
        return AcademicGroup.objects.create(
            course=course,
            professor=professor,
            group_code=code,
            term_period="2026-1",
        )

    @staticmethod
    def _class(group, day, status=ClassStatus.COMPLETED):
        start_time = timezone.make_aware(datetime.combine(day, time(12)), BOGOTA_TZ)
        return ScheduledClass.objects.create(
            group=group,
            title="Clase de estadísticas",
            start_time=start_time,
            duration_minutes=60,
            qr_duration_minutes=10,
            status=status,
        )

    @staticmethod
    def _student(email, code):
        user = User.objects.create_user(
            email=email, google_sub=f"sub-{email}", role="ROLE_STUDENT"
        )
        return Student.objects.create(
            user=user,
            student_code=code,
            document_number=f"DOC-{code}",
            first_name="Estudiante",
            last_name=code,
        )

    @staticmethod
    def _mark(scheduled_class, student, session_index=1):
        session = AttendanceSession.objects.create(
            scheduled_class=scheduled_class,
            token_hash=hashlib.sha256(
                f"{uuid.uuid4()}-{session_index}".encode()
            ).hexdigest(),
            expires_at=timezone.now() + timedelta(minutes=10),
            is_active=False,
        )
        return Attendance.objects.create(
            session=session,
            student=student,
            ip_address="127.0.0.1",
            user_agent="stats-test",
        )

    def test_anonymous_and_non_professor_are_denied(self):
        self.assertEqual(APIClient().get(STATS_URL).status_code, 401)

        student_user = User.objects.create_user(
            email="stats-nonprof@ut.edu.co",
            google_sub="sub-stats-nonprof",
            role="ROLE_STUDENT",
        )
        client = APIClient()
        client.force_login(student_user)
        self.assertEqual(client.get(STATS_URL).status_code, 403)

        admin = User.objects.create_user(
            email="stats-admin@ut.edu.co",
            google_sub="sub-stats-admin",
            role="ROLE_ADMIN",
        )
        client.force_login(admin)
        self.assertEqual(client.get(STATS_URL).status_code, 403)

    def test_period_stats_deduplicate_students_and_courses_and_scope_professor(self):
        response = self.client.get(STATS_URL, {"period": "1m"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["period"], "1m")
        self.assertIsNone(response.data["course_id"])
        self.assertEqual(
            response.data["totals"],
            {"students": 1, "courses_count": 2, "classes_completed": 1},
        )
        self.assertEqual(
            response.data["changes"],
            {"students": -50.0, "classes_completed": -50.0},
        )
        self.assertEqual(response.data["attendance"], {
            "present": 0,
            "absent_estimated": 1,
            "expected": 1,
            "rate": 0.0,
            "has_roster": True,
        })
        self.assertEqual(response.data["courses"][0]["rate"], 0.0)
        self.assertEqual(response.data["top_absences"][0]["student_id"], str(self.student_two.id))
        self.assertEqual(response.data["top_absences"][0]["absences"], 1)
        self.assertEqual(len(response.data["recent_classes"]), 1)
        self.assertEqual(response.data["recent_classes"][0]["expected"], 1)
        self.assertEqual(response.data["recent_classes"][0]["present"], 0)
        self.assertEqual(response.data["recent_classes"][0]["rate"], 0.0)

    def test_course_filter_is_applied_and_restricted_to_professor_courses(self):
        response = self.client.get(
            STATS_URL,
            {"period": "all", "course_id": str(self.course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["courses_count"], 1)
        self.assertEqual(response.data["totals"]["classes_completed"], 3)
        self.assertEqual(len(response.data["courses"]), 1)
        self.assertEqual(response.data["courses"][0]["name"], self.course.name)

        response = self.client.get(
            STATS_URL,
            {"course_id": str(Course.objects.get(code="ST-201").id)},
        )
        self.assertEqual(response.status_code, 403)

    def test_invalid_course_id_returns_validation_error(self):
        response = self.client.get(STATS_URL, {"course_id": "not-a-uuid"})
        self.assertEqual(response.status_code, 400)

    def test_assigned_course_without_completed_classes_has_no_estimated_rate(self):
        course = Course.objects.get(code="ST-102")
        response = self.client.get(
            STATS_URL,
            {"period": "all", "course_id": str(course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["courses_count"], 1)
        self.assertEqual(response.data["totals"]["classes_completed"], 0)
        self.assertFalse(response.data["attendance"]["has_roster"])
        self.assertIsNone(response.data["attendance"]["rate"])
        self.assertEqual(response.data["courses"][0]["classes_completed"], 0)
        self.assertIsNone(response.data["courses"][0]["rate"])
        self.assertEqual(response.data["recent_classes"], [])

    def test_all_period_includes_all_historical_stats(self):
        response = self.client.get(STATS_URL, {"period": "all"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["students"], 3)
        self.assertEqual(response.data["totals"]["courses_count"], 2)
        self.assertEqual(response.data["totals"]["classes_completed"], 3)
        self.assertIsNone(response.data["changes"]["students"])
        self.assertEqual(response.data["attendance"]["expected"], 3)
        self.assertEqual(response.data["attendance"]["present"], 2)
        self.assertEqual(response.data["attendance"]["absent_estimated"], 1)

    def test_invalid_period_returns_validation_error(self):
        response = self.client.get(STATS_URL, {"period": "2m"})
        self.assertEqual(response.status_code, 400)

    def test_growth_with_no_previous_data_is_not_a_percentage(self):
        self.assertIsNone(_growth(1, 0))
