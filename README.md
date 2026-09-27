# SIA-QR

**Sistema de Asistencia Académica por Código QR.**

Plataforma web para digitalizar el registro de asistencia en entornos universitarios. Reemplaza las firmas en papel mediante códigos QR dinámicos, autenticación única con **Google** restringida al dominio institucional `@ut.edu.co`, captura opcional de geolocalización y listado de asistencia en tiempo real.


## Stack tecnológico

- **Backend:** Python 3.12 · Django + Django REST Framework
- **Frontend:** React 18 (JavaScript con Create React App)
- **Base de datos:** PostgreSQL 16 · Docker Compose

## Estructura del proyecto

```
SIA-QR/
├── docker-compose.yml        # Servicios: db (Postgres 16), backend, frontend
├── .env.example              # Variables de configuración (Postgres, Django)
├── SIA-QR.md                 # Especificación funcional y arquitectónica
├── backend/                  # Django (proyecto: sia_qr)
│   ├── sia_qr/               # Configuración (settings, urls)
│   └── apps/                 # Aplicaciones del proyecto
│       ├── authentication/   # Usuarios, profesores, estudiantes
│       ├── academic/         # Cursos, grupos, clases
│       └── attendance/       # Sesiones QR y marcaciones (núcleo)
└── frontend/                 # React (Create React App)
    └── src/
        ├── components/       # UI reutilizable
        ├── pages/            # Vistas (Login, AdminPanel, AttendQR)
        ├── services/         # Llamadas Axios a la API
        ├── context/          # Estado global (ej. AuthContext)
        └── utils/            # Helpers y validaciones
```

## Requisitos previos

- [Docker](https://www.docker.com/products/docker-desktop/) (con Docker Compose)
- Git

## Puesta en marcha con Docker

1. **Clonar el repositorio y entrar al proyecto:**

   ```bash
   git clone <url-del-repositorio> SIA-QR
   cd SIA-QR
   ```

2. **Crear el archivo `.env` desde la plantilla:**

   ```bash
   cp .env.example .env
   ```

   Dentro de Docker, `POSTGRES_HOST=db` (nombre del servicio Postgres) es el valor correcto.

3. **Levantar los servicios (crea las imágenes y arranca Postgres, backend y frontend):**

   ```bash
   docker compose up --build -d
   ```

4. **Aplicar las migraciones iniciales** (una sola vez; requerido para admin/auth/sessions):

   ```bash
   docker compose exec backend python manage.py migrate
   ```

5. **Acceder a la aplicación:**

   | Servicio  | URL                              |
   |-----------|----------------------------------|
   | Frontend  | http://localhost:3000            |
   | Backend   | http://localhost:8000            |
   | Admin     | http://localhost:8000/admin      |

## Comandos útiles

- Ver logs de un servicio: `docker compose logs -f backend` (o `frontend`, `db`)
- Detener los contenedores: `docker compose down`
- Volver a arrancar: `docker compose up -d`
- **Reset completo** (borra el volumen `postgres_data`): `docker compose down -v`

## Panel Profesor (sprint actual)

Entregado y aprobado por QA: **Mis Cursos y programación de clases** (RF-PROF-02, RF-PROF-03).

- `GET /api/academic/my-groups/` — grupos del profesor autenticado.
- `GET` / `POST /api/academic/groups/<uuid:group_id>/classes/` — listar y programar clases (`status` siempre `SCHEDULED`; 404 si el grupo es ajeno; anónimo → 403).
- Frontend: Login → Mis Cursos → Detalle del grupo (polling 30 s) → crear clase de hoy.
- Detalle completo (request/response, modelos, cómo probar, backlog QA): [`docs/SPRINT-panel-profesor.md`](docs/SPRINT-panel-profesor.md).

**Evolución CRUD** (aprobada por QA, sin migraciones nuevas): crear cursos solo con `{name}` (`code`/`01`/`term` auto), renombrar/eliminar (cascada + curso huérfano), detalle/actualizar/eliminar clase con doble filtro ownership, botón ⚡ clase inmediata (ahora Bogotá, 60 min, `PRESENTIAL`), vista `ClaseDetalle` (QR y asistencia como placeholders vacíos).
Rutas nuevas: `POST my-groups/`, `GET/PATCH/PUT/DELETE my-groups/<id>/`, `GET/PATCH/PUT/DELETE groups/<id>/classes/<class_id>/` (ajeno → 404, anónimo → 403).
Detalle: [`docs/SPRINT-crud-profesor.md`](docs/SPRINT-crud-profesor.md).

**Mejoras Cursos** (aprobada por QA, 1 migración `0002`): campo `qr_duration_minutes` (default 15, 1–120) en clases, serializer de grupo con `professor` anidado, paginación 10/máx 50 + `?search` (`course__name` en grupos, `title` en clases), 4 rutas admin `admin/groups/*` (list/detail grupos, list/update clases solo get/patch/put → POST/DELETE 405, rol admin; profesor → 403), frontend con `Modal` animado, `CreateClassForm` (programar/editar, profesor/admin) con QR 15, botones [⚡ inmediata][📅 Programar], buscador con debounce + paginación y módulo Admin Cursos (read-only + editar).
Detalle: [`docs/SPRINT-mejoras-cursos.md`](docs/SPRINT-mejoras-cursos.md).

## Asistencia por QR v2.1 (sprint actual, sin export, QR 100 % automático + fix inmediata §7.8)

Entregado y aprobado por QA (auto-QR con residuales menores no bloqueantes R1–R5) + **fix inmediata APROBADO (solo frontend, ver §7.8)**: **núcleo de asistencia** (RF-EST-01–06, RF-PROF-04–07 parcial; RF-PROF-09 export fuera de alcance) + **QR automático sin botón Generar**.

- **Backend:** `Student` (perfil real vía `PATCH /me`, sin autocreación), `AttendanceSession` (token SHA-256, **single-active** Opción A con `UniqueConstraint` parcial + `select_for_update`), `Attendance` (`UNIQUE` sesión–estudiante, geo opcional), `SystemConfig[QR_DEFAULT_MINUTES]`; `reconcile_professor_role` (promoción por whitelist en `GET/PATCH /me`); revocación de QR al cerrar la clase.
- **Endpoints base:** A1 `POST groups/<g>/classes/<c>/sessions/` (ahora fallback interno, la UI no lo llama) · A2 `GET /api/attendance/sessions/<s>/attendances/` (lista viva paginada, sin lat/long) · B1 `GET /api/attendance/resolve/?token=` · B2 `POST /api/attendance/mark/` (idempotente; **412 + needs_profile** sin perfil) · B3 `POST groups/<g>/classes/instant/` (clase `IN_PROGRESS` + QR atómicos, intacta) · `GET /api/auth/csrf/` + `PATCH /me`.
- **Auto-QR v2.1:** `GET groups/<g>/classes/<c>/current-session/` (lazy ensure: `200 live` / `202 pending {starts_in_s}` / `410 finished`, `Cache-Control: no-store`, GET exento de CSRF) + `POST .../current-session/rotate/` (**Mostrar en este dispositivo**, `201` con QR nuevo que revoca el anterior, con CSRF). Auto-rotación por expiración en ventana, cierre lazy a `COMPLETED`, ventana `[start − gracia, end)` con `EARLY_QR_GRACE_SECONDS` (default 30 s, `SystemConfig` > env, 0–300), timezone `America/Bogota` aware. Errores: 401/403/404/**409**/**410**/**503** (+ `Retry-After: 10`).
- **Frontend:** `/attend?token=` (login Google con reanudación, `StudentProfileForm`, geo opcional, MARCAR; ante **410** re-escanear el QR vigente) · `QrDisplay` (`qrcode.react`, countdown, token nunca impreso) · `ClaseDetalle` (**sin botón Generar**: fases `pending/live/finished`, caché `sessionStorage` por pestaña, polling ensure 10 s + lista 5 s sin reload, botón **Mostrar en este dispositivo**) · instantánea con título/TTL en `CursoDetalle` · `api.js` con CSRF (`REACT_APP_API_BASE`).
- **Fix inmediata §7.8 (solo frontend, QA APROBADO):** corregida pérdida de `data.session` B3 al navegar (`CursoDetalle` propaga `initialSession` → `ProfLayout selectClass(class, initialSession)+key+limpieza` → `ClaseDetalle` init `live` + `saveCached` + guard mismo `session_id`). Resultado: QR < 3 s 0 rotate, reload conserva, segundo dispositivo sí avisa + Rota, programada intacta.
- **Seguridad:** `SessionAuthentication401` (sesión + CSRF, anónimo → 401), cookies `Secure/HttpOnly/SameSite`, `CSRF_TRUSTED_ORIGINS` debe incluir el origen del SPA.
- **Verificación:** `check` 0 errores · `migrate` (sin migraciones nuevas en v2.1) · 45 tests OK · `npm run build` OK. Post-fix §7.8: `check` OK + `build` OK; `migrate`/tests completos **pendientes en Docker**.
- Detalle completo (guía profesor/estudiante auto-QR, request/response, tabla de errores 401/403/404/409/410/503, env `EARLY_QR_GRACE_SECONDS`, ventana/gracia, E2E, residuales R1–R5, **bugfix inmediata §7.8 y pendientes §7.9**): [`docs/SPRINT-asistencia-qr.md`](docs/SPRINT-asistencia-qr.md).

## Notas

- El `.env` vive en la raíz del repo (ignorado por git). `POSTGRES_*` solo se aplican al crear el contenedor de Postgres; cambiarlos después requiere `docker compose down -v`.
- Los contenedores montan el código local (`./backend:/app`, `./frontend:/app`), por lo que los cambios se reflejan con hot-reload.
- Para ejecutar sin Docker (backend en el host), cambiar `POSTGRES_HOST=localhost` en `.env`, y desde `backend/` correr `python manage.py runserver 0.0.0.0:8000`.