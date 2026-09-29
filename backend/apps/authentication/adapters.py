import uuid
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from apps.attendance.models import SystemConfig
from apps.authentication.models import AuthorizedProfessorEmail, Professor, User, UserRole


def _frontend():
    return getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _is_persisted_user(sociallogin, existing, email):
    """Discrimina User transient (nuevo) vs existente.

    El pk UUID tiene default=uuid.uuid4 por lo que un transient ya trae
    pk truthy: NO basta con `getattr(existing, "pk", None)`. Se combina:
    sociallogin.is_existing + existing._state.adding + EXISTS en BD
    por pk y por email.
    """
    if existing is None:
        return False
    # 1) Flag de allauth (cuando está disponible).
    try:
        if bool(getattr(sociallogin, "is_existing", False)):
            return True
    except Exception:
        pass
    # 2) _state.adding=False => objeto cargado desde BD.
    try:
        if getattr(existing._state, "adding", True) is False:
            return True
    except Exception:
        pass
    # 3) Verificación en BD (SELECT, sin INSERT).
    try:
        pk = getattr(existing, "pk", None)
        if pk is not None and User.objects.filter(pk=pk).exists():
            return True
    except Exception:
        pass
    try:
        if email and User.objects.filter(email__iexact=email).exists():
            return True
    except Exception:
        pass
    return False


def _ensure_professor_for_user(user, email=""):
    """get_or_create idempotente de Professor. Solo para User persistido."""
    base = (email or getattr(user, "email", "") or "Profesor").split("@")[0].strip() or "Profesor"
    extra = {}
    try:
        extra_data = getattr(user, "_social_extra_data", None) or {}
        extra["first_name"] = (
            extra_data.get("given_name") or extra_data.get("name") or base
        )[:100]
        extra["last_name"] = (extra_data.get("family_name") or "Docente")[:100]
    except Exception:
        extra["first_name"] = base[:100]
        extra["last_name"] = "Docente"
    for _ in range(3):
        code = f"PROV-{uuid.uuid4().hex[:6].upper()}"
        try:
            with transaction.atomic():
                prof, _ = Professor.objects.get_or_create(
                    user=user,
                    defaults={
                        "first_name": extra.get("first_name", base[:100]),
                        "last_name": extra.get("last_name", "Docente"),
                        "employee_code": code,
                        "department": None,
                    },
                )
                return prof
        except IntegrityError:
            # Carrera: otro request creó el perfil, o colisión del
            # employee_code único -> reintentar get / nuevo código.
            try:
                return Professor.objects.get(user=user)
            except Professor.DoesNotExist:
                continue
    # 🟢 BAJA (DoesNotExist→500): tras agotar reintentos, lectura final
    # tolerante — nunca debe reventar el login con DoesNotExist.
    try:
        return Professor.objects.get(user=user)
    except Professor.DoesNotExist:
        return None


class InstitutionalGoogleAdapter(DefaultSocialAccountAdapter):
    def pre_social_login(self, request, sociallogin):
        # Obtener email del sociallogin
        email = sociallogin.user.email or ""
        if not email and "email" in sociallogin.account.extra_data:
            email = sociallogin.account.extra_data["email"]
        email = (email or "").strip().lower()

        domain = email.split("@")[-1].lower() if "@" in email else ""

        # Obtener dominio permitido desde SystemConfig o default
        try:
            config = SystemConfig.objects.get(config_key="ALLOWED_DOMAIN")
            allowed_domain = config.config_value.strip().lower()
        except SystemConfig.DoesNotExist:
            allowed_domain = "ut.edu.co"

        if domain != allowed_domain:
            raise ImmediateHttpResponse(
                HttpResponseRedirect(f"{_frontend()}/login?error=domain_not_allowed")
            )

        # Poblar google_sub si no está seteado
        sub = sociallogin.account.uid
        if not sociallogin.user.google_sub:
            sociallogin.user.google_sub = sub
        if not sociallogin.user.email:
            sociallogin.user.email = email

        # M2: reconcilia rol en cada login (promueve al profesor autorizado
        # tardíamente que hoy quedaría STUDENT para siempre).
        # FIX FK: el pk UUID es truthy aun en transient (default=uuid.uuid4),
        # por lo que NO se discrimina con `getattr(existing, "pk", None)`.
        try:
            is_prof = AuthorizedProfessorEmail.objects.filter(email__iexact=email).exists()
        except Exception:
            is_prof = False
        existing = getattr(sociallogin, "user", None)
        if not is_prof or existing is None:
            return
        if not _is_persisted_user(sociallogin, existing, email):
            # Rama NUEVA (transient): solo mutar en memoria, SIN save(),
            # SIN get_or_create() ni ningún INSERT. save_user() creará
            # User y Professor en el orden válido.
            existing.role = UserRole.ROLE_PROFESSOR
            return
        # Rama EXISTENTE: reconcilia rol + ensure Professor en atomic(),
        # con reintento ante IntegrityError por carrera.
        # NUNCA toca ADMIN (guard como views.py:83-84).
        try:
            with transaction.atomic():
                fresh = User.objects.filter(pk=existing.pk).first()
                target = fresh if fresh is not None else existing
                # 🔴 ALTA: guard ADMIN — un ADMIN en whitelist por error
                # nunca debe degradarse a PROFESSOR.
                if getattr(target, "role", None) == UserRole.ROLE_ADMIN or getattr(
                    existing, "role", None
                ) == UserRole.ROLE_ADMIN:
                    return
                if target.role != UserRole.ROLE_PROFESSOR:
                    target.role = UserRole.ROLE_PROFESSOR
                    target.save(update_fields=["role", "updated_at"])
                    # Reflejar en el objeto del sociallogin en memoria.
                    existing.role = UserRole.ROLE_PROFESSOR
                try:
                    _ensure_professor_for_user(target, email=email)
                except (IntegrityError, Professor.DoesNotExist):
                    # Carrera: reintentar get del perfil ya creado.
                    try:
                        Professor.objects.get(user=target)
                    except Professor.DoesNotExist:
                        pass
        except (IntegrityError, Professor.DoesNotExist):
            try:
                target = User.objects.filter(pk=existing.pk).first() or existing
                Professor.objects.get(user=target)
            except Exception:
                pass

    def populate_user(self, request, sociallogin, data):
        # populate puro: normalizar + asignar rol, sin INSERT ni save().
        user = super().populate_user(request, sociallogin, data)
        raw_email = ""
        try:
            raw_email = (
                sociallogin.account.extra_data.get("email", data.get("email", ""))
                or getattr(user, "email", "")
                or ""
            )
        except Exception:
            raw_email = getattr(user, "email", "") or ""
        user.email = str(raw_email or "").strip().lower()
        try:
            user.google_sub = sociallogin.account.uid
        except Exception:
            pass
        try:
            whitelisted = bool(
                user.email
                and AuthorizedProfessorEmail.objects.filter(
                    email__iexact=user.email
                ).exists()
            )
        except Exception:
            whitelisted = False
        user.role = (
            UserRole.ROLE_PROFESSOR if whitelisted else UserRole.ROLE_STUDENT
        )
        return user

    def save_user(self, request, sociallogin, form=None):
        # 🟡 MEDIA-BAJA: hint para reconciliar la carrera email/google_sub
        # UNIQUE (doble callback concurrente) si super().save_user() revienta.
        try:
            _raw = getattr(sociallogin.user, "email", "") or (
                sociallogin.account.extra_data or {}
            ).get("email", "")
        except Exception:
            _raw = ""
        email_hint = str(_raw or "").strip().lower()
        try:
            uid_hint = sociallogin.account.uid
        except Exception:
            uid_hint = ""
        try:
            with transaction.atomic():
                user = super().save_user(request, sociallogin, form=form)
                if user.role == UserRole.ROLE_PROFESSOR:
                    try:
                        extra_data = sociallogin.account.extra_data or {}
                    except Exception:
                        extra_data = {}
                    user._social_extra_data = extra_data
                    try:
                        _ensure_professor_for_user(user, email=user.email)
                    except (IntegrityError, Professor.DoesNotExist):
                        # Colisión de employee_code único o carrera:
                        # el perfil ya existe -> get idempotente.
                        try:
                            Professor.objects.get(user=user)
                        except Professor.DoesNotExist:
                            pass
                return user
        except IntegrityError:
            # Carrera: otro request creó el User (email/google_sub UNIQUE).
            # Reconciliación idempotente en lugar de 500.
            existing = None
            try:
                if email_hint:
                    existing = User.objects.filter(
                        email__iexact=email_hint
                    ).first()
                if existing is None and uid_hint:
                    existing = User.objects.filter(google_sub=uid_hint).first()
            except Exception:
                existing = None
            if existing is not None:
                try:
                    if getattr(existing, "role", None) == UserRole.ROLE_PROFESSOR:
                        _ensure_professor_for_user(existing, email=email_hint)
                except Exception:
                    pass
                return existing
            raise ImmediateHttpResponse(
                HttpResponseRedirect(f"{_frontend()}/login?error=account_exists")
            )

    def get_login_redirect_url(self, request, user):
        """M4: respeta ?next= del flujo /attend?token= (round-trip
        token -> login Google -> vuelta a /attend). Solo permite destinos
        del propio frontend o rutas locales para evitar open-redirect."""
        frontend = _frontend()
        nxt = None
        try:
            nxt = request.GET.get("next") or request.POST.get("next")
        except Exception:
            nxt = None
        if nxt:
            nxt = str(nxt).strip()
            if nxt.startswith(frontend + "/") or nxt == frontend or nxt.startswith("/"):
                # Normaliza rutas relativas al frontend absoluto.
                if nxt.startswith("/"):
                    return f"{frontend}{nxt}"
                return nxt
        return frontend + "/"
