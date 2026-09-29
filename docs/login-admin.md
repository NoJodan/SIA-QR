# Login Admin separado (correo + contraseña)

**Estado:** implementado · **Veredicto QA:** APROBADO (sin hallazgos críticos/medios).
**Alcance:** acceso interno de administradores sin pasar por Google OIDC. No cambia el login Google de profesores/estudiantes ni los modelos/adapters.
**Fuente de verdad del dominio:** `SIA-QR.md` (este archivo solo documenta lo entregado).

## 1. Qué es

Ruta de autenticación paralela exclusiva para `ROLE_ADMIN`:

- **Profesores/estudiantes:** siguen usando Google OIDC restringido a `@ut.edu.co` (flujo allauth existente).
- **Administradores:** usan correo + contraseña contra `POST /api/auth/admin/login/`, que abre **sesión Django** (cookie `sessionid`, sin JWT).
- Sin endpoint de registro: la credencial admin **solo se crea/rota por gestión Django** (`createsuperuser` / `changepassword` / `set_password` en shell).
- Frontend: página dedicada `/admin-login` + acceso camuflado desde `Login` (link casi invisible abajo-derecha).

Archivos tocados (referencia, no modificar sin motivo):

| Capa | Archivo | Cambio |
|---|---|---|
| Backend | `backend/apps/authentication/views.py` | `admin_login_view` + `AdminLoginThrottle` (scope `admin_login`) + error genérico `_GENERIC_ADMIN_LOGIN_ERROR` |
| Backend | `backend/apps/authentication/urls.py` | `path("admin/login/", admin_login_view, name="admin-login")` |
| Backend | `backend/sia_qr/settings.py` | `REST_FRAMEWORK.DEFAULT_THROTTLE_RATES["admin_login"] = "5/min"` |
| Frontend | `frontend/src/services/auth.js` | `adminLogin(email, password)` (normaliza email, `ensureCsrf()` + `POST /api/auth/admin/login/`) |
| Frontend | `frontend/src/pages/AdminLogin.js` | Form correo+contraseña, error genérico, link "Volver al inicio" |
| Frontend | `frontend/src/App.js` | `Route /admin-login` antes de `*` (con `onSuccess → /`) |
| Frontend | `frontend/src/pages/Login.js` | Link camuflado `absolute bottom-3 right-4 opacity-0 hover/focus-visible:opacity-100` a `/admin-login` con `aria-label="Acceso de administrador"` |

## 2. Endpoint y contrato

Base: `http://localhost:8000`. Montaje: `sia_qr/urls.py → api/auth/ + authentication/urls.py`.

### `POST /api/auth/admin/login/`

- **Auth:** `AllowAny` + `SessionAuthentication401` (SessionAuthentication **con enforcement CSRF**, sin `csrf_exempt`).
- **Throttle:** `AdminLoginThrottle` (`AnonRateThrottle`, scope `admin_login` → `5/min` por IP, ver `settings.py`).
- **CSRF:** se exige vía `enforce_csrf` explícito porque DRF exime el middleware y `SessionAuthentication` solo lo verifica con sesión previa. El SPA debe fijar la cookie antes: `GET /api/auth/csrf/` (helper `ensureCsrf()` en `services/api.js`, axios con `withCredentials + withXSRFToken`, cookie `csrftoken` → header `X-CSRFToken`).

**Request (ejemplo):**

```json
{
  "email": "admin@ut.edu.co",
  "password": "••••••••"
}
```

El backend normaliza `email` con `strip().lower()`; `password` se pasa tal cual a `authenticate(request, email=..., password=...)`.

**Validaciones de acceso (todas devuelven el mismo 401 genérico — anti-enumeración):**

1. `authenticate()` devuelve `None` (email inexistente o password incorrecta).
2. `user.is_active` es `False`.
3. `user.role != ROLE_ADMIN` (un profesor/estudiante válido también recibe 401, no 403).
4. `user.has_usable_password()` es `False` (cuentas solo-Google sin password nunca entran por aquí).

**Éxito `200`:** hace `django_login(request, user)` (fija `sessionid`) y devuelve el mismo payload de `GET /api/auth/me/` (`_me_payload(user)`):

```json
{
  "id": "uuid",
  "email": "admin@ut.edu.co",
  "role": "ROLE_ADMIN",
  "is_active": true
}
```

(Sin campos de profesor/estudiante cuando el rol es admin.)

### Tabla de errores

| Código | Cuándo | Cuerpo (ejemplo) |
|---|---|---|
| `200` | Credenciales válidas + `is_active` + `ROLE_ADMIN` + password usable | Payload `me` (ver arriba) |
| `400` | Falta `email` o `password` (vacíos tras normalizar) | `{"error": "El correo electrónico y la contraseña son obligatorios"}` |
| `401` | **Genérico anti-enumeración** (credencial inválida, inactivo, rol no admin, sin password usable, o topes de longitud `email > 255` / `password > 128`) | `{"error": "Credenciales inválidas"}` — idéntico en los 5 casos |
| `403` | Falta CSRF (`csrftoken` / `X-CSRFToken`) | Respuesta estándar CSRF de Django/DRF |
| `429` | Throttle `admin_login` superado (> 5 intentos/min por IP) | Respuesta estándar de throttle DRF |

> No hay JWT, no hay refresh token, no hay registro. El logout es el existente `POST /api/auth/logout/` (cierra la sesión Django).

### Ejemplo curl (flujo CSRF + sesión)

```bash
BASE=http://localhost:8000
# 1. Fijar cookie CSRF
curl -c cookies.txt "$BASE/api/auth/csrf/"
# 2. Extraer token y loguear (con cookie + header)
CSRF=$(grep csrftoken cookies.txt | awk '{print $NF}')
curl -b cookies.txt -c cookies.txt -X POST "$BASE/api/auth/admin/login/" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: $CSRF" \
  -d '{"email":"admin@ut.edu.co","password":"CAMBIAME"}'
# 3. Verificar sesión
curl -b cookies.txt "$BASE/api/auth/me/"
```

## 3. Cómo crear / rotar la credencial admin

No existe endpoint de registro. Todo por gestión Django (dentro de Docker o desde `backend/` con el `.env` cargado):

```bash
# Docker (recomendado)
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py changepassword admin@ut.edu.co

# Local sin Docker (desde backend/, POSTGRES_HOST=localhost)
python manage.py createsuperuser
python manage.py changepassword admin@ut.edu.co
```

Notas:

- `createsuperuser` pide email + password y crea el usuario con `role = ROLE_ADMIN` (default del manager en `models.py`).
- Para rotar sin interactivo (ej. emergencia), en shell Django:
  ```python
  from apps.authentication.models import User
  u = User.objects.get(email__iexact="admin@ut.edu.co")
  u.set_password("NUEVA-SEGURA-AQUI")
  u.save(update_fields=["password"])
  ```
- Si el usuario ya existe pero no es admin o está inactivo, corregirlo por shell/admin de Django (`role = ROLE_ADMIN`, `is_active = True`) — el endpoint nunca promueve roles.
- Las cuentas creadas solo vía Google (sin password usable) **no pueden** usar este endpoint hasta que se les fije password con `changepassword`/`set_password`.

## 4. Cómo usar en el frontend

### Ruta `/admin-login`

- Definida en `App.js` **antes** del catch-all `*`:
  ```jsx
  <Route path="/attend" element={<AttendQR />} />
  <Route path="/admin-login" element={<AdminLogin onSuccess={() => (window.location.href = "/")} />} />
  <Route path="*" element={<MainApp />} />
  ```
- Acceso directo: `http://localhost:3000/admin-login`.
- `AdminLogin.js`: precarga CSRF en `useEffect`, re-asegura CSRF en submit, normaliza el email (`trim().toLowerCase()`), llama `adminLogin(email, password)`, ante éxito redirige a `/` (`MainApp` hace `GET /me/` y monta `AdminLayout` por `role === "ROLE_ADMIN"`); ante fallo muestra **error genérico** `"Credenciales inválidas"` (solo propaga el `400` de campos vacíos tal cual). Botón con estado `Verificando...` + `disabled` durante el POST y link `Volver al inicio` (`to="/"`).
- Servicio (`services/auth.js`):
  ```js
  import api, { ensureCsrf } from "./api";
  export async function adminLogin(email, password) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    await ensureCsrf();
    const res = await api.post("/api/auth/admin/login/", { email: normalizedEmail, password });
    return res.data;
  }
  ```
  Reutiliza la instancia `api` (`baseURL = REACT_APP_API_BASE || http://localhost:8000`, `withCredentials + withXSRFToken`).

### Botón oculto en `Login.js`

El login principal sigue mostrando solo "Iniciar sesión con Google Institucional". El acceso admin está camuflado para no confundir a estudiantes/profesores:

```jsx
<Link
  to="/admin-login"
  aria-label="Acceso de administrador"
  className="absolute bottom-3 right-4 p-2 text-xs text-gray-400 opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:text-gray-600 hover:underline"
>
  Administrador
</Link>
```

- Invisible (`opacity-0`) hasta `hover` o foco por teclado (`focus-visible`).
- Posición `absolute` abajo-derecha dentro de la tarjeta (la tarjeta lleva `relative`).
- Accesible: `aria-label="Acceso de administrador"`, navegable con Tab.

### Flujo de uso (operador)

1. Abrir `http://localhost:3000/` → pasar el mouse (o Tab) por la esquina inferior derecha → clic en "Administrador" (o ir directo a `/admin-login`).
2. Ingresar correo + contraseña de admin → "Iniciar sesión".
3. Ante `200` se redirige a `/` y se monta el `AdminLayout` (whitelist, cursos admin, etc.). Ante fallo se muestra `"Credenciales inválidas"` sin distinguir causa.

## 5. Verificaciones

```bash
# Backend (desde backend/)
python manage.py check     # OK, 0 errores (sin migraciones nuevas: no se tocó models.py)

# Frontend (desde frontend/)
npm run build              # OK (compilación CRA sin errores)
```

Comprobaciones manuales sugeridas:

1. `POST` sin CSRF → `403`.
2. `POST` con email inexistente / password mala / usuario profesor / inactivo / sin password usable → los 5 devuelven el mismo `401 {"error": "Credenciales inválidas"}`.
3. `POST` admin válido → `200` + payload `me` + cookie `sessionid`; `GET /api/auth/me/` posterior devuelve `ROLE_ADMIN`.
4. 6.º intento en < 1 min → `429`.
5. Frontend: `/admin-login` renderiza el form; link oculto aparece con hover/foco; éxito redirige a `/` con panel admin.

## 6. Notas futuras de QA (no bloqueantes, veredicto APROBADO)

1. **Throttle por proceso:** `AnonRateThrottle` con scope `admin_login` cuenta en memoria del proceso (caché local por defecto). Con múltiples réplicas/workers el límite `5/min` es por proceso, no global. Si se escala horizontalmente, mover throttles a caché compartida (sin Redis por restricción actual: evaluar alternativa) o documentar el límite por réplica.
2. **Sin `audit_logs` aún:** los intentos de login admin (éxito/fallo) no se registran en `audit_logs`. A futuro, loguear `email normalizado + IP + resultado genérico (sin password)` para trazabilidad anti-fuerza-bruta.
3. **Foco menor (a11y):** tras un fallo, el foco no se mueve automáticamente al mensaje de error. Mejora sugerida: `ref` + `focus()` en el `div` de error o `aria-live="assertive"` para lectores de pantalla.
