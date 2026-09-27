import uuid
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class ClassModality(models.TextChoices):
    PRESENTIAL = "PRESENTIAL", "Presencial"
    VIRTUAL = "VIRTUAL", "Virtual"


class ClassStatus(models.TextChoices):
    SCHEDULED = "SCHEDULED", "Programada"
    IN_PROGRESS = "IN_PROGRESS", "En curso"
    COMPLETED = "COMPLETED", "Finalizada"
    CANCELLED = "CANCELLED", "Cancelada"


class Course(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "courses"

    def __str__(self):
        return f"{self.code} - {self.name}"


class AcademicGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    course = models.ForeignKey(Course, on_delete=models.RESTRICT, related_name="groups", db_column="course_id")
    professor = models.ForeignKey(
        "authentication.Professor", on_delete=models.RESTRICT, related_name="groups", db_column="professor_id"
    )
    group_code = models.CharField(max_length=10)
    term_period = models.CharField(max_length=20)

    class Meta:
        db_table = "academic_groups"
        constraints = [
            models.UniqueConstraint(
                fields=["course", "group_code", "term_period"], name="unique_group_per_term"
            )
        ]

    def __str__(self):
        return f"{self.course.code} G{self.group_code} ({self.term_period})"


class ScheduledClass(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    group = models.ForeignKey(AcademicGroup, on_delete=models.CASCADE, related_name="classes", db_column="group_id")
    title = models.CharField(max_length=150)
    start_time = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField()
    qr_duration_minutes = models.PositiveIntegerField(
        default=10, validators=[MinValueValidator(1), MaxValueValidator(120)]
    )
    modality = models.CharField(max_length=20, choices=ClassModality.choices, default=ClassModality.PRESENTIAL)
    status = models.CharField(max_length=20, choices=ClassStatus.choices, default=ClassStatus.SCHEDULED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "scheduled_classes"
        ordering = ["start_time"]

    def __str__(self):
        return f"{self.title} ({self.start_time})"
