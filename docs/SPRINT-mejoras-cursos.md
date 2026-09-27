# Sprint: Mejoras Cursos — QR, Búsqueda, Paginación y Admin

**Estado:** implementado · **Veredicto QA:** APROBADO (1 medio + 5 bajos, sin críticos; puede avanzar a documentación).
**Alcance:** evolución del Panel Profesor sobre [`docs/SPRINT-panel-profesor.md`](SPRINT-panel-profesor.md) y [`docs/SPRINT-crud-profesor.md`](SPRINT-crud-profesor.md) (no se duplica; aquí solo lo nuevo de este sprint).
**Migraciones:** una nueva — `academic/0002_scheduledclass_qr_duration_minutes`.
**Fuente de verdad del dominio:** `SIA-QR.md` (no se modifica).

## Qué cambió (6 puntos)

### 1. Backend — campo QR (`ScheduledClass.qr_duration_minutes`)

- `models.py`: `qr_duration_minutes = PositiveIntegerField(default=15, validators=[Min 1, Max 120])`.
- Migración `0002_scheduledclass_qr_duration_minutes` (`AddField`, default 15).
- `serializers.py` (`ScheduledClassSerializer`): campo agregado a `fields`; `validate_qr_duration_minutes` (1–120, mensaje en español). `duration_minutes` y `start_time` conservan sus validaciones previas. `status`, `id`, `created_at` siguen read-only.
- Efecto: `POST / classes/` acepta `qr_duration_minutes` opcional (si se omite → 15); `PATCH/PUT` lo acepta; `GET` lo devuelve. `createInstantClass` del frontend lo envía siempre como `15`.

### 2. Backend — serializers con anidados

- `AcademicGroupSerializer`: agrega `professor` (`SerializerMethodField` → `{full_name, employee_code, email | null}` vía `get_professor`). Mantiene `course` anidado + `classes_count` read-only.
- `ScheduledClassSerializer`: agrega `qr_duration_minutes` (ver punto 1). `end_time` calculado sin cambios.
- Nota: `ProfessorBriefSerializer` quedó definido en `serializers.py` pero **sin uso** (el anidado real lo resuelve `get_professor`). Ver backlog.

### 3. Backend — paginación y búsqueda

- Nuevo `pagination.py`: `StandardResultsPagination(PageNumberPagination)` con `page_size = 10`, `page_size_query_param = "page_size"`, `max_page_size = 50`.
- Aplicada a 4 vistas de lista: `MyGroupsListView`, `ScheduledClassListCreateView`, `AdminGroupsListView`, `AdminClassListView`.
- `SearchFilter`:
  - `MyGroupsListView` y `AdminGroupsListView`: `search_fields = ["course__name"]`.
  - `ScheduledClassListCreateView` y `AdminClassListView`: `search_fields = ["title"]`.
- Query params en listas: `?search=<texto>&page=<n>&page_size=<1..50>`.
- Respuesta paginada DRF estándar: `{count, next, previous, results}`. El frontend la normaliza con `unwrap()` (acepta también arreglo plano legacy).

### 4. Backend — 4 vistas admin (solo lectura de cursos + edición de clases)

Permisos en las 4: `CsrfExemptSessionAuthentication` + `IsAuthenticated + IsAdminUserRole` (`user.role == ROLE_ADMIN`). No profesor → **403** (verificado: profesor en admin → 403). Sin sesión → 403.

| Método | Ruta (bajo `/api/academic/`) | Vista | Notas |
|---|---|---|---|
| GET | `admin/groups/` | `AdminGroupsListView` (`ListAPIView`) | Todos los grupos, `select_related(course, professor, professor__user)`, `annotate(classes_count)`, orden `course__name`. Con búsqueda + paginación |
| GET | `admin/groups/<uuid:group_id>/` | `AdminGroupDetailView` (`RetrieveAPIView`) | Un grupo cualquiera (sin filtro por profesor) |
| GET | `admin/groups/<uuid:group_id>/classes/` | `AdminClassListView` (`ListAPIView`) | Clases del grupo, orden `start_time`. Con búsqueda + paginación. No valida existencia del grupo (lista vacía si el id no existe) |
| GET / PATCH / PUT | `admin/groups/<uuid:group_id>/classes/<uuid:class_id>/` | `AdminClassUpdateView` (`RetrieveUpdateAPIView`, `http_method_names = ["get", "patch", "put", "head", "options"]`) | Solo lectura + edición. `POST`/`DELETE` → **405** |

### 5. Frontend — modales, formularios y nombre limpio

- `components/Modal.js` (reutilizable): overlay `fixed inset-0 bg-black/50`, cierre por click-fuera y `Escape`, `stopPropagation` interno, animación `transition-opacity/transform duration-200`. Sin scroll-lock (ver backlog).
- `components/CreateClassForm.js`: mismo componente para **programar y editar** (prop `initial`; `editing = Boolean(initial)`), y para **profesor y admin** (prop `isAdmin` → llama a `updateGroupClass` o `adminUpdateGroupClass`). Labels/placeholders/`title` en cada campo; QR con `min=1 max=120`, `placeholder="15"`, default `15`, helper `Vida útil del QR`. Muestra errores de `start_time / duration_minutes / qr_duration_minutes / title / detail`.
- `pages/CursoDetalle.js`: botones **[⚡ inmediata][📅 Programar]** lado a lado (`flex gap-2`); programar y editar abren `Modal` con el mismo `CreateClassForm`. Cada fila muestra `QR {c.qr_duration_minutes ?? 15} min` junto a fecha (`formatBogota`), duración y badge `modality · status`.
- `pages/ClaseDetalle.js`: bloque info con fila **Vida útil del QR** (`{classItem.qr_duration_minutes ?? 15} min`). QR y asistencia siguen como placeholders (fuera de alcance, app `attendance`).
- Nombre limpio: `MisCursos`, `CursoDetalle`, `AdminCursos`, `AdminCursoDetalle` y `ClaseDetalle` renderizan **solo `course.name`** (`g.course?.name`) como título. La **sombra backend queda intacta**: `code` autogenerado + `group_code "01"` + `term_period` siguen existiendo y se muestran como metadato (`Grupo … · periodo`), no como título.

### 6. Frontend — admin, buscador y paginación

- `components/Sidebar.js`: tabs `Profesores | Cursos`.
- `components/AdminLayout.js`: tabs `profesores | cursos | curso-detalle-admin`; seleccionar grupo → `curso-detalle-admin`; volver → `cursos`.
- `pages/AdminCursos.js`: todos los grupos con profesor (`full_name · employee_code · email`) + `Grupo … · periodo · N clase(s)`; buscador + paginación.
- `pages/AdminCursoDetalle.js`: read-only salvo **Editar** (abre `Modal` + `CreateClassForm isAdmin`); sin crear/eliminar. Buscador + paginación.
- `components/SearchBar.js` (input controlado) + `utils/useDebounce.js` (300 ms) + `components/Pagination.js` (`← page/total →`, oculta si ≤ 1 página). Patrón en las 4 listas: `search` → `debounced` → `load(debounced, page)`; cambiar búsqueda resetea a página 1.
- `pages/MisCursos.js`: buscador + paginación con `PAGE_SIZE = 9` local para `totalPages` (ver backlog: servidor pagina de 10). Subtítulo con `count` (`N curso(s)`), grid de cards `nombre + N clase(s)`, crear/editar inline/eliminar con `confirm`.
- `services/academic.js`: helpers `params(search, page, pageSize)` + `unwrap(data)`; firmas `getMyGroups(search, page)`, `getGroupClasses(groupId, search, page)`, `adminGetGroups`, `adminGetGroup`, `adminGetGroupClasses`, `adminUpdateGroupClass`; `createInstantClass` envía `{title: "Clase inmediata HH:MM", start_time: nowBogotaISO(), duration_minutes: 60, qr_duration_minutes: 15, modality: "PRESENTIAL"}`.

## Endpoints nuevos / params

Base: `http://localhost:8000`. Solo se listan rutas **nuevas o con params nuevos**; las 8 rutas de sprints previos no cambian.

| Método | Ruta | Permisos | Descripción |
|---|---|---|---|
| GET | `/api/academic/my-groups/?search=&page=&page_size=` | Profesor | **Params nuevos.** Busca por `course__name`, pagina 10/máx 50 |
| GET | `/api/academic/groups/<group_id>/classes/?search=&page=&page_size=` | Profesor | **Params nuevos.** Busca por `title`, pagina 10/máx 50 |
| GET | `/api/academic/admin/groups/?search=&page=&page_size=` | **Admin** | **Nueva.** Todos los grupos (403 si es profesor) |
| GET | `/api/academic/admin/groups/<group_id>/` | **Admin** | **Nueva.** Detalle de cualquier grupo |
| GET | `/api/academic/admin/groups/<group_id>/classes/?search=&page=&page_size=` | **Admin** | **Nueva.** Clases del grupo (búsqueda + paginación) |
| GET / PATCH / PUT | `/api/academic/admin/groups/<group_id>/classes/<class_id>/` | **Admin** | **Nueva.** Leer/editar clase; `POST`/`DELETE` → 405 |

**Ejemplo — crear clase con QR:**

```json
// POST /api/academic/groups/<group_id>/classes/  →  201
{
  "title": "Repaso parcial 2",
  "start_time": "2026-09-28T08:00:00-05:00",
  "duration_minutes": 90,
  "qr_duration_minutes": 15,
  "modality": "PRESENTIAL"
}
```

Omisión de `qr_duration_minutes` → `15`. Fuera de rango (0, 121) → `400`. Respuesta incluye `qr_duration_minutes` y `end_time`.

**Ejemplo — lista paginada:**

```json
// GET /api/academic/my-groups/?search=calculo&page=1  →  200
{
  "count": 23,
  "next": "http://localhost:8000/api/academic/my-groups/?page=2&search=calculo",
  "previous": null,
  "results": [
    {
      "id": "uuid-grupo",
      "course": { "id": "uuid", "code": "CALCUL12AB34CD", "name": "Cálculo I", "description": null },
      "professor": { "full_name": "Ana Pérez", "employee_code": "P001", "email": "a@ut.edu.co" },
      "group_code": "01",
      "term_period": "2026-2",
      "classes_count": 3
    }
  ]
}
```

## Cómo probar los 6 puntos (Docker)

```bash
cp .env.example .env        # POSTGRES_HOST=db dentro de Docker
docker compose up --build -d
docker compose exec backend python manage.py migrate
# Frontend: http://localhost:3000 · Backend: http://localhost:8000
```

1. **Campo QR:** `POST /api/academic/groups/<id>/classes/` con `{"title": "T", "start_time": "<futuro -05:00>", "duration_minutes": 90, "qr_duration_minutes": 5}` → `201` y lo devuelve; con `0` o `121` → `400`; sin el campo → `15`.
2. **Serializers nested:** `GET /api/academic/my-groups/` → cada grupo trae `course.{id,code,name,description}` + `professor.{full_name,employee_code,email}`; `GET .../classes/` → cada clase trae `qr_duration_minutes` + `end_time`.
3. **Búsqueda/paginación:** `GET /api/academic/my-groups/?search=<parte del nombre>` filtra; `?page=2&page_size=5` pagina (`count/next/previous/results`). Igual en `.../classes/?search=<título>` y en las dos listas admin.
4. **Admin:** con sesión admin, `GET /api/academic/admin/groups/` → `200` paginado; `PATCH /api/academic/admin/groups/<g>/classes/<c>/ {"title": "X"}` → `200`; `POST` o `DELETE` a esa última → `405`. Con sesión profesor en cualquier `admin/...` → `403`. Frontend: Admin → Cursos → detalle → solo botón Editar.
5. **Modales/formularios:** profesor → grupo → **[⚡ inmediata]** crea clase `60 min / QR 15` al instante; **[📅 Programar]** abre modal con defaults (hoy, `08:00`, `90`, QR `15`); **Editar** abre el mismo formulario precargado. Títulos de cards muestran solo el nombre del curso.
6. **Verificación del sprint:** `python manage.py check` y `migrate` OK; `npm run build` OK (reportados por el implementador).

## Backlog QA (no bloqueante)

Veredicto **APROBADO**: sin críticos. Deuda registrada para no perderla:

1. **Medio — `PAGE_SIZE` 9 vs 10:** `MisCursos.js` calcula `totalPages` con `PAGE_SIZE = 9` local mientras el servidor pagina de 10 (`StandardResultsPagination`). Las demás listas usan 10. Unificar (usar `page_size=9` explícito o calcular con 10).
2. **Bajo — serializer muerto:** `ProfessorBriefSerializer` definido y sin uso (el anidado lo hace `get_professor`). Eliminar o reutilizar.
3. **Bajo — `count` manual extra:** `MyGroupsListView.create` y `MyGroupDetailView.update` fijan `classes_count` a mano (`0` / `group.classes.count()`) en vez de anotar. Revisar consistencia.
4. **Bajo — admin list sin 404:** `AdminClassListView` filtra por `group_id` sin validar que el grupo exista (id inexistente → lista vacía `200`, no `404`).
5. **Bajo — modal sin scroll-lock:** `Modal.js` cierra con `Escape`/click-fuera y anima, pero no bloquea el scroll del fondo ni devuelve el foco.
6. **Bajo — `fetch` directo:** `ProfConfiguraciones`/`App.js` hacen `fetch` directo bypaseando la instancia axios (`services/api.js`). Migrar a `api`/servicios.

Deuda previa vigente: ver Backlog en [`docs/SPRINT-panel-profesor.md`](SPRINT-panel-profesor.md) y [`docs/SPRINT-crud-profesor.md`](SPRINT-crud-profesor.md) (p. ej. estrategia CSRF definitiva con `CsrfExemptSessionAuthentication`).
