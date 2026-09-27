import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(BASE_DIR))

load_dotenv(BASE_DIR.parent / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"
if not SECRET_KEY:
    if DEBUG:
        # Solo desarrollo local: permite arrancar sin .env configurado.
        SECRET_KEY = "django-insecure-dev-only-key"
    else:
        from django.core.exceptions import ImproperlyConfigured

        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY es obligatorio en producción (DEBUG=False). "
            "Defínelo en el .env de la raíz (ver .env.example)."
        )
ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    # Terceros
    "rest_framework",
    "corsheaders",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    # Apps del proyecto
    "apps.authentication",
    "apps.academic",
    "apps.attendance",
]

AUTH_USER_MODEL = "authentication.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "sia_qr.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "sia_qr.wsgi.application"
ASGI_APPLICATION = "sia_qr.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "sia_qr"),
        "USER": os.getenv("POSTGRES_USER", "sia_qr"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "sia_qr"),
        "HOST": os.getenv("POSTGRES_HOST", "localhost"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "es-co"
TIME_ZONE = "America/Bogota"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
SITE_ID = 1

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
}

# Configuración de Sesiones y Cookies (C1: sin eximir CSRF; cookies
# HttpOnly/Secure/SameSite=Lax; CSRF_TRUSTED_ORIGINS por env).
# En producción (DEBUG=False) las cookies viajan solo por HTTPS.
_COOKIE_SECURE = os.getenv("COOKIE_SECURE", "False" if DEBUG else "True").lower() == "true"
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = _COOKIE_SECURE
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # axios debe leer `csrftoken` para cabecera X-CSRFToken
CSRF_COOKIE_SECURE = _COOKIE_SECURE

# Allauth / Socialaccount
SOCIALACCOUNT_ADAPTER = "apps.authentication.adapters.InstitutionalGoogleAdapter"
LOGIN_REDIRECT_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/") + "/"
ACCOUNT_LOGOUT_REDIRECT_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/") + "/login"
SOCIALACCOUNT_LOGIN_ON_GET = True
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_USERNAME_REQUIRED = False
ACCOUNT_AUTHENTICATION_METHOD = "email"

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": [
            "profile",
            "email",
            "openid",
        ],
        "AUTH_PARAMS": {
            "access_type": "online",
        },
    }
}

# CORS
_CORS_ORIGINS = [
    o.strip() for o in os.getenv(
        "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if o.strip()
]
CORS_ALLOWED_ORIGINS = _CORS_ORIGINS
CORS_ALLOW_CREDENTIALS = True

# SIA-QR: URL pública del frontend (para construir attend_url del QR) y
# TTL por defecto (minutos) de las sesiones QR instantáneas.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
try:
    QR_DEFAULT_MINUTES = int(os.getenv("QR_DEFAULT_MINUTES", "10"))
except ValueError:
    QR_DEFAULT_MINUTES = 10
if QR_DEFAULT_MINUTES < 1 or QR_DEFAULT_MINUTES > 120:
    QR_DEFAULT_MINUTES = 10

# m2: gracia previa (segundos) del QR automático antes del inicio.
# Fuente prioritaria: SystemConfig[EARLY_QR_GRACE_SECONDS] (0-300) >
# este setting > 30 (default en apps.academic.services).
try:
    EARLY_QR_GRACE_SECONDS = int(os.getenv("EARLY_QR_GRACE_SECONDS", "30"))
except ValueError:
    EARLY_QR_GRACE_SECONDS = 30
if EARLY_QR_GRACE_SECONDS < 0 or EARLY_QR_GRACE_SECONDS > 300:
    EARLY_QR_GRACE_SECONDS = 30

# CSRF: orígenes de confianza por env (coma-separados). Por defecto se
# deriva de CORS + FRONTEND_URL para no olvidar el origen del SPA.
# El frontend axios envía X-CSRFToken (withXSRFToken) tras GET /api/auth/csrf/.
_CSRF_ENV = [o.strip() for o in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]
CSRF_TRUSTED_ORIGINS = _CSRF_ENV or list(dict.fromkeys(_CORS_ORIGINS + [FRONTEND_URL]))
