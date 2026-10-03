# Integración frontend — `feature/integracion` (QA APROBADO)

**Estado:** implementado · **Veredicto QA:** APROBADO · **Push:** NO realizado (requerimiento usuario, rama solo local).
**Fuente de verdad del dominio:** `SIA-QR.md` (no se duplica aquí).

## 1. Objetivo y ramas origen

Integrar **solo el diseño/UX** de `origin/feature/frontend` sobre el contrato API estable de `feature/oauth`, sin romper backend ni autenticación.

| Concepto | Valor |
|---|---|
| Rama de trabajo | `feature/integracion` (local, sin push) |
| Base | `feature/oauth` @ `7f3c62c` (`[FEAT] Varios, pereza`) |
| Donante diseño | `origin/feature/frontend` @ `e6155d9` (`[FEAT] Amplía QR de asistencia a pantalla completa`) |
| Commit integración | `2a746bd` — `feat(frontend): integra diseno feature/frontend sobre contrato API feature/oauth` (28 archivos frontend, backend sin diff) |
| Commit fix QA | `61d2c7e` — `fix(qa-integracion): corrige hallazgos C1/A1-A3/M1-M4+M5 del qa-reviewer` |
| Stack | Django + DRF + PostgreSQL 16 + CRA JS (`react-scripts`) + Tailwind v3 · Sin TS/Vite/Redis |
| Contrato preservado | Sesión + CSRF · Google OIDC `@ut.edu.co` · polling (sin WebSocket) · `sessionStorage` por pestaña |

## 2. Estrategia (checkout selectivo, intocables)

```bash
git fetch origin
git checkout -b feature/integracion feature/oauth
git checkout origin/feature/frontend -- frontend/
# Re-port manual: App.js (/admin-login), services/*, contrato PATCH /me, TTL
```

**Intocables (verificado `git diff 7f3c62c..61d2c7e -- <path>` vacío):**

- `backend/` (modelos, vistas, serializers, settings, `urls.py`)
- `docker-compose.yml`, `.env.example`, `backend/requirements*.txt`
- `frontend/src/services/` (`api.js`, `auth.js`, `academic.js`, `attendance.js`)
- `frontend/src/context/`, `frontend/src/utils/`, `frontend/src/hooks/`
- `frontend/package.json` / `package-lock.json` (sin Vite/TS, CRA 5 + React 18)

Solo se tocó presentación: `public/index.html`, `src/App.js`, `src/components/*`, `src/pages/*`, `src/index.css`, `tailwind.config.js`, `src/assets/logo.png` (+ temporales luego purgados, ver M3).

## 3. Mapa de archivos integrados (28 en `2a746bd`)

| Grupo | Archivos | Qué trajo el diseño nuevo |
|---|---|---|
| Shell | `public/index.html`, `src/index.css`, `tailwind.config.js`, `src/App.js` | Título/meta, paleta institucional, rutas `/attend` + `/admin-login` |
| Profesor | `ProfLayout.js`, `ProfSidebar.js` (116 líneas), `ProfHeader.js`, `MisCursos.js`, `CursoDetalle.js`, `ClaseDetalle.js` (225 líneas), `ProfConfiguraciones.js` | Sidebar colapsable, polling 30 s / ensure 10 s + lista 5 s, `sessionStorage`, botón ⚡ inmediata |
| Admin | `AdminLayout.js`, `AdminCursos.js`, `AdminCursoDetalle.js`, `AdminLogin.js`, `CourseForm.js`, `CreateClassForm.js`, `Modal.js`, `Profesores.js` | Skin rojo `#B3200E`, `Modal` animado, `qr_duration_minutes`, buscador + paginación |
| Estudiante | `AttendQR.js` (75 líneas), `QrDisplay.js` (102 líneas) | Flujo `/attend?token=`, geo opcional, countdown, token nunca impreso |
| Login | `Login.js` (158 líneas) + `Login.css` (1074 líneas iniciales) | Portal split-screen institucional, `portal-login-*` |
| Assets | `logo.png`, `UNIVERSIDAD-DEL-TOLIMA-1.jpg`, `Logo_..._web.png`, `fondodelogin.jpg` | Logo vigente `logo.png`; los otros 3 se purgaron en M3 |

## 4. Adaptaciones para mantener el contrato API

El donante traía formularios y defaults divergentes; se re-portó la lógica de `feature/oauth`:

| Endpoint | Método | Uso frontend (archivo) | Adaptación integración |
|---|---|---|---|
| `/api/auth/csrf/` | GET | `services/api.js` (`ensureCsrf`, `withCredentials`, `X-CSRFToken`) | Intacto, no se tocó |
| `/api/auth/me/` | GET | `App.js` (`fetchCurrentUser`), `AttendQR.js` (resolve + perfil) | Intacto; `needs_profile` gobierna `StudentProfileForm` |
| `/api/auth/me/` | PATCH | `AttendQR.js` | **C1:** restaurado a `{student_code, document_number, phone_number, address}` + `suggestedName` Google solo-lectura (ver §6) |
| `/api/auth/logout/` | POST | `App.js` (`handleLogout`) | Intacto con CSRF |
| Google OIDC | GET redirect | `Login.js` (`googleLoginUrl` + `?next=` + reanudación `PENDING_TOKEN_KEY`) | Intacto; dominio `@ut.edu.co` en backend |
| `/api/academic/my-groups/` | GET | `MisCursos.js` | Intacto |
| `/api/academic/groups/<g>/classes/` | GET/POST | `CursoDetalle.js`, `CreateClassForm.js` | **A2:** default `qr_duration_minutes ?? 10` unificado |
| `/api/academic/groups/<g>/classes/<c>/` | GET/PATCH/DELETE | `AdminCursoDetalle.js`, `ClaseDetalle.js` | Intacto, doble filtro ownership (ajeno → 404) |
| `/api/academic/groups/<g>/classes/instant/` | POST (B3) | `CursoDetalle.js` → `initialSession` → `ClaseDetalle` | **A3:** reconciliación `qrMinutes`/`ttl_minutes` restaurada |
| `/api/attendance/.../current-session/` | GET (lazy ensure) | `ClaseDetalle.js` (`200 live` / `202 pending {starts_in_s}` / `410 finished`) | Intacto (`Cache-Control: no-store`) |
| `/api/attendance/.../current-session/rotate/` | POST | `ClaseDetalle.js` (**Mostrar en este dispositivo**) | Intacto con CSRF |
| `/api/attendance/sessions/<s>/attendances/` | GET | `ClaseDetalle.js` (lista viva paginada, sin lat/long) | Intacto, polling 5 s |
| `/api/attendance/resolve/?token=` (B1) | GET | `AttendQR.js` | Intacto; **410** → re-escanear vigente |
| `/api/attendance/mark/` (B2) | POST | `AttendQR.js` | Intacto; idempotente, `412 + needs_profile` sin perfil, geo opcional no bloqueante |

Regla: ante conflicto diseño vs contrato, **gana el contrato** (`feature/oauth`); el diseño solo aporta CSS/layout.

## 5. Decisiones de diseño: nuevo prevalece + funcionalidad vieja portada

- **Prevalece el skin de `origin/feature/frontend`:** portal login split-screen, sidebar profesor colapsable con glow, `Modal` animado, `QrDisplay` pantalla completa con countdown, paleta institucional roja `#B3200E`, Tailwind v3.
- **Funcionalidad vieja portada (no se perdió):**
  - `App.js`: ruta `/admin-login` restaurada (`AdminLogin onSuccess → /`); rutas `/attend` pública y `* → MainApp` por rol (`ROLE_ADMIN → AdminLayout`, `ROLE_PROFESSOR → ProfLayout`).
  - `AdminLogin.js`: adaptado al skin rojo + responsive (no eliminado).
  - `AttendQR.js`: reanudación tras Google (`PENDING_TOKEN_KEY`), geo con timeout 8 s no bloqueante, `StudentProfileForm` por contrato (C1).
  - `ClaseDetalle.js`: fases `pending/live/finished`, caché `sessionStorage`, `initialSession` B3 (< 3 s, 0 rotate), `Mostrar en este dispositivo`.
  - `CursoDetalle.js`: instantánea con título/TTL + reconciliación `session.ttl_minutes` (A3).

## 6. Correcciones QA (`61d2c7e`, QA APROBADO)

| ID | Hallazgo | Fix |
|---|---|---|
| **C1** | `AttendQR StudentProfileForm` pedía `first/last` y rompía `PATCH /me` | Solo `{student_code, document_number, phone_number, address}` + `suggestedName` solo-lectura; `maxLength` 20 tel / 500 dirección, `type=tel` |
| **A1** | Sin acceso a `/admin-login` desde el portal | Link discreto en `portal-login-footer` |
| **A2** | Defaults QR divergentes (15 vs 10) | `qr_duration ?? 10` unificado en `CreateClassForm` + `AdminCursoDetalle` |
| **A3** | `qrMinutes` solo desde `classItem`, ignoraba `ttl_minutes` real | Reconciliación `ClaseDetalle qrMinutes` + `CursoDetalle` instantánea desde `session.ttl_minutes` |
| **M1** | `Login.css` 1074 líneas con legacy `login-*` muerto (~480 líneas) | Purga a ~597 líneas; solo `portal-*` + `login-viewport-locked` (requerido por `Login.js`) |
| **M2** | `index.html` sin SRI/description | SRI + `crossorigin` + `preconnect` fonts + `theme-color` + `description` |
| **M3** | Assets huérfanos (`fondodelogin.jpg` 105 KB + 2 imgs UT) | Eliminados; solo `logo.png` vigente |
| **M4** | `eslint-disable` en deps de efecto | `hasStartsIn` nombrado en deps |
| **M5** | `QrDisplay` no retornaba foco al cerrar modal | Retorno de foco (a11y) |

## 7. Verificación reportada

- `python manage.py check` → 0 errores · `migrate` → OK (sin migraciones nuevas).
- `npm run build` → OK (`JS 102.57 kB` / `CSS 7.9 kB`, CRA 5).
- `docker compose up --build -d` → `db healthy`, `backend :8000`, `frontend :3000`.
- `GET /api/auth/csrf/` → 200 · `GET /` frontend → 200.
- `git diff 7f3c62c..61d2c7e -- backend/ services/ context/ utils/ compose` → vacío (contrato intacto).

## 8. Cómo probar local

```bash
git fetch origin
git checkout feature/integracion
cp .env.example .env          # POSTGRES_HOST=db en Docker, localhost sin Docker
docker compose up --build -d
docker compose exec backend python manage.py migrate
docker compose logs -f backend
```

| Prueba | Pasos | Esperado |
|---|---|---|
| Portal | `http://localhost:3000` | Split-screen UT, botón Google, footer con `/admin-login` |
| Admin | `/admin-login` → login | Entra a `AdminLayout` (rol `ROLE_ADMIN`) |
| Profesor | Login Google `@ut.edu.co` → Mis Cursos → Detalle → ⚡ inmediata | QR < 3 s, `live`, polling sin reload |
| Estudiante | `/attend?token=<vigente>` → login → completar perfil → MARCAR | `200` marcado; sin perfil → `412 needs_profile`; `410` → re-escanear |
| API | `curl http://localhost:8000/api/auth/csrf/` | `200` con cookie CSRF |

## 9. Qué NO se hizo (fuera de alcance)

- **Push** a `origin` (requerimiento explícito del usuario; rama solo local).
- **OAuth E2E** contra Google (requiere credenciales + dominio `@ut.edu.co`; solo se verificó redirección y `?next=`).
- **Tests automáticos** nuevos (se reutilizó la suite de `feature/oauth`; `61` tests de la re-auditoría siguen vigentes, no se agregaron).
- **Mobile** nativo / PWA (solo responsive web; QR a pantalla completa es CSS).
- **Export** asistencia (RF-PROF-09, fuera de alcance heredado) ni cambios de modelo/BD.

## 11. Rediseño Cursos `f970836` (QA APROBADO)

Commit `f970836` — 8 archivos frontend, solo JSX/clases (header-card + toolbar sticky + grid 2 col + modal `max-w-xl`, `SearchBar` lupa+clear, primaria `#B3200E`, pills `COMPLETED slate` vs `CANCELLED rojo`, skeleton/empty, a11y ESC/foco/labels). Contrato intacto (payloads, polling 30 s, debounce 300, `formatBogota`; diff `backend/services/context/utils/hooks` vacío). QA APROBADO con 3 medios + 5 bajos no bloqueantes. **Detalle completo:** [`docs/DISENO_CURSOS.md`](DISENO_CURSOS.md) (por archivo, antes/después, tokens, a11y, verificación, follow-up, cómo probar).

## 12. Checklist de aceptación

- [x] `feature/integracion` creada desde `feature/oauth@7f3c62c`, solo `frontend/` del donante.
- [x] `backend/`, `compose`, `services/`, `context/`, `utils/` sin diff (contrato intacto).
- [x] Diseño nuevo prevalece; `AdminLogin`, `/admin-login`, `initialSession`, `ttl_minutes`, `PATCH /me` portados.
- [x] Correcciones C1/A1-A3/M1-M5 aplicadas.
- [x] `check` OK · `migrate` OK · `build` OK (102.57 kB / 7.9 kB) · `compose` healthy · `csrf` 200 · front 200.
- [x] QA APROBADO.
- [ ] Push pendiente (decisión del usuario).

## 13. Ajustes QR + asistencia `d655664` (QA APROBADO)

Commit `d655664` — 3 archivos frontend, solo presentación/copy (retiro de `(Bogotá)` visible manteniendo `America/Bogota` en lógica, literal `QR activo - Escanea para firmar asistencia.`, rediseño institucional `AttendQR` en `#B3200E` con `Continuar con Google / Firmar asistencia / Firma tu asistencia`; lógica intacta: `phases`, `PENDING_TOKEN_KEY`, geo 8 s, `PATCH /me`, códigos). Build `105.53 kB / 8.42 kB`, `check` 0 errores, `migrate` sin cambios. QA APROBADO con 1 medio + 2 bajos no bloqueantes. **Detalle completo:** [`docs/AJUSTES_QR_ASISTENCIA.md`](AJUSTES_QR_ASISTENCIA.md) (literales, tokens, contrato, verificación, follow-up, cómo probar).

## 14. Comando `clear_students` (QA APROBADO, sin commit, sin push)

Utilidad QA/dev `clear_students` (untracked: `backend/apps/authentication/management/commands/clear_students.py` + `tests_clear_students.py`): borra `User role=STUDENT` vía ORM CASCADE (`Student`, `Attendance`, `SocialAccount`), preserva admin/professor/whitelist/cursos/sesiones/configs. Flags `--dry-run/--yes/--domain/--exclude-emails/--batch-size`; `DEBUG=False` exige `--yes`. Verificación: `check` 0 errores, `migrate` OK, **29 tests OK**. QA APROBADO con medios no bloqueantes (M1 superuser-STUDENT, M2 `--yes` en prod, M3 flags sin test, B1 eco emails, B2 assert SQL, B3 locks). **Detalle completo:** [`docs/COMANDO_CLEAR_STUDENTS.md`](COMANDO_CLEAR_STUDENTS.md) (sintaxis, ejemplos, backup `pg_dump`, pendientes, cómo probar).

## 15. Fix asistencia con ubicación `563c28d` (QA APROBADO)

Commit `563c28d` — fix `400` genérico al firmar **con ubicación** (navegador 13-16 decimales vs `DecimalField 8/8/2`; sin geo `null` pasaba). Back `TolerantGeoField` con `quantize 8/8/2`, inválido → `None` nunca `400`, token estricto; front `toFixedOrNull` + reintento único con `null`s en `400`; `views.py` sin cambios. Verificación: **23/23 attendance, 78/78 backend, build OK**. QA APROBADO con 4 bajos no bloqueantes. **Detalle completo:** [`docs/FIX_ASISTENCIA_GEO.md`](FIX_ASISTENCIA_GEO.md) (causa, fix por archivo, matriz con/sin geo y códigos, verificación, pendientes, cómo probar con Sensor Ibagué / denegar / timeout).

## 16. Módulo Reportes `79d0970` + fix `ba71453` (QA APROBADO)

Commits `79d0970` + fix `ba71453` — `GET /api/attendance/reports/?format=json|xlsx|pdf` con 14 filtros (curso/grupo/clase multi/sesión/fechas Bogotá máx 366/registro/doc/código/search/estado/modalidad/profesor solo admin/ubicación), permisos prof-solo-suyo (`403`) / admin-todo, XLSX `openpyxl` header `#B3200E` + PDF `reportlab` landscape (12 col sin lat/long, caps 5000/1000), frontend `Reportes.js` tabs Prof/Admin + toolbar sticky + preview/blob. Verificación: **19/19 reports, 97/97 total, build ~110 kB**. QA APROBADO con 3 bajos no bloqueantes. **Detalle completo:** [`docs/MODULO_REPORTES.md`](MODULO_REPORTES.md) (objetivo, roles, filtros, columnas, endpoints, exports, UI, verificación, pendientes, cómo probar).

## 17. Fix reinicio QR por rotación S1→S2 (solo front, sin commit, sin push)

Diagnóstico: el backend `ensure` auto-rota si sigue en ventana (`services.py` 145-192, `generate_session`, revoca previas, single-active): TTL expirado + `IN_PROGRESS` ⇒ nueva sesión S2 con nuevo `session_id`/token. No es grace/storage/rotate-auto del front. Programada igual una vez `IN_PROGRESS`. Comportamiento esperado SÍ regenerar en ventana (RF-PROF-05/07), NO quedar expirado. Back intacto (hash/sha/token single-active, constraints, 410, `QR_DEFAULT`/`EARLY`, no-store, 401/CSRF, transacción Instant, geo).

Front `ClaseDetalle.js` (ensure/live): si `d.session_id !== sessionRef` actual **con `attend_url` presente** ⇒ rotación: `setSession`, `saveCached`, `setQrMinutes`, banner transitorio 10 s `QR renovado — el anterior ya no es válido (nueva sesión …id corto)` + `rotationCount` para `sesión N`; `attend_url null` sigue siendo `otro dispositivo` (guards sin confundir). `QrDisplay.js` props `sessionLabel/rotationCount/phase`: expirado `Expiró — generando nuevo QR…`, activo rotado `Nuevo QR activo (sesión N) — Expira en MM:SS`, `key={session_id}` para remontaje visible, `firedRef` 1 vez por `expiresAt`, guard `phase live + !document.hidden` en `onExpired`; polls 10 s/5 s intactos. Lista viva **acumulada por clase** vía `GET /api/attendance/reports/?format=json&class_id=` (S1+S2, sin vaciado al rotar; badge `acumulada · todas las sesiones` + `…id` por fila si >1 sesión; fallback a lista de sesión vigente). Alternativa backend documentada y descartada: endpoint dedicado de agregados por clase (innecesario: el filtro `class_id` existente ya cubre el caso sin tocar el back).

Verificación: `check` 0 errores (solo 3 warnings allauth preexistentes), `migrate` sin cambios, **68/68 tests attendance+academic OK**, `npm run build` OK (`110.78 kB / 8.56 kB`, +498 B), compose `db/backend/frontend` Up. Manual pendiente (requiere sesión Google profesor): instant TTL 1-2 + duración 60 ⇒ rota con `session_id` distinto; programada pending→live→rota; S1 vieja `mark/resolve` 410 y S2 200/201; `count is_active==1`; fin ventana 410 `COMPLETED` + `clearCached`; rotate manual 201 intacto.
