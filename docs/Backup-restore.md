# Backup & restore — PostgreSQL (SIA-QR)

> Script: `scripts/Backup-Db.ps1`. Destino host persistente: `backups/sia_qr_<timestamp>.dump` (formato custom `pg_dump -F c`). **No usar `/tmp` del contenedor como destino final.**

## 1. Backup (host Windows + Docker)

```powershell
.\scripts\Backup-Db.ps1
```

El script:

1. Genera `$stamp = yyyyMMdd_HHmmss` y `$dest = "backups/sia_qr_$stamp.dump"` (crea `backups/` si falta).
2. `docker exec sia_qr_db pg_dump -U sia_qr -d sia_qr -F c -f "/tmp/sia_qr_$stamp.dump"`.
3. `docker cp "sia_qr_db:/tmp/sia_qr_$stamp.dump" $dest` + `rm` del temporal dentro del contenedor.
4. Lista `.\backups` y verifica con:
   `SELECT role, count(*) FROM users GROUP BY role;` + `SELECT count(*) FROM students;`.

Backup de referencia versionado junto a `.gitkeep`: `backups/sia_qr_20261002.dump` (tomado durante la purga de QA del 2026-10-02, ver §3).

## 2. Restore

```powershell
# Copiar el dump al contenedor y restaurar sobre una BD existente
docker cp .\backups\sia_qr_20261002.dump sia_qr_db:/tmp/restore.dump
docker exec sia_qr_db pg_restore -U sia_qr -d sia_qr -c /tmp/restore.dump
docker exec sia_qr_db rm /tmp/restore.dump
```

Variante desde cero (si se cambiaron `POSTGRES_*` o se corrompió el volumen):

```powershell
docker compose down -v   # borra el volumen postgres_data
docker compose up -d db
Start-Sleep -Seconds 8
docker cp .\backups\sia_qr_20261002.dump sia_qr_db:/tmp/restore.dump
docker exec sia_qr_db pg_restore -U sia_qr -d sia_qr -c /tmp/restore.dump
docker compose up -d
docker compose exec backend python manage.py migrate
```

Verificación post-restore:

```powershell
docker exec sia_qr_db psql -U sia_qr -d sia_qr -c "SELECT role, count(*) FROM users GROUP BY role ORDER BY role;" -c "SELECT count(*) AS students_total FROM students;"
```

## 3. Purga QA 2026-10-02 (referencia)

Durante la re-auditoría QA se purgaron los datos de prueba de estudiantes **después** de tomar el backup:

- `students`: 0 filas.
- `users` con `role = ROLE_STUDENT`: 0 filas.
- Backup previo: `./backups/sia_qr_20261002.dump`.

Para repetir la purga (solo entornos de prueba):

```sql
-- Con backup tomado primero (ver §1)
TRUNCATE students CASCADE;
DELETE FROM users WHERE role = 'ROLE_STUDENT';
SELECT count(*) AS students_total FROM students;
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;
```

> No purgar en producción. El `TRUNCATE ... CASCADE` elimina también `attendances` ligadas a esos estudiantes.
