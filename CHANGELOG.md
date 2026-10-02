# CHANGELOG — SIA-QR

Formato: `[Fecha] Título` + qué cambió + cómo verificar. La especificación de dominio (`SIA-QR.md`) no se modifica.

## [2026-10-02] Re-auditoría QA APROBADA — TTL instantánea, perfil estudiante, purga DB (61 tests OK)

**Estado:** implementado · **Veredicto QA:** APROBADO. **Tests:** 61 OK (9 nuevos en `backend/apps/authentication/test_qa_reaudit.py`). `python manage.py check` / `migrate` verdes, `npm run build` OK.

Detalle técnico: [`docs/SPRINT-asistencia-qr.md §8`](docs/SPRINT-asistencia-qr.md).

### 1. Fix TTL instantánea (backend + frontend, defaults unificados a 10)

- **Backend** (`backend/apps/academic/views.py` — `InstantClassCreateView.post`, Opción B): tras `generate_session` persiste `clase.qr_duration_minutes = ttl_minutes` + `save(update_fields=[...])` y `refresh_from_db()` antes de serializar. Si el `save` falla → `set_rollback(True)` + **503** `{"error": "Servicio no disponible, intenta de nuevo."}` (m1: nunca serializar un TTL en memoria divergente de la BD). Colisión/carrera → **409** reintentable, inesperado → **503** con log (M3/m3 intactos).
- **Frontend:** `ClaseDetalle.js` reconcilia `qrMinutes` desde la sesión vigente (`GET current-session` / `POST rotate` → `ttl_minutes`) en vez de solo `classItem.qr_duration_minutes`; `CursoDetalle.js` reconcilia `cls.qr_duration_minutes` con `session.ttl_minutes` tras B3. Defaults unificados a **10** (`useState(... ?? 10)`, `instantTtl=10`, `CreateClassForm`, modelo).
- **Verificar:** crear instantánea con `{"qr_duration_minutes": 5}` → `session.ttl_minutes == 5` y `class.qr_duration_minutes == 5`; `ClaseDetalle` muestra `5 min`; reload conserva.

### 2. Texto QR profesor

- `ClaseDetalle.js` fase `live`: `● QR activo - escanea el código para tomar asistencia.`
- **Verificar:** abrir clase en ventana → badge verde con ese texto exacto.

### 3. Formulario estudiante sin nombre + `PATCH /me` atómico (B1–B4/m2)

- **Formulario** (`AttendQR.js`): sin inputs `first/last`; nombre solo-lectura desde Google (`suggested_first_name/last_name`). Solo pide **Número documento** (max 50), **Código estudiante** (max 50), **Teléfono** (`type=tel`, max 20, ≥ 7 dígitos), **Dirección** (max 500).
- **Backend** (`apps/authentication/views.py`): nombre derivado de Google con fallback monónimo (B3: `Madonna` → `first=last=Madonna`); teléfono exige ≥ 7 dígitos (B2: rechaza `"       "` / `"-------"`); dirección tope 500 (m2); `needs_profile=True` si `phone/address` vacíos aunque el perfil exista (B4, cubre pre-migración `NULL`); `PATCH` en `transaction.atomic` + re-chequeo `iexact` ante `IntegrityError` → **409 legible, nunca 500** (B1).
- Contrato completo: [`docs/API-perfil-estudiante.md`](docs/API-perfil-estudiante.md).
- **Verificar:** `GET /api/auth/me/` con `phone=NULL` → `needs_profile: true`; `mark` → 412; `PATCH` duplicado → 409; monónimo Google → 200.

### 4. Purga DB + backup

- Purgados datos de prueba: `students` 0 filas, `users ROLE_STUDENT` 0 filas.
- Backup previo: `./backups/sia_qr_20261002.dump` + script `scripts/Backup-Db.ps1`.
- Guía backup/restore: [`docs/Backup-restore.md`](docs/Backup-restore.md).
- **Verificar:** `SELECT role, count(*) FROM users GROUP BY role;` + `SELECT count(*) FROM students;` (ver salida del script).

### Verificación reportada

`python manage.py check` 0 errores · `migrate` verde · **61 tests OK** (incluye 9 nuevos `test_qa_reaudit.py`: B2×3, B3×1, B4×2, B1×2, m2×1) · `npm run build` OK.

---

## Entradas anteriores (resumen, detalle en `docs/SPRINT-*.md`)

- **Asistencia QR v2.1 + fix inmediata §7.8:** auto-QR sin botón Generar (`GET current-session` + `POST rotate`, polling 10 s/5 s, `sessionStorage`), fix B3→`ClaseDetalle` vía `initialSession` (< 3 s, 0 rotate). Ver `docs/SPRINT-asistencia-qr.md §§7–7.9`.
- **Mejoras Cursos:** `qr_duration_minutes` (default 15→10), paginación + `?search`, rutas admin, `Modal`/`CreateClassForm`. Ver `docs/SPRINT-mejoras-cursos.md`.
- **CRUD Profesor / Panel Profesor:** cursos/grupos/clases, clase inmediata, `ClaseDetalle`. Ver `docs/SPRINT-crud-profesor.md` y `docs/SPRINT-panel-profesor.md`.
