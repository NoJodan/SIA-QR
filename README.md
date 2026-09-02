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

## Notas

- El `.env` vive en la raíz del repo (ignorado por git). `POSTGRES_*` solo se aplican al crear el contenedor de Postgres; cambiarlos después requiere `docker compose down -v`.
- Los contenedores montan el código local (`./backend:/app`, `./frontend:/app`), por lo que los cambios se reflejan con hot-reload.
- Para ejecutar sin Docker (backend en el host), cambiar `POSTGRES_HOST=localhost` en `.env`, y desde `backend/` correr `python manage.py runserver 0.0.0.0:8000`.