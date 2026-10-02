# Backup PostgreSQL a volumen/host (NO /tmp como destino final).
# Uso: .\scripts\Backup-Db.ps1
# Destino: .\backups\sia_qr_<timestamp>.dump (host persistente).
# Verificación: SELECT role/count, students count + listado del dump.
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = "backups/sia_qr_$stamp.dump"
New-Item -ItemType Directory -Path backups -Force | Out-Null
docker exec sia_qr_db pg_dump -U sia_qr -d sia_qr -F c -f "/tmp/sia_qr_$stamp.dump"
docker cp "sia_qr_db:/tmp/sia_qr_$stamp.dump" $dest
docker exec sia_qr_db rm "/tmp/sia_qr_$stamp.dump"
Write-Output "Backup en $dest"
Get-ChildItem ./backups | Format-Table Name, Length, LastWriteTime -AutoSize
docker exec sia_qr_db psql -U sia_qr -d sia_qr -c "SELECT role, count(*) FROM users GROUP BY role ORDER BY role;" -c "SELECT count(*) AS students_total FROM students;"
