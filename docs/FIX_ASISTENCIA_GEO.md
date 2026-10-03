# Fix asistencia con ubicación — `563c28d` (QA APROBADO)

**Rama:** `feature/integracion` · **Commit:** `563c28d` — `fix(attendance): geo tolerante en marcacion, sin 400 por decimales (RNF-06)`
**Base:** `3450411` · **Alcance:** 3 archivos (1 back + 1 front + tests). `views.py` sin cambios.
**Veredicto QA:** APROBADO (4 bajos no bloqueantes, ver §5). **Push:** NO realizado.
**Docs relacionados:** [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) · [`AJUSTES_QR_ASISTENCIA.md`](AJUSTES_QR_ASISTENCIA.md).

> La geo es opcional y NO bloqueante (RNF-06). Este fix elimina el `400` genérico al firmar **con ubicación**.

## 1. Causa

- `MarkAttendanceSerializer` usaba `DecimalField` estricto: `latitude 10,8` / `longitude 11,8` / `accuracy 8,2`.
- El navegador envía **13–16 decimales** (`Geolocation API`), DRF rechaza el exceso de `decimal_places` → **`400` genérico**.
- **Sin geo (`null`) pasaba**, por eso el fallo solo aparecía con ubicación concedida.

## 2. Fix por archivo (3)

| Archivo | Cambio | Intacto |
|---|---|---|
| `backend/apps/attendance/serializers.py` (+~50) | Nuevo `TolerantGeoField`: `required=False, allow_null=True, default=None`; `quantize(8/8/2, ROUND_HALF_UP)` en vez de rechazar; `None`/`""`/ausente → `None`; `NaN`/`Infinity`/texto → `None`; fuera de rango → `None`; `token` sigue estricto (`strip`, `400` si vacío/ausente) | Modelo, `views.py`, `UNIQUE(session,student)`, token hash + TTL |
| `frontend/src/pages/AttendQR.js` (+~90/−10) | `toFixedOrNull(v,dec)` (lat/lon 8, accuracy 2) como primera barrera; solo envía geo si `geoState === "ready"`, si no fuerza `null`s; botón **no** se deshabilita en `pending`; **reintento único** con `null`s ante `400`; `markOnce` + `finishOk(data)` (`done`/`already`) | Fases, `PENDING_TOKEN_KEY`, `GEO_TIMEOUT 8 s`, `PATCH /me`, códigos `401/404/409/410/412` |
| `backend/apps/attendance/tests.py` (+177) | `MarkGeoToleranceTests` (6 serializer) + `MarkAttendanceGeoMatrixTests` (8 endpoint) | Resto de la suite |

Detalle reintento `400` (red de seguridad RNF-06): si el payload llevaba geo y el back responde `400`, se reintenta **una vez** con `{token, null, null, null}`; ese reintento mapea `412 → formulario perfil + ready`, `404 → inválido`, `409/410 → expiró/ya registrada`, resto → mensaje legible y `phase="ready"` para reintentar. Si el `400` original iba ya sin geo, muestra `error`/`token` del back o genérico.

## 3. Matriz con/sin geo y códigos

| Caso | Payload | Esperado |
|---|---|---|
| Geo precisa 15 decimales | `lat 4.123456789012345, lon -75.1234567890123, acc 12.3456789` | `201`, redondea a `4.12345679 / -75.12345679 / 12.35` |
| Geo como string | `"4.123456789012345" / "-75.123456789012345" / "3.14159"` | `201` (`3.14`) |
| Sin geo | `null`s, `""` o `{}` (ausentes) | `201` (firma igual) |
| `accuracy` larga | `lat 4.5, lon -75.5, acc 9.87654321` | `201` |
| Basura / fuera de rango | `NaN / "abc" / Infinity`, `lat 91, lon 200, acc -5` | `201` con `None` (coerce, **nunca `400`**) |
| Token ausente/vacío | `{}` / `""` / `"   "` | `400` en `token` (único `400` válido) |
| Token inválido | `token-inexistente` | `404` `El código QR no es válido.` |
| Expirado | `expires_at` pasado | `410` |
| Clase cerrada | `status=COMPLETED` | `409` |
| Sin perfil | usuario sin `Student` | `412` + `needs_profile` → formulario, queda en `ready` |
| Duplicado | mismo `token` 2× | `201` luego `200` + `already_marked` |
| Front: `400` con geo | cualquier `400` habiendo enviado geo | 1 reintento con `null`s antes de mostrar error |

## 4. Verificación reportada

- `attendance`: **23/23 OK** (6 tolerancia + 8 matriz + preexistentes).
- Backend total: **78/78 OK**.
- `npm run build` (CRA): **OK**.
- `views.py` sin diff; `token` estricto verificado (vacío/ausente → `400` en `token`).

```bash
git checkout feature/integracion
git show --stat 563c28d   # 3 archivos: serializers.py, tests.py, AttendQR.js
git diff 3450411..563c28d -- backend/apps/attendance/views.py  # esperado: vacío
```

## 5. Pendientes follow-up (4 bajos, no bloqueantes)

1. **Bajo — `toFixedOrNull` sin `try/catch`:** `Number(v)` + `n.toFixed(dec)` asume finito tras `isFinite`; envolver en `try/catch → null` por robustez ante objetos con `valueOf` raro.
2. **Bajo — mensaje de retry confuso:** `Ubicación inválida, reintentando sin ubicación.` se muestra cuando el reintento *ya falló*; redactar en pasado (`No se pudo firmar ni siquiera sin ubicación…`) y/o log del `400` original.
3. **Bajo — mensaje custom de `token`:** el `400` sin geo usa `d.error || fieldError(d,"token") || genérico`; fijar literal dedicado (`Falta el token…`) para no depender del texto DRF.
4. **Bajo — a11y `labels`/`live`:** los 4 `<label>` de `StudentProfileForm` siguen sin `htmlFor`/`id` y los errores sin `role="alert"` (heredado de `d655664` §6). Añadir `useId` + `role="alert"`.

## 6. Cómo probar (10 min)

```bash
git checkout feature/integracion
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Profesor: crea clase → ClaseDetalle → QR live → copia token de ?token=
```

| # | Prueba | Pasos (Chrome DevTools → `Sensors` → Location) | Esperado |
|---|---|---|---|
| 1 | **Sensor Ibagué** | `Sensors → Custom location: 4.4389, -75.2322` → `/attend?token=<vigente>` → permitir → `Firmar asistencia` | `201` → `¡Asistencia registrada!`; BD guarda `lat/lon` a 8 dec + `accuracy` a 2 dec |
| 2 | **Denegar** | `Sensors → Location unavailable` (o bloquear permiso) → firmar | Badge `Sin ubicación — igual puedes firmar`, firma `201` con `null`s |
| 3 | **Timeout** | `Sensors → timeout` / no responder 8 s (`GEO_TIMEOUT_MS`) → firmar sin esperar | No bloquea: se puede firmar en `pending`, payload con `null`s → `201` |
| 4 | **15 decimales** | Consola: `markAttendance({token, latitude: 4.123456789012345, longitude: -75.123456789012345, accuracy: 12.3456789})` | `201` (antes del fix: `400`); serializer redondea |
| 5 | **Basura** | `latitude: "NaN", accuracy: "Infinity"` o `lat 91` | `201` con `None`, nunca `400` |
| 6 | **Regresión códigos** | Token inválido / expirado / duplicado / sin perfil | `404 / 410 / 200 already_marked / 412` + formulario perfil |
