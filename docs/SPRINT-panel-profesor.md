# Sprint: Panel Profesor — Mis Cursos y Clases

**Estado:** implementado · **Veredicto QA:** APROBADO (con deuda no bloqueante en Backlog).
**Alcance:** RF-PROF-02 (consultar cursos/grupos asignados) y RF-PROF-03 (programar clases: fecha, hora inicio, duración, modalidad).
**Fuente de verdad del dominio:** `SIA-QR.md` (no se duplica aquí; este archivo solo documenta lo entregado en el sprint).

## Qué se entregó

**Backend — app `academic` (`backend/apps/academic/`):**
- `models.py`: `Course` (tabla `courses`), `AcademicGroup` (tabla `academic_groups`, `UNIQUE(course, group_code, term_period)`, FK a `Course` y `authentication.Professor` con `RESTRICT`), `ScheduledClass` (tabla `scheduled_classes`, FK a grupo con `CASCADE`, `ordering = ["start_time"]`, enums `ClassModality` PRESENTIAL/VIRTUAL y `ClassStatus` SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED).
- `serializers.py`: `AcademicGroupSerializer` (curso anidado + `classes_count` read-only); `ScheduledClassSerializer` (campos `id, title, start_time, end_time, duration_minutes, modality, status, created_at`; `end_time = start_time + duration_minutes` calculado; read-only `id, status, created_at`; valida `duration_minutes > 0` y `start_time` no anterior a ahora − 5 min).
- `permissions.py`: `IsProfessor` (exige `user.role == ROLE_PROFESSOR`).
- `views.py`: `MyGroupsListView` (lista grupos del profesor autenticado, `select_related("course")`, `annotate(classes_count=Count("classes"))`, orden `course__code, group_code`); `ScheduledClassListCreateView` (lista/crea clases de un grupo; `get_group()` devuelve **404 si el grupo no existe o es de otro profesor**; `perform_create` fuerza `status=SCHEDULED`).
- `urls.py` montado en `sia_qr/urls.py` bajo `api/academic/`: `my-groups/` y `groups/<uuid:group_id>/classes/`.
- `admin.py`: registro de `Course`, `AcademicGroup`, `ScheduledClass` en el admin.
- Migración `0001_initial` de `academic`.
- Auth: `CsrfExemptSessionAuthentication` + `IsAuthenticated + IsProfessor` en ambas vistas. Sin autenticación → **403**.

**Frontend (`frontend/src/`):**
- `services/api.js`: instancia axios `baseURL: http://localhost:8000`, `withCredentials: true`.
- `services/academic.js`: `getMyGroups()`, `getGroupClasses(groupId)`, `createGroupClass(groupId, payload)`.
- `utils/dates.js`: `formatBogota(iso)` (`es-CO`, `America/Bogota`), `todayISODate()` (formato `en-CA` en zona Bogotá), `combineDateTimeToISO(date, time)` (ISO con offset fijo `-05:00`).
- `components/ProfHeader.js`: título + subtítulo + botón "← Volver" opcional.
- `pages/MisCursos.js`: lista grupos (`onSelectGroup`); estados cargando / error / "No tienes grupos asignados".
- `pages/CursoDetalle.js`: cabecera del grupo + `CreateClassForm` + lista de clases ordenada por `start_time`; **polling cada 30 s** (sin WebSocket por restricción No-Redis).
- `components/CreateClassForm.js`: fecha (hoy por defecto), hora (`08:00`), título, duración (90 min), modalidad; envía `title, start_time, duration_minutes, modality`; muestra errores de `start_time / duration_minutes / detail`.
- `components/ProfSidebar.js` + `components/ProfLayout.js`: shell del profesor con tabs `mis-cursos | curso-detalle | configuraciones`; `App.js` monta `ProfLayout` cuando `user.role === "ROLE_PROFESSOR"`.

## Endpoints

Base: `http://localhost:8000`. Todas requieren sesión + rol profesor; anónimo → `403`.

| Método | Ruta | Permisos | Descripción |
|---|---|---|---|
| GET | `/api/academic/my-groups/` | `IsAuthenticated + IsProfessor` | Grupos del profesor autenticado |
| GET | `/api/academic/groups/<uuid:group_id>/classes/` | `IsAuthenticated + IsProfessor` | Clases del grupo (404 si es ajeno) |
| POST | `/api/academic/groups/<uuid:group_id>/classes/` | `IsAuthenticated + IsProfessor` | Programa una clase (`status` siempre `SCHEDULED`) |

**GET my-groups — respuesta 200 (ejemplo):**
```json
[
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "course": { "id": "uuid", "code": "MAT101", "name": "Cálculo I", "description": "..." },
    "group_code": "01",
    "term_period": "2026-1",
    "classes_count": 3
  }
]
```

**GET group classes — respuesta 200 (ejemplo):**
```json
[
  {
    "id": "uuid",
    "title": "Límites y continuidad",
    "start_time": "2026-09-28T08:00:00-05:00",
    "end_time": "2026-09-28T09:30:00-05:00",
    "duration_minutes": 90,
    "modality": "PRESENTIAL",
    "status": "SCHEDULED",
    "created_at": "2026-09-27T10:00:00-05:00"
  }
]
```

**POST group classes — request (ejemplo):**
```json
{
  "title": "Límites y continuidad",
  "start_time": "2026-09-28T08:00:00-05:00",
  "duration_minutes": 90,
  "modality": "PRESENTIAL"
}
```
`status` se ignora si se envía (siempre `SCHEDULED`). Errores: `400` (`start_time` en el pasado, `duration_minutes <= 0`), `403` (sin sesión o no profesor), `404` (grupo inexistente o de otro profesor).

## Modelos / tablas

| Modelo | Tabla | Notas |
|---|---|---|
| `Course` | `courses` | `code` único |
| `AcademicGroup` | `academic_groups` | `UNIQUE(course_id, group_code, term_period)`; FK `RESTRICT` a curso y profesor |
| `ScheduledClass` | `scheduled_classes` | FK `CASCADE` a grupo; `modality` default `PRESENTIAL`; `status` default `SCHEDULED`; orden `start_time` |

Refleja el SQL de `SIA-QR.md` para el dominio académico. La app `attendance` (sesiones QR, marcaciones) queda fuera de este sprint.

## Flujo frontend

```
Login (Google OIDC / sesión) → ProfLayout (tab mis-cursos)
  → MisCursos (GET my-groups, tarjetas por grupo)
  → click grupo → CursoDetalle (GET group classes + polling 30 s)
  → CreateClassForm (fecha de hoy por defecto) → POST group classes
  → la clase aparece en la lista ordenada por start_time
```

Fechas se muestran con `formatBogota` (`es-CO`, `America/Bogota`); el formulario construye el ISO con `combineDateTimeToISO` (offset `-05:00`).

## Cómo probar (Docker)

```bash
cp .env.example .env        # POSTGRES_HOST=db dentro de Docker
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Frontend: http://localhost:3000 · Backend: http://localhost:8000 · Admin: http://localhost:8000/admin
```

1. Crear usuario profesor con `professor_profile` (vía admin o fixture) e iniciar sesión.
2. `GET /api/academic/my-groups/` → lista sus grupos (anónimo → 403).
3. `GET /api/academic/groups/<id>/classes/` → clases del grupo; con id ajeno → 404.
4. Desde el frontend: Mis Cursos → seleccionar grupo → programar clase de hoy → verificar que aparece en la lista.
5. Verificación del sprint: `python manage.py check` y `migrate` OK; `npm run build` OK.

## Variables / env

| Variable | Ejemplo | Notas |
|---|---|---|
| `POSTGRES_HOST` | `db` (Docker) / `localhost` (host) | Cambiarlo tras el primer arranque exige `docker compose down -v` |
| `POSTGRES_DB/USER/PASSWORD/PORT` | ver `.env.example` | Solo aplican al crear el contenedor postgres |
| `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` | ver `.env.example` | Config Django |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Debe incluir el origen del frontend |
| `TIME_ZONE` (settings) | `America/Bogota` | Fijo en código, consistente con la BD |

## Backlog (deuda QA no bloqueante)

1. `CsrfExemptSessionAuthentication` heredado de `authentication`: evaluar estrategia CSRF definitiva.
2. `ProfConfiguraciones` usa `fetch` directo y bypasea la instancia axios (`services/api.js`).
3. Doble query del grupo en `POST` (`get_queryset` + `perform_create` llaman a `get_group()`).
4. Sin paginación en `my-groups/` ni en clases del grupo.
5. Lógica redundante de cambio de tab en `ProfLayout`.
6. Ordenamiento por `start_time` duplicado en cliente (`CursoDetalle`) existiendo ya en servidor.
7. Frontend no distingue `403 / 404 / 400` (mensaje genérico de error).
