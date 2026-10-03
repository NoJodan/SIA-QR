"""QR automático: ventana de clase y sesión actual idempotente (QR único).

Fuente de verdad del dominio: `SIA-QR.md` (TTL/expiración anti-replay,
unicidad estricta, zona `America/Bogota`).

Este módulo NO reemplaza `generate_session()` (núcleo single-active en
`apps.attendance.services`); lo reutiliza para crear UNA sola vez la
sesión vigente (S1) de una clase programada sin intervención del profesor:

- `class_window()`      -> (inicio, fin) de la clase.
- `should_auto_start()` -> True si `now` está en ventana (con gracia previa).
- `get_valid_session()` -> sesión activa no expirada (o None).
- `ensure_current_session()` -> máquina pending/live/expired/finished
  idempotente, sin auto-rotación (QR único por clase).
"""

from datetime import timedelta

from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.academic.models import ClassStatus

# Gracia previa por defecto: el QR aparece hasta 30s antes del inicio.
# Fuente prioritaria: SystemConfig[EARLY_QR_GRACE_SECONDS] (0-300) >
# settings.EARLY_QR_GRACE_SECONDS > este default.
EARLY_GRACE_SECONDS = 30
EARLY_GRACE_MIN = 0
EARLY_GRACE_MAX = 300

# Zona por defecto para normalizar datetimes naive (m1): America/Bogota.
from zoneinfo import ZoneInfo as _ZoneInfo

_BOGOTA_TZ = _ZoneInfo("America/Bogota")


def _ensure_aware(value):
    """m1: normaliza un datetime naive a aware (America/Bogota).

    Sin esto, restar/comparar un `start_time` naive con `timezone.now()`
    (aware) lanza TypeError -> 500 en el poll.
    """
    if value is not None and timezone.is_naive(value):
        return timezone.make_aware(value, _BOGOTA_TZ)
    return value


def get_early_grace_seconds():
    """m2: gracia previa configurable (segundos).

    Lee SystemConfig[EARLY_QR_GRACE_SECONDS] validando 0-300; ante valor
    ausente/inválido usa settings.EARLY_QR_GRACE_SECONDS y por último 30.
    """
    from django.conf import settings as _settings

    candidates = []
    try:
        from apps.attendance.models import SystemConfig

        cfg = SystemConfig.objects.get(config_key="EARLY_QR_GRACE_SECONDS")
        candidates.append(int(str(cfg.config_value).strip()))
    except Exception:
        pass
    try:
        candidates.append(int(getattr(_settings, "EARLY_QR_GRACE_SECONDS", 30)))
    except (TypeError, ValueError):
        pass
    candidates.append(EARLY_GRACE_SECONDS)
    for value in candidates:
        if EARLY_GRACE_MIN <= value <= EARLY_GRACE_MAX:
            return value
    return EARLY_GRACE_SECONDS


def class_window(clase):
    """Retorna (start, end) aware de la clase (m1: normaliza naive)."""
    start = _ensure_aware(clase.start_time)
    end = start + timedelta(minutes=clase.duration_minutes)
    return start, end


def should_auto_start(clase, now=None):
    """True si `now` está dentro de [start - gracia, end)."""
    now = _ensure_aware(now or timezone.now())
    start, end = class_window(clase)
    return (start - timedelta(seconds=get_early_grace_seconds())) <= now < end


def get_valid_session(clase, now=None):
    """Sesión activa y no expirada más reciente, o None."""
    from apps.attendance.models import AttendanceSession

    now = now or timezone.now()
    return (
        AttendanceSession.objects.filter(
            scheduled_class=clase, is_active=True, expires_at__gt=now
        )
        .order_by("-created_at")
        .first()
    )


def _revoke_sessions(clase):
    """Revoca las sesiones activas de la clase (cierre/rotación)."""
    from apps.attendance.models import AttendanceSession

    AttendanceSession.objects.filter(
        scheduled_class=clase, is_active=True
    ).update(is_active=False)


def _close_class(clase):
    """Cierre perezoso: COMPLETED + revoca QR activos."""
    clase.status = ClassStatus.COMPLETED
    clase.save(update_fields=["status", "updated_at"])
    _revoke_sessions(clase)


def _session_ttl_minutes(session, clase):
    """TTL informativo: delta created_at->expires_at, fallback a config."""
    try:
        delta_min = (session.expires_at - session.created_at).total_seconds() / 60
        ttl = int(round(delta_min))
        if 1 <= ttl <= 120:
            return ttl
    except Exception:
        pass
    from apps.attendance.services import resolve_ttl

    return resolve_ttl(clase)


def ensure_current_session(clase):
    """Asegura la sesión vigente de la clase (QR único, sin auto-rotación).

    Retorna un dict con `outcome`:
    - pending  {status, starts_in_s, start_time} si falta para el inicio.
    - live     {session, created, result} si hay sesión válida o recién creada
      (S1 única). `result` es el dict de `generate_session()` (con
      `attend_url`/`token_raw`) solo cuando `created` es True; en reuso el
      token crudo ya no existe (solo se guarda su hash) y `result` es None.
    - expired  {status, reason=qr_expired, session_id, expires_at} si el QR
      único expiró dentro de la ventana (no se genera S2; sin auto-rotación).
    - finished {status, reason} si la clase está cerrada o pasó su ventana
      (con cierre perezoso a COMPLETED + revocación).

    QR único: si no hay sesión válida en ventana y ya hubo alguna sesión
    (`has_ever_had_session` por class_id) se retorna expired sin generar;
    solo si nunca hubo sesión se crea S1 una vez. Si pasó el fin, cierra
    sin crear. Ante carrera de single-active
    (IntegrityError/ValidationError) reintenta con fetch de la sesión
    válida en vez de propagar 500.
    """
    from apps.attendance.services import generate_session

    now = _ensure_aware(timezone.now())

    if clase.status in (ClassStatus.COMPLETED, ClassStatus.CANCELLED):
        return {"outcome": "finished", "status": clase.status, "reason": "closed"}

    start, end = class_window(clase)

    if now >= end:
        _close_class(clase)
        return {
            "outcome": "finished",
            "status": ClassStatus.COMPLETED,
            "reason": "window_elapsed",
        }

    if now < start - timedelta(seconds=get_early_grace_seconds()):
        remaining = int((start - now).total_seconds())
        return {
            "outcome": "pending",
            "status": ClassStatus.SCHEDULED,
            "starts_in_s": max(0, remaining),
            "start_time": start,
        }

    # En ventana (incluye gracia previa): reusar si hay sesión válida.
    session = get_valid_session(clase, now)
    if session is not None:
        return {"outcome": "live", "session": session, "created": False, "result": None}

    # QR único sin auto-rotación: si ya hubo alguna sesión, no generar S2.
    from apps.attendance.models import AttendanceSession as _AS

    has_ever = _AS.objects.filter(scheduled_class=clase).exists()
    if has_ever:
        last = (
            _AS.objects.filter(scheduled_class=clase)
            .order_by("-created_at")
            .first()
        )
        # Revoca remanentes activos expirados (higiene single-active).
        _revoke_sessions(clase)
        return {
            "outcome": "expired",
            "status": clase.status,
            "reason": "qr_expired",
            "session_id": str(last.id) if last is not None else None,
            "expires_at": last.expires_at if last is not None else None,
        }

    # Nunca hubo sesión: crear S1 una vez. generate_session revoca previas
    # (vacías aquí) y pasa SCHEDULED -> IN_PROGRESS.
    try:
        result = generate_session(clase)
    except (IntegrityError, ValidationError):
        # Carrera de single-active o colisión de token: la otra transacción
        # pudo dejar una sesión válida -> reusarla (nunca 500 en el poll).
        fresh = get_valid_session(clase, timezone.now())
        if fresh is not None:
            return {"outcome": "live", "session": fresh, "created": False, "result": None}
        raise ValidationError("No se pudo generar el código QR, intenta de nuevo.")
    return {"outcome": "live", "session": result["session"], "created": True, "result": result}
