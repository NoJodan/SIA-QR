"""Métricas agregadas y estimaciones de asistencia para el resumen del profesor."""

import calendar
from datetime import date, timedelta

from django.db.models import Count, Exists, OuterRef, Subquery
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.academic.models import AcademicGroup, ClassStatus, ScheduledClass
from apps.attendance.models import Attendance
from apps.attendance.reports import BOGOTA_TZ, _day_bounds

PERIOD_MONTHS = {
    "1m": 1,
    "3m": 3,
    "6m": 6,
    "12m": 12,
}


class StatsFilterSerializer(serializers.Serializer):
    period = serializers.ChoiceField(
        choices=[
            ("1m", "Último mes"),
            ("3m", "Últimos 3 meses"),
            ("6m", "Últimos 6 meses"),
            ("12m", "Último año"),
            ("all", "Todo el periodo"),
        ],
        default="3m",
        error_messages={"invalid_choice": "Periodo inválido."},
    )
    course_id = serializers.UUIDField(
        required=False,
        error_messages={"invalid": "Identificador de curso inválido."},
    )


def _shift_months(day, months):
    month_index = day.month - 1 + months
    year = day.year + month_index // 12
    month = month_index % 12 + 1
    day_of_month = min(day.day, calendar.monthrange(year, month)[1])
    return day.replace(year=year, month=month, day=day_of_month)


def _period_windows(period, today=None):
    """Devuelve el rango seleccionado y el anterior equivalente en Bogotá."""
    if period == "all":
        return None, None

    today = today or timezone.localdate(timezone=BOGOTA_TZ)
    months = PERIOD_MONTHS[period]
    current_from = _shift_months(today + timedelta(days=1), -months)
    previous_to = current_from - timedelta(days=1)
    period_days = (today - current_from).days
    previous_from = previous_to - timedelta(days=period_days)
    return (current_from, today), (previous_from, previous_to)


def _apply_window(queryset, field_name, window):
    if window:
        start, end = window
        queryset = queryset.filter(
            **{
                f"{field_name}__gte": _day_bounds(start),
                f"{field_name}__lte": _day_bounds(end, end=True),
            }
        )
    return queryset


def _month_starts(start, end):
    month = date(start.year, start.month, 1)
    last_month = date(end.year, end.month, 1)
    while month <= last_month:
        yield month
        month = _shift_months(month, 1)


def _growth(current, previous):
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


def _baseline_attendance_exists():
    """Correlates a mark with that student's group's first completed class."""
    first_completed_class = (
        ScheduledClass.objects.filter(
            group_id=OuterRef("session__scheduled_class__group_id"),
            status=ClassStatus.COMPLETED,
        )
        .order_by("start_time", "id")
        .values("id")[:1]
    )
    return Attendance.objects.filter(
        session__scheduled_class__group_id=OuterRef(
            "session__scheduled_class__group_id"
        ),
        session__scheduled_class_id=Subquery(first_completed_class),
        student_id=OuterRef("student_id"),
    )


def _attendance_for_roster(user, group_ids, window):
    marks = Attendance.objects.filter(
        session__scheduled_class__group__professor__user=user,
        session__scheduled_class__group_id__in=group_ids,
        session__scheduled_class__status=ClassStatus.COMPLETED,
    )
    marks = _apply_window(marks, "session__scheduled_class__start_time", window)
    return (
        marks.annotate(in_initial_roster=Exists(_baseline_attendance_exists()))
        .filter(in_initial_roster=True)
        .annotate(
            month=TruncMonth(
                "session__scheduled_class__start_time",
                tzinfo=BOGOTA_TZ,
            )
        )
    )


def _course_filter_values(user):
    return list(
        AcademicGroup.objects.filter(professor__user=user)
        .values("course_id", "course__name")
        .distinct()
        .order_by("course__name")
    )


def build_stats(user, period, course_id=None):
    """Calcula métricas, gráficos y estimaciones solo para grupos del profesor."""
    current_window, previous_window = _period_windows(period)
    all_courses = _course_filter_values(user)
    groups = AcademicGroup.objects.filter(professor__user=user)

    if course_id:
        if not groups.filter(course_id=course_id).exists():
            raise PermissionDenied("No tienes acceso a las estadísticas de ese curso.")
        groups = groups.filter(course_id=course_id)

    groups = list(groups.values("id", "course_id", "course__name"))
    group_ids = [group["id"] for group in groups]
    course_ids = {group["course_id"] for group in groups}

    student_marks = Attendance.objects.filter(
        session__scheduled_class__group__professor__user=user,
        session__scheduled_class__group_id__in=group_ids,
    )
    student_marks = _apply_window(
        student_marks, "session__scheduled_class__start_time", current_window
    )
    students = student_marks.values("student_id").distinct().count()

    completed_classes = ScheduledClass.objects.filter(
        group__professor__user=user,
        group_id__in=group_ids,
        status=ClassStatus.COMPLETED,
    )
    completed_classes = _apply_window(completed_classes, "start_time", current_window)
    classes_completed = completed_classes.count()
    courses_count = len(course_ids)

    changes = {"students": None, "classes_completed": None}
    if previous_window:
        previous_student_marks = Attendance.objects.filter(
            session__scheduled_class__group__professor__user=user,
            session__scheduled_class__group_id__in=group_ids,
        )
        previous_student_marks = _apply_window(
            previous_student_marks,
            "session__scheduled_class__start_time",
            previous_window,
        )
        previous_students = previous_student_marks.values("student_id").distinct().count()

        previous_classes = ScheduledClass.objects.filter(
            group__professor__user=user,
            group_id__in=group_ids,
            status=ClassStatus.COMPLETED,
        )
        previous_classes = _apply_window(previous_classes, "start_time", previous_window)
        changes = {
            "students": _growth(students, previous_students),
            "classes_completed": _growth(classes_completed, previous_classes.count()),
        }

    baseline_classes = list(
        ScheduledClass.objects.filter(
            group_id__in=group_ids,
            status=ClassStatus.COMPLETED,
        )
        .order_by("group_id", "start_time", "id")
        .distinct("group_id")
        .values("id", "group_id")
    )
    baseline_group_ids = {row["group_id"] for row in baseline_classes}
    baseline_ids = [row["id"] for row in baseline_classes]
    roster_rows = Attendance.objects.filter(
        session__scheduled_class_id__in=baseline_ids
    ).values(
        "session__scheduled_class__group_id",
        "student_id",
        "student__first_name",
        "student__last_name",
    ).distinct()

    roster_by_group = {group_id: set() for group_id in baseline_group_ids}
    student_names = {}
    for row in roster_rows:
        group_id = row["session__scheduled_class__group_id"]
        student_id = row["student_id"]
        roster_by_group[group_id].add(student_id)
        student_names[student_id] = (
            f'{row["student__first_name"]} {row["student__last_name"]}'.strip()
            or "Estudiante"
        )

    class_month_rows = (
        completed_classes.annotate(month=TruncMonth("start_time", tzinfo=BOGOTA_TZ))
        .values("group_id", "month")
        .annotate(class_count=Count("id"))
    )
    classes_by_group_month = {}
    classes_by_group = {}
    for row in class_month_rows:
        group_id = row["group_id"]
        month = row["month"].date().replace(day=1)
        count = row["class_count"]
        classes_by_group_month[(group_id, month)] = count
        classes_by_group[group_id] = classes_by_group.get(group_id, 0) + count

    attendance_rows = _attendance_for_roster(user, group_ids, current_window).values(
        "session__scheduled_class__group_id",
        "student_id",
        "month",
    ).annotate(
        present_classes=Count("session__scheduled_class_id", distinct=True)
    )
    present_by_group_student = {}
    present_by_group = {}
    present_by_group_month = {}
    for row in attendance_rows:
        group_id = row["session__scheduled_class__group_id"]
        student_id = row["student_id"]
        month = row["month"].date().replace(day=1)
        present_classes = row["present_classes"]
        key = (group_id, student_id)
        present_by_group_student[key] = present_classes
        present_by_group[group_id] = (
            present_by_group.get(group_id, 0) + present_classes
        )
        month_key = (group_id, month)
        present_by_group_month[month_key] = (
            present_by_group_month.get(month_key, 0) + present_classes
        )

    expected_total = 0
    present_total = 0
    expected_by_course = {course_id: 0 for course_id in course_ids}
    present_by_course = {course_id: 0 for course_id in course_ids}
    course_classes = {course_id: 0 for course_id in course_ids}
    absence_by_student = {}

    for group in groups:
        group_id = group["id"]
        course_id_for_group = group["course_id"]
        roster = roster_by_group.get(group_id, set())
        group_classes = classes_by_group.get(group_id, 0)
        group_present = present_by_group.get(group_id, 0)
        group_expected = len(roster) * group_classes

        expected_total += group_expected
        present_total += group_present
        expected_by_course[course_id_for_group] += group_expected
        present_by_course[course_id_for_group] += group_present
        course_classes[course_id_for_group] += group_classes

        if group_classes and roster:
            for student_id in roster:
                present = present_by_group_student.get((group_id, student_id), 0)
                missed = max(group_classes - present, 0)
                if missed:
                    absence_by_student[student_id] = (
                        absence_by_student.get(student_id, 0) + missed
                    )

    total_absences = max(expected_total - present_total, 0)
    attendance_rate = (
        round(present_total * 100 / expected_total, 1) if expected_total else None
    )

    courses_by_id = {row["course_id"]: row["course__name"] for row in all_courses}
    courses_stats = []
    for course_id_for_group in course_ids:
        expected = expected_by_course[course_id_for_group]
        present = present_by_course[course_id_for_group]
        courses_stats.append(
            {
                "course_id": str(course_id_for_group),
                "name": courses_by_id[course_id_for_group],
                "classes_completed": course_classes[course_id_for_group],
                "present": present,
                "absent_estimated": max(expected - present, 0),
                "expected": expected,
                "rate": round(present * 100 / expected, 1) if expected else None,
            }
        )
    courses_stats.sort(
        key=lambda item: (-item["classes_completed"], item["name"].casefold())
    )

    if period == "all":
        today = timezone.localdate(timezone=BOGOTA_TZ)
        trend_start = _shift_months(date(today.year, today.month, 1), -11)
        trend_end = today
    else:
        trend_start, trend_end = current_window
    trend = []
    for month in _month_starts(trend_start, trend_end):
        expected = 0
        present = 0
        for group_id in group_ids:
            group_roster_size = len(roster_by_group.get(group_id, set()))
            class_count = classes_by_group_month.get((group_id, month), 0)
            expected += group_roster_size * class_count
            present += present_by_group_month.get((group_id, month), 0)
        trend.append(
            {
                "month": month.isoformat(),
                "present": present,
                "absent_estimated": max(expected - present, 0),
                "expected": expected,
                "rate": round(present * 100 / expected, 1) if expected else None,
            }
        )

    top_absences = sorted(
        (
            {
                "student_id": str(student_id),
                "name": student_names.get(student_id, "Estudiante"),
                "absences": absences,
            }
            for student_id, absences in absence_by_student.items()
        ),
        key=lambda item: (-item["absences"], item["name"].casefold()),
    )[:5]

    recent_classes = list(
        completed_classes.select_related("group__course")
        .order_by("-start_time", "-id")
        .values(
            "id",
            "title",
            "start_time",
            "group_id",
            "group__course__name",
        )[:5]
    )
    recent_class_ids = [row["id"] for row in recent_classes]
    recent_present = {}
    if recent_class_ids:
        recent_attendance = (
            Attendance.objects.filter(
                session__scheduled_class_id__in=recent_class_ids,
            )
            .annotate(in_initial_roster=Exists(_baseline_attendance_exists()))
            .filter(in_initial_roster=True)
            .values("session__scheduled_class_id")
            .annotate(present=Count("student_id", distinct=True))
        )
        recent_present = {
            row["session__scheduled_class_id"]: row["present"]
            for row in recent_attendance
        }

    for row in recent_classes:
        group_id = row["group_id"]
        expected = len(roster_by_group.get(group_id, set()))
        present = recent_present.get(row["id"], 0)
        row["id"] = str(row["id"])
        row["start_time"] = row["start_time"].isoformat()
        row["course_name"] = row.pop("group__course__name")
        row["present"] = present
        row["expected"] = expected
        row["absent_estimated"] = max(expected - present, 0) if expected else None
        row["rate"] = round(present * 100 / expected, 1) if expected else None
        row.pop("group_id")

    return {
        "period": period,
        "course_id": str(course_id) if course_id else None,
        "totals": {
            "students": students,
            "courses_count": courses_count,
            "classes_completed": classes_completed,
        },
        "changes": changes,
        "attendance": {
            "present": present_total,
            "absent_estimated": total_absences,
            "expected": expected_total,
            "rate": attendance_rate,
            "has_roster": expected_total > 0,
        },
        "courses": courses_stats,
        "trend": trend,
        "top_absences": top_absences,
        "recent_classes": recent_classes,
        "filters": {
            "courses": [
                {"id": str(row["course_id"]), "name": row["course__name"]}
                for row in all_courses
            ]
        },
    }
