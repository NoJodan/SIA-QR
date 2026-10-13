import re
import uuid

from django.contrib.auth import authenticate
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.db import IntegrityError, transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from apps.authentication.models import (
    AuthorizedProfessorEmail,
    Professor,
    Student,
    User,
    UserRole,
)


class SessionAuthentication401(SessionAuthentication):
    """SessionAuthentication estándar (CON enforcement CSRF) pero con
    cabecera WWW-Authenticate para que DRF devuelva 401 (no 403)
    cuando no hay sesión Google."""

    def authenticate_header(self, request):
        return 'Session realm="SIA-QR"'


class IsAdminUserRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == UserRole.ROLE_ADMIN
        )


class AdminLoginThrottle(AnonRateThrottle):
    """Throttle bajo anti-fuerza-bruta para el login admin (scope admin_login)."""

    scope = "admin_login"


_GENERIC_ADMIN_LOGIN_ERROR = {"error": "Credenciales inválidas"}

_PHONE_RE = re.compile(r"^(?=(?:\D*\d){7,})\+?[\d\s\-()]{7,20}$")


def _phone_has_digits(value):
    """B2: exige >=7 dígitos (la regex sola aceptaba '       ' o '-------')."""
    import re as _re

    return len(_re.sub(r"\D", "", value or "")) >= 7


def get_google_names(user):
    """Nombres sugeridos desde Google (SocialAccount.extra_data).

    Lee given_name/family_name/name con fallbacks como en adapters.py.
    Retorna (first_name, last_name) o (None, None) si no es obtenible.
    No crea ningún perfil.

    Fallback monónimo (B3): si Google solo trae una palabra
    (ej. extra_data={'name': 'Madonna'} o given_name='Madonna' sin
    family_name), se duplica en first/last (first=parts[0],
    last=parts[0]) para no bloquear el registro para siempre con 400.
    """
    extra = {}
    try:
        from allauth.socialaccount.models import SocialAccount

        sa = SocialAccount.objects.filter(user=user).order_by("-last_login", "-id").first()
        if sa is not None:
            extra = sa.extra_data or {}
    except Exception:
        extra = {}
    if not isinstance(extra, dict):
        extra = {}
    given = str(extra.get("given_name") or "").strip()
    family = str(extra.get("family_name") or "").strip()
    full = str(extra.get("name") or "").strip()
    first = given or ""
    last = family or ""
    if not first and full:
        parts = full.split()
        if len(parts) == 1:
            first = parts[0]
            # B3 monónimo: duplicar para no bloquear (ej. 'Madonna').
            if not last:
                last = parts[0]
        elif len(parts) >= 2:
            first = parts[0]
            if not last:
                last = " ".join(parts[1:])
    # B3 monónimo por given_name sin family_name (ej. given='Madonna'):
    # si solo hay first, duplicarlo en last antes del corte final.
    if first and not last:
        last = first
    first = (first or "")[:100].strip()
    last = (last or "")[:100].strip()
    if not first or not last:
        return None, None
    return first, last


@api_view(["POST"])
@authentication_classes([SessionAuthentication401])
@permission_classes([AllowAny])
@throttle_classes([AdminLoginThrottle])
def admin_login_view(request):
    """POST /api/auth/admin/login/ — login admin por sesión Django (NO JWT).

    AllowAny + SessionAuthentication401 (CON enforcement CSRF, SIN csrf_exempt).
    El CSRF se exige vía enforce_csrf explícito porque DRF exime el middleware
    y SessionAuthentication solo lo verifica cuando ya hay sesión.
    """
    # Enforce CSRF explícito: POST sin X-CSRFToken válido → 403.
    SessionAuthentication401().enforce_csrf(request)

    raw_email = request.data.get("email", "") if hasattr(request.data, "get") else ""
    raw_password = request.data.get("password", "") if hasattr(request.data, "get") else ""
    email = str(raw_email or "").strip().lower()
    password = str(raw_password or "")

    if not email or not password:
        return Response(
            {"error": "El correo electrónico y la contraseña son obligatorios"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Topes de longitud (modelo: email 255; password Django ≤ 128 útil).
    if len(email) > 255 or len(password) > 128:
        return Response(_GENERIC_ADMIN_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)

    user = authenticate(request, email=email, password=password)
    if user is None:
        return Response(_GENERIC_ADMIN_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)
    if not user.is_active:
        return Response(_GENERIC_ADMIN_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)
    if getattr(user, "role", None) != UserRole.ROLE_ADMIN:
        return Response(_GENERIC_ADMIN_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)
    if not user.has_usable_password():
        return Response(_GENERIC_ADMIN_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)

    django_login(request, user)
    return Response(_me_payload(user), status=status.HTTP_200_OK)


def _ensure_professor_profile(user, email=""):
    """Crea el perfil Professor si falta (usado al promover tardíamente).

    Idempotente: get_or_create + atomic; ante IntegrityError por carrera
    reintenta el get en lugar de create() directo.
    """
    try:
        return user.professor_profile
    except Exception:
        pass
    try:
        return Professor.objects.get(user=user)
    except Professor.DoesNotExist:
        pass
    base = (email or user.email or "Profesor").split("@")[0].strip() or "Profesor"
    for _ in range(3):
        code = f"PROV-{uuid.uuid4().hex[:6].upper()}"
        try:
            with transaction.atomic():
                prof, _ = Professor.objects.get_or_create(
                    user=user,
                    defaults={
                        "employee_code": code,
                        "first_name": base[:100],
                        "last_name": "Docente",
                        "department": None,
                    },
                )
                return prof
        except IntegrityError:
            try:
                return Professor.objects.get(user=user)
            except Professor.DoesNotExist:
                continue
    # 🟢 BAJA (DoesNotExist→500): lectura final tolerante.
    try:
        return Professor.objects.get(user=user)
    except Professor.DoesNotExist:
        return None


def reconcile_professor_role(user):
    """M2: promueve a PROFESSOR si el email está en la whitelist aunque el
    usuario se haya registrado antes como STUDENT. Solo promueve, nunca
    degrada (la degradación es acción explícita del DELETE admin)."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "role", None) == UserRole.ROLE_ADMIN:
        return False
    try:
        whitelisted = AuthorizedProfessorEmail.objects.filter(
            email__iexact=(user.email or "").strip().lower()
        ).exists()
    except Exception:
        return False
    if not whitelisted:
        return False
    # Solo promueve STUDENT -> PROFESSOR; nunca degrada PROFESSOR -> STUDENT.
    changed = False
    if user.role == UserRole.ROLE_STUDENT:
        # En la práctica solo STUDENT llega aquí; nunca degrada.
        try:
            with transaction.atomic():
                user.role = UserRole.ROLE_PROFESSOR
                user.save(update_fields=["role", "updated_at"])
            changed = True
        except IntegrityError:
            user.refresh_from_db()
            changed = user.role == UserRole.ROLE_PROFESSOR
    try:
        _ensure_professor_profile(user, email=user.email)
    except Exception:
        # 🟢 BAJA: IntegrityError (carrera) o DoesNotExist (perfil
        # borrado entre get/create) nunca deben reventar con 500;
        # último intento de lectura idempotente.
        try:
            Professor.objects.get(user=user)
        except Exception:
            pass
    return changed


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@ensure_csrf_cookie
def csrf_view(request):
    """C1: fija la cookie `csrftoken` para el SPA (axios withXSRFToken)."""
    return Response({"detail": "CSRF cookie fijada"}, status=status.HTTP_200_OK)


@api_view(["GET", "PATCH"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user
    # M2: reconcilia rol contra la whitelist en cada lectura de perfil.
    reconcile_professor_role(user)
    user.refresh_from_db()

    if request.method == "PATCH":
        if user.role == UserRole.ROLE_PROFESSOR:
            return _patch_professor(request, user)
        if user.role == UserRole.ROLE_STUDENT:
            return _patch_student(request, user)
        return Response(
            {"error": "Tu rol no permite editar el perfil"},
            status=status.HTTP_403_FORBIDDEN,
        )

    return Response(_me_payload(user))


def _student_profile_incomplete(student):
    """B4: perfil incompleto si phone/address vacíos (pre-migración con
    phone=NULL o address=NULL/'' eludía el requisito mirando solo
    existencia). Retorna True si falta teléfono o dirección."""
    if student is None:
        return True
    phone = str(getattr(student, "phone_number", None) or "").strip()
    address = str(getattr(student, "address", None) or "").strip()
    return (not phone) or (not address)


def _me_payload(user):
    data = {
        "id": str(user.id),
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
    }

    if user.role == UserRole.ROLE_PROFESSOR:
        prof = getattr(user, "professor_profile", None)
        try:
            if prof is None:
                prof = Professor.objects.get(user=user)
        except Exception:
            prof = None
        data.update({
            "employee_code": prof.employee_code if prof else None,
            "first_name": prof.first_name if prof else "",
            "last_name": prof.last_name if prof else "",
            "department": prof.department if prof else "",
        })

    if user.role == UserRole.ROLE_STUDENT:
        suggested_first, suggested_last = get_google_names(user)
        try:
            student = user.student_profile
            data.update({
                "student_code": student.student_code,
                "document_number": student.document_number,
                "first_name": student.first_name,
                "last_name": student.last_name,
                "phone_number": getattr(student, "phone_number", None),
                "address": student.address,
                "suggested_first_name": suggested_first,
                "suggested_last_name": suggested_last,
                # B4: pre-migración con phone/address NULL/'' cuenta como
                # incompleto aunque el perfil exista.
                "needs_profile": _student_profile_incomplete(student),
            })
        except Exception:
            try:
                student = Student.objects.get(user=user)
                data.update({
                    "student_code": student.student_code,
                    "document_number": student.document_number,
                    "first_name": student.first_name,
                    "last_name": student.last_name,
                    "phone_number": getattr(student, "phone_number", None),
                    "address": student.address,
                    "suggested_first_name": suggested_first,
                    "suggested_last_name": suggested_last,
                    "needs_profile": _student_profile_incomplete(student),
                })
            except Student.DoesNotExist:
                data.update({
                    "student_code": None,
                    "document_number": None,
                    "first_name": "",
                    "last_name": "",
                    "phone_number": None,
                    "address": None,
                    "suggested_first_name": suggested_first,
                    "suggested_last_name": suggested_last,
                    # M1: el perfil NO se autocrea; el estudiante debe
                    # completarlo vía PATCH antes de marcar (412 si falta).
                    "needs_profile": True,
                })

    return data


def _patch_professor(request, user):
    prof = getattr(user, "professor_profile", None)
    if prof is None:
        try:
            prof = Professor.objects.get(user=user)
        except Professor.DoesNotExist:
            return Response(
                {"error": "Perfil de profesor no encontrado"},
                status=status.HTTP_404_NOT_FOUND,
            )

    employee_code = str(request.data.get("employee_code") or "").strip()
    if not employee_code:
        return Response(
            {"error": "El código de empleado es obligatorio"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(employee_code) > 50:
        return Response(
            {"error": "El código de empleado no puede superar 50 caracteres"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if Professor.objects.filter(employee_code=employee_code).exclude(pk=prof.pk).exists():
        return Response(
            {"error": "Ese código de empleado ya está asignado a otro profesor"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    fields = ["employee_code"]
    if "department" in request.data:
        department = str(request.data.get("department") or "").strip()
        if len(department) > 100:
            return Response(
                {"error": "El departamento no puede superar 100 caracteres"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        prof.department = department or None
        fields.append("department")

    prof.employee_code = employee_code
    prof.save(update_fields=fields)
    user.refresh_from_db()
    return Response(_me_payload(user))


def _patch_student(request, user):
    """M1: registro inicial real del estudiante (RF-EST-03). Crea o actualiza
    el perfil con código/documento/teléfono/dirección reales; el nombre se
    deriva de Google (SocialAccount) y se ignoran first/last entrantes.
    Unicidad con 409 legible.

    B1: check+create/update envueltos en transaction.atomic(); ante
    IntegrityError por carrera se re-chequea iexact y se responde 409
    legible (nunca 500)."""
    student_code = str(request.data.get("student_code") or "").strip()
    document_number = str(request.data.get("document_number") or "").strip()
    phone_number = str(request.data.get("phone_number") or "").strip()
    address = str(request.data.get("address") or "").strip()

    errors = {}
    if not student_code:
        errors["student_code"] = "El código estudiantil es obligatorio."
    elif len(student_code) > 50:
        errors["student_code"] = "No puede superar 50 caracteres."
    if not document_number:
        errors["document_number"] = "El número de documento es obligatorio."
    elif len(document_number) > 50:
        errors["document_number"] = "No puede superar 50 caracteres."
    if not phone_number:
        errors["phone_number"] = "El teléfono es obligatorio."
    elif len(phone_number) > 20:
        errors["phone_number"] = "No puede superar 20 caracteres."
    elif not _PHONE_RE.match(phone_number) or not _phone_has_digits(phone_number):
        # B2: exige >=7 dígitos (rechaza '       ' y '-------').
        errors["phone_number"] = "Formato de teléfono inválido."
    if not address:
        errors["address"] = "La dirección es obligatoria."
    elif len(address) > 500:
        # m2: tope coherente con maxLength=500 del frontend.
        errors["address"] = "La dirección no puede superar 500 caracteres."
    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    # Nombre derivado de Google; 400 si no es obtenible.
    first_name, last_name = get_google_names(user)
    if not first_name or not last_name:
        return Response(
            {"error": "No se pudo obtener tu nombre desde Google, intenta de nuevo."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        with transaction.atomic():
            try:
                existing = Student.objects.get(user=user)
                me_qs = Student.objects.exclude(pk=existing.pk)
            except Student.DoesNotExist:
                existing = None
                me_qs = Student.objects.all()
            if me_qs.filter(student_code__iexact=student_code).exists():
                return Response(
                    {"student_code": "Ese código estudiantil ya está registrado por otra cuenta."},
                    status=status.HTTP_409_CONFLICT,
                )
            if me_qs.filter(document_number__iexact=document_number).exists():
                return Response(
                    {"document_number": "Ese número de documento ya está registrado por otra cuenta."},
                    status=status.HTTP_409_CONFLICT,
                )

            if existing is None:
                Student.objects.create(
                    user=user,
                    student_code=student_code,
                    document_number=document_number,
                    first_name=first_name,
                    last_name=last_name,
                    phone_number=phone_number,
                    address=address,
                )
            else:
                existing.student_code = student_code
                existing.document_number = document_number
                existing.first_name = first_name
                existing.last_name = last_name
                existing.phone_number = phone_number
                existing.address = address
                existing.save(update_fields=["student_code", "document_number", "first_name", "last_name", "phone_number", "address"])
    except IntegrityError:
        # B1: carrera entre check y create/update (UNIQUE) -> re-chequear
        # iexact y responder 409 legible, nunca 500.
        if Student.objects.filter(student_code__iexact=student_code).exclude(user=user).exists():
            return Response(
                {"student_code": "Ese código estudiantil ya está registrado por otra cuenta."},
                status=status.HTTP_409_CONFLICT,
            )
        if Student.objects.filter(document_number__iexact=document_number).exclude(user=user).exists():
            return Response(
                {"document_number": "Ese número de documento ya está registrado por otra cuenta."},
                status=status.HTTP_409_CONFLICT,
            )
        # Colisión de user_id (doble create concurrente del mismo usuario):
        # el perfil ya existe -> 409 legible en lugar de 500.
        if Student.objects.filter(user=user).exists():
            return Response(
                {"error": "Tu perfil ya fue registrado, recarga e intenta de nuevo."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {"error": "No se pudo guardar el perfil, intenta de nuevo."},
            status=status.HTTP_409_CONFLICT,
        )
    user.refresh_from_db()
    return Response(_me_payload(user))


@api_view(["POST"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAuthenticated])
def logout_view(request):
    django_logout(request)
    return Response({"detail": "Sesión cerrada exitosamente"}, status=status.HTTP_200_OK)


@api_view(["GET", "POST", "DELETE"])
@authentication_classes([SessionAuthentication401])
@permission_classes([IsAdminUserRole])
def professors_whitelist(request):
    if request.method == "GET":
        emails = AuthorizedProfessorEmail.objects.all().order_by("-created_at")
        data = [
            {"id": str(item.id), "email": item.email, "created_at": item.created_at}
            for item in emails
        ]
        return Response(data, status=status.HTTP_200_OK)

    if request.method == "POST":
        email = request.data.get("email", "").strip().lower()
        if not email or "@" not in email:
            return Response({"error": "Correo electrónico inválido"}, status=status.HTTP_400_BAD_REQUEST)

        obj, created = AuthorizedProfessorEmail.objects.get_or_create(email=email)
        if not created:
            return Response({"error": "El correo ya está en la lista blanca"}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {"id": str(obj.id), "email": obj.email, "created_at": obj.created_at},
            status=status.HTTP_201_CREATED,
        )

    if request.method == "DELETE":
        email = (request.data.get("email") or request.query_params.get("email", "")).strip().lower()
        if not email:
            return Response({"error": "Email requerido para eliminar"}, status=status.HTTP_400_BAD_REQUEST)

        deleted_count, _ = AuthorizedProfessorEmail.objects.filter(email__iexact=email).delete()
        if deleted_count == 0:
            return Response({"error": "Correo no encontrado en la lista blanca"}, status=status.HTTP_404_NOT_FOUND)

        # Regla: Cuando se elimine un correo (DELETE), busca al User asociado.
        # Si existe, cámbiale el role a ROLE_STUDENT y guarda.
        # 🟡 MEDIA: nunca degradar ADMIN; 🟢 BAJA: match __iexact arriba.
        User.objects.filter(email__iexact=email).exclude(role=UserRole.ROLE_ADMIN).update(role=UserRole.ROLE_STUDENT)

        return Response({"detail": "Correo eliminado y rol actualizado si correspondía"}, status=status.HTTP_200_OK)
