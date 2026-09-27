from rest_framework import serializers

from apps.attendance.models import Attendance


class SessionCreateSerializer(serializers.Serializer):
    qr_duration_minutes = serializers.IntegerField(min_value=1, max_value=120, required=False)


class AttendanceListSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    student_code = serializers.CharField(source="student.student_code", read_only=True)
    # NO se exponen lat/long exactas; solo si registró ubicación.
    has_location = serializers.SerializerMethodField()

    class Meta:
        model = Attendance
        fields = ["id", "student_name", "student_code", "registered_at", "has_location"]

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()

    def get_has_location(self, obj):
        return obj.latitude is not None and obj.longitude is not None


class MarkAttendanceSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=512)
    latitude = serializers.DecimalField(
        max_digits=10, decimal_places=8, required=False, allow_null=True,
        min_value=-90, max_value=90,
    )
    longitude = serializers.DecimalField(
        max_digits=11, decimal_places=8, required=False, allow_null=True,
        min_value=-180, max_value=180,
    )
    accuracy = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True,
        min_value=0, max_value=100000,
    )

    def validate_token(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("El token es obligatorio.")
        return value
