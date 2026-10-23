from urllib.parse import quote

from django.conf import settings
from django.test import TestCase, RequestFactory, override_settings
from django.contrib.auth import get_user_model
from django.contrib.sites.models import Site
from django.urls import resolve
from rest_framework.test import APIClient
from allauth.socialaccount.models import SocialAccount, SocialApp, SocialLogin
from allauth.core.exceptions import ImmediateHttpResponse
from apps.attendance.models import SystemConfig
from apps.authentication.adapters import (
    InstitutionalGoogleAdapter,
    ProxiedGoogleOAuth2Adapter,
)
from apps.authentication.models import AuthorizedProfessorEmail, Professor, UserRole
from apps.authentication.views import reconcile_professor_role

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

    @override_settings(FRONTEND_URL="https://sia-qr.vercel.app")
    def test_google_callback_url_uses_frontend_domain(self):
        # El callback de Google debe ir por el dominio del SPA (proxy Vercel)
        # para que la cookie de sesion sea first-party.
        request = RequestFactory().get("/api/auth/google/login/")
        adapter = ProxiedGoogleOAuth2Adapter(request)
        self.assertEqual(
            adapter.get_callback_url(request, None),
            f"{settings.FRONTEND_URL}/api/auth/google/login/callback/",
        )

    @override_settings(FRONTEND_URL="http://localhost:3000")
    def test_google_callback_url_local_uses_backend_domain(self):
        # Sin proxy /api en el dev server, el callback debe volver al backend.
        request = RequestFactory().get(
            "/api/auth/google/login/", HTTP_HOST="localhost:8000"
        )
        adapter = ProxiedGoogleOAuth2Adapter(request)
        self.assertEqual(
            adapter.get_callback_url(request, None),
            "http://localhost:8000/api/auth/google/login/callback/",
        )

    @override_settings(FRONTEND_URL="https://sia-qr.vercel.app")
    def test_google_login_route_redirect_uri_uses_frontend_domain(self):
        # Regresion del flujo cableado (no solo del adapter): el provider
        # construye el authorize con su oauth2_adapter_class, asi que el
        # redirect_uri real debe salir del dominio del SPA.
        app = SocialApp.objects.create(
            provider="google", name="Google", client_id="cid", secret="sec"
        )
        app.sites.add(Site.objects.get_current())

        response = self.client.get("/api/auth/google/login/")

        self.assertEqual(response.status_code, 302)
        self.assertIn(
            quote(f"{settings.FRONTEND_URL}/api/auth/google/login/callback/", safe=""),
            response["Location"],
        )


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
        SocialAccount.objects.create(
            user=student, provider="google", uid="sub-stu",
            extra_data={"given_name": "Est", "family_name": "Uno"},
        )
        self.client.force_login(student)

        response = self.client.patch(
            "/api/auth/me/", {"employee_code": "HACK-1"}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        # ...y con datos reales crea el perfil (200).
        response = self.client.patch(
            "/api/auth/me/",
            {"student_code": "123456", "document_number": "1234567890",
             "phone_number": "3001234567", "address": "Calle 1 #2-3",
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


class ProfessorWhitelistAdapterTests(TestCase):
    """FIX FK huérfano: pre_social_login() confundía el transient (pk UUID
    truthy) con existente y hacía INSERT de Professor antes que User."""

    def setUp(self):
        self.factory = RequestFactory()
        self.adapter = InstitutionalGoogleAdapter()
        SystemConfig.objects.create(
            config_key="ALLOWED_DOMAIN", config_value="ut.edu.co"
        )

    def _sociallogin(self, email, uid="sub-test", persisted_user=None):
        account = SocialAccount(
            uid=uid,
            provider="google",
            extra_data={
                "email": email,
                "given_name": "Profe",
                "family_name": "Test",
            },
        )
        user = persisted_user if persisted_user is not None else User(email=email)
        return SocialLogin(user=user, account=account)

    def test_whitelist_transient_no_crea_professor_solo_setea_rol(self):
        AuthorizedProfessorEmail.objects.create(email="nuevo@ut.edu.co")
        users_before = User.objects.count()
        sociallogin = self._sociallogin("nuevo@ut.edu.co", uid="sub-nuevo")

        self.adapter.pre_social_login(None, sociallogin)

        # Solo muta en memoria: rol asignado, sin INSERT alguno.
        self.assertEqual(sociallogin.user.role, UserRole.ROLE_PROFESSOR)
        self.assertEqual(User.objects.count(), users_before)
        self.assertEqual(Professor.objects.count(), 0)
        self.assertFalse(
            Professor.objects.filter(
                user_id=sociallogin.user.pk
            ).exists()
        )

    def test_transient_pk_truthy_no_se_confunde_con_existente(self):
        # El transient trae pk truthy por default=uuid.uuid4: regresión
        # directa del bug (getattr(existing, "pk", None) siempre truthy).
        AuthorizedProfessorEmail.objects.create(email="otro@ut.edu.co")
        sociallogin = self._sociallogin("otro@ut.edu.co", uid="sub-otro")
        self.assertIsNotNone(sociallogin.user.pk)

        self.adapter.pre_social_login(None, sociallogin)

        self.assertEqual(sociallogin.user.role, UserRole.ROLE_PROFESSOR)
        self.assertEqual(Professor.objects.count(), 0)

    def test_save_user_crea_user_y_professor_en_orden_valido(self):
        AuthorizedProfessorEmail.objects.create(email="save@ut.edu.co")
        request = self.factory.get("/")
        # allauth save_user() toca request.session (unstash_verified_email).
        from django.contrib.sessions.middleware import SessionMiddleware

        SessionMiddleware(lambda r: None).process_request(request)
        request.session.save()
        sociallogin = self._sociallogin("save@ut.edu.co", uid="sub-save")
        # Flujo real allauth: populate_user() corre antes que save_user().
        self.adapter.populate_user(
            request, sociallogin, {"email": "save@ut.edu.co"}
        )
        user = self.adapter.save_user(request, sociallogin)

        # User persistido primero, Professor después con FK válida.
        self.assertIsNotNone(user.pk)
        user.refresh_from_db()
        self.assertEqual(user.role, UserRole.ROLE_PROFESSOR)
        prof = Professor.objects.get(user=user)
        self.assertEqual(prof.user_id, user.pk)
        self.assertTrue(prof.employee_code)

    def test_reconciliacion_existente_student_whitelist_promueve(self):
        student = User.objects.create_user(
            email="viejo@ut.edu.co",
            google_sub="sub-viejo",
            role=UserRole.ROLE_STUDENT,
        )
        AuthorizedProfessorEmail.objects.create(email="viejo@ut.edu.co")
        sociallogin = self._sociallogin(
            "viejo@ut.edu.co", uid="sub-viejo", persisted_user=student
        )

        self.adapter.pre_social_login(None, sociallogin)

        student.refresh_from_db()
        self.assertEqual(student.role, UserRole.ROLE_PROFESSOR)
        prof = Professor.objects.get(user=student)
        self.assertEqual(prof.user_id, student.pk)

    def test_reconcile_professor_role_solo_promueve_no_degrada(self):
        prof_user = User.objects.create_user(
            email="nodeg@ut.edu.co",
            google_sub="sub-nodeg",
            role=UserRole.ROLE_PROFESSOR,
        )
        Professor.objects.create(
            user=prof_user,
            employee_code="UT-NODEG",
            first_name="N",
            last_name="D",
        )
        # Sin whitelist: no degrada a STUDENT.
        reconcile_professor_role(prof_user)
        prof_user.refresh_from_db()
        self.assertEqual(prof_user.role, UserRole.ROLE_PROFESSOR)

    def test_relogin_idempotente_doble_pre_social_login_un_professor(self):
        # QA: re-login idempotente — doble pre_social_login persistido
        # debe dejar exactamente 1 Professor y rol PROFESSOR.
        student = User.objects.create_user(
            email="relogin@ut.edu.co",
            google_sub="sub-relogin",
            role=UserRole.ROLE_STUDENT,
        )
        AuthorizedProfessorEmail.objects.create(email="relogin@ut.edu.co")
        sl1 = self._sociallogin(
            "relogin@ut.edu.co", uid="sub-relogin", persisted_user=student
        )
        self.adapter.pre_social_login(None, sl1)
        student.refresh_from_db()
        self.assertEqual(student.role, UserRole.ROLE_PROFESSOR)
        # Segundo login: refresca el objeto persistido desde BD.
        student.refresh_from_db()
        sl2 = self._sociallogin(
            "relogin@ut.edu.co", uid="sub-relogin", persisted_user=student
        )
        self.adapter.pre_social_login(None, sl2)
        student.refresh_from_db()
        self.assertEqual(student.role, UserRole.ROLE_PROFESSOR)
        self.assertEqual(
            Professor.objects.filter(user=student).count(), 1
        )

    def test_doble_save_user_mismo_email_no_revienta(self):
        # QA: doble save_user (carrera email/google_sub UNIQUE) debe
        # reconciliar al existente en lugar de IntegrityError 500.
        from django.contrib.sessions.middleware import SessionMiddleware

        AuthorizedProfessorEmail.objects.create(email="doble@ut.edu.co")

        def _req():
            req = self.factory.get("/")
            SessionMiddleware(lambda r: None).process_request(req)
            req.session.save()
            return req

        sl1 = self._sociallogin("doble@ut.edu.co", uid="sub-doble")
        self.adapter.populate_user(_req(), sl1, {"email": "doble@ut.edu.co"})
        user1 = self.adapter.save_user(_req(), sl1)
        self.assertIsNotNone(user1.pk)

        # Segundo callback con mismo email+uid (reintento concurrente).
        sl2 = self._sociallogin("doble@ut.edu.co", uid="sub-doble")
        self.adapter.populate_user(_req(), sl2, {"email": "doble@ut.edu.co"})
        user2 = self.adapter.save_user(_req(), sl2)

        self.assertEqual(str(user2.pk), str(user1.pk))
        self.assertEqual(User.objects.filter(email__iexact="doble@ut.edu.co").count(), 1)
        self.assertEqual(Professor.objects.filter(user_id=user1.pk).count(), 1)
