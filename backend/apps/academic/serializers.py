from django.core.validators import RegexValidator
from django.utils import timezone
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from apps.academic.models import (
    AcademicGroup,
    ClassStatus,
    Course,
    Program,
    ProgramArea,
    ScheduledClass,
)
from apps.attendance.serializers import TolerantGeoField


class CourseSerializer(serializers.ModelSerializer):
    # program (id) + program_name: el frontend muestra el chip del programa.
    program = serializers.PrimaryKeyRelatedField(read_only=True)
    program_name = serializers.CharField(source="program.name", read_only=True, allow_null=True)

    class Meta:
        model = Course
        fields = ["id", "code", "name", "description", "program", "program_name"]


class ProgramSerializer(serializers.ModelSerializer):
    courses = serializers.SerializerMethodField()

    class Meta:
        model = Program
        fields = ["id", "name", "code", "area", "courses"]

    def get_courses(self, obj):
        # Prefetch courses__groups en la vista: sin N+1. Una fila por grupo
        # (nombre del curso + grupo), como los pide la vista admin.
        return [
            {"group_id": str(group.id), "name": course.name, "group_code": group.group_code}
            for course in obj.courses.all()
            for group in course.groups.all()
        ]


class ProgramWriteSerializer(serializers.ModelSerializer):
    name = serializers.CharField(
        max_length=150,
        error_messages={
            "required": "El nombre es obligatorio.",
            "null": "El nombre es obligatorio.",
            "blank": "El nombre es obligatorio.",
            "max_length": "Máximo 150 caracteres.",
        },
    )
    code = serializers.CharField(
        max_length=4,
        validators=[
            RegexValidator(r"^\d{4}$", message="El código debe tener 4 dígitos (0000–9999)."),
            UniqueValidator(queryset=Program.objects.all(), message="Ese código ya está registrado."),
        ],
        error_messages={
            "required": "El código es obligatorio.",
            "null": "El código es obligatorio.",
            "blank": "El código es obligatorio.",
            "max_length": "El código debe tener 4 dígitos (0000–9999).",
        },
    )
    area = serializers.ChoiceField(
        choices=ProgramArea.choices,
        error_messages={
            "required": "El área es obligatoria.",
            "null": "El área es obligatoria.",
            "invalid_choice": "Área inválida.",
        },
    )

    class Meta:
        model = Program
        fields = ["name", "code", "area"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre es obligatorio.")
        return value


class AcademicGroupSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)
    professor = serializers.SerializerMethodField()
    classes_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AcademicGroup
        fields = ["id", "course", "professor", "group_code", "term_period", "semester", "classes_count"]

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
    group_number = serializers.IntegerField(
        min_value=1,
        max_value=10,
        error_messages={
            "required": "El número de grupo es obligatorio.",
            "invalid": "El número de grupo debe ser un entero entre 1 y 10.",
            "min_value": "El número de grupo debe estar entre 1 y 10.",
            "max_value": "El número de grupo debe estar entre 1 y 10.",
            "null": "El número de grupo es obligatorio.",
        },
    )
    semester = serializers.IntegerField(
        required=False,
        default=1,
        min_value=1,
        max_value=12,
        error_messages={
            "required": "El semestre es obligatorio.",
            "invalid": "El semestre debe ser un entero entre 1 y 12.",
            "min_value": "El semestre debe estar entre 1 y 12.",
            "max_value": "El semestre debe estar entre 1 y 12.",
            "null": "El semestre es obligatorio.",
        },
    )
    # Opcional: id del programa (UUID pk, como el resto de modelos). Se
    # resuelve contra Program en las vistas; null vacía el programa.
    program = serializers.UUIDField(
        required=False,
        allow_null=True,
        error_messages={"invalid": "Programa no encontrado."},
    )

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre es obligatorio.")
        return value

    def validate_program(self, value):
        if value is not None and not Program.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Programa no encontrado.")
        return value


class ScheduledClassSerializer(serializers.ModelSerializer):
    end_time = serializers.SerializerMethodField(read_only=True)
    # Solo se expone el estado derivado del rango; las coordenadas del salón
    # (geofence_lat/lng) jamás salen por API.
    geofence_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = ScheduledClass
        fields = [
            "id", "title", "start_time", "end_time",
            "duration_minutes", "qr_duration_minutes", "modality", "status", "created_at",
            "geofence_active", "geofence_radius_m",
        ]
        read_only_fields = ["id", "status", "created_at", "geofence_active", "geofence_radius_m"]

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


class ClassGeofenceSerializer(serializers.Serializer):
    """Coords del profesor para fijar el rango del salón (tolerante, RNF-06).

    `accuracy` es informativo: se guarda solo como referencia, no se usa en
    el cálculo del radio.
    """

    latitude = TolerantGeoField(decimal_places=8, min_value=-90, max_value=90)
    longitude = TolerantGeoField(decimal_places=8, min_value=-180, max_value=180)
    accuracy = TolerantGeoField(decimal_places=2, min_value=0, max_value=100000)
