# Contrato API — Perfil de estudiante (`/api/auth/me/`)

Base: `http://localhost:8000`. Auth: sesión Google (`SessionAuthentication401` + CSRF). Anónimo → **401**.

> Fuente de implementación: `backend/apps/authentication/views.py` (`me`, `_me_payload`, `_patch_student`, `get_google_names`, `_student_profile_incomplete`). Frontend: `frontend/src/pages/AttendQR.js` (formulario `StudentProfileForm` embebido).

## 1. `GET /api/auth/me/`

Retorna el perfil + reconciliación de rol (`reconcile_professor_role`: si el email está en la whitelist de profesores se promueve `STUDENT → PROFESSOR`; nunca degrada).

**Respuesta 200 (estudiante sin perfil):**

```json
{
  "id": "uuid-user",
  "email": "est@ut.edu.co",
  "role": "ROLE_STUDENT",
  "is_active": true,
  "student_code": null,
  "document_number": null,
  "first_name": "",
  "last_name": "",
  "phone_number": null,
  "address": null,
  "suggested_first_name": "Ana",
  "suggested_last_name": "Pérez",
  "needs_profile": true
}
```

**Respuesta 200 (estudiante con perfil):**

```json
{
  "id": "uuid-user",
  "email": "est@ut.edu.co",
  "role": "ROLE_STUDENT",
  "is_active": true,
  "student_code": "202421234",
  "document_number": "1234567890",
  "first_name": "Ana",
  "last_name": "Pérez",
  "phone_number": "+57 300 123 4567",
  "address": "Calle 1 #2-3",
  "suggested_first_name": "Ana",
  "suggested_last_name": "Pérez",
  "needs_profile": false
}
```

### `suggested_*` — nombre desde Google (solo lectura)

- Se leen de `SocialAccount.extra_data`: `given_name` / `family_name`, con fallback a `name` partido por espacios.
- **Fallback monónimo (B3):** si Google solo trae una palabra (ej. `{"name": "Madonna"}` o `given_name="Madonna"` sin `family_name`), se duplica en ambos (`first = last = "Madonna"`) para no bloquear el registro con 400.
- Si no se puede obtener un nombre completo, ambos son `null` y el `PATCH` responde 400 (ver §2).
- El frontend los muestra como `Registrado como: <suggested> (<email>)` + nota `Nombre tomado de tu cuenta de Google (solo lectura)`. **El formulario no tiene inputs de nombre.**

### `needs_profile` (B4)

`true` si:

- no existe fila `Student` para el usuario, **o**
- existe pero `phone_number` o `address` están vacíos (`NULL` / `""` / solo espacios).

Esto cubre perfiles pre-migración con `phone=NULL` o `address=NULL` que antes eludían el requisito mirando solo existencia. `B2 mark` también usa esta regla: perfil incompleto → **412 + `needs_profile: true`**.

## 2. `PATCH /api/auth/me/` (estudiante)

Crea o actualiza el perfil real (RF-EST-03). **Operación atómica** (`transaction.atomic`): check + create/update dentro de la transacción; ante `IntegrityError` por carrera se re-chequea y se responde **409 legible, nunca 500** (B1).

### Request

```http
PATCH /api/auth/me/
X-CSRFToken: <token>
Content-Type: application/json

{
  "student_code": "202421234",
  "document_number": "1234567890",
  "phone_number": "+57 300 123 4567",
  "address": "Calle 1 #2-3"
}
```

- **Solo estos 4 campos.** `first_name` / `last_name` entrantes se **ignoran**: el nombre se deriva siempre de Google (`get_google_names`).
- Todos obligatorios. Límites: `student_code` ≤ 50, `document_number` ≤ 50, `phone_number` ≤ 20, `address` ≤ 500 (m2, coherente con `maxLength=500` del frontend).
- Teléfono (B2): regex `^(?=(?:\D*\d){7,})\+?[\d\s\-()]{7,20}$` **más** conteo de dígitos ≥ 7. Rechaza `"       "` y `"-------"` con 400 (la regex sola los aceptaba).

### Respuestas

| Código | Cuerpo | Cuándo |
|---|---|---|
| 200 | payload completo como `GET` (`needs_profile: false`) | Creación/actualización OK |
| 400 | `{"student_code": "...", "phone_number": "...", ...}` por campo, o `{"error": "No se pudo obtener tu nombre desde Google, intenta de nuevo."}` | Campo faltante/límite/formato, o Google sin nombre obtenible |
| 409 | `{"student_code": "Ese código estudiantil ya está registrado por otra cuenta."}` / `{"document_number": "..."}` / `{"error": "Tu perfil ya fue registrado, recarga e intenta de nuevo."}` / `{"error": "No se pudo guardar el perfil, intenta de nuevo."}` | Duplicado (`iexact`, excluyendo la propia fila) o carrera concurrente — **nunca 500** |
| 401 | — | Sin sesión |
| 403 | `{"error": "Tu rol no permite editar el perfil"}` | Rol `ROLE_ADMIN` (solo `STUDENT`/`PROFESSOR` editan) |

Comparación `iexact`: `EST-123` colisiona con `est-123` (mismo 409).

### Ejemplo duplicado (409)

```http
PATCH /api/auth/me/
{"student_code": "EST-RACE", "document_number": "DOC-2", "phone_number": "+57 300 123 4567", "address": "Calle 1"}
```

```json
// 409
{"student_code": "Ese código estudiantil ya está registrado por otra cuenta."}
```

## 3. Formulario frontend (`AttendQR.js`)

- Sin inputs `first/last`. Solo 4 campos: **Número de documento** (`maxLength=50`), **Código estudiantil** (`maxLength=50`), **Teléfono** (`type=tel`, `maxLength=20`), **Dirección** (`maxLength=500`), todos `*` obligatorios.
- Errores 400/409 se muestran por campo; éxito → re-resuelve (`B1`) y reintenta la marcación.
- Se muestra cuando `GET /me` o `B1 resolve` traen `needs_profile: true`, o `B2 mark` responde **412**.

## 4. Cómo verificar

```bash
# Backend en Docker
docker compose exec backend python manage.py check
docker compose exec backend python manage.py test apps.authentication.test_qa_reaudit -v 2
```

Casos cubiertos por `test_qa_reaudit.py`: teléfono solo-espacios → 400, teléfono solo-guiones → 400, teléfono colombiano válido → 200, monónimo `Madonna` → 200 con `first/last` duplicados, `phone=NULL` → `needs_profile: true` en `GET /me` y 412 en `mark`, doble `PATCH` mismo código → segundo 409 nunca 500, `address` 501 chars → 400.
