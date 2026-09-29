# Fix: IntegrityError en login Google de profesor en whitelist

**Fecha:** 2026-09-29 · **Estado:** implementado · **Veredicto QA:** APROBADO
**Ruta afectada:** `GET /api/auth/google/login/callback/` (flujo `pre_social_login`)
**Error:** `IntegrityError at /api/auth/google/login/callback/ — FK professors_user_id_fkey`
**Alcance:** solo login de profesor whitelisteado; sin migraciones nuevas.

## 1. Causa

`pre_social_login` en `backend/apps/authentication/adapters.py` creaba el
`Professor` con `get_or_create(user=...)` usando el `User` **transient** de
allauth (aún no insertado en `users`). Como el PK es `UUID` con
`default=uuid.uuid4`, el objeto transient ya trae `pk` truthy, así que el
chequeo `getattr(existing, "pk", None)` lo confundía con un usuario existente.
El `INSERT` en `professors` referenciaba un `user_id` inexistente → violación
de `professors_user_id_fkey`.

Efecto colateral: los intentos fallidos podían dejar filas huérfanas en
`professors` (ver §5 limpieza).

## 2. Solución por archivo

**`backend/apps/authentication/adapters.py`** (núcleo del fix):

- Nuevo helper `_is_persisted_user(sociallogin, existing, email)`: distingue
  transient vs existente combinando `sociallogin.is_existing` +
  `existing._state.adding` + `EXISTS` en BD por pk y por email (solo `SELECT`,
  sin `INSERT`). No basta con mirar `pk` por el default UUID.
- `pre_social_login`: dos ramas.
  - **Nueva (transient):** solo muta en memoria (`existing.role = PROFESSOR`),
    sin `save()`, sin `get_or_create()`, sin ningún `INSERT`.
  - **Existente:** reconcilia rol + `ensure Professor` dentro de
    `transaction.atomic()`, con reintento ante `IntegrityError` por carrera.
- Guard `ADMIN`: un `ADMIN` en whitelist por error nunca se degrada a
  `PROFESSOR` (mismo guard que `views.py`).
- `save_user`: crea `User → Professor` en orden válido dentro de `atomic`;
  ante `IntegrityError` por doble callback concurrente (`email`/`google_sub`
  `UNIQUE`) reconcilia idempotentemente (busca por `email__iexact` o
  `google_sub`) o redirige a `/login?error=account_exists`. Maneja también
  `Professor.DoesNotExist` de forma tolerante (nunca 500 en login).
- `populate_user`: puro (normaliza email, asigna rol por whitelist con
  `iexact`), sin `INSERT` ni `save()`.

**`backend/apps/authentication/views.py`:**

- `_ensure_professor_profile` y `reconcile_professor_role`:
  `get_or_create + atomic` idempotente, reintento con `get` ante
  `IntegrityError`, lectura final tolerante (nunca 500).
- `professors_whitelist` `POST`: `get_or_create` + `atomic` (idempotente).
- `DELETE`: filtro `email__iexact` y degradación con
  `.exclude(role=ADMIN)` — nunca degrada `ADMIN`.

**`backend/apps/authentication/tests.py`** (7 tests nuevos, 17/17 verde):

- `ProfessorWhitelistAdapterTests`: transient no crea `Professor` (solo setea
  rol), pk transient truthy no se confunde con existente, `save_user` crea
  `User` y `Professor` en orden válido, reconciliación existente
  `STUDENT → PROFESSOR`, `reconcile_professor_role` solo promueve (nunca
  degrada), relogin idempotente (un solo `Professor`), doble `save_user` con
  mismo email no revienta.

## 3. Cómo reintentar el login

1. Aplicar la limpieza SQL del §5 si hubo intentos fallidos previos (filas
   huérfanas bloquean/confunden el reintento).
2. Verificar que el correo esté en la whitelist (`GET /api/auth/...` admin o
   tabla `authorized_professor_emails`).
3. Reintentar el flujo normal: Frontend → Login con Google
   (`/api/auth/google/login/callback/`) → redirección al frontend `/`.
4. Verificar: `GET /api/auth/me/` debe devolver `"role": "PROFESSOR"` con el
   perfil anidado; no debe aparecer `IntegrityError` en los logs del backend
   (`docker compose logs -f backend`).

## 4. Verificaciones

```bash
# Desde backend/
python manage.py check     # 0 errores
python manage.py migrate   # sin migraciones nuevas, OK
python manage.py test apps.authentication  # 17/17 OK (7 nuevos del fix)
```

## 5. Limpieza de huérfanos

Filas en `professors` cuyo `user_id` no existe en `users` (dejadas por los
intentos fallidos previos al fix):

```sql
-- Inspeccionar
SELECT id, user_id, employee_code
FROM professors
WHERE user_id NOT IN (SELECT id FROM users);

-- Eliminar
DELETE FROM professors
WHERE user_id NOT IN (SELECT id FROM users);
```

## 6. Notas futuras de QA (no bloqueantes)

1. `POST` whitelist es case-sensitive al detectar duplicados: normaliza con
   `.strip().lower()` al guardar pero el chequeo de duplicado debería usar
   `email__iexact` para `Foo@UT.edu.co` vs `foo@ut.edu.co`.
2. Fallback `save_user` sin `SocialAccount` conectada: si la reconciliación por
   carrera (`IntegrityError` en doble callback) no encuentra el `User` por
   `email`/`google_sub`, considerar vincular/crear el `SocialAccount`
   correspondiente en lugar de solo redirigir a `?error=account_exists`.
