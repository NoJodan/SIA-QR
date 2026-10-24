from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from rest_framework import serializers

from apps.attendance.models import Attendance, AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "event_type", "resource", "ip_address", "payload",
            "created_at",
        ]
        read_only_fields = fields


class SessionCreateSerializer(serializers.Serializer):
    qr_duration_minutes = serializers.IntegerField(min_value=1, max_value=120, required=False)


class AttendanceListSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    student_code = serializers.CharField(source="student.student_code", read_only=True)
    # NO se exponen lat/long exactas; solo si registró ubicación.
    has_location = serializers.SerializerMethodField()
    # En rango / fuera de rango (null solo si la clase no tiene rango fijado
    # o es mediada). Se recalcula en cada consulta, también tras cerrar la
    # clase: la geocerca ya no cambia después, así el veredicto es estable.
    inside_range = serializers.SerializerMethodField()
    distance_m = serializers.SerializerMethodField()

    class Meta:
        model = Attendance
        fields = [
            "id", "student_name", "student_code", "registered_at", "has_location",
            "inside_range", "distance_m",
        ]

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()

    def get_has_location(self, obj):
        return obj.latitude is not None and obj.longitude is not None

    def _geofence(self):
        """Clase con rango fijado (presencial y con coordenadas) o None.

        No exige que la clase esté en curso: el veredicto se re-valida en
        cada lectura, incluso después de cerrar la clase (el panel del
        profesor conserva En rango / Fuera de Rango en el historial).

        Se cachea por serializador: DRF reutiliza la misma instancia para
        todas las filas, así los 2 method fields no repiten los chequeos.
        """
        if hasattr(self, "_geofence_cache"):
            return self._geofence_cache
        from apps.academic.models import ClassModality

        clase = self.context.get("class")
        vigente = None
        if (
            clase is not None
            and clase.modality == ClassModality.PRESENTIAL
            and clase.geofence_lat is not None
            and clase.geofence_lng is not None
        ):
            vigente = clase
        self._geofence_cache = vigente
        return vigente

    def _distance(self, obj):
        """(rango_vigente, distancia_m) cacheados por fila."""
        if not hasattr(self, "_distance_cache"):
            self._distance_cache = {}
        key = obj.id
        if key not in self._distance_cache:
            from apps.attendance.services import haversine_m

            clase = self._geofence()
            if clase is None or obj.latitude is None or obj.longitude is None:
                self._distance_cache[key] = (None, None)
            else:
                value = haversine_m(clase.geofence_lat, clase.geofence_lng, obj.latitude, obj.longitude)
                self._distance_cache[key] = (clase, None if value is None else round(value, 1))
        return self._distance_cache[key]

    def get_distance_m(self, obj):
        return self._distance(obj)[1]

    def get_inside_range(self, obj):
        clase = self._geofence()
        if clase is None:
            return None
        distance = self._distance(obj)[1]
        if distance is None:
            # Rango fijado y alumno sin ubicación: cuenta como fuera de
            # rango (sin distancia que mostrar). La marcación no se bloquea.
            return False
        return distance <= (clase.geofence_radius_m or 0)


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
