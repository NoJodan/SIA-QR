import uuid
from django.conf import settings
from django.http import HttpResponseRedirect
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from apps.attendance.models import SystemConfig
from apps.authentication.models import AuthorizedProfessorEmail, Professor, UserRole


def _frontend():
    return getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")


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
        try:
            is_prof = AuthorizedProfessorEmail.objects.filter(email__iexact=email).exists()
        except Exception:
            is_prof = False
        existing = getattr(sociallogin, "user", None)
        if is_prof and existing is not None and getattr(existing, "pk", None):
            if existing.role != UserRole.ROLE_PROFESSOR:
                existing.role = UserRole.ROLE_PROFESSOR
                existing.save(update_fields=["role", "updated_at"])
            Professor.objects.get_or_create(
                user=existing,
                defaults={
                    "first_name": (email.split("@")[0] or "Profesor")[:100],
                    "last_name": "Docente",
                    "employee_code": f"PROV-{uuid.uuid4().hex[:6].upper()}",
                    "department": None,
                },
            )
        elif is_prof and existing is not None:
            # Usuario nuevo aún sin pk: asegura el rol para save_user().
            existing.role = UserRole.ROLE_PROFESSOR

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        user.google_sub = sociallogin.account.uid
        user.email = sociallogin.account.extra_data.get("email", data.get("email", "")).strip().lower()

        if AuthorizedProfessorEmail.objects.filter(email__iexact=user.email).exists():
            user.role = UserRole.ROLE_PROFESSOR
        else:
            user.role = UserRole.ROLE_STUDENT

        return user

    def save_user(self, request, sociallogin, form=None):
        user = super().save_user(request, sociallogin, form=form)
        if user.role == UserRole.ROLE_PROFESSOR:
            extra_data = sociallogin.account.extra_data
            first_name = extra_data.get("given_name") or extra_data.get("name", "Profesor")
            last_name = extra_data.get("family_name") or "Docente"
            employee_code = f"PROV-{uuid.uuid4().hex[:6].upper()}"

            Professor.objects.get_or_create(
                user=user,
                defaults={
                    "first_name": first_name,
                    "last_name": last_name,
                    "employee_code": employee_code,
                    "department": None,
                },
            )
        return user

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
