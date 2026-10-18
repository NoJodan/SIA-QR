from allauth.socialaccount.providers.oauth2.views import (
    OAuth2CallbackView,
    OAuth2LoginView,
)
from django.contrib import admin
from django.urls import include, path

from apps.authentication.adapters import ProxiedGoogleOAuth2Adapter

urlpatterns = [
    path("admin/", admin.site.urls),
    # Google OAuth con callback fijo en el dominio del SPA (proxy Vercel):
    # mismos paths que allauth, resueltos antes que el include. Sin este
    # callback first-party la cookie de sesión no vuelve al frontend.
    path(
        "api/auth/google/login/",
        OAuth2LoginView.adapter_view(ProxiedGoogleOAuth2Adapter),
        name="proxied_google_login",
    ),
    path(
        "api/auth/google/login/callback/",
        OAuth2CallbackView.adapter_view(ProxiedGoogleOAuth2Adapter),
        name="proxied_google_callback",
    ),
    # Las URLs propias van primero: allauth cuelga sus account urls de la raiz y
    # su "logout/" (account_logout) sombrearia el nuestro.
    path("api/auth/", include("apps.authentication.urls")),
    path("api/auth/", include("allauth.urls")),
    path("api/academic/", include("apps.academic.urls")),
    path("api/attendance/", include("apps.attendance.urls")),
]
