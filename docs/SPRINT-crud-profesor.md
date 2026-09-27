# Sprint: CRUD Profesor — Cursos, Clases e Instantánea

**Estado:** implementado · **Veredicto QA:** APROBADO (sin críticos ni medios; puede avanzar a documentación).
**Alcance:** evolución del Panel Profesor sobre [`docs/SPRINT-panel-profesor.md`](SPRINT-panel-profesor.md) (no se duplica; aquí solo lo nuevo).
**Migraciones:** ninguna nueva (reutiliza `0001_initial` de `academic`).

## Qué cambió

**Backend — app `academic` (`backend/apps/academic/`, sin migraciones):**

- `views.py`:
  - `MyGroupsListView` ahora es `ListCreateAPIView`: `POST my-groups/` crea un `Course` sombra + un `AcademicGroup` (`group_code="01"`, `term_period` actual Bogotá). Solo acepta `{name}` vía `AcademicGroupWriteSerializer`.
  - Nuevo `MyGroupDetailView` (`RetrieveUpdateDestroyAPIView`, `lookup_url_kwarg="group_id"`): `PATCH/PUT` solo renombra (`course.name`); `DELETE` borra el grupo (cascada a `scheduled_classes`) y el `Course` si queda huérfano.
  - Nuevo `ScheduledClassDetailView` (`RetrieveUpdateDestroyAPIView`, `lookup_url_kwarg="class_id"`): doble filtro de ownership (grupo del profesor + clase del grupo). `status` forzado a `SCHEDULED` en creación (`perform_create`); en escritura el serializer lo declara read-only, así que el cliente no puede alterarlo.
- Auth/permisos: `CsrfExemptSessionAuthentication` + `IsAuthenticated + IsProfessor` en las 4 vistas. Sin sesión o sin rol → **403**. Grupo o clase de otro profesor → **404** (`get_object_or_404` con `professor=prof`).
- `urls.py` (montado en `api/academic/`): se agregan `my-groups/<uuid:group_id>/` y `groups/<uuid:group_id>/classes/<uuid:class_id>/`. Las dos rutas previas (`my-groups/`, `groups/<uuid:group_id>/classes/`) no cambian.

**Frontend (`frontend/src/`):**

- `services/academic.js`: `+6` helpers sobre la instancia axios (`createMyGroup`, `updateMyGroup` (PATCH), `deleteMyGroup`, `getGroupClass`, `updateGroupClass` (PATCH), `deleteGroupClass`) + `createInstantClass(groupId)` (usa el endpoint de creación existente).
- `utils/dates.js`: `+ nowBogotaISO()` (ISO del momento actual en `America/Bogota`, offset fijo `-05:00`).
- `components/CourseForm.js` (nuevo): solo campo nombre (obligatorio, máx. 150, trim); usado para crear y renombrar.
- `pages/MisCursos.js`: cards en grid (`nombre + N clase(s)`) con crear (`+ Nuevo curso`), editar inline y eliminar (con `confirm`).
- `pages/CursoDetalle.js`: lista clicable (`onSelectClass`), editar/eliminar por clase, botón `⚡ Clase inmediata` (`createInstantClass`).
- `pages/ClaseDetalle.js` (nueva): info a la izquierda (inicio, duración, modalidad · estado), cuadrado QR placeholder vacío a la derecha (`QR pendiente`), bloque de asistencia placeholder vacío (`Aún no hay marcaciones registradas`).
- `components/ProfLayout.js`: 3 niveles (`mis-cursos | curso-detalle | clase-detalle`) + `configuraciones`; `ClaseDetalle onBack` vuelve al detalle del grupo.

## Endpoints

Base: `http://localhost:8000`. Todos requieren sesión + rol profesor; anónimo → `403`; recurso ajeno → `404`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/academic/my-groups/` | Grupos del profesor (ya existía, sin cambios) |
| POST | `/api/academic/my-groups/` | **Nuevo.** Crea curso solo con `{name}` → 201 |
| GET | `/api/academic/my-groups/<uuid:group_id>/` | **Nuevo.** Detalle del grupo propio (404 si es ajeno) |
| PATCH / PUT | `/api/academic/my-groups/<uuid:group_id>/` | **Nuevo.** Solo renombra (`{name}`) |
| DELETE | `/api/academic/my-groups/<uuid:group_id>/` | **Nuevo.** Borra grupo (cascada) + curso huérfano |
| GET / POST | `/api/academic/groups/<uuid:group_id>/classes/` | Lista/programa clases (ya existía, sin cambios) |
| GET | `/api/academic/groups/<uuid:group_id>/classes/<uuid:class_id>/` | **Nuevo.** Detalle con doble filtro ownership |
| PATCH / PUT | `/api/academic/groups/<uuid:group_id>/classes/<uuid:class_id>/` | **Nuevo.** Edita clase (`status` read-only) |
| DELETE | `/api/academic/groups/<uuid:group_id>/classes/<uuid:class_id>/` | **Nuevo.** Elimina clase |

**POST my-groups — request / respuesta:**

```json
// POST /api/academic/my-groups/  →  201
{ "name": "Cálculo I" }
```

```json
{
  "id": "uuid-del-grupo",
  "course": { "id": "uuid", "code": "<AUTOGENERADO>", "name": "Cálculo I", "description": null },
  "group_code": "01",
  "term_period": "<año>-<1|2> actual Bogotá",
  "classes_count": 0
}
```

Errores: `400` (nombre vacío o > 150), `403` (anónimo / no profesor).

**PATCH my-groups — solo renombra:**

```json
// PATCH /api/academic/my-groups/<group_id>/  →  200
{ "name": "Cálculo I - B" }
```

Cualquier otro campo se ignora. `DELETE` → `204`, borra las clases del grupo por cascada y el curso solo si ningún otro grupo lo usa.

**Clase inmediata (no es endpoint nuevo, es `POST classes/` con valores fijos):**

```json
// POST /api/academic/groups/<group_id>/classes/  →  201
{
  "title": "Clase inmediata <HH:MM Bogotá>",
  "start_time": "<nowBogotaISO()>",
  "duration_minutes": 60,
  "modality": "PRESENTIAL"
}
```

`status` se ignora si se envía (siempre `SCHEDULED`). Errores: `400` (`start_time` en el pasado, `duration_minutes <= 0`), `403`, `404` (grupo ajeno/inexistente).

**PATCH clase — ejemplo:**

```json
// PATCH /api/academic/groups/<group_id>/classes/<class_id>/  →  200
{ "title": "Límites y continuidad", "duration_minutes": 90 }
```

`status`, `id`, `created_at` son read-only. `GET` detalle con grupo ajeno o clase de otro grupo → `404`.

## Reglas de negocio

1. Crear curso = solo `{name}` (1–150, trim, obligatorio). El `code` del `Course` sombra se autogenera (`slugify(name)[:12].upper() + 6 hex`, fallback `CURSO…`); el grupo nace con `group_code="01"` y `term_period` actual (`YYYY-1` si mes ≤ 6, si no `YYYY-2`, hora Bogotá).
2. Renombrar (`PATCH/PUT my-groups/<id>/`) solo toca `course.name`; no cambia `code`, `group_code` ni `term_period`.
3. Borrar grupo = cascada a sus `scheduled_classes`; el `Course` se borra únicamente si queda sin grupos.
4. Clases: `status` siempre `SCHEDULED` al crear; el serializer lo bloquea en escritura.Ownership en dos niveles: grupo del profesor **y** clase del grupo (ambos 404 si no coinciden).
5. Clase inmediata: `now` Bogotá + 60 min + `PRESENTIAL`; título `Clase inmediata HH:MM`.
6. Fechas: visualización `formatBogota` (`es-CO`, `America/Bogota`); formularios con `combineDateTimeToISO` (offset `-05:00`); instantánea con `nowBogotaISO()`.
7. QR y asistencia en `ClaseDetalle` son **placeholders vacíos** (fuera de alcance; lo implementa la app `attendance`).

## Flujo frontend

```
MisCursos (cards nombre + N) → + Nuevo curso (CourseForm) / Editar / Eliminar
  → click card → CursoDetalle (lista clicable, editar/eliminar, ⚡ Clase inmediata, polling 30 s)
    → click clase → ClaseDetalle (info | QR pendiente / Asistencia vacía) → Volver al grupo
```

## Cómo probar (Docker)

```bash
cp .env.example .env        # POSTGRES_HOST=db dentro de Docker
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Frontend: http://localhost:3000 · Backend: http://localhost:8000
```

1. Iniciar sesión como profesor; anónimo → `403` en las 4 rutas.
2. `POST /api/academic/my-groups/ {"name": "Física I"}` → `201` con `group_code "01"` y `term_period` actual.
3. `PATCH /api/academic/my-groups/<id>/ {"name": "Física I - B"}` → `200`, solo cambia el nombre.
4. `GET /api/academic/groups/<id>/classes/<class_id>/` con id ajeno → `404`.
5. Frontend: Mis Cursos → crear/editar/eliminar curso → entrar al grupo → `⚡ Clase inmediata` → abrir la clase (QR pendiente + asistencia vacía).
6. Verificación del sprint: `python manage.py check` y `migrate` OK; `npm run build` OK.

## Backlog QA (no bloqueante)

Veredicto **APROBADO**: sin críticos ni medios. Quedan 3 hallazgos bajos no bloqueantes (detalle en el reporte de QA) + nota preexistente de CSRF (`CsrfExemptSessionAuthentication` heredada de `authentication`, ya registrada en el sprint anterior; evaluar estrategia definitiva). Deuda previa vigente: ver sección Backlog de [`docs/SPRINT-panel-profesor.md`](SPRINT-panel-profesor.md).
