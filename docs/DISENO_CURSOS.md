# Rediseño sección Cursos — `f970836` (QA APROBADO)

**Rama:** `feature/integracion` · **Commit:** `f970836` — `feat(cursos): rediseno seccion cursos…`
**Base:** `61d2c7e` (fix QA integración) · **Alcance:** 8 archivos frontend, solo JSX/clases.
**Veredicto QA:** APROBADO (3 medios + 5 bajos no bloqueantes, ver §7).
**Detalle integración general:** [`docs/INTEGRACION_FRONTEND.md`](INTEGRACION_FRONTEND.md).

> Solo presentación. Sin cambios en `backend/`, `services/`, `context/`, `utils/`, `hooks/`, `compose` ni dependencias.

## 1. Qué cambió por archivo (8)

| Archivo | Cambio | Intacto |
|---|---|---|
| `components/SearchBar.js` | Input `type="search"` con lupa (svg) + botón clear `×` (`aria-label="Limpiar búsqueda"`). `useId()` + `<label sr-only>`. Estilo `rounded-xl slate + focus #B3200E`. | Firma `{value, onChange, placeholder}`; sin debounce interno |
| `components/Modal.js` | `max-w-lg → max-w-xl`, `rounded-2xl p-4/sm:p-6`, header con icono + título `truncate`. `role="dialog" aria-modal + aria-label`. Autofoco primer campo (`setTimeout 0`) + retorno de foco al cerrar. ESC por `window keydown`. Prop nueva `icon`. | Cierre por overlay + `stopPropagation`; firma `{title, onClose, children}` compatible |
| `components/Pagination.js` | Alineación `justify-end`, colores `slate`, `aria-label` anterior/siguiente, `aria-live="polite"` en `page/total`. Prop nueva `countLabel` (`· N curso(s)/clase(s)`). `disabled:cursor-not-allowed` + anillos de foco. | Firma `{page, totalPages, onChange}` compatible; oculta si ≤ 1 página |
| `components/CreateClassForm.js` | Re-maquetado completo: Título primero + helpers por campo; `htmlFor/useId` + `aria-invalid/describedby`; modalidad `select → radiogroup` segmentado Presencial/Virtual; error en `role="alert"`; footer `justify-end` Cancelar (secundaria) + Crear (primaria). | Payloads (`createGroupClass` / `updateGroupClass` / `adminUpdateGroupClass`, `combineDateTimeToISO`, `qr_duration ?? 10`, `min 1 max 120`) sin cambios |
| `pages/MisCursos.js` | Header-card (`section rounded-2xl`) + toolbar sticky + grid `md:grid-cols-2` + crear en `Modal "Nuevo curso"`. Skeleton `animate-pulse` (3 cards) y empty `📚 + CTA`. Cards con footer `Editar / Eliminar / Ver` (+ `border-t`). `Pagination countLabel`. | `PAGE_SIZE=9`, `useDebounce 300`, `load(debounced, page)`, `handleCreate` append, `confirm` eliminar |
| `pages/AdminCursos.js` | Igual patrón: header-card + toolbar sticky (`md:max-w-sm`) + skeleton + empty `📚` + cards `aria-label="Ver …"` + `Pagination countLabel`. Error en `role="alert"`. | `getAdminGroups`, búsqueda resetea `page=1`, `totalPages count/10` |
| `pages/CursoDetalle.js` | Header-card con `ProfHeader` + inmediata en `<details>` colapsable (`⚡ Inmediata ▾` con `instant-title/instant-ttl`) + `📅 Programar` primaria. Toolbar sticky con `SearchBar + Filtrar vista` (`statusView`). Grid 2 col, skeleton 3 cards, empty `📅 + Programar primera clase`. Pills separadas modalidad/estado (ver tokens). Acciones `Editar / Eliminar / Ver` con `aria-label`. | `load`, `debounce 300`, `handleInstant` + reconciliación `ttl_minutes`, `formatBogota`, `qr ?? 10`, polling profesor 30 s heredado |
| `pages/AdminCursoDetalle.js` | Igual que `CursoDetalle` menos crear/eliminar/inmediata: header-card + `← Volver` rojo + toolbar + `Filtrar vista` + grid + skeleton/empty + pills + solo `Editar` (+ `Ver` decorativo). | `adminGetGroupClasses`, `isAdmin` en `CreateClassForm`, `totalPages count/10` |

## 2. Antes / después (layout)

| Zona | Antes | Después |
|---|---|---|
| Encabezado | `h2 text-xl gray` suelto + `p text-sm gray-500` | `section bg-white rounded-2xl border-slate-200 shadow-sm p-5` con título `text-2xl slate-800` |
| Toolbar | `div mb-4` plano, buscador `w-full md:w-64` | `sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3` + buscador en `md:max-w-sm`; en detalle: `flex-col md:flex-row` con `Filtrar vista` |
| Listas | `space-y-3` vertical, cards `rounded-xl gray-100 hover:border-blue-300` | `grid gap-4 md:grid-cols-2`, cards `rounded-2xl slate-200 hover:shadow-md hover:border-[#B3200E]/30 transition` |
| Crear | Inline (`div mb-4`) en `MisCursos`; inmediata siempre visible en `CursoDetalle` | `Modal max-w-xl` (`Nuevo curso` / `Programar clase` / `Editar clase`); inmediata en `<details>` colapsable |
| Estados | `p text-gray-500` (cargando/vacío), error `text-red-600` | Skeleton `animate-pulse` 3 cards; empty card `📚/📅 + CTA`; error `role="alert" border-red-200 bg-red-50` |
| Clases | Badge único `modality · status` gris/rojo | Dos pills separadas + filtro vista `ALL/SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED` |

## 3. Tokens

- **Primaria:** `bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl` + `focus-visible:ring-[#B3200E]/40`. Usada en: `+ Nuevo curso`, `Programar`, `Crear ahora` (variante borde), `Programar primera clase`, submit `Crear clase/Guardar`.
- **Secundaria:** `bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl` (Cancelar, `Ver`, `Crear ahora` inmediata). Terciaria: `bg-slate-100 hover:bg-slate-200 text-slate-700` (Editar, paginación). Destructiva tenue: `bg-red-50 hover:bg-red-100 text-red-700` (Eliminar).
- **Fondo toolbar:** `bg-[#F8FAFC]/95 backdrop-blur rounded-xl`. Cards: `bg-white rounded-2xl border-slate-200 shadow-sm`. Texto: `slate-800` títulos / `slate-500/600` meta.
- **Pills estado** (`text-xs px-2 py-1 rounded-full border`): `SCHEDULED amber`, `IN_PROGRESS emerald`, `COMPLETED slate-100/slate-600` (antes rojo — ahora distinto de CANCELLED), `CANCELLED red-50/red-700`. Modalidad: `slate-100/slate-600` siempre.
- **Foco:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40` en botones/inputs/selects; inputs `focus:border-[#B3200E] focus:ring-2 focus:ring-[#B3200E]/20`. **No hay `tailwind.config.js` nuevo:** es uso de arbitrarios + paleta `slate` estándar.

## 4. Accesibilidad

- Labels reales (`htmlFor` + `useId`) en `SearchBar` (`sr-only`), `CreateClassForm` (título/fecha/hora/duración/TTL), `Filtrar vista`, `instant-title/instant-ttl`; `fieldset/legend + radiogroup` en modalidad.
- `Modal`: `role="dialog" aria-modal="true" aria-label=<título>`; ESC cierra; autofoco al primer campo; retorno de foco al disparador (mejora M5 previa). **Pendiente:** trampa de `Tab` (ver §7).
- `aria-label="Ver/Editar/Eliminar <nombre>"` en cards; `aria-label` anterior/siguiente + `aria-live="polite"` en paginación; `role="alert"` + `aria-describedby/errorId` + `aria-invalid` en formularios.
- `type="search"`, `maxLength`, `min/max`, `disabled:opacity-50 + cursor-not-allowed`, iconos decorativos con `aria-hidden`.

## 5. Contrato preservado (sin regresión)

- **Diff vacío verificado:** `git diff 61d2c7e..f970836 -- backend/ frontend/src/services/ frontend/src/context/ frontend/src/utils/ frontend/src/hooks/` → 0 líneas.
- **Payloads idénticos:** `createMyGroup(name)`, `createGroupClass/updateGroupClass/adminUpdateGroupClass`, inmediata (`title/TTL/duration/modality`), `qr_duration_minutes ?? 10`, `min 1–max 120`, `combineDateTimeToISO + todayISODate`, `formatBogota`.
- **Comportamiento intacto:** `useDebounce(search, 300)`, búsqueda resetea `page=1`, `totalPages = ceil(count/10)` (detalle/admin) y `ceil(count/9)` en `MisCursos` (deuda previa), polling profesor 30 s / lista viva heredados, `sessionStorage`/CSRF/OIDC sin tocar.

## 6. Verificación

```bash
git checkout feature/integracion
git diff 61d2c7e..f970836 --stat   # 8 archivos frontend, 628+/169-
# Contrato:
git diff 61d2c7e..f970836 -- backend/ frontend/src/services/ frontend/src/context/ frontend/src/utils/ frontend/src/hooks/
# Backend / frontend:
python manage.py check            # esperado: 0 errores
python manage.py migrate          # esperado: sin migraciones nuevas
npm run build                     # esperado: OK (CRA 5)
docker compose up --build -d      # db :5432 · backend :8000 · frontend :3000
```

> Nota tech-writer: verificación funcional completa en manos de QA (veredicto APROBADO); este doc no altera código, solo registra el cambio. Re-ejecutar `check/migrate/build` antes de merge.

## 7. Hallazgos QA pendientes (follow-up, no bloqueantes)

**Medios (3):**

1. `PAGE_SIZE 9 vs 10` — `MisCursos` calcula `totalPages` con 9 local; servidor pagina de 10. Heredado de sprint anterior, sigue vigente. Unificar (`page_size=9` explícito o calcular con 10).
2. `statusView` solo filtra la página actual (cliente), no todo el `count`. Aceptado como "vista rápida"; si se quiere filtro real, pasar `status` al API o filtrar tras cargar todas.
3. `handleCreate` hace `append` (`setGroups(prev => [...prev, created])`) sin `load()` ni actualizar `count`. Al crear en página 1+ o con búsqueda activa el total queda desfasado. Follow-up: `load()` + `setCount(c+1)` o invalidar página.

**Bajos (5):**

4. Copy del empty en `MisCursos`: el CTA dice `Programar primera clase` cuando crea un **curso**. Cambiar a `Crear primer curso`.
5. Sin trampa de `Tab` en `Modal` (solo ESC + autofoco + retorno). Añadir focus-trap + scroll-lock.
6. `noValidate={false}` explícito en `CreateClassForm` (ruido; es el default). Quitar prop o fijar `noValidate` si se quiere validación solo custom.
7. `CourseForm` (nombre de curso) preexistente sin retocar: sin `htmlFor`, sin `role="alert"`, inline. Homologar con `CreateClassForm`.
8. `Pagination countLabel` muestra el `count` total aunque `statusView` filtra la vista (ej. `12 clase(s)` viendo 3). Aclarar copy (`12 en total`) o contar visibles.

## 8. Cómo probar (15 min)

| # | Prueba | Pasos | Esperado |
|---|---|---|---|
| 1 | Crear inmediata | Profesor → grupo → `⚡ Inmediata` → despliega → `Crear ahora` (con/sin título, TTL 10) | Clase creada < 3 s, aparece en grid con pill `Programada/En progreso`, QR `10 min` |
| 2 | Programar | `📅 Programar` → modal `max-w-xl` → fecha/hora/título/duración/TTL/modalidad → `Crear clase` | `201`, cierra modal, foco vuelve a `📅 Programar`, aparece en lista |
| 3 | Editar | `Editar` en card → modal precargado → cambiar título/TTL → `Guardar cambios` | `PATCH/PUT 200`, refleja cambio sin reload |
| 4 | Buscar | Toolbar → escribir `calculo` (lupa visible) → `×` limpia | Filtra con debounce 300 ms, `page=1`; limpiar restaura |
| 5 | Paginar | Con > 10 clases/cursos → `← 1/2 →` + `countLabel` | Cambia página, `aria-live` anuncia, oculta si 1 página |
| 6 | Filtrar vista | `Filtrar vista: Canceladas/Finalizadas` | Solo pills de ese estado en la página actual (limitación conocida §7.2) |
| 7 | Admin | `/admin` → Cursos → detalle | Solo `Editar`; sin `📅/⚡/Eliminar`; pills `COMPLETED slate` ≠ `CANCELLED rojo` |
| 8 | Responsive | 360 px / 768 px / 1280 px | 360: 1 col, toolbar apilada, modal `calc(100dvh-2rem)` con scroll; 768+: 2 col; `break-words` sin overflow |
| 9 | Teclado | `Tab` hasta `+ Nuevo curso/Ver` → `Enter` → `ESC` | Foco visible (anillo rojo), modal autofoca primer input, `ESC` cierra y devuelve foco |
| 10 | Vacío/error | Grupo sin clases; cortar backend | Empty `📅 + Programar primera clase`; error en caja roja `role="alert"` |
