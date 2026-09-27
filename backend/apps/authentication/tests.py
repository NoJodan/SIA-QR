from django.test import TestCase
from django.contrib.auth import get_user_model
from django.urls import resolve
from rest_framework.test import APIClient
from allauth.socialaccount.models import SocialAccount, SocialLogin
from allauth.core.exceptions import ImmediateHttpResponse
from apps.attendance.models import SystemConfig
from apps.authentication.adapters import InstitutionalGoogleAdapter
from apps.authentication.models import Professor

User = get_user_model()


class AuthenticationIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="test@ut.edu.co",
            google_sub="sub-12345",
            role="ROLE_STUDENT",
        )

    def test_me_endpoint_unauthenticated(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_endpoint_authenticated(self):
        self.client.force_login(self.user)
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["email"], "test@ut.edu.co")
        self.assertEqual(response.data["role"], "ROLE_STUDENT")
        self.assertEqual(response.data["id"], str(self.user.id))

    def test_adapter_allows_configured_domain(self):
        SystemConfig.objects.create(config_key="ALLOWED_DOMAIN", config_value="ut.edu.co")
        adapter = InstitutionalGoogleAdapter()
        account = SocialAccount(uid="sub-999", extra_data={"email": "student@ut.edu.co"})
        user = User(email="student@ut.edu.co")
        sociallogin = SocialLogin(user=user, account=account)

        # No debe lanzar excepción
        adapter.pre_social_login(None, sociallogin)

    def test_adapter_rejects_unauthorized_domain(self):
        SystemConfig.objects.create(config_key="ALLOWED_DOMAIN", config_value="ut.edu.co")
        adapter = InstitutionalGoogleAdapter()
        account = SocialAccount(uid="sub-888", extra_data={"email": "attacker@gmail.com"})
        user = User(email="attacker@gmail.com")
        sociallogin = SocialLogin(user=user, account=account)

        with self.assertRaises(ImmediateHttpResponse) as ctx:
            adapter.pre_social_login(None, sociallogin)

        response = ctx.exception.response
        self.assertEqual(response.status_code, 302)
        self.assertIn("domain_not_allowed", response.url)


class ProfessorProfileUpdateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="prof@ut.edu.co",
            google_sub="sub-prof",
            role="ROLE_PROFESSOR",
        )
        self.prof = Professor.objects.create(
            user=self.user,
            employee_code="PROV-000001",
            first_name="Ana",
            last_name="Perez",
        )
        self.client.force_login(self.user)

    def test_patch_updates_employee_code_and_department(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"employee_code": "  UT-1234  ", "department": "Ingenieria de Sistemas"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.prof.refresh_from_db()
        self.assertEqual(self.prof.employee_code, "UT-1234")
        self.assertEqual(self.prof.department, "Ingenieria de Sistemas")
        self.assertEqual(response.data["employee_code"], "UT-1234")

    def test_patch_rejects_duplicate_employee_code(self):
        other = User.objects.create_user(email="other@ut.edu.co", google_sub="sub-other", role="ROLE_PROFESSOR")
        Professor.objects.create(
            user=other, employee_code="UT-DUP", first_name="B", last_name="C"
        )

        response = self.client.patch(
            "/api/auth/me/", {"employee_code": "UT-DUP"}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.prof.refresh_from_db()
        self.assertEqual(self.prof.employee_code, "PROV-000001")

    def test_patch_keeps_own_employee_code(self):
        response = self.client.patch(
            "/api/auth/me/", {"employee_code": "PROV-000001"}, format="json"
        )

        self.assertEqual(response.status_code, 200)

    def test_patch_rejects_empty_employee_code(self):
        response = self.client.patch("/api/auth/me/", {"employee_code": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.prof.refresh_from_db()
        self.assertEqual(self.prof.employee_code, "PROV-000001")

    def test_patch_forbidden_for_student(self):
        # M1: el PATCH de estudiante es el registro de perfil real
        # (ya no 403). Sin campos de perfil válidos responde 400.
        student = User.objects.create_user(
            email="stu@ut.edu.co", google_sub="sub-stu", role="ROLE_STUDENT"
        )
        self.client.force_login(student)

        response = self.client.patch(
            "/api/auth/me/", {"employee_code": "HACK-1"}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        # ...y con datos reales crea el perfil (200).
        response = self.client.patch(
            "/api/auth/me/",
            {"student_code": "EST-1", "document_number": "DOC-1",
             "first_name": "Est", "last_name": "Uno"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)


class LogoutRouteTests(TestCase):
    def test_logout_url_resolves_to_app_view(self):
        # allauth cuelga account urls de la raiz y su "logout/" (account_logout)
        # es un CBV con CSRF activo: si vuelve a ganarnos, el POST del frontend
        # recibe 403 y la sesion nunca se destruye. El test client no enforces
        # CSRF, asi que este assert es el unico que detecta el sombreado.
        self.assertEqual(
            resolve("/api/auth/logout/").func.__module__, "apps.authentication.views"
        )
