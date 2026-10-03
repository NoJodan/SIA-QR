# QR rotación → QR único — `9761098` + `e5521b2` (vigente: QR único, QA APROBADO)

**Rama:** `feature/integracion` · **Commits:** `9761098` (rotación S1→S2, histórico) + `e5521b2` — `feat(qr-unico): QR unico sin auto-rotacion, 410 expired/rotation_disabled` (vigente).
**Alcance vigente (`e5521b2`):** 2 back (`academic/services.py`, `academic/views.py`) + 3 front (`ClaseDetalle.js`, `QrDisplay.js`, `services/attendance.js`) + tests.
**Veredicto QA `e5521b2`:** APROBADO (3 bajos no bloqueantes, ver §8.7). **Push:** NO realizado.
**Docs relacionados:** [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) §17 (histórico) · §18 (vigente) · [`MODULO_REPORTES.md`](MODULO_REPORTES.md) (filtro `class_id`, ya no usado por la lista viva).

> ⚠️ **Cambio de comportamiento:** §1–§7 describen el contrato antiguo (auto-rotación S1→S2). El contrato **vigente desde `e5521b2` es QR único sin auto-rotación** — ver **§8**. Se conserva la historia sin reescribirla.

> El QR "se reiniciaba" porque el backend auto-rota en ventana. El front lo mostraba como el mismo timer. Fix solo front: detectar la rotación y mostrarla como tal.

## 1. Causa

- El `ensure` del backend auto-rota si sigue en ventana (`services.py` `generate_session`, revoca previas, single-active): **TTL expirado + `IN_PROGRESS` ⇒ nueva sesión S2** con nuevo `session_id`/token.
- La programada hace lo mismo una vez `IN_PROGRESS`.
- El front (`ClaseDetalle.js`) reusaba la sesión y el countdown (`QrDisplay.js`) seguía corriendo como si fuera el mismo QR: el profesor veía un "reinicio" sin explicación y la lista viva se vaciaba al cambiar de `session_id`.
- No era grace/storage/`rotate` automático del front.

## 2. Comportamiento esperado (contrato intacto)

- **SÍ regenera en ventana** (RF-PROF-05/07): expirado el TTL pero clase `IN_PROGRESS` ⇒ S2 nueva proyectable. NO debe quedar expirado.
- **S1 vieja ⇒ `410`:** `mark`/`resolve` con token S1 → `410` (re-escanear vigente). **S2 ⇒ `200/201`.**
- **Fin de ventana ⇒ `410` + `COMPLETED`:** `current-session` → `410`, front `clearCached`, fase `finished`, mensaje `La clase finalizó…`.
- **Single-active:** `count is_active == 1` por clase (S1 revocada al crear S2).
- Back intacto: hash/sha token, constraints, `UNIQUE(session,student)`, `QR_DEFAULT`/`EARLY`, `no-store`, `401`/CSRF, transacción Instant, geo opcional.

## 3. Fix por archivo (2, solo front)

| Archivo | Cambio |
|---|---|
| `frontend/src/pages/ClaseDetalle.js` | Detección de rotación en `ensure`/`live`: si `d.session_id !== sessionRef.current.session_id` **con `attend_url` presente** ⇒ `flagRotation(d.session_id)`: `setSession` + `saveCached` + `setQrMinutes`, banner transitorio 10 s `QR renovado — el anterior ya no es válido (nueva sesión …id corto)` + `rotationCount` (etiqueta `sesión N`); `attend_url null` sigue siendo caso `otro dispositivo` (guards sin confundir). `rotate` manual también llama `flagRotation`. Lista viva **acumulada por clase** vía `GET /api/attendance/reports/?format=json&class_id=` (S1+S2, no se vacía al rotar; badge `acumulada · todas las sesiones` + `…id` por fila si > 1 sesión; fallback a `getSessionAttendances` vigente si el reporte falla). Polls intactos: ensure 10 s, lista 5 s (efecto depende además de `session.session_id` para refrescar justo al rotar). Timer del banner con cleanup al desmontar. |
| `frontend/src/components/QrDisplay.js` | Props nuevas `sessionLabel / rotationCount / phase`. Activo rotado: `Nuevo QR activo (sesión N) — Expira en MM:SS`; expirado: `Expiró — generando nuevo QR…` (antes `renovando…`). `key={session_id}` en el padre para remontaje visible. `firedRef` 1 vez por `expiresAt` + guard `phase === "live"` y `!document.hidden` en `onExpired` (si expiró en background, el poll ensure de 10 s del padre ya trae la S2). Sin cambios de estilo fuera de los literales. |

Alternativa descartada: endpoint backend dedicado de agregados por clase — innecesario, el filtro `class_id` existente de reportes ya cubre el caso sin tocar el back (restricción No-Redis respetada: polling, sin WebSocket).

## 4. Matriz instant / programada

| Caso | Pasos | Esperado |
|---|---|---|
| Instantánea rota en ventana | Clase instantánea TTL 1–2, duración 60 → esperar TTL en `ClaseDetalle` live | Banner 10 s + `Nuevo QR activo (sesión 2)` con `session_id` distinto; `saveCached` actualizado |
| Programada pending → live → rota | Clase programada futura → `pending {starts_in_s}` → entra en ventana → esperar TTL | `pending` → `live` → rotación idéntica a la instantánea |
| S1 vieja tras rotar | `resolve`/`mark` con token S1 | `410` (re-escanear vigente) |
| S2 vigente | `mark` con token S2 | `200/201` (duplicado → `200 already_marked`) |
| Fin de ventana | Esperar fin `IN_PROGRESS` | `410` + `COMPLETED` + `clearCached` + fase `finished` |
| `attend_url null` (otro dispositivo) | Sesión live creada en otro dispositivo | Botón `Mostrar en este dispositivo` (`rotate` → `201`), sin banner de rotación |
| Lista al rotar | Firmar en S1, rotar, firmar en S2 | Lista NO se vacía: badge `acumulada`, filas S1+S2 con `…id` por fila |
| Rotate manual | `Mostrar en este dispositivo` | `201`, `attend_url` nuevo, banner + `sesión N` |
| Polls | Dejar abierto 1 min | Ensure 10 s / lista 5 s sin reload ni parpadeo del QR |

## 5. Verificación reportada

- `python manage.py check` → **0 errores** (solo 3 warnings allauth preexistentes) · `migrate` → sin cambios.
- Tests: **68/68 OK** (attendance + academic).
- `npm run build` (CRA) → **OK** (`110.78 kB / 8.56 kB`, +498 B vs previo).
- `docker compose` → `db` / `backend` / `frontend` Up.
- `git diff 9761098^..9761098 -- backend/` → vacío (back intacto).

```bash
git checkout feature/integracion
git show --stat 9761098   # 2 front + INTEGRACION §17
git diff 9761098^..9761098 -- backend/  # esperado: vacío
```

## 6. Pendientes follow-up (QA, no bloqueantes)

1. **M1 — contraste del `sessionLabel`:** `text-[11px] text-slate-400` sobre blanco (~2.8:1, bajo AA). Subir a `slate-500/600` o `12px`.
2. **M2 — banner sin live-region:** `rotationNotice` y badges `en vivo/acumulada` sin `role="status"`/`aria-live`; el lector no anuncia la rotación. Añadir `aria-live="polite"`.
3. **B1 — expiración en background:** el guard `document.hidden` evita `onExpired` oculto y delega al poll 10 s (delay aceptado). Opcional: refetch en `visibilitychange`.
4. **B2 — semántica del `count`:** el contador `(N)` ahora viene de reportes por clase, no de la sesión vigente. Aclarar label (`N asistencias · clase`) o documentarlo en la UI.

## 7. Cómo probar (15 min, requiere sesión Google profesor `@ut.edu.co`)

```bash
git checkout feature/integracion
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Profesor: Mis Cursos → ⚡ inmediata con TTL 1-2 + duración 60 → ClaseDetalle live
```

| # | Prueba | Pasos | Esperado |
|---|---|---|---|
| 1 | **Rota en ventana** | TTL **1–2**, duración 60 → mirar QR live hasta expirar | Banner 10 s + `Nuevo QR activo (sesión 2)`; `session_id` distinto al anterior (`…id` corto visible) |
| 2 | **S1 muerta / S2 válida** | Copiar `?token=` S1 y S2 → `/attend?token=` + `mark` | S1 → `410`; S2 → `200/201` |
| 3 | **`is_active == 1`** | Tras rotar: contar sesiones activas de la clase (admin/shell) | Solo S2 activa (`count is_active == 1`) |
| 4 | **Lista acumulada** | Firmar en S1, rotar, firmar en S2 | Badge `acumulada · todas las sesiones`, filas con `…id` de ambas |
| 5 | **Fin de ventana** | Esperar fin `IN_PROGRESS` | `410` + `COMPLETED`, QR desmontado, `La clase finalizó…` |
| 6 | **Programada** | Clase futura → `pending` → live → esperar TTL | `pending {starts_in_s}` → `live` → rota igual que #1 |

> ⏳ Histórico: §7 válido solo hasta `9761098`. Desde `e5521b2` usar §8.8.

## 8. QR único sin auto-rotación `e5521b2` (VIGENTE, QA APROBADO)

Commit `e5521b2` — `feat(qr-unico): QR unico sin auto-rotacion, 410 expired/rotation_disabled`. 6 archivos: `academic/services.py`, `academic/views.py`, `academic/tests.py`, `ClaseDetalle.js`, `QrDisplay.js`, `services/attendance.js`.

### 8.1 Antes (rotaba) vs ahora (único)

| Aspecto | Antes (`9761098`) | Ahora (`e5521b2`, vigente) |
|---|---|---|
| TTL expirado en ventana | Auto-rotación S2 (nuevo `session_id`/token, revoca S1) | **Sin S2:** `expired 410 qr_expired`, QR queda expirado |
| Regla | 1 clase = N sesiones (single-active, solo 1 viva) | **1 clase = 1 sesión** (`has_ever_had_session` por `class_id`) |
| `rotate` / A1 | `rotate` → `201` nuevo QR; A1 creaba libre | **Deprecated:** ambos → `410 rotation_disabled`, nunca `201` |
| Front | Banner 10 s + `sesión N` + lista acumulada por clase (`reports?class_id=`) | **Fase `expired` fija**, sin banner/rotación; `QrDisplay Expirado 00:00`; lista **por `session_id`** (`getSessionAttendances`) |
| Fin de ventana | `410 finished` + `COMPLETED` | Igual (sin cambios) |

### 8.2 Regla 1 clase = 1 sesión

- `ensure_current_session()` (`academic/services.py`): si hay sesión válida ⇒ `live` (reuso). Si no hay válida y **ya hubo alguna** (`AttendanceSession.objects.filter(scheduled_class=clase).exists()`) ⇒ `expired {qr_expired, session_id, expires_at}`, revoca remanentes, **sin S2**. Solo si nunca hubo ⇒ crea S1 una vez.
- `ClassSessionCreateView` (A1) y `ClassCurrentSessionRotateView` (deprecated): si ya existe alguna sesión ⇒ `410 {state: expired, reason: rotation_disabled}`, nunca `201`. Rutas conservadas por compatibilidad, no usar en UI.

### 8.3 Endpoints 410

| Endpoint | Caso | Respuesta vigente |
|---|---|---|
| `GET .../current-session/` | QR vigente | `200 live` (`attend_url` solo al crear S1; reuso ⇒ `null`, usar caché) |
| `GET .../current-session/` | QR único expirado en ventana | `410 {state: expired, reason: qr_expired, session_id, expires_at}` + `no-store`, **sin S2** |
| `GET .../current-session/` | Fuera de ventana / cerrada | `410 {state: finished}` + cierre perezoso a `COMPLETED` (igual que antes) |
| `POST .../current-session/rotate/` | En ventana (haya o no sesión) | `410 {reason: rotation_disabled}` (antes `201`) |
| `POST .../sessions/` (A1) | Segunda creación | `410 {reason: rotation_disabled}` (primera ⇒ `201` S1) |
| `GET /api/attendance/resolve/?token=` · `POST /api/attendance/mark/` | Token expirado/revocado | `410` (re-escanear; no hay S2 que lo sustituya) |

### 8.4 Front expirado

- `ClaseDetalle.js`: fases `loading | pending | live | expired | finished`. `410 expired/rotation_disabled` ⇒ fase `expired` fija + `clearCached` + `stopEnsure` (detiene poll 10 s). Sin banner, sin `rotationCount`, sin botón `Mostrar en este dispositivo` (aviso `La rotación está deshabilitada (QR único)`). Lista viva **por sesión** (`getSessionAttendances(session_id)`, poll 5 s); se elimina la acumulada `reports?class_id=` y el badge `acumulada`.
- `QrDisplay.js`: props reducidas a `{attendUrl, expiresAt, size, onExpired}`. Expirado ⇒ `Expirado — 00:00` (antes `Expiró — generando nuevo QR…`); `onExpired` marca expirado local una vez, sin refetch ni guards de visibilidad. Fase `expired` sin `attend_url` ⇒ placeholder `00:00 / Expirado`.
- `services/attendance.js`: `createClassSession` y `rotateCurrentSession` marcados `@deprecated` (solo compatibilidad).

### 8.5 Matriz instant / programada

| Caso | Pasos | Esperado vigente |
|---|---|---|
| Instantánea expira en ventana | Inmediata TTL 1–2, duración 60 → esperar TTL en live | Fase `expired` fija + `El código QR expiró…`; `QrDisplay 00:00`; **count total sesiones == 1** |
| Programada pending → live → expira | Futura → `pending {starts_in_s}` → live → esperar TTL | `pending` → `live` (S1 única) → `expired` igual que instantánea; polls siguientes NO duplican |
| Sin S2 | Tras expirar: `GET current-session` repetidos | Siempre `410 qr_expired` mismo `session_id`; `is_active == 0` |
| `rotate` en ventana | `POST .../rotate/` | `410 rotation_disabled`, nunca `201` |
| A1 segunda creación | `POST .../sessions/` ×2 | `201` S1, luego `410 rotation_disabled` |
| Fin de ventana | Esperar fin `IN_PROGRESS` | `410 finished` + `COMPLETED` + `clearCached` (igual que antes) |
| Lista | Firmar en S1, expirar | Lista por sesión, NO se mezcla con otras; badge `acumulada` eliminado |

### 8.6 Verificación reportada

- `python manage.py check` → **0 errores** · `migrate` → sin cambios.
- Tests: **72/72 OK** (incluye `test_expired_no_rotate_within_window`, `test_reuse_same_session_then_rotate_blocked`, `test_expired_no_rotate_returns_410`, `test_rotate_in_window_returns_410_rotation_disabled`, `SingleSessionCreateTests` A1→410 / pending→live única / finished).
- `npm run build` (CRA) → **OK** (`~110.3 kB`).
- `docker compose` → `db` / `backend` / `frontend` Up.

```bash
git checkout feature/integracion
git show --stat e5521b2   # 6 archivos back+front+tests
```

### 8.7 Pendientes follow-up (QA, bajos no bloqueantes)

1. **B1 — A1 sin `no-store`:** la primera creación S1 (`201`) no devuelve `Cache-Control: no-store` (el resto sí). Añadirlo.
2. **B2 — comentario stale `rotate`:** queda referencia a códigos `201/202/409/503` en el docstring de `attendance.js` aunque el endpoint ya solo da `410/202/410`. Actualizar comentario.
3. **B3 — doble query + `key` remanente:** `has_ever` + `last` son 2 queries (unificable en una) y queda `key={session_id}` innecesaria en un `QrDisplay` (sin remontaje por rotación). Limpieza menor.

### 8.8 Cómo probar (10 min, requiere sesión Google profesor `@ut.edu.co`)

```bash
git checkout feature/integracion
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Profesor: Mis Cursos → ⚡ inmediata con TTL 1-2 + duración 60 → ClaseDetalle live
```

| # | Prueba | Pasos | Esperado |
|---|---|---|---|
| 1 | **Expira sin S2** | TTL **1–2**, duración 60 → mirar QR live hasta expirar | Fase `expired` + `El código QR expiró…`; countdown fijo `00:00`; **sin banner ni `sesión 2`** |
| 2 | **Sin S2 en back** | Tras expirar: contar sesiones de la clase (admin/shell) | `count total == 1`, `count is_active == 0`; polls `GET` siguen `410 qr_expired` mismo `session_id` |
| 3 | **`rotate` 410** | `POST .../current-session/rotate/` en ventana | `410 rotation_disabled`, nunca `201` |
| 4 | **A1 410** | `POST .../sessions/` ×2 | `201` S1, luego `410 rotation_disabled` |
| 5 | **Programada** | Clase futura → `pending` → live → esperar TTL | `pending {starts_in_s}` → `live` S1 única → `expired` (sin duplicar) |
| 6 | **Fin de ventana** | Esperar fin `IN_PROGRESS` | `410 finished` + `COMPLETED`, `La clase finalizó…` |
