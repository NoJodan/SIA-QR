from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

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


class TolerantGeoField(serializers.Field):
    """Geo opcional y NO bloqueante (RNF-06): nunca genera 400.

    Acepta str/float/int/Decimal/None/"" y redondea con quantize a
    `decimal_places` en vez de rechazar por exceso de decimales (el
    navegador envía 13-16 decimales). Si el valor es inparseable
    (NaN/Infinity/texto) o queda fuera de rango, coerciona a None.
    """

    def __init__(self, *, decimal_places, min_value, max_value, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        kwargs.setdefault("default", None)
        super().__init__(**kwargs)
        self.decimal_places = decimal_places
        self.min_value = Decimal(str(min_value))
        self.max_value = Decimal(str(max_value))
        self._quantum = Decimal(1).scaleb(-decimal_places)

    def to_internal_value(self, data):
        if data is None:
            return None
        if isinstance(data, str):
            if not data.strip():
                return None
            data = data.strip()
        try:
            value = Decimal(str(data))
            if value.is_nan() or value.is_infinite():
                return None
            rounded = value.quantize(self._quantum, rounding=ROUND_HALF_UP)
            if rounded < self.min_value or rounded > self.max_value:
                return None
            return rounded
        except (InvalidOperation, ValueError, AttributeError):
            return None

    def to_representation(self, value):
        return value


class MarkAttendanceSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=512)
    latitude = TolerantGeoField(decimal_places=8, min_value=-90, max_value=90)
    longitude = TolerantGeoField(decimal_places=8, min_value=-180, max_value=180)
    accuracy = TolerantGeoField(decimal_places=2, min_value=0, max_value=100000)

    def validate_token(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("El token es obligatorio.")
        return value
