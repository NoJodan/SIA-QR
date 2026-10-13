import uuid
from django.db import models


class SystemConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    config_key = models.CharField(max_length=100, unique=True)
    config_value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_configs"

    def __str__(self):
        return f"{self.config_key}: {self.config_value}"


class AttendanceSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scheduled_class = models.ForeignKey(
        "academic.ScheduledClass",
        on_delete=models.CASCADE,
        related_name="attendance_sessions",
        db_column="class_id",
    )
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "attendance_sessions"
        constraints = [
            # C2: single-active garantizado a nivel BD (una sola sesión
            # activa por clase, incluso bajo concurrencia).
            models.UniqueConstraint(
                fields=["scheduled_class"],
                condition=models.Q(is_active=True),
                name="unique_active_session_per_class",
            ),
        ]
        indexes = [
            # Índice parcial: solo sesiones activas (ver SIA-QR.md).
            models.Index(
                fields=["token_hash"],
                name="idx_attendance_sessions_token",
                condition=models.Q(is_active=True),
            ),
        ]

    def __str__(self):
        return f"Sesión {self.id} (clase {self.scheduled_class_id})"


class Attendance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        AttendanceSession,
        on_delete=models.CASCADE,
        related_name="attendances",
        db_column="session_id",
    )
    student = models.ForeignKey(
        "authentication.Student",
        on_delete=models.CASCADE,
        related_name="attendances",
        db_column="student_id",
    )
    registered_at = models.DateTimeField(auto_now_add=True)
    # Geolocalización opcional y NO bloqueante: NULL si no se otorga.
    latitude = models.DecimalField(max_digits=10, decimal_places=8, blank=True, null=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=8, blank=True, null=True)
    accuracy = models.DecimalField(max_digits=8, decimal_places=2, blank=True, null=True)
    ip_address = models.CharField(max_length=45)
    user_agent = models.TextField()

    class Meta:
        db_table = "attendances"
        constraints = [
            models.UniqueConstraint(
                fields=["session", "student"],
                name="unique_attendance_per_session",
            ),
        ]
        indexes = [
            models.Index(fields=["session"], name="idx_attendances_session"),
            models.Index(fields=["student"], name="idx_attendances_student"),
        ]

    def __str__(self):
        return f"Asistencia {self.id} (sesión {self.session_id})"
