from django.utils import timezone
from rest_framework import serializers

from apps.academic.models import AcademicGroup, ClassStatus, Course, ScheduledClass


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ["id", "code", "name", "description"]


class ProfessorBriefSerializer(serializers.Serializer):
    full_name = serializers.CharField()
    employee_code = serializers.CharField()
    email = serializers.EmailField()


class AcademicGroupSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)
    professor = serializers.SerializerMethodField()
    classes_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AcademicGroup
        fields = ["id", "course", "professor", "group_code", "term_period", "classes_count"]

    def get_professor(self, obj):
        prof = getattr(obj, "professor", None)
        if prof is None:
            return None
        return {
            "full_name": f"{prof.first_name} {prof.last_name}".strip(),
            "employee_code": prof.employee_code,
            "email": prof.user.email if hasattr(prof, "user") else None,
        }


class AcademicGroupWriteSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=1, max_length=150)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre es obligatorio.")
        return value


class ScheduledClassSerializer(serializers.ModelSerializer):
    end_time = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ScheduledClass
        fields = [
            "id", "title", "start_time", "end_time",
            "duration_minutes", "qr_duration_minutes", "modality", "status", "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def get_end_time(self, obj):
        return obj.start_time + timezone.timedelta(minutes=obj.duration_minutes)

    def validate_duration_minutes(self, value):
        if value <= 0:
            raise serializers.ValidationError("La duración debe ser mayor a 0.")
        return value

    def validate_qr_duration_minutes(self, value):
        if value < 1 or value > 120:
            raise serializers.ValidationError("La vida útil del QR debe estar entre 1 y 120 minutos.")
        return value

    def validate_start_time(self, value):
        # m1: normaliza datetimes naive (asume America/Bogota) en vez de
        # comparar naive vs aware (TypeError -> 500).
        if value is not None and timezone.is_naive(value):
            from zoneinfo import ZoneInfo

            value = timezone.make_aware(value, ZoneInfo("America/Bogota"))
        if value < timezone.now() - timezone.timedelta(minutes=5):
            raise serializers.ValidationError("La fecha de inicio no puede estar en el pasado.")
        return value
