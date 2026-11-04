import hashlib
import uuid
from datetime import date, datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academic.models import AcademicGroup, ClassStatus, Course, ScheduledClass
from apps.attendance.models import Attendance, AttendanceSession
from apps.attendance.reports import BOGOTA_TZ
from apps.attendance.stats import _growth, _period_windows, _shift_months
from apps.authentication.models import Professor, Student, User

STATS_URL = "/api/attendance/stats/"


class SummaryStatsTests(TestCase):
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

        admin = User.objects.create_user(
            email="stats-admin@ut.edu.co",
            google_sub="sub-stats-admin",
            role="ROLE_ADMIN",
        )
        self.admin_client = APIClient()
        self.admin_client.force_login(admin)

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

    def test_anonymous_and_student_are_denied_and_admin_allowed(self):
        self.assertEqual(APIClient().get(STATS_URL).status_code, 401)

        student_user = User.objects.create_user(
            email="stats-nonprof@ut.edu.co",
            google_sub="sub-stats-nonprof",
            role="ROLE_STUDENT",
        )
        client = APIClient()
        client.force_login(student_user)
        self.assertEqual(client.get(STATS_URL).status_code, 403)
        self.assertEqual(self.admin_client.get(STATS_URL).status_code, 200)

    def test_period_stats_deduplicate_students_and_courses_and_scope_professor(self):
        response = self.client.get(STATS_URL, {"period": "1m"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["period"], "1m")
        self.assertEqual(response.data["granularity"], "month")
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
        self.assertEqual(response.data["filters"]["professors"], [])
        self.assertIsNone(response.data["institution"])

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
        self.assertGreaterEqual(len(response.data["trend"]), 2)
        self.assertEqual(
            sum(point["expected"] for point in response.data["trend"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(point["present"] for point in response.data["trend"]),
            response.data["attendance"]["present"],
        )
        self.assertEqual(
            sum(course["expected"] for course in response.data["courses"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(course["present"] for course in response.data["courses"]),
            response.data["attendance"]["present"],
        )

    def test_all_period_trend_covers_oldest_completed_class(self):
        course = Course.objects.create(code="ST-OLD", name="Curso histórico")
        group = self._group(self.professor, course, "01")
        today = timezone.localdate(timezone=BOGOTA_TZ)
        old_day = _shift_months(today, -18)
        old_class = self._class(group, old_day)
        student = self._student("old-student@ut.edu.co", "STU-501")
        self._mark(old_class, student)

        response = self.client.get(STATS_URL, {"period": "all"})

        self.assertEqual(response.status_code, 200)
        months = [point["month"] for point in response.data["trend"]]
        self.assertIn(date(old_day.year, old_day.month, 1).isoformat(), months)
        self.assertEqual(
            sum(point["expected"] for point in response.data["trend"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(point["present"] for point in response.data["trend"]),
            response.data["attendance"]["present"],
        )

    def test_admin_sees_global_stats_and_institution_counts(self):
        response = self.admin_client.get(STATS_URL, {"period": "all"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["totals"],
            {"students": 4, "courses_count": 3, "classes_completed": 4},
        )
        self.assertEqual(
            response.data["institution"],
            {
                "students_registered": 4,
                "professors": 2,
                "courses": 3,
                "groups": 4,
            },
        )
        self.assertEqual(len(response.data["filters"]["professors"]), 2)
        self.assertEqual(
            {row["id"] for row in response.data["filters"]["professors"]},
            {str(self.professor.id), str(self.other_professor.id)},
        )
        self.assertEqual(len(response.data["filters"]["courses"]), 3)

        # institution no depende del periodo elegido.
        response = self.admin_client.get(STATS_URL, {"period": "1d"})
        self.assertEqual(
            response.data["institution"],
            {
                "students_registered": 4,
                "professors": 2,
                "courses": 3,
                "groups": 4,
            },
        )

    def test_admin_professor_filter_and_professor_cannot_use_it(self):
        response = self.admin_client.get(
            STATS_URL,
            {"period": "all", "professor_id": str(self.other_professor.id)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["totals"],
            {"students": 1, "courses_count": 1, "classes_completed": 1},
        )
        # institution es global, no del scope filtrado.
        self.assertEqual(
            response.data["institution"],
            {
                "students_registered": 4,
                "professors": 2,
                "courses": 3,
                "groups": 4,
            },
        )
        self.assertEqual(len(response.data["filters"]["courses"]), 1)

        response = self.client.get(
            STATS_URL,
            {"professor_id": str(self.professor.id)},
        )
        self.assertEqual(response.status_code, 403)

        response = self.admin_client.get(
            STATS_URL,
            {"period": "all", "professor_id": str(uuid.uuid4())},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["totals"],
            {"students": 0, "courses_count": 0, "classes_completed": 0},
        )
        self.assertEqual(response.data["attendance"]["expected"], 0)
        self.assertIsNone(response.data["attendance"]["rate"])
        self.assertEqual(
            response.data["institution"],
            {
                "students_registered": 4,
                "professors": 2,
                "courses": 3,
                "groups": 4,
            },
        )
        self.assertEqual(response.data["filters"]["courses"], [])

    def test_top_absences_accumulates_present_classes_across_months(self):
        course = Course.objects.create(code="ST-MULTI", name="Curso multi-mes")
        group = self._group(self.professor, course, "01")
        current, _ = _period_windows("3m")
        days = [
            current[0],
            _shift_months(current[0], 1),
            _shift_months(current[0], 2),
        ]
        classes = [self._class(group, day) for day in days]
        student_a = self._student("multi-a@ut.edu.co", "STU-301")
        student_b = self._student("multi-b@ut.edu.co", "STU-302")
        self._mark(classes[0], student_a)
        self._mark(classes[0], student_b)
        self._mark(classes[2], student_a)

        response = self.client.get(STATS_URL, {"period": "3m"})

        self.assertEqual(response.status_code, 200)
        absences = {
            row["student_id"]: row["absences"]
            for row in response.data["top_absences"]
        }
        self.assertEqual(absences[str(student_a.id)], 1)
        self.assertEqual(absences[str(student_b.id)], 2)

    def test_roster_falls_back_to_first_completed_class_with_marks(self):
        course = Course.objects.create(code="ST-ROSTER", name="Curso roster")
        group = self._group(self.professor, course, "01")
        current, _ = _period_windows("1m")
        empty_class = self._class(group, current[0])
        roster_class = self._class(group, current[0] + timedelta(days=1))
        later_class = self._class(group, current[0] + timedelta(days=2))
        student_a = self._student("roster-a@ut.edu.co", "STU-401")
        student_b = self._student("roster-b@ut.edu.co", "STU-402")
        self._mark(roster_class, student_a)
        self._mark(roster_class, student_b)
        self._mark(later_class, student_a)

        response = self.client.get(
            STATS_URL,
            {"period": "1m", "course_id": str(course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["classes_completed"], 3)
        self.assertEqual(response.data["attendance"]["expected"], 6)
        self.assertEqual(response.data["attendance"]["present"], 3)
        self.assertEqual(response.data["attendance"]["rate"], 50.0)
        self.assertTrue(response.data["attendance"]["has_roster"])
        absences = {
            row["student_id"]: row["absences"]
            for row in response.data["top_absences"]
        }
        self.assertEqual(absences[str(student_a.id)], 1)
        self.assertEqual(absences[str(student_b.id)], 2)

        recent = {row["id"]: row for row in response.data["recent_classes"]}
        self.assertEqual(recent[str(roster_class.id)]["expected"], 2)
        self.assertEqual(recent[str(roster_class.id)]["present"], 2)
        self.assertEqual(recent[str(roster_class.id)]["rate"], 100.0)
        self.assertEqual(recent[str(later_class.id)]["expected"], 2)
        self.assertEqual(recent[str(later_class.id)]["present"], 1)
        self.assertEqual(recent[str(later_class.id)]["rate"], 50.0)
        self.assertEqual(recent[str(empty_class.id)]["expected"], 2)
        self.assertEqual(recent[str(empty_class.id)]["present"], 0)
        self.assertEqual(recent[str(empty_class.id)]["rate"], 0.0)

    def test_has_roster_when_roster_exists_but_period_has_no_classes(self):
        course = Course.objects.create(code="ST-ROSTER-2", name="Curso roster sin clases")
        group = self._group(self.professor, course, "01")
        _, previous = _period_windows("1d")
        roster_class = self._class(group, previous[0])
        student = self._student("roster-day@ut.edu.co", "STU-601")
        self._mark(roster_class, student)

        response = self.client.get(
            STATS_URL,
            {"period": "1d", "course_id": str(course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["classes_completed"], 0)
        self.assertTrue(response.data["attendance"]["has_roster"])
        self.assertEqual(response.data["attendance"]["expected"], 0)
        self.assertIsNone(response.data["attendance"]["rate"])

    def test_day_and_week_periods_use_daily_granularity(self):
        today = date(2026, 11, 2)
        one_day = timedelta(days=1)
        self.assertEqual(
            _period_windows("1d", today),
            ((today, today), (today - one_day, today - one_day)),
        )
        self.assertEqual(
            _period_windows("1w", today),
            (
                (today - timedelta(days=6), today),
                (today - timedelta(days=13), today - timedelta(days=7)),
            ),
        )

        response = self.client.get(STATS_URL, {"period": "1d"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["granularity"], "day")
        self.assertEqual(len(response.data["trend"]), 1)
        self.assertEqual(
            response.data["trend"][0]["month"],
            timezone.localdate(timezone=BOGOTA_TZ).isoformat(),
        )
        self.assertEqual(
            sum(point["expected"] for point in response.data["trend"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(point["present"] for point in response.data["trend"]),
            response.data["attendance"]["present"],
        )

        response = self.client.get(STATS_URL, {"period": "1w"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["granularity"], "day")
        self.assertEqual(len(response.data["trend"]), 7)
        self.assertEqual(
            response.data["trend"][-1]["month"],
            timezone.localdate(timezone=BOGOTA_TZ).isoformat(),
        )
        self.assertEqual(
            sum(point["expected"] for point in response.data["trend"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(point["present"] for point in response.data["trend"]),
            response.data["attendance"]["present"],
        )

    def test_day_and_week_periods_with_completed_classes(self):
        course = Course.objects.create(code="ST-DAY", name="Curso diario")
        group = self._group(self.professor, course, "01")
        today = timezone.localdate(timezone=BOGOTA_TZ)
        first_class = self._class(group, today)
        second_class = self._class(group, today)
        second_class.start_time += timedelta(hours=1)
        second_class.save(update_fields=["start_time"])
        student_a = self._student("day-a@ut.edu.co", "STU-701")
        student_b = self._student("day-b@ut.edu.co", "STU-702")
        self._mark(first_class, student_a)
        self._mark(first_class, student_b)
        self._mark(second_class, student_a)

        response = self.client.get(
            STATS_URL,
            {"period": "1d", "course_id": str(course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["granularity"], "day")
        self.assertEqual(len(response.data["trend"]), 1)
        self.assertEqual(response.data["attendance"]["expected"], 4)
        self.assertEqual(response.data["attendance"]["present"], 3)
        self.assertEqual(response.data["trend"][0]["expected"], 4)
        self.assertEqual(response.data["trend"][0]["present"], 3)

        response = self.client.get(
            STATS_URL,
            {"period": "1w", "course_id": str(course.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["granularity"], "day")
        self.assertEqual(len(response.data["trend"]), 7)
        self.assertEqual(
            sum(point["expected"] for point in response.data["trend"]),
            response.data["attendance"]["expected"],
        )
        self.assertEqual(
            sum(point["present"] for point in response.data["trend"]),
            response.data["attendance"]["present"],
        )

    def test_invalid_period_returns_validation_error(self):
        response = self.client.get(STATS_URL, {"period": "2m"})
        self.assertEqual(response.status_code, 400)

    def test_growth_with_no_previous_data_is_not_a_percentage(self):
        self.assertIsNone(_growth(1, 0))
