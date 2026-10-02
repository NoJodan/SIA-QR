# Comando `clear_students` — purga de estudiantes (QA APROBADO)

**Estado:** implementado en rama `feature/integracion` · **Veredicto QA:** APROBADO (medios/bajos no bloqueantes, ver §7) · **Push:** NO realizado · **Commit:** pendiente (fuentes `untracked`, ver §8).

| Concepto | Valor |
|---|---|
| Comando | `backend/apps/authentication/management/commands/clear_students.py` (untracked, sin commit) |
| Tests | `backend/apps/authentication/tests_clear_students.py` (untracked, 3 tests: borrado selectivo, `dry-run`, idempotencia) |
| Rama | `feature/integracion` (local, sin push) |
| Alcance | Solo QA / desarrollo. **No usar en producción sin backup + ventana de mantenimiento.** |
| Documento padre | [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) §14 (puntero) · Backup: [`Backup-restore.md`](Backup-restore.md) |

## 1. Qué borra / qué preserva

Borrado **solo vía ORM** (`QuerySet.delete()`, nunca SQL crudo ni `TRUNCATE`). La cascada BD/ORM arrastra lo ligado al `User`:

**Borra (solo `role=ROLE_STUDENT`):**

- `User` con `role=ROLE_STUDENT` (con y sin perfil `Student` — `needs_profile` incluidos).
- `Student` (`OneToOne on_delete=CASCADE`).
- `Attendance` (`FK student → CASCADE`, respeta `UNIQUE(session_id, student_id)`).
- `SocialAccount` / `Token` / `EmailAddress` de allauth (`FK a User con CASCADE`).

**Preserva siempre:**

- `ROLE_ADMIN`, `ROLE_PROFESSOR`, superusers (salvo matiz M1, ver §7), perfiles `Professor`.
- Whitelist `authorized_professor_emails`, cursos, grupos, clases programadas.
- Sesiones (`AttendanceSession.token_hash` intacto) y `system_configs` (`ALLOWED_DOMAIN`, etc.).

**Propiedades:** idempotente (0 estudiantes → mensaje `No hay estudiantes…` y exit `0`); conteos previo/posterior en stdout con hora `America/Bogota`.

## 2. Sintaxis

```bash
python manage.py clear_students [--dry-run] [--yes | -y] [--domain DOMINIO] [--exclude-emails a@x,b@y] [--batch-size N]
```

| Flag | Default | Efecto |
|---|---|---|
| `--dry-run` | `False` | Solo conteos + `Se borrarían…`. No modifica la BD. No exige `--yes` ni confirmación. |
| `--yes`, `-y` | `False` | Omite confirmación interactiva. **Obligatorio con `DEBUG=False`** (sin él + sin `--dry-run` → `CommandError`). |
| `--domain` | `None` | Solo emails `@DOMINIO` (`email__iendswith`, case-insensitive; acepta con/sin `@`). Ej. `--domain ut.edu.co`. |
| `--exclude-emails` | `""` | Emails a excluir, separados por coma, case-insensitive. Ej. `--exclude-emails a@ut.edu.co,b@ut.edu.co`. |
| `--batch-size` | `1000` | Tamaño de chunk del borrado (`>= 1`, si no → `CommandError`). |
| (sin flags) | — | Pide confirmación interactiva: escribir `BORRAR` (cualquier otra cosa / EOF / Ctrl+C → cancela sin cambios). |

## 3. Ejemplos

```bash
# Ayuda
python manage.py clear_students --help

# Simulación (seguro, sin --yes)
python manage.py clear_students --dry-run
# Salida: users totales / students objetivo (con perfil / sin perfil) / attendances / social accounts
#         + "[dry-run] Se borrarían N usuarios STUDENT (…) Sin cambios en la BD."

# Borrado real en dev (pide escribir BORRAR)
python manage.py clear_students

# Borrado real sin prompt (requerido en prod DEBUG=False)
python manage.py clear_students --yes

# Solo un dominio + excluidos + lotes chicos
python manage.py clear_students --domain ut.edu.co --exclude-emails keeper@ut.edu.co,otro@ut.edu.co --batch-size 500 --yes

# Simular ese mismo filtro antes de borrarlo
python manage.py clear_students --domain ut.edu.co --exclude-emails keeper@ut.edu.co --batch-size 500 --dry-run
```

En Docker:

```bash
docker compose exec backend python manage.py clear_students --dry-run
docker compose exec backend python manage.py clear_students --yes
```

## 4. Protección en producción + backup obligatorio

1. **Confirmación:** sin `--yes` pide `Escribe BORRAR para confirmar`. Con `DEBUG=False`, borrar sin `--yes` (y sin `--dry-run`) aborta con `CommandError`.
2. **Guarda interna:** cada queryset (global y por chunk) pasa por `_assert_student_only` — aborta si el filtro `role=ROLE_STUDENT` se pierde o aparecen no-STUDENT.
3. **Transacción:** borrado en un único `transaction.atomic()` por chunks (ver B3 en §7 para volúmenes grandes).
4. **Backup antes de borrar** (obligatorio). Opción recomendada — script versionado (formato custom `pg_dump -F c` a `backups/`):

```powershell
.\scripts\Backup-Db.ps1
```

Equivalente manual:

```powershell
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
docker exec sia_qr_db pg_dump -U sia_qr -d sia_qr -F c -f "/tmp/sia_qr_$stamp.dump"
docker cp "sia_qr_db:/tmp/sia_qr_$stamp.dump" "backups/sia_qr_$stamp.dump"
docker exec sia_qr_db rm "/tmp/sia_qr_$stamp.dump"
```

Restore (detalle completo en [`Backup-restore.md`](Backup-restore.md)):

```powershell
docker cp .\backups\sia_qr_<stamp>.dump sia_qr_db:/tmp/restore.dump
docker exec sia_qr_db pg_restore -U sia_qr -d sia_qr -c /tmp/restore.dump
```

> No purgar en producción sin backup verificado. La guía anterior de purga con `TRUNCATE students CASCADE` (`Backup-restore.md` §3) queda **reemplazada** por este comando ORM para entornos QA/dev.

## 5. Verificación reportada

- `python manage.py check` → 0 errores.
- `python manage.py migrate` → OK (sin migraciones nuevas; el comando no toca modelos).
- Suite backend → **29 tests OK**, incluye los 3 nuevos `tests_clear_students.py`:
  - `borra_solo_students_y_preserva_resto` (2 con perfil + attendance + 1 sin perfil borrados; admin/profesor/whitelist/curso/grupo/clase/sesión-token/`SystemConfig` intactos).
  - `dry_run_no_borra` (3 STUDENT / 2 perfiles / 2 attendances intactos).
  - `idempotencia_segunda_corrida_exit_0` (`No hay estudiantes…`, exit 0).
- `docker compose up --build -d` → `db healthy`, `backend :8000`, `frontend :3000` (sin cambios en frontend).

## 6. Cómo probar (local, QA/dev)

```bash
git checkout feature/integracion
cp .env.example .env   # POSTGRES_HOST=db en Docker, localhost sin Docker
docker compose up --build -d
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py check

# 1. Simular
docker compose exec backend python manage.py clear_students --dry-run

# 2. Borrar (dev: interactivo; prod-like DEBUG=False: con --yes)
docker compose exec backend python manage.py clear_students --yes

# 3. Repetir → idempotente
docker compose exec backend python manage.py clear_students --yes
# Esperado: "No hay estudiantes para borrar. Nada que hacer."

# 4. Tests del comando
docker compose exec backend python manage.py test apps.authentication.tests_clear_students -v 2
```

Verificación SQL post-borrado:

```sql
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;
SELECT count(*) AS students_total FROM students;
-- Esperado QA/dev purgado: 0 filas ROLE_STUDENT, 0 students
```

## 7. Pendientes QA (no bloqueantes, QA APROBADO con ellos)

| ID | Sev. | Hallazgo | Follow-up sugerido |
|---|---|---|---|
| M1 | Media | Superuser con `role=STUDENT` caería en el borrado (no hay exclusión `is_superuser`; "preserva superusers" asume que ninguno es STUDENT). | Excluir `is_superuser=True` o abortar si el QS contiene alguno. |
| M2 | Media | `--yes` en prod omite toda confirmación (riesgo operativo con `DEBUG=False`). | Doble confirmación / variable de entorno / allowlist de entorno. |
| M3 | Media | Flags `--domain` / `--exclude-emails` / `--batch-size` sin test directo (solo hay cobertura de borrado total, `dry-run` e idempotencia). | Agregar tests por flag (dominio, excluidos case-insensitive, `batch-size=1` y `< 1`). |
| B1 | Baja | Emails de `--exclude-emails` se imprimen tal cual en stdout (eco en logs). | Enmascarar o modo `--quiet`. |
| B2 | Baja | `_assert_student_only` inspecciona `str(qs.query)` buscando `ROLE_STUDENT` (frágil ante cambios ORM/DB). | Asertar por filtros declarados además del conteo semántico existente. |
| B3 | Baja | Borrado en un único `transaction.atomic()`; con miles de filas puede retener locks. | Transacción por chunk o ventana de mantenimiento documentada. |

## 8. Archivos y estado de rama

- Nuevos **sin commit** (`git status --short` → `??`): `backend/apps/authentication/management/commands/clear_students.py`, `backend/apps/authentication/tests_clear_students.py`.
- Este doc: `docs/COMANDO_CLEAR_STUDENTS.md` (nuevo) + puntero en [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) §14.
- No se modificó código fuente ni se hizo push (requerimiento explícito).

## 9. Ejecución 2026-10-02 (`--yes`, QA APROBADO)

Detalle completo en [`EJECUCION_CLEAR_STUDENTS_2026-10-02.md`](EJECUCION_CLEAR_STUDENTS_2026-10-02.md). Resumen:

- **Pre:** 3 users (1 admin + 1 professor `ealugor@ut.edu.co` + 1 student `jpdelgadon@ut.edu.co` con perfil + 2 social, 0 attendances). **Backup:** `/tmp/pre_clear_students_.dump` (63 K, contenedor db).
- **Post:** 2 users (0 STUDENT, 0 students; resto intacto: 1 prof, whitelist 1, courses 1, groups 1, configs 2, social 1 profesor).
- Próximo login del estudiante recrea `User STUDENT` sin `Student` → `me.needs_profile=True` → formulario, y `mark` da `412` hasta completar perfil (flujo esperado).
- QA: `SELECT` pre/post OK, `check` 0 errores, `dry-run` idempotente. H1 `scheduled_classes` en 0 previo por DELETE API normal; H2 sin `audit_logs`; H3 warnings allauth. Sin push.
