# Ajustes QR + asistencia — `d655664` (QA APROBADO)

**Rama:** `feature/integracion` · **Commit:** `d655664` — `feat(frontend): quita menciones Bogota en formularios y redisena AttendQR institucional`
**Base:** `f970836` (rediseño Cursos) · **Alcance:** 3 archivos frontend, solo presentación/copy. Sin `backend/`, sin `services/`, sin `context/`, sin dependencias.
**Veredicto QA:** APROBADO (1 medio + 2 bajos no bloqueantes, ver §6).
**Docs relacionados:** [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) · [`DISENO_CURSOS.md`](DISENO_CURSOS.md).

> Solo UI/copy. Lógica intacta (`phases`, `PENDING_TOKEN_KEY`, geo 8 s, `PATCH /me`, códigos). `America/Bogota` sigue en lógica (`formatBogota`, `combineDateTimeToISO`); solo se retiró de textos visibles.

## 1. Qué cambió por archivo (3)

| Archivo | Cambio | Intacto |
|---|---|---|
| `components/CreateClassForm.js` (4 líneas) | Retiro de `(Bogotá)` visible: `Día de la clase (Bogotá).` → `Día de la clase.`; label `Hora (Bogotá)` → `Hora`; `title="Hora de inicio (Bogotá)"` → `Hora de inicio`; helper `Hora de inicio (Bogotá).` → `Hora de inicio.` | Payloads (`createGroupClass` / `updateGroupClass` / `adminUpdateGroupClass`, `combineDateTimeToISO`, `qr_duration ?? 10`, `min 1 max 120`), `htmlFor/useId`, `aria-invalid/describedby`, `radiogroup` modalidad |
| `pages/ClaseDetalle.js` (1 línea) | Banner `live` (L357): `QR activo — se genera y renueva solo.` → **`QR activo - Escanea para firmar asistencia.`** (literal exacto, con guion `-`, negrita solo en `QR activo`) | Fases `pending/live/finished`, `current-session` (200/202/410), `rotate`, polling lista viva 5 s, `qrMinutes`/`ttl_minutes`, `sessionStorage` |
| `pages/AttendQR.js` (rediseño, +149/−99) | Rediseño institucional (ver §2–§3). Unifica verbo a **firmar** en UI visible | Flujo `no-token/resolving/login/ready/done/already/error`, `readToken`, `PENDING_TOKEN_KEY="siaqr_pending_token"`, geo timeout 8 s no bloqueante, `resolveToken`/`markAttendance`, `PATCH /api/auth/me/` C1, códigos (ver §4) |

## 2. Literales nuevos (exactos)

```
QR activo - Escanea para firmar asistencia.   # ClaseDetalle banner live (con guion -, no —)
Continuar con Google                          # AttendQR fase login (antes: "Iniciar sesión con Google Institucional")
Firmar asistencia                             # AttendQR botón ready (antes: "MARCAR ASISTENCIA")
Firma tu asistencia                           # AttendQR h1 en no-token / login / ready
```

Otros copys tocados por el rediseño (mismo archivo):

- Perfil: `Completa tu perfil de estudiante para firmar asistencia` (antes `…para marcar asistencia`).
- Login: `Inicia sesión con tu correo institucional (@ut.edu.co) para firmar tu asistencia.` (antes `…para marcar tu asistencia.`).
- Geo badge: `Sin ubicación — igual puedes firmar` (antes `…puedes marcar`).
- Éxito: pill `Firma exitosa` / `Ya firmada`; título `¡Asistencia registrada!` / `Asistencia ya registrada` (antes `✅ + text-5xl` + verde).
- Hora: `Hora: {formatBogota(...)}` — **sin** el sufijo visible `(Bogotá)` (la zona sigue aplicándose en el formateo).

⚠️ Residual conocido (no bloqueante, ver §6.1): dos mensajes de error internos aún dicen **marcar** en vez de **firmar** (L253 `412` y L268 `403`).

## 3. Tokens del rediseño AttendQR

- **Primaria institucional:** `bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl` + `focus-visible:ring-[#B3200E]/40` — en `Continuar con Google`, `Firmar asistencia`, `Guardar perfil y continuar`, `Reintentar`.
- **Header:** `AttendHeader()` nuevo — `flex items-center gap-3 rounded-2xl bg-[#B3200E] px-5 py-4 text-white shadow-sm` + `logo.png` (`h-10 w-10 rounded-full bg-white p-1`, `alt="Universidad del Tolima"`) + `SIA-QR / Universidad del Tolima`. Presente en las 6 fases.
- **Layout:** página `flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-4`, contenedor `w-full max-w-md space-y-4`, cards `rounded-2xl border-slate-200 bg-white p-5 shadow-sm` (detalle sesión: `rounded-xl border-slate-200 bg-slate-50 p-4`).
- **Formulario perfil:** fondo `amber-50/amber-200/amber-600` → `slate-50/slate-200 + primaria`; inputs `rounded-xl border-slate-200 … focus:border-[#B3200E] focus:ring-[#B3200E]/20`; labels `text-xs font-medium text-slate-700`.
- **Badges:** geo `rounded-full border px-3 py-1 text-xs` (`ready`: `emerald-50/emerald-200/emerald-700`; resto: `slate-50/slate-200/slate-500`); éxito `emerald-50/emerald-200/emerald-700` con dot; error `red-50/red-200/red-700` (`Revisa e intenta de nuevo` + `h1 text-red-700`).
- **Eliminado:** `bg-gray-50/green-50`, botones `blue-600/green-600`, `✅ text-5xl`, `📍` emoji, `text-2xl SIA-QR` como h1.

## 4. Contrato preservado (sin regresión)

- **Fases:** `no-token → resolving → login | ready → done/already | error`. `already_marked` → `already`; `mark` → `done`/`already`.
- **`PENDING_TOKEN_KEY = "siaqr_pending_token"`** (`localStorage`): `readToken()` guarda URL→local antes de redirigir; login re-guarda en `onClick` (respaldo M4 por si `?next=` no sobrevive al OAuth); `handleMark` lo limpia al firmar. `attendUrl = origin + /attend?token=`.
- **Geo opcional NO bloqueante:** `GEO_TIMEOUT_MS = 8000`, `enableHighAccuracy + maximumAge 60000`; solo se pide en `phase === "ready"`; estados `idle/pending/ready/denied/unsupported`; se firma igual sin ubicación (`null`).
- **`PATCH /api/auth/me/` (C1 intacto):** solo `{student_code, document_number, phone_number, address}` + `suggestedName` Google solo-lectura; `maxLength 50/50/20/500`, `type=tel`; `409/400` → errores por campo, resto → global.
- **Códigos:** `resolve`: `401→login`, `404→"El código QR no es válido."`, `410→error backend o "expiró o la clase ya finalizó"`, resto → conexión. `mark`: `401→login`, `404→inválido`, `412/needs_profile→muestra formulario y queda en ready`, `409/410→expiró o ya registrada→error`, `403→"Solo los estudiantes…"`, resto → reintento.
- **Diff de contrato vacío esperado:** `git diff f970836..d655664 -- backend/ frontend/src/services/ frontend/src/context/ frontend/src/utils/ frontend/src/hooks/` → 0 líneas (solo los 3 archivos de §1).

## 5. Verificación reportada

- `python manage.py check` → **0 errores** · `python manage.py migrate` → **sin cambios** (sin migraciones nuevas).
- `npm run build` → OK (CRA 5): **`JS 105.53 kB` / `CSS 8.42 kB`**.
- `docker compose up --build -d` → `db :5432 · backend :8000 · frontend :3000` (re-verificar antes de merge).
- Push **NO** realizado (requerimiento explícito; rama solo local).

## 6. Pendientes follow-up (no bloqueantes)

1. **Medio — copy residual `marcar` vs `firmar` (`AttendQR.js` L253/268):** el error `412` (`Completa tu perfil de estudiante para marcar asistencia.`) y el `403` (`Solo los estudiantes pueden marcar asistencia con esta cuenta.`) aún usan *marcar* mientras toda la UI visible migró a *firmar*. Unificar a `firmar` (2 literales).
2. **Bajo — `labels` sin `htmlFor`:** los 4 `<label>` de `StudentProfileForm` (documento/código/teléfono/dirección) no tienen `htmlFor`/`id` pareado (a diferencia de `CreateClassForm`). Añadir `useId` + `htmlFor`.
3. **Bajo — errores sin `role="alert"`:** los `<p class="…text-red-600">` de perfil/ready/error no tienen `role="alert"` ni `aria-live`. Añadir `role="alert"` (patrón ya usado en `CreateClassForm`/`CursoDetalle`).

## 7. Cómo probar (10 min)

| # | Prueba | Pasos | Esperado |
|---|---|---|---|
| 1 | Copy profesor | Profesor → grupo → clase → banner `live` | `QR activo - Escanea para firmar asistencia.` (guion `-`, punto final) |
| 2 | Sin `(Bogotá)` | `📅 Programar` / `Editar clase` | `Día de la clase.` / `Hora` / `Hora de inicio.` sin mención visible; la hora sigue guardándose en `America/Bogota` |
| 3 | Estudiante login | `/attend?token=<vigente>` sin sesión | Header rojo + logo, `Firma tu asistencia`, `…@ut.edu.co…firmar…`, botón `Continuar con Google` → OAuth con `?next=` y reanuda por `PENDING_TOKEN_KEY` |
| 4 | Firmar | Con sesión + perfil completo → `Firmar asistencia` | `200` → pill `Firma exitosa` + `¡Asistencia registrada!` + `Hora: <formatBogota>` sin `(Bogotá)`; re-firmar → `Ya firmada` |
| 5 | Sin perfil | Cuenta sin perfil → firmar | `412` → formulario `…para firmar asistencia` + `Guardar perfil y continuar`; `PATCH /me` con 4 campos |
| 6 | Geo opcional | Denegar ubicación → firmar | Badge `Sin ubicación — igual puedes firmar`, firma igual (`null`) |
| 7 | Expirado/inválido | Token `410`/`404`, sin token | `No se pudo continuar` + `Reintentar`; sin token → `Firma tu asistencia` + `Falta el token…` |
| 8 | Responsive | 360 / 768 / 1280 px | `max-w-md` centrado, header + card apilados, sin overflow |

```bash
git checkout feature/integracion
git diff f970836..d655664 --stat   # 3 archivos, 149+/99-
# Contrato:
git diff f970836..d655664 -- backend/ frontend/src/services/ frontend/src/context/ frontend/src/utils/ frontend/src/hooks/
python manage.py check            # esperado: 0 errores
python manage.py migrate          # esperado: sin migraciones nuevas
npm run build                     # esperado: OK 105.53 kB / 8.42 kB
```
