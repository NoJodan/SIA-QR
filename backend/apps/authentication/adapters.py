import uuid
from django.http import HttpResponseRedirect
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from apps.attendance.models import SystemConfig
from apps.authentication.models import AuthorizedProfessorEmail, Professor, UserRole


class InstitutionalGoogleAdapter(DefaultSocialAccountAdapter):
    def pre_social_login(self, request, sociallogin):
        # Obtener email del sociallogin
        email = sociallogin.user.email or ""
        if not email and "email" in sociallogin.account.extra_data:
            email = sociallogin.account.extra_data["email"]

        domain = email.split("@")[-1].lower() if "@" in email else ""

        # Obtener dominio permitido desde SystemConfig o default
        try:
            config = SystemConfig.objects.get(config_key="ALLOWED_DOMAIN")
            allowed_domain = config.config_value.strip().lower()
        except SystemConfig.DoesNotExist:
            allowed_domain = "ut.edu.co"

        if domain != allowed_domain:
            raise ImmediateHttpResponse(
                HttpResponseRedirect("http://localhost:3000/login?error=domain_not_allowed")
            )

        # Poblar google_sub si no está seteado
        sub = sociallogin.account.uid
        if not sociallogin.user.google_sub:
            sociallogin.user.google_sub = sub
        if not sociallogin.user.email:
            sociallogin.user.email = email

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

