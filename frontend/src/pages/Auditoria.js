import React, { useCallback, useEffect, useRef, useState } from "react";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import Skeleton from "../components/Skeleton";
import { MetricCard } from "../components/StatsPanels";
import { fetchAuditLogs } from "../services/attendance";
import { getStats } from "../services/stats";
import { formatBogotaDate, formatBogotaTime, todayISODate } from "../utils/dates";

const PAGE_SIZE = 10;

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20";
const labelCls = "mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600";
const primaryBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#B3200E] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40";

const ROLE_LABELS = {
  ROLE_PROFESSOR: "Profesor",
  ROLE_ADMIN: "Administrador",
  ROLE_STUDENT: "Estudiante",
};

const CHIP_GREEN = "border border-emerald-200 bg-emerald-50 text-emerald-700";
const CHIP_BLUE = "border border-blue-200 bg-blue-50 text-blue-700";
const CHIP_RED = "border border-red-200 bg-red-50 text-red-700";
const CHIP_AMBER = "border border-amber-200 bg-amber-50 text-amber-700";
const CHIP_SLATE = "border border-slate-200 bg-slate-100 text-slate-600";

// Chip de acción derivado del sufijo de event_type (creación/edición/borrado)
// más los eventos sin sufijo que emite el backend.
function actionMeta(eventType) {
  const et = eventType || "";
  if (et.endsWith("_created")) return { label: "Crear", cls: CHIP_GREEN };
  if (et.endsWith("_updated")) return { label: "Editar", cls: CHIP_BLUE };
  if (et.endsWith("_deleted")) return { label: "Eliminar", cls: CHIP_RED };
  if (et.startsWith("login")) return { label: "Acceso", cls: CHIP_SLATE };
  if (et === "whitelist_added") return { label: "Agregar", cls: CHIP_AMBER };
  if (et === "whitelist_removed") return { label: "Quitar", cls: CHIP_AMBER };
  if (et === "attendance_marked") return { label: "Registrar", cls: CHIP_AMBER };
  if (et === "attendance_duplicate") return { label: "Duplicado", cls: CHIP_AMBER };
  if (et === "qr_rotated") return { label: "Rotar", cls: CHIP_AMBER };
  if (et === "admin_clear_users") return { label: "Limpieza", cls: CHIP_SLATE };
  return { label: "Acción", cls: CHIP_AMBER };
}

// Módulo en español con icono, derivado del event_type (recurso como respaldo).
function moduleMeta(eventType, resource) {
  const et = eventType || "";
  if (et.startsWith("group_")) return { label: "Cursos", icon: "fa-book-open" };
  if (et.startsWith("class_")) return { label: "Clases", icon: "fa-calendar-days" };
  if (et.startsWith("attendance_")) return { label: "Asistencia", icon: "fa-user-check" };
  if (et === "qr_rotated") return { label: "Sesión QR", icon: "fa-qrcode" };
  if (et.startsWith("whitelist_")) return { label: "Profesores", icon: "fa-chalkboard-user" };
  if (et.startsWith("admin_student_")) return { label: "Estudiantes", icon: "fa-user-graduate" };
  if (et.startsWith("student_profile_")) return { label: "Perfil", icon: "fa-id-card" };
  if (et === "admin_clear_users") return { label: "Usuarios", icon: "fa-users" };
  if (et.startsWith("login")) return { label: "Acceso", icon: "fa-right-to-bracket" };
  const prefix = String(resource || "").split(":")[0];
  return { label: prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : "General", icon: "fa-circle-info" };
}

// Detalle legible en español a partir de event_type + payload reales del backend.
function detailText(row) {
  const et = row.event_type || "";
  const p = row.payload || {};
  switch (et) {
    case "group_created":
      return p.name ? `Creó el curso "${p.name}"` : "Creó un curso";
    case "group_updated":
      return p.name ? `Editó el curso "${p.name}"` : "Editó un curso";
    case "group_deleted":
      return p.name ? `Eliminó el curso "${p.name}"` : "Eliminó un curso";
    case "class_created":
      return p.instant ? "Creó una clase instantánea" : "Creó la clase";
    case "class_updated":
      return "Editó la clase";
    case "class_deleted":
      return p.title ? `Eliminó la clase "${p.title}"` : "Eliminó la clase";
    case "qr_rotated":
      return p.ttl_minutes
        ? `Rotó el QR de la clase (vigencia ${p.ttl_minutes} min)`
        : "Rotó el QR de la clase";
    case "attendance_marked":
      return "Marcó asistencia";
    case "attendance_duplicate":
      return "Marcó asistencia (ya estaba registrada)";
    case "login_denied":
      return p.domain
        ? `Inicio de sesión denegado (dominio ${p.domain})`
        : "Inicio de sesión denegado";
    case "student_profile_created":
      return "Creó su perfil de estudiante";
    case "student_profile_updated":
      return "Actualizó su perfil de estudiante";
    case "whitelist_added":
      return p.email ? `Autorizó al profesor ${p.email}` : "Agregó un profesor a la lista";
    case "whitelist_removed":
      return p.email ? `Removió al profesor ${p.email}` : "Removió un profesor de la lista";
    case "admin_student_updated":
      return "Editó los datos de un estudiante";
    case "admin_student_deleted":
      return p.student_code ? `Eliminó al estudiante ${p.student_code}` : "Eliminó a un estudiante";
    case "admin_clear_users":
      return "Limpió profesores, estudiantes y grupos del sistema";
    default: {
      const human = (et || "evento").replace(/_/g, " ");
      const first = human.charAt(0).toUpperCase() + human.slice(1);
      return row.resource ? `${first} (${row.resource})` : first;
    }
  }
}

const dayKey = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

// "Hoy, 20:35" / "Ayer, 18:20" / "12/06, 18:20" (siempre hora de Bogotá).
function relativeActivityLabel(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  const key = dayKey(date);
  const time = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (key === dayKey(new Date())) return `Hoy, ${time}`;
  if (key === dayKey(new Date(Date.now() - 86400000))) return `Ayer, ${time}`;
  const [, month, day] = key.split("-");
  return `${day}/${month}, ${time}`;
}

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

// Mini calendario desplegable (a mano, sin dependencias): rango desde→hasta
// en dos clics, presets rápidos y navegación de mes. El rango se aprecia en el
// grid; se aplica recién al pulsar "Filtrar".
function DateRangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => startOfMonth(new Date()));

  // Hoy en días America/Bogota, igual que los filtros del backend.
  const today = todayISODate();
  const label = from || to
    ? [from, to].filter(Boolean).map(shortDate).join(" – ")
    : "Seleccionar rango";

  const pickDay = (iso) => {
    if (!from || (from && to)) {
      onChange({ from: iso, to: "" });
      setView(startOfMonth(new Date(`${iso}T12:00:00`)));
    } else if (iso < from) {
      onChange({ from: iso, to: from });
      // Rango completo: se cierra para no tapar el botón "Filtrar".
      setOpen(false);
    } else {
      onChange({ from, to: iso });
      setOpen(false);
    }
  };

  const applyPreset = (days, thisMonth) => {
    // Derivado del "hoy" de Bogotá: los presets son días inclusivos
    // (hoy - days + 1), para que "Últimos 7 días" sean 7 días calendario.
    const base = new Date(`${today}T12:00:00`);
    const start = thisMonth
      ? startOfMonth(base)
      : new Date(base.getFullYear(), base.getMonth(), base.getDate() - days + 1);
    onChange({ from: toISODate(start), to: today });
    setView(startOfMonth(base));
    setOpen(false);
  };

  const year = view.getFullYear();
  const month = view.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toISODate(new Date(year, month, day)));
  }
  while (cells.length % 7) cells.push(null);

  const monthLabel = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" })
    .format(view)
    .replace(" de ", " ");

  const presets = [
    { label: "Hoy", run: () => applyPreset(1, false) },
    { label: "Últimos 7 días", run: () => applyPreset(7, false) },
    { label: "Últimos 30 días", run: () => applyPreset(30, false) },
    { label: "Este mes", run: () => applyPreset(0, true) },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <i className="fa-solid fa-calendar-days text-[#B3200E]/70" aria-hidden="true" />
          <span className={`truncate ${from || to ? "text-slate-800" : "text-slate-400"}`}>
            {label}
          </span>
        </span>
        <i
          className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar calendario"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div
            role="dialog"
            aria-label="Seleccionar rango de fechas"
            className="absolute right-0 z-30 mt-2 w-[240px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Mes anterior"
                onClick={() => setView(new Date(year, month - 1, 1))}
                className="grid h-5 w-5 place-items-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-[#B3200E]"
              >
                <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" />
              </button>
              <span className="text-sm font-semibold capitalize text-slate-800">{monthLabel}</span>
              <button
                type="button"
                aria-label="Mes siguiente"
                onClick={() => setView(new Date(year, month + 1, 1))}
                className="grid h-5 w-5 place-items-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-[#B3200E]"
              >
                <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
              </button>
            </div>

            <div className="mb-2 grid grid-cols-2 gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={preset.run}
                  className="rounded-lg border border-slate-200 px-1 py-1 text-[9px] font-semibold text-slate-600 transition hover:border-[#B3200E]/40 hover:bg-red-50 hover:text-[#B3200E]"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-400">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {cells.map((iso, index) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pickDay(iso)}
                    aria-label={shortDate(iso)}
                    aria-pressed={iso === from || iso === to}
                    className={`h-6 rounded-lg text-[11px] transition ${
                      iso === from || iso === to
                        ? "bg-[#B3200E] font-semibold text-white shadow-sm"
                        : from && to && iso > from && iso < to
                          ? "bg-red-50 text-[#B3200E]"
                          : "text-slate-700 hover:bg-red-50"
                    } ${iso === today ? "ring-1 ring-[#B3200E]/40" : ""}`}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                ) : (
                  <span key={`blank-${index}`} className="h-6" aria-hidden="true" />
                ),
              )}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500">
              <span>Desde: <strong>{from ? shortDate(from) : "—"}</strong></span>
              <span>Hasta: <strong>{to ? shortDate(to) : "—"}</strong></span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const emptyFilters = { q: "", actor: "", from: "", to: "" };

const buildParams = (filters) => {
  const params = {};
  if (filters.q.trim()) params.q = filters.q.trim();
  if (filters.actor) params.actor = filters.actor;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  return params;
};

export default function Auditoria() {
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [professors, setProfessors] = useState([]);
  const seq = useRef(0);

  const run = useCallback(async (filters, pageNum) => {
    const current = seq.current + 1;
    seq.current = current;
    setLoading(true);
    setError("");
    try {
      const data = await fetchAuditLogs(buildParams(filters), pageNum, PAGE_SIZE);
      if (current !== seq.current) return;
      setRows(data.results || []);
      setCount(data.count || 0);
      setStats(data.stats || null);
      setSearched(true);
    } catch (err) {
      if (current !== seq.current) return;
      setError(
        err?.response?.status === 403
          ? "No tienes permiso para ver el registro de auditoría."
          : "No se pudo cargar el registro de auditoría. Intenta de nuevo.",
      );
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, []);

  // Carga inicial sin filtros: se ven todas las acciones de inmediato.
  useEffect(() => {
    run(emptyFilters, 1);
  }, [run]);

  // Profesores del select: reutiliza filters.professors del endpoint de
  // estadísticas (trae user_id, el valor que espera ?actor=). Si falla, el
  // select queda solo con "Todos los usuarios".
  useEffect(() => {
    let alive = true;
    getStats({ period: "1d" })
      .then((response) => {
        if (alive) {
          setProfessors((response.filters?.professors || []).filter((p) => p.user_id));
        }
      })
      .catch(() => {
        if (alive) setProfessors([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleFiltrar = () => {
    const filters = { ...draft };
    setApplied(filters);
    setPage(1);
    run(filters, 1);
  };

  const handleLimpiar = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
    run(emptyFilters, 1);
  };

  const handlePage = (next) => {
    setPage(next);
    run(applied, next);
  };

  const set = (key) => (event) =>
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const kpis = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard title="Total de Acciones" value={stats?.total ?? null} icon="fa-list-check" />
      <MetricCard
        title="Acciones de Profesores"
        value={stats?.professors ?? null}
        icon="fa-chalkboard-user"
      />
      <MetricCard
        title="Acciones Administrativas"
        value={stats?.administrators ?? null}
        icon="fa-user-shield"
      />
      <MetricCard
        title="Última Actividad"
        displayValue={relativeActivityLabel(stats?.last_activity)}
        icon="fa-clock"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <section className={`${cardCls} sm:p-6`}>
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#B3200E] text-white shadow-sm">
            <i className="fa-solid fa-clipboard-user text-xl" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Auditoría</h1>
              {searched && !loading && (
                <span className="inline-flex items-center rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-semibold text-[#B3200E]">
                  {count} registro(s)
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Historial de acciones de profesores y administradores en el sistema.
            </p>
          </div>
        </div>
      </section>

      {loading && !stats ? (
        <>
          <p role="status" className="sr-only">Cargando estadísticas de auditoría...</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[78px] !rounded-xl" />
            ))}
          </div>
        </>
      ) : (
        <div className={loading ? "opacity-60" : ""}>{kpis}</div>
      )}

      <section className={cardCls}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="min-w-0">
            <label htmlFor="aud-q" className={labelCls}>
              <i className="fa-solid fa-magnifying-glass text-[#B3200E]/80" aria-hidden="true" />
              Búsqueda
            </label>
            <SearchBar
              id="aud-q"
              value={draft.q}
              onChange={(value) => setDraft((prev) => ({ ...prev, q: value }))}
              placeholder="Buscar por usuario, acción o detalle…"
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="aud-usuario" className={labelCls}>
              <i className="fa-solid fa-user text-[#B3200E]/80" aria-hidden="true" />
              Usuario
            </label>
            <div className="relative">
              <select
                id="aud-usuario"
                value={draft.actor}
                onChange={set("actor")}
                className={`${inputCls} appearance-none pr-9`}
              >
                <option value="">Todos los usuarios</option>
                {professors.length > 0 && (
                  <optgroup label="Profesores">
                    {professors.map((professor) => (
                      <option key={professor.user_id} value={professor.user_id}>
                        {professor.name} · {professor.email}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <i
                className="fa-solid fa-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="min-w-0">
            <span className={labelCls}>
              <i className="fa-solid fa-calendar-day text-[#B3200E]/80" aria-hidden="true" />
              Rango de fechas
            </span>
            <DateRangePicker
              from={draft.from}
              to={draft.to}
              onChange={(range) => setDraft((prev) => ({ ...prev, ...range }))}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={handleFiltrar} disabled={loading} className={primaryBtnCls}>
            <i
              className={`fa-solid ${loading ? "fa-spinner fa-spin" : "fa-filter"}`}
              aria-hidden="true"
            />
            {loading ? "Filtrando..." : "Filtrar"}
          </button>
          <button type="button" onClick={handleLimpiar} disabled={loading} className={secondaryBtnCls}>
            <i className="fa-solid fa-eraser" aria-hidden="true" />
            Limpiar
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && (
        <div className={cardCls} aria-hidden="true">
          <div className="h-8 bg-slate-50" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex h-11 items-center gap-4 border-t border-slate-100">
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/6" />
              <Skeleton className="h-4 w-16 !rounded-full" />
              <Skeleton className="h-4 w-20 !rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      )}

      {!loading && searched && rows.length === 0 && !error && (
        <div className={`${cardCls} text-center`}>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#B3200E]/10 text-[#B3200E]">
            <i className="fa-solid fa-clipboard-user text-xl" aria-hidden="true" />
          </div>
          <p role="status" className="mt-3 text-sm text-slate-600">
            No se encontraron registros con los filtros elegidos.
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Módulo</th>
                  <th className="px-4 py-3">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const action = actionMeta(row.event_type);
                  const moduleInfo = moduleMeta(row.event_type, row.resource);
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-medium text-slate-800">
                          {formatBogotaDate(row.created_at)}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatBogotaTime(row.created_at)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="break-words font-medium text-slate-800">
                          {row.actor_name || "Sistema"}
                        </p>
                        {/* Sin perfil actor_name == email: no se repite el
                            email, pero el rol se conserva. */}
                        {row.actor_email !== row.actor_name ? (
                          <p className="break-all text-xs text-slate-500">
                            {row.actor_email || "Sin usuario"}
                            {row.actor_role ? ` · ${ROLE_LABELS[row.actor_role] || row.actor_role}` : ""}
                          </p>
                        ) : (
                          row.actor_role && (
                            <p className="break-all text-xs text-slate-500">
                              {ROLE_LABELS[row.actor_role] || row.actor_role}
                            </p>
                          )
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${action.cls}`}>
                          {action.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                          <i className={`fa-solid ${moduleInfo.icon}`} aria-hidden="true" />
                          {moduleInfo.label}
                        </span>
                      </td>
                      <td className="break-words px-4 py-3 text-slate-600">
                        {detailText(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onChange={handlePage}
          countLabel={`${count} registro(s)`}
        />
      )}
    </div>
  );
}
