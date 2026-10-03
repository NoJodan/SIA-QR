# Módulo Reportes — `feature/integracion` (QA APROBADO)

**Rama:** `feature/integracion` · **Commits:** `79d0970` (módulo) + `ba71453` (fix QA) · **Veredicto QA:** APROBADO.
**Detalle integración general:** [`INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md) §16.
**Fuente de verdad del dominio:** `SIA-QR.md` (RF-PROF-09 / RF-ADM-04).

> Backend + frontend. Sin migraciones nuevas, sin Redis, sin cambios al contrato de asistencia (B1/B2/A2 intactos).

## 1. Objetivo

Reporte agregado de marcaciones con preview paginado + descarga Excel/PDF, con ownership por rol:

- **Profesor:** solo sus grupos (ajeno → `403`).
- **Admin:** todo + filtro opcional por profesor.

## 2. Roles y permisos

| Rol | Alcance | Reglas |
|---|---|---|
| `ROLE_PROFESSOR` | Solo `session__scheduled_class__group__professor__user = request.user` | `group_id` / `class_id` / `session_id` ajenos → `403 {"error": "No tienes acceso a …"}`. `professor_id` → `403 {"error": "No tienes permiso para filtrar por profesor."}`. Excepción: `course_id` ajeno → `200` vacío (los cursos son compartidos, no 403). |
| `ROLE_ADMIN` | Todo | `professor_id` (UUID Profesor) filtra; UUID inexistente → `200` vacío (`none()`). Sin `professor_id` → todos los profesores. |
| Anónimo / otro rol | Nada | Sin sesión → `401` (`SessionAuthentication401`). `IsProfessorOrAdmin` bloquea estudiante. GET puro, sin CSRF. |

## 3. Endpoint

`GET /api/attendance/reports/?format=json|xlsx|pdf` — `backend/apps/attendance/views_reports.py::AttendanceReportView`, lógica en `reports.py`, ruta `urls.py::reports/`.

| `format` | Respuesta | Tope |
|---|---|---|
| `json` (defecto) | Paginado `StandardResultsPagination` (10, máx 50): `{count, next, previous, results: [report_row]}` | Paginado, sin tope global |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `attachment; filename="siaqr_reporte_AAAAMMDD_HHMMSS.xlsx"` | `MAX_EXPORT_ROWS = 5000`; superar → `400 {"error": "El reporte supera el máximo de 5000 registros…"}` |
| `pdf` | `application/pdf`, `attachment; filename="siaqr_reporte_….pdf"` | `MAX_PDF_ROWS = 1000`; superar → `400` análogo (una sola `Table` en memoria; ~400 filas lo legible) |

### 4. Filtros (todos opcionales, `ReportFilterSerializer`)

| Param | Tipo | Notas |
|---|---|---|
| `course_id` | UUID | Filtra `group__course_id`. Ajeno (prof) → `200` vacío, no 403. |
| `group_id` | UUID | Ajeno (prof) → `403`. Inválido → `400 "Identificador de grupo inválido."` |
| `class_id` | UUID multi | `?class_id=a&class_id=b`, coma-separado o lista (`MultipleUUIDField`). Alguna ajena (prof) → `403`. Inválido → `400 "Identificador de clase inválido."` |
| `session_id` | UUID | Ajena (prof) → `403`. |
| `date_from` / `date_to` | `AAAA-MM-DD` | Sobre `class.start_time`, convertido a aware `America/Bogota` (inicio/fin del día). `from > to` → `400`. Rango inclusivo `(to−from)+1 > 366` → `400 "no puede superar 366 días"`. Formato libre → `400 "usa AAAA-MM-DD"`. |
| `registered_from` / `registered_to` | `AAAA-MM-DD` | Idem sobre `registered_at`. |
| `document` | texto ≤ 50 | `icontains` sobre `student__document_number`. |
| `student_code` | texto ≤ 50 | `icontains` sobre `student__student_code`. |
| `search` | texto ≤ 100 | `icontains` OR sobre nombre/apellido/documento/código/email. |
| `class_status` | `SCHEDULED\|IN_PROGRESS\|COMPLETED\|CANCELLED` | Otro → `400 "Estado de clase inválido."` |
| `modality` | `PRESENTIAL\|VIRTUAL` | Otro → `400 "Modalidad inválida."` |
| `professor_id` | UUID | Solo admin (prof → `403`). |
| `has_location` | `true\|false\|all` | Normaliza `1/sí/yes→true`, `0/no→false`, `todos/todas→all`. `true` = lat+long no nulos; `false` = alguno nulo. Inválido → `400`. |
| `format` | `json\|xlsx\|pdf` | Normaliza minúsculas/trim; otro → `400 "Formato inválido (json, xlsx o pdf)."` |

Orden: `registered_at, id`. `select_related(student__user, …course, …professor__user)`.

### 5. Columnas

**JSON (`report_row`, 18 claves):** `id, student_name, student_code, document_number, email, course_code, course_name, group_id, group_code, term_period, class_id, class_title, class_start_time, modality, class_status, session_id, registered_at, has_location`. Sin `lat/long` crudos (solo booleano, como la lista viva A2).

**XLSX (12, `openpyxl` `write_only`, anchos fijos + `freeze A2` + `auto_filter`):** `Estudiante | Código | Documento | Correo | Curso | Grupo (código + periodo) | Clase | Modalidad | Estado | Inicio clase | Registrado | Ubicación (Sí/No)`. Cabecera `PatternFill #B3200E` + `Font blanca bold`. Fechas `dd/mm/aaaa hh:mm` Bogotá (`_fmt_bogota`). Iterador `chunk_size=1000`.

**PDF (7, `reportlab` A4 horizontal, `Helvetica`, `repeatRows=1`, footer `Página N`):** `Estudiante | Código | Curso | Clase | Inicio | Registrado | Ubic.` + encabezado título, resumen de filtros y `Generado: dd/mm/aaaa hh:mm (America/Bogota)`. Inputs del resumen con `html.escape` (un `<>&` sin escapar rompía `Paragraph` → 500). Sin emojis (Helvetica no los soporta).

### 6. Ejemplos

```bash
# Preview profesor (sesión): paginado estándar
curl -b cookies.txt "http://localhost:8000/api/attendance/reports/?format=json&page=1&page_size=10&group_id=<UUID>"

# Multi-clase + rango Bogotá + búsqueda
curl -b cookies.txt "http://localhost:8000/api/attendance/reports/?format=json&class_id=<A>&class_id=<B>&date_from=2026-01-01&date_to=2026-03-31&search=perez"

# Solo admin: por profesor
curl -b cookies.txt "http://localhost:8000/api/attendance/reports/?format=json&professor_id=<UUID_PROF>"

# Descargas (profesor: refinar si 400 por tope)
curl -b cookies.txt -OJ "http://localhost:8000/api/attendance/reports/?format=xlsx&group_id=<UUID>"
curl -b cookies.txt -OJ "http://localhost:8000/api/attendance/reports/?format=pdf&group_id=<UUID>"
```

Errores típicos: `401` sin sesión · `403` grupo/clase/sesión ajenos o `professor_id` como prof · `400` UUID/fecha/formato/rango>366/tope 5000/1000.

## 7. Exports (detalle)

- **XLSX:** `export_xlsx(qs)` — `Workbook(write_only=True)`, hoja `Reporte`, cabecera `#B3200E`, `column_dimensions` por `_REPORT_WIDTHS`, `freeze_panes A2` y `auto_filter A1:<L><total+1>` en `try/except` (WriteOnly no soporta vistas en algunas versiones).
- **PDF:** `export_pdf(qs, validated)` — `SimpleDocTemplate(landscape(A4), márgenes 12/12/14/14 mm)`, `colWidths` proporcionales (24/10/20/20/10/10/6), `BACKGROUND #B3200E + TEXTCOLOR white + ROWBACKGROUNDS white/#F8FAFC + GRID grey`, `FONTSIZE 8`.
- **Filename:** `siaqr_reporte_%Y%m%d_%H%M%S.xlsx|pdf` (hora Bogotá), header dual `filename="…" + filename*=UTF-8''…`.

## 8. UI (`frontend/src/pages/Reportes.js` + `services/reports.js`)

- **Montaje:** `isAdmin` decide la pestaña/ruta (Prof `ProfLayout` / Admin `AdminLayout`); el tab Admin solo visible con `ROLE_ADMIN`. Misma página, distinto `fetchAll` base (`my-groups/` vs `admin/groups/`).
- **Toolbar:** `sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3` con grid `1/2/3 col`: Curso → Grupo → Clase(s) multiselección (`Ctrl+clic`, coma-separada), ID sesión (valida UUID v4 local antes de buscar), Desde/Hasta + Registro desde/hasta (`type=date`), Documento, Código, `SearchBar` (usa `draft.search` directo, no el debounce stale — fix MEDIO 2), Estado, Modalidad, Ubicación, y solo admin `professorId` (UUID v4 local + ayuda `aria-describedby`).
- **Flujo:** `draft` → `Buscar` congela `applied` → `getReportPreview(params, page, 10)` → tabla 6 col (Estudiante / Curso-Grupo / Clase+pill estado / Modalidad / Registrado `formatBogota` / Ubicación pill) + `Pagination page/totalPages countLabel`. `Limpiar` resetea todo. Botones `Descargar Excel` (primaria `#B3200E`) / `Descargar PDF` (borde rojo) arriba en header-card con `count`; `downloadReport(params, fmt)` vía `blob` + `Content-Disposition` (`filename*` prioritario) + `revokeObjectURL`. Deshabilitados si `count==0`, cargando o sobre tope; avisos `role=alert` ámbar si `count>5000` (Excel) o `>1000` solo-PDF. `401` → redirect `/login` o `/admin-login`; `403` → `"No tienes permiso…"`. Cascada curso→grupo→clases con `fetchAll` (page_size 50, tope 20 páginas/1000 + `console.warn` + nota truncada en grupos).
- **Build:** `npm run build` OK (~110 kB JS, ignorado por git — no se commitea `build/`).

## 9. Verificación reportada

```bash
docker compose up --build -d
docker compose exec backend python manage.py check      # 0 errores
docker compose exec backend python manage.py migrate   # OK, sin migraciones nuevas
docker compose exec backend python manage.py test apps.attendance.tests_reports  # 19/19
docker compose exec backend python manage.py test      # 97/97 total
docker exec sia-qr-frontend npm run build              # OK ~110 kB
```

## 10. Pendientes (remanentes bajos, no bloqueantes QA)

1. **`fetchAll` aviso:** el truncado a 1000 solo deja `console.warn` + nota en grupos; clases sin nota visible — refinar filtros si falta un ítem.
2. **Oráculo `200` vs `403`:** `course_id` ajeno → `200` vacío pero `group/class/session` ajenos → `403`; documentado en §2/§4, no cambiar sin ADR (rompe compatibilidad).
3. **Formula-injection:** celdas XLSX que empiecen con `= + - @` se exportan tal cual; si el archivo se abre en Excel con cálculo activo, sanitizar (prefijar `'` o validar) en futuro fix.

## 11. Cómo probar (manual, 5 min)

| # | Como | Pasos | Esperado |
|---|---|---|---|
| 1 | Prof | Login `@ut.edu.co` → Reportes → elegir grupo propio → Buscar | Tabla con sus marcaciones, `N registro(s)`, paginación 10 |
| 2 | Admin | `/admin-login` → Reportes (tab Admin) → pegar `professorId` UUID → Buscar | Solo filas de ese profesor; UUID inexistente → vacío sin error |
| 3 | 403 prof | Como prof, forzar `group_id` ajeno en URL (`?format=json&group_id=<AJENO>`) | `403 "No tienes acceso a ese grupo."`; en UI mensaje `"No tienes permiso…"` |
| 4 | 403 prof-admin | Como prof, `?format=json&professor_id=<UUID>` | `403 "No tienes permiso para filtrar por profesor."` |
| 5 | XLSX | Con resultados → Descargar Excel | Archivo `siaqr_reporte_*.xlsx`, 12 col, cabecera `#B3200E`, fechas Bogotá |
| 6 | PDF | Con resultados → Descargar PDF | `siaqr_reporte_*.pdf` horizontal, 7 col, filtros + fecha generación + `Página N` |
| 7 | Cap | Filtros amplios con `count>1000` (>5000 para XLSX) | Botón deshabilitado + aviso ámbar; llamada directa → `400 "supera el máximo…"` |
| 8 | Rango | `date_from=2026-01-01&date_to=2027-06-01` (>366) | `400 "no puede superar 366 días"` |
