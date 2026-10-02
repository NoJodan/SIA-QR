# Ejecución `clear_students --yes` — 2026-10-02 (feature/integracion)

**Fecha:** 2026-10-02 · **Rama:** `feature/integracion` (local, sin push) · **Comando:** `clear_students --yes` · **Veredicto:** QA APROBADO.

Doc del comando: [`COMANDO_CLEAR_STUDENTS.md`](COMANDO_CLEAR_STUDENTS.md). Backup/restore general: [`Backup-restore.md`](Backup-restore.md).

## 1. Conteos pre / post (verificación `SELECT`)

| Tabla / filtro | Pre | Post | Esperado post |
|---|---|---|---|
| `users` total | 3 | 2 | 2 |
| `users` `role=ADMIN` | 1 | 1 | intacto |
| `users` `role=PROFESSOR` (`ealugor@ut.edu.co`) | 1 | 1 | intacto |
| `users` `role=STUDENT` (`jpdelgadon@ut.edu.co`) | 1 | 0 | 0 |
| `students` (perfil de `jpdelgadon@ut.edu.co`) | 1 | 0 | 0 |
| `socialaccount_socialaccount` total | 2 (1 prof + 1 student) | 1 (prof) | cae el del student por CASCADE |
| `attendances` | 0 | 0 | 0 (nada que arrastrar) |
| `authorized_professor_emails` (whitelist) | 1 | 1 | intacto |
| `courses` / `academic_groups` | 1 / 1 | 1 / 1 | intactos |
| `system_configs` | 2 | 2 | intactos (`ALLOWED_DOMAIN`, etc.) |

SQL de verificación usado:

```sql
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;
SELECT count(*) AS students_total FROM students;
SELECT count(*) FROM attendances;
SELECT count(*) FROM socialaccount_socialaccount;
SELECT count(*) FROM authorized_professor_emails;
SELECT count(*) FROM courses;
SELECT count(*) FROM academic_groups;
SELECT count(*) FROM system_configs;
```

## 2. Backup previo

- **Path (dentro del contenedor `db` / `sia_qr_db`):** `/tmp/pre_clear_students_.dump` — **63 K**.
- Formato custom `pg_dump -Fc` tomado **antes** del borrado.
- Nota: quedó solo en `/tmp` del contenedor (no copiado a `backups/`). Para reutilizar/restaurar, copiar al host según [`Backup-restore.md`](Backup-restore.md) § restore (`docker cp` + `pg_restore -c`).

## 3. Comandos ejecutados

```bash
# 0. Backup (en contenedor db)
docker exec sia_qr_db pg_dump -U sia_qr -d sia_qr -F c -f /tmp/pre_clear_students_.dump
docker exec sia_qr_db ls -lh /tmp/pre_clear_students_.dump   # 63K

# 1. Pre-conteos (psql / SELECT §1)

# 2. Purga real (feature/integracion)
docker compose exec backend python manage.py clear_students --yes

# 3. Post-conteos (SELECT §1) → 0 STUDENT / 0 students, resto intacto

# 4. Idempotencia
docker compose exec backend python manage.py clear_students --dry-run
# Esperado: "No hay estudiantes…" / "Se borrarían 0…", exit 0, sin cambios
```

## 4. Por qué volverá el formulario de perfil

El borrado elimina el `User STUDENT` **y** su fila `students` (CASCADE). El próximo login Google del mismo correo crea un `User` nuevo `role=STUDENT` **sin** `Student`:

1. `GET /api/auth/me/` → entra a la rama `Student.DoesNotExist` (`apps/authentication/views.py`): no autocrea perfil, devuelve campos vacíos + `"needs_profile": True`.
2. El frontend ve `needs_profile=True` y muestra el formulario de completar perfil (`PATCH /api/auth/me/`).
3. Hasta completar perfil, `POST /api/attendance/mark/` responde **`412` + `needs_profile: True`** (`apps/attendance/views.py`, test `test_mark_without_profile_is_412_needs_profile`).

Es el flujo diseñado, no un residuo del borrado.

## 5. Verificación QA (APROBADO)

- [x] `SELECT` pre/post coinciden con la tabla del §1 (0 STUDENT / 0 students; prof, whitelist, cursos, grupos, configs, social-prof intactos).
- [x] `python manage.py check` → **0 errores**.
- [x] `dry-run` posterior idempotente (0 objetivo, exit 0, sin cambios en BD).
- [x] Sin migraciones nuevas (el comando no toca modelos).

## 6. Notas / hallazgos no bloqueantes

- **H1 — `scheduled_classes` en 0 (previo al `clear`):** valor ya en 0 antes de la purga; corresponde a borrados vía API normal (`DELETE`), no al `clear_students` (que no toca clases/sesiones).
- **H2 — sin `audit_logs`:** no hay tabla/filas de auditoría que verificar en este entorno; nada que purgar ni preservar.
- **H3 — warnings de allauth en `check`/tests:** avisos conocidos de configuración allauth, no relacionados con el borrado; no bloquean.

## 7. Estado de rama

- Ejecución en `feature/integracion`, **sin push** (requerimiento explícito).
- El comando y sus tests siguen `untracked` (`backend/apps/authentication/management/commands/clear_students.py`, `backend/apps/authentication/tests_clear_students.py`); commit pendiente.
