# SIA-QR

**Sistema de Información de Asistencia por Código QR** para entornos universitarios.

Plataforma web que reemplaza las firmas de asistencia en papel por códigos QR dinámicos. Los estudiantes firman escaneando el QR proyectado en clase; los profesores programan clases, visualizan la asistencia en vivo y generan reportes. Autenticación única con **Google**, restringida al dominio institucional `@ut.edu.co`.

## Características

- **Firma de asistencia por QR**: cada clase genera un código QR único con vigencia limitada (anti-reutilización); el estudiante lo escanea y firma desde su celular.
- **Autenticación con Google**: sin contraseñas; el acceso se limita al dominio institucional configurable.
- **Roles**: estudiante, profesor y administrador, cada uno con su panel y permisos.
- **Gestión académica**: cursos, grupos, programación de clases presenciales o virtuales y clases inmediatas.
- **Lista de asistencia en vivo**: el profesor ve quién firma en tiempo real durante la clase.
- **Geolocalización opcional**: se registra como referencia, nunca bloquea la firma.
- **Reportes de asistencia**: consulta y exportación por curso, grupo o clase.
- **Perfil de estudiante**: registro de datos institucionales (documento, código, teléfono, dirección) con validación en backend.

## Stack tecnológico

| Capa     | Tecnología                                          |
|----------|-----------------------------------------------------|
| Backend  | Python 3.12 · Django + Django REST Framework       |
| Frontend | React 18 (JavaScript, Create React App)            |
| Base de datos | PostgreSQL 16                                  |
| Orquestación | Docker Compose                                  |

Sin Redis ni servicios externos adicionales: el backend, la base de datos y el frontend son todo lo necesario.

## Estructura del proyecto

```
SIA-QR/
├── docker-compose.yml   # Servicios: db (Postgres 16), backend, frontend
├── .env.example         # Plantilla de variables de configuración
├── SIA-QR.md            # Especificación funcional y arquitectónica
├── backend/             # Django (proyecto: sia_qr)
│   ├── sia_qr/          # Configuración (settings, urls)
│   └── apps/
│       ├── authentication/  # Usuarios, profesores, estudiantes, login Google
│       ├── academic/        # Cursos, grupos académicos, clases
│       └── attendance/      # Sesiones QR, marcaciones y reportes (núcleo)
└── frontend/            # React (Create React App)
    └── src/
        ├── components/  # UI reutilizable (QR, modales, formularios)
        ├── pages/       # Vistas por rol (Login, MisCursos, AttendQR, Reportes…)
        ├── services/    # Llamadas Axios a la API
        ├── context/     # Estado global (ej. AuthContext)
        └── utils/       # Helpers (fechas, validaciones)
```

## Requisitos previos

- [Docker](https://www.docker.com/products/docker-desktop/) con Docker Compose
- Git

## Instalación y puesta en marcha

1. **Clonar el repositorio:**

   ```bash
   git clone <url-del-repositorio> SIA-QR
   cd SIA-QR
   ```

2. **Crear el archivo `.env` desde la plantilla:**

   ```bash
   cp .env.example .env
   ```

   Dentro de Docker, `POSTGRES_HOST=db` (nombre del servicio Postgres) es el valor correcto.

3. **Levantar los servicios:**

   ```bash
   docker compose up --build -d
   ```

4. **Aplicar las migraciones** (una sola vez, requerido para admin/auth/sessions):

   ```bash
   docker compose exec backend python manage.py migrate
   ```

5. **Acceder a la aplicación:**

   | Servicio | URL                         |
   |----------|-----------------------------|
   | Frontend | http://localhost:3000       |
   | Backend  | http://localhost:8000       |
   | Admin    | http://localhost:8000/admin |

## Uso

- **Estudiante**: abre el enlace del QR (`/attend?token=…`), inicia sesión con su cuenta institucional de Google, completa su perfil una sola vez y pulsa para firmar. Si no tiene perfil completo, la aplicación se lo pide antes de firmar.
- **Profesor**: inicia sesión, entra a **Mis Cursos**, programa clases o crea una clase inmediata; durante la clase muestra el QR y ve la lista de asistencia actualizarse en vivo.
- **Administrador**: gestiona cursos y usuarios desde el panel admin de Django y el módulo de administración del frontend.

## Configuración

El `.env` vive en la raíz del repo (ignorado por git). Variables principales:

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_DB/USER/PASSWORD/HOST/PORT` | Conexión a Postgres (`HOST=db` en Docker, `localhost` sin Docker) |
| `DJANGO_SECRET_KEY` | Obligatoria en producción (`DEBUG=False`) |
| `DJANGO_DEBUG` / `DJANGO_ALLOWED_HOSTS` | Modo y hosts permitidos |
| `CORS_ALLOWED_ORIGINS` | Orígenes del frontend (por defecto `http://localhost:3000`) |
| `FRONTEND_URL` | URL pública del frontend, usada para construir los enlaces del QR |
| `QR_DEFAULT_MINUTES` | Vigencia por defecto de las sesiones QR (1–120 min) |
| `EARLY_QR_GRACE_SECONDS` | Antelación con la que el QR se activa antes del inicio (0–300 s) |

> Los valores `POSTGRES_*` solo se aplican al crear el contenedor de Postgres; cambiarlos después requiere `docker compose down -v` (borra los datos).

## Desarrollo local sin Docker

- **Backend**: desde `backend/`, con `POSTGRES_HOST=localhost` en el `.env`:
  ```bash
  python manage.py runserver 0.0.0.0:8000
  ```
- **Frontend**: desde `frontend/`:
  ```bash
  npm install && npm start
  ```
- Los contenedores montan el código local (`./backend:/app`, `./frontend:/app`), así que los cambios se reflejan con hot-reload.

## Comandos útiles

```bash
docker compose logs -f backend    # Logs de un servicio (backend, frontend, db)
docker compose up -d              # Volver a arrancar
docker compose down               # Detener los contenedores
docker compose down -v            # Reset completo (borra postgres_data)
```

## Verificación

```bash
python manage.py check            # Chequeo del backend (desde backend/)
python manage.py migrate          # Aplica migraciones pendientes
npm run build                     # Valida que el frontend compila (desde frontend/)
```
