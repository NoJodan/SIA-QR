import React from "react";

const cardClass =
  "overflow-hidden rounded-xl border border-rose-100 bg-white shadow-[0_3px_12px_rgba(115,13,7,0.06)]";

const metrics = [
  { label: "Estudiantes registrados", icon: "fa-user-graduate" },
  { label: "Profesores", icon: "fa-chalkboard-user" },
  { label: "Cursos y grupos", icon: "fa-book-open" },
  { label: "Clases realizadas", icon: "fa-calendar-check" },
];

function MetricCard({ label, icon }) {
  return (
    <article className="relative flex min-h-[78px] min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-rose-100 bg-white px-3 py-2.5 shadow-[0_3px_12px_rgba(115,13,7,0.06)] sm:gap-3.5 sm:px-2.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e51f2b] to-[#b40b1b] text-lg text-white shadow-sm">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div className="relative z-10 min-w-0 flex-1">
        <p className="text-[22px] font-bold leading-none tracking-tight text-[#7d120c]">—</p>
        <p className="mt-1 truncate text-[10px] leading-tight text-slate-600">{label}</p>
        <p className="mt-0.5 truncate text-[9px] leading-tight text-slate-400">
          Sin datos disponibles
        </p>
      </div>
      <i
        className={`fa-solid ${icon} pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[34px] text-rose-100/80`}
        aria-hidden="true"
      />
    </article>
  );
}

function Panel({ title, subtitle, icon, children }) {
  return (
    <section className={`${cardClass} min-w-0`}>
      <div className="flex min-h-10 items-center justify-between gap-2 bg-gradient-to-r from-[#871510] to-[#68100b] px-3 py-2 text-white">
        <h2 className="flex items-center gap-2 text-xs font-semibold">
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
          {title}
        </h2>
        {subtitle && <span className="text-[9px] text-white/75">{subtitle}</span>}
      </div>
      <div className="min-w-0 p-3">{children}</div>
    </section>
  );
}

function EmptyState({ children }) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
      <i className="fa-solid fa-chart-simple text-xl text-rose-200" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export default function AdminResumen() {
  return (
    <section className="relative z-10 mx-auto min-h-full w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
      <header className="mb-3 flex min-h-12 items-center sm:mb-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[25px] font-bold leading-none tracking-tight text-[#7d120c] sm:text-[28px]">
            <i className="fa-solid fa-chart-simple text-[21px] sm:text-2xl" aria-hidden="true" />
            Resumen
          </h1>
          <p className="mt-1.5 text-[11px] leading-tight text-slate-600 sm:text-xs">
            Estadísticas generales de la institución.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[0_8px_24px_rgba(115,13,7,0.07)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#951b16] to-[#67100b] text-white shadow-[0_4px_10px_rgba(103,16,11,0.2)]">
            <i className="fa-solid fa-building-columns text-lg" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight text-[#70100a]">
              Estadísticas institucionales
            </p>
            <p className="mt-1 truncate text-[10px] leading-tight text-slate-500">
              Cursos, profesores, estudiantes y asistencia
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-rose-100 bg-[#fffafa] px-3 py-2.5 text-[11px] font-semibold text-[#9b211b] shadow-sm">
          <i className="fa-solid fa-earth-americas" aria-hidden="true" />
          Alcance global
        </span>
      </div>

      <div className="space-y-3">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,1.2fr)]">
          <Panel title="Asistencia por curso" icon="fa-chart-column">
            <EmptyState>No hay datos disponibles para mostrar.</EmptyState>
          </Panel>
          <Panel title="Estado de asistencia" icon="fa-chart-pie">
            <EmptyState>No hay datos disponibles para mostrar.</EmptyState>
          </Panel>
          <Panel title="Evolución de la asistencia" icon="fa-chart-line" subtitle="Histórico">
            <EmptyState>No hay datos disponibles para mostrar.</EmptyState>
          </Panel>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Panel title="Cursos destacados" icon="fa-book-open">
            <EmptyState>No hay cursos disponibles para mostrar.</EmptyState>
          </Panel>
          <Panel title="Indicadores del alcance administrativo" icon="fa-users">
            <EmptyState>
              Los indicadores estarán disponibles cuando se conecten los datos del sistema.
            </EmptyState>
          </Panel>
        </div>
      </div>
    </section>
  );
}
