"""Núcleo del motor de asistencia: generación de sesiones QR.

Reutilizado por A1 (sesión sobre clase existente) y B3 (clase instantánea).
"""

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.academic.models import ClassStatus

MIN_TTL = 1
MAX_TTL = 120


def get_default_qr_minutes():
    """TTL por defecto: SystemConfig QR_DEFAULT_MINUTES > settings > 10."""
    try:
        from apps.attendance.models import SystemConfig

        cfg = SystemConfig.objects.get(config_key="QR_DEFAULT_MINUTES")
        value = int(str(cfg.config_value).strip())
        if MIN_TTL <= value <= MAX_TTL:
            return value
    except Exception:
        pass
    fallback = getattr(settings, "QR_DEFAULT_MINUTES", 10)
    try:
        fallback = int(fallback)
    except (TypeError, ValueError):
        fallback = 10
    if fallback < MIN_TTL or fallback > MAX_TTL:
        fallback = 10
    return fallback


def resolve_ttl(clase, ttl_override=None):
    """Prioridad: override del body (1-120) > clase.qr_duration_minutes > default."""
    if ttl_override is not None:
        try:
            value = int(ttl_override)
        except (TypeError, ValueError):
            raise ValidationError(
                {"qr_duration_minutes": "Debe ser un entero entre 1 y 120."}
            )
        if value < MIN_TTL or value > MAX_TTL:
            raise ValidationError(
                {"qr_duration_minutes": "Debe estar entre 1 y 120 minutos."}
            )
        return value
    qr_minutes = getattr(clase, "qr_duration_minutes", None)
    try:
        qr_minutes = int(qr_minutes) if qr_minutes is not None else None
    except (TypeError, ValueError):
        qr_minutes = None
    if qr_minutes is not None and MIN_TTL <= qr_minutes <= MAX_TTL:
        return qr_minutes
    return get_default_qr_minutes()


def generate_session(clase, ttl_override=None):
    """Crea una sesión QR single-active para la clase.

    Revoca sesiones previas activas (Opción A), pasa SCHEDULED -> IN_PROGRESS
    y devuelve el token crudo (única vez) junto con la sesión.
    """
    from apps.attendance.models import AttendanceSession

    ttl = resolve_ttl(clase, ttl_override)
    now = timezone.now()
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")

    last_error = None
    for _ in range(3):  # reintento ante colisión del UNIQUE de token_hash
        raw = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        try:
            with transaction.atomic():
                # C2: bloquea las filas activas de esta clase para que dos
                # generate concurrentes no dejen 2 sesiones activas. El
                # UniqueConstraint parcial es la garantía final.
                list(
                    AttendanceSession.objects.select_for_update().filter(
                        scheduled_class=clase, is_active=True
                    )
                )
                AttendanceSession.objects.filter(
                    scheduled_class=clase, is_active=True
                ).update(is_active=False)
                if clase.status == ClassStatus.SCHEDULED:
                    clase.status = ClassStatus.IN_PROGRESS
                    clase.save(update_fields=["status", "updated_at"])
                session = AttendanceSession.objects.create(
                    scheduled_class=clase,
                    token_hash=token_hash,
                    expires_at=now + timedelta(minutes=ttl),
                    is_active=True,
                )
            return {
                "session": session,
                "token_raw": raw,
                "attend_url": f"{frontend}/attend?token={raw}",
                "expires_at": session.expires_at,
                "ttl_minutes": ttl,
            }
        except IntegrityError as exc:
            last_error = exc
    # M3: nunca propagar IntegrityError crudo (sería 500). Las vistas lo
    # mapean a 409 con reintento; este ValidationError es el último recurso.
    raise ValidationError("No se pudo generar el código QR, intenta de nuevo.")
