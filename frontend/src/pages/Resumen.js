import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getProfessorStats } from "../services/stats";

const PERIOD_OPTIONS = [
  { value: "1m", label: "Último mes" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Último año" },
  { value: "all", label: "Todo el periodo" },
];

const numberFormat = new Intl.NumberFormat("es-CO");
const percentFormat = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 1,
});
const monthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  year: "numeric",
  timeZone: "America/Bogota",
});
const shortMonthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  timeZone: "America/Bogota",
});
const dateFormat = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Bogota",
});
const CHART_COLORS = ["#c91c2a", "#f7b8c0"];
const cardClass =
  "overflow-hidden rounded-xl border border-rose-100 bg-white shadow-[0_3px_12px_rgba(115,13,7,0.06)]";

function formatPercent(value) {
  return value === null || value === undefined
    ? "Sin datos"
    : `${percentFormat.format(value)}%`;
}

function ChangeBadge({ change, total }) {
  if (change === null || change === undefined) {
    return (
      <span className="text-[11px] font-medium text-slate-400">
        {total > 0 ? "Nuevo en el periodo" : "Sin comparación"}
      </span>
    );
  }

  const isPositive = change >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
        isPositive ? "text-emerald-700" : "text-rose-700"
      }`}
      aria-label={`${isPositive ? "Aumentó" : "Disminuyó"} ${Math.abs(change)} por ciento respecto al periodo anterior`}
    >
      <i
        className={`fa-solid ${isPositive ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}`}
        aria-hidden="true"
      />
      {Math.abs(change)}%
    </span>
  );
}

function MetricCard({ title, value, icon, decorativeIcon, change }) {
  return (
    <article className="relative flex min-h-[78px] items-center gap-3 overflow-hidden rounded-xl border border-rose-100 bg-white px-3 py-2.5 shadow-[0_3px_12px_rgba(115,13,7,0.06)] sm:gap-3.5 sm:px-2.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e51f2b] to-[#b40b1b] text-lg text-white shadow-sm">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div className="relative z-10 min-w-0 flex-1 pb-1">
        <p className="text-[22px] font-bold leading-none tracking-tight text-[#7d120c]">
          {numberFormat.format(value)}
        </p>
        <p className="mt-1 truncate text-[10px] leading-tight text-slate-600">{title}</p>
      </div>
      <i
        className={`fa-solid ${decorativeIcon || icon} pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[34px] text-rose-100/80`}
        aria-hidden="true"
      />
      {change !== undefined && (
        <div className="absolute bottom-1.5 right-2 z-10">
          <ChangeBadge change={change} total={value} />
        </div>
      )}
    </article>
  );
}

function FilterSelect({ label, value, onChange, children, className = "" }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-9 max-w-full appearance-none rounded-lg border border-white/80 bg-white/75 px-3 pr-8 text-[11px] font-medium text-slate-700 outline-none transition hover:bg-white focus:border-[#b3200e]/40 focus:ring-2 focus:ring-[#b3200e]/15 ${className}`}
      >
        {children}
      </select>
      <i
        className="fa-solid fa-chevron-down pointer-events-none absolute right-3 text-[9px] text-slate-500"
        aria-hidden="true"
      />
    </label>
  );
}

function SummaryToolbar({ period, onPeriodChange, courseId, onCourseChange, courses }) {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-rose-100 bg-gradient-to-r from-[#fce1e6] to-[#fbdde4] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <i className="fa-solid fa-graduation-cap text-xl text-[#7d120c]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-bold leading-tight text-[#70100a]">Mis cursos</p>
          <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-600">
            Información de tus clases y estudiantes
          </p>
        </div>
        <span className="mx-1 hidden h-7 w-px bg-[#a33a3a]/30 sm:block" aria-hidden="true" />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <FilterSelect
          label="Filtrar por curso"
          value={courseId}
          onChange={onCourseChange}
          className="min-w-[132px]"
        >
          <option value="">Todos los cursos</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Filtrar estadísticas por periodo"
          value={period}
          onChange={onPeriodChange}
          className="min-w-[132px]"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterSelect>
      </div>
    </div>
  );
}

function Panel({ title, icon, subtitle, children, className = "" }) {
  return (
    <section className={`${cardClass} ${className}`}>
      <div className="flex min-h-10 items-center justify-between gap-2 bg-gradient-to-r from-[#871510] to-[#68100b] px-3 py-2 text-white">
        <h2 className="flex items-center gap-2 text-xs font-semibold">
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
          {title}
        </h2>
        {subtitle && <span className="text-[9px] text-white/75">{subtitle}</span>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function EmptyState({ children }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
      <i className="fa-solid fa-chart-simple text-xl text-rose-200" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function CourseAttendanceChart({ courses }) {
  const chartCourses = courses.filter((course) => course.rate !== null);
  if (!chartCourses.length) {
    return <EmptyState>No hay roster de referencia y clases finalizadas para este periodo.</EmptyState>;
  }

  return (
    <div className="max-h-[320px] overflow-y-auto overflow-x-hidden">
      <div style={{ height: Math.max(210, chartCourses.length * 38) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartCourses}
            layout="vertical"
            margin={{ top: 2, right: 12, bottom: 2, left: 0 }}
          >
            <CartesianGrid stroke="#f1e7e8" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={105}
              tick={{ fontSize: 10, fill: "#475569" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => [`${percentFormat.format(value)}%`, "Asistencia del roster"]}
              labelFormatter={(label) => label}
              contentStyle={{ borderRadius: 10, borderColor: "#f3d9dc", fontSize: 11 }}
            />
            <Bar
              dataKey="rate"
              name="Asistencia del roster"
              fill="#c91c2a"
              radius={[0, 5, 5, 0]}
              barSize={16}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AttendanceDonut({ attendance }) {
  if (!attendance.has_roster) {
    return <EmptyState>Aún no hay un roster que permita estimar asistencia y ausencias.</EmptyState>;
  }

  const data = [
    { name: "Presentes del roster", value: attendance.present },
    { name: "Ausencias estimadas", value: attendance.absent_estimated },
  ];

  return (
    <div className="flex min-h-[205px] flex-col items-center justify-center gap-2 sm:flex-row sm:gap-1">
      <div className="relative h-44 w-full min-w-0 sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="82%"
              paddingAngle={attendance.present && attendance.absent_estimated ? 2 : 0}
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={CHART_COLORS[index]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [numberFormat.format(value), name]}
              contentStyle={{ borderRadius: 10, borderColor: "#f3d9dc", fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-800">{formatPercent(attendance.rate)}</span>
          <span className="text-[10px] text-slate-500">del roster</span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-1/2">
        {data.map((item, index) => (
          <div key={item.name} className="flex items-start gap-2 text-[11px]">
            <span
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index] }}
              aria-hidden="true"
            />
            <span className="min-w-0 text-slate-600">
              {item.name}
              <strong className="ml-1 block text-slate-800">
                {numberFormat.format(item.value)}
              </strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceTrend({ trend }) {
  if (!trend.some((item) => item.rate !== null)) {
    return <EmptyState>No hay clases finalizadas con roster de referencia en este periodo.</EmptyState>;
  }

  const chartData = trend.map((item) => ({
    ...item,
    label: shortMonthFormat
      .format(new Date(`${item.month}-01T12:00:00`))
      .replace(".", ""),
  }));

  return (
    <div className="h-[210px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="attendanceTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d51d2a" stopOpacity={0.24} />
              <stop offset="95%" stopColor="#d51d2a" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f1e7e8" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={{ stroke: "#e2d5d7" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
            tick={{ fontSize: 9, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(_label, payload) =>
              payload?.[0]?.payload?.month
                ? monthFormat.format(new Date(`${payload[0].payload.month}T12:00:00`))
                : ""
            }
            formatter={(value) => [`${percentFormat.format(value)}%`, "Asistencia del roster"]}
            contentStyle={{ borderRadius: 10, borderColor: "#f3d9dc", fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="rate"
            connectNulls={false}
            stroke="#c91c2a"
            strokeWidth={2.5}
            fill="url(#attendanceTrendFill)"
            activeDot={{ r: 4, fill: "#c91c2a" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CourseExtremes({ courses }) {
  const ratedCourses = courses.filter((course) => course.rate !== null);
  if (!ratedCourses.length) {
    return <EmptyState>No hay cursos con datos de asistencia para comparar.</EmptyState>;
  }

  const best = [...ratedCourses].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name))[0];
  const lowest = [...ratedCourses].sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name))[0];
  if (ratedCourses.length === 1 || best.rate === lowest.rate) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">
            {ratedCourses.length === 1 ? "Asistencia del curso" : "Asistencia de los cursos"}
          </p>
          <p className="truncate text-[11px] font-semibold text-slate-700">
            {ratedCourses.length === 1 ? best.name : `${ratedCourses.length} cursos`}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
          {formatPercent(best.rate)}
        </span>
      </div>
    );
  }
  const extremes = [
    { label: "Mayor asistencia", course: best, icon: "fa-arrow-up", color: "text-emerald-600", badge: "bg-emerald-50 text-emerald-700" },
    { label: "Menor asistencia", course: lowest, icon: "fa-arrow-down", color: "text-rose-600", badge: "bg-rose-50 text-rose-700" },
  ];

  return (
    <div className="divide-y divide-slate-100">
      {extremes.map(({ label, course, icon, color, badge }) => (
        <div key={label} className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0">
          <i className={`fa-solid ${icon} ${color}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
            <p className="truncate text-[11px] font-semibold text-slate-700">{course.name}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>
            {formatPercent(course.rate)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TopAbsences({ students }) {
  if (!students.length) {
    return <EmptyState>No hay ausencias estimadas para los grupos con roster.</EmptyState>;
  }

  return (
    <ol className="divide-y divide-slate-100">
      {students.map((student, index) => (
        <li key={student.student_id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
          <span className="w-5 shrink-0 text-[11px] font-semibold text-slate-500">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">
            {student.name}
          </span>
          <span className="shrink-0 text-[10px] font-semibold text-rose-700">
            {numberFormat.format(student.absences)} {student.absences === 1 ? "falta" : "faltas"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RecentClasses({ classes }) {
  if (!classes.length) {
    return <EmptyState>No hay clases finalizadas dentro del periodo seleccionado.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] border-collapse text-left text-[10px]">
        <thead>
          <tr className="bg-rose-50 text-[#70100a]">
            <th className="rounded-l-lg px-2 py-2 font-semibold">Fecha</th>
            <th className="px-2 py-2 font-semibold">Curso / clase</th>
            <th className="rounded-r-lg px-2 py-2 text-right font-semibold">Asistencia</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((classItem) => (
            <tr key={classItem.id} className="border-b border-slate-100 last:border-0">
              <td className="whitespace-nowrap px-2 py-2 text-slate-600">
                {dateFormat.format(new Date(classItem.start_time))}
              </td>
              <td className="max-w-[150px] px-2 py-2">
                <span className="block truncate font-medium text-slate-700">
                  {classItem.course_name}
                </span>
                <span className="block truncate text-[9px] text-slate-400">
                  {classItem.title}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right">
                {classItem.rate === null ? (
                  <span className="text-slate-400">Sin roster</span>
                ) : (
                  <span className="font-semibold text-slate-700">
                    {formatPercent(classItem.rate)}
                    <span className="ml-1 font-normal text-slate-400">
                      ({numberFormat.format(classItem.present)}/{numberFormat.format(classItem.expected)})
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Cargando estadísticas">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-[78px] animate-pulse rounded-xl border border-rose-100 bg-rose-50/60"
        />
      ))}
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div
          key={`panel-${item}`}
          className="h-56 animate-pulse rounded-xl border border-rose-100 bg-rose-50/40"
        />
      ))}
    </div>
  );
}

export default function Resumen() {
  const [period, setPeriod] = useState("3m");
  const [courseId, setCourseId] = useState("");
  const [stats, setStats] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStats(null);
    setLoading(true);
    setError("");

    getProfessorStats(period, courseId, { signal: controller.signal })
      .then((response) => {
        setStats(response);
        setCourses(response.filters.courses);
      })
      .catch((requestError) => {
        if (requestError.name !== "CanceledError") {
          setError("No se pudieron cargar las estadísticas. Intenta de nuevo.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period, courseId, reload]);

  const selectedCourseLabel = useMemo(
    () => courses.find((course) => course.id === courseId)?.name,
    [courseId, courses],
  );
  const trendLabel =
    period === "all"
      ? "Últimos 12 meses"
      : PERIOD_OPTIONS.find((option) => option.value === period)?.label;

  return (
    <section className="mx-auto w-full max-w-7xl">
      <header className="mb-3 flex min-h-12 items-center border-l border-[#d8c8cb] pl-3.5 sm:mb-4 sm:pl-4">
        <div>
          <h1 className="text-[25px] font-bold leading-none tracking-tight text-[#7d120c] sm:text-[28px]">
            Resumen
          </h1>
          <p className="mt-1.5 text-[11px] leading-tight text-slate-600 sm:text-xs">
            Visualiza las estadísticas de asistencia de tus clases y cursos.
          </p>
        </div>
      </header>

      <SummaryToolbar
        period={period}
        onPeriodChange={setPeriod}
        courseId={courseId}
        onCourseChange={setCourseId}
        courses={courses}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReload((current) => current + 1)}
            className="shrink-0 font-semibold underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      )}

      {loading && !stats ? (
        <LoadingGrid />
      ) : (
        stats && (
          <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <MetricCard
                title="Estudiantes con asistencia"
                value={stats.totals.students}
                icon="fa-users"
                decorativeIcon="fa-people-group"
                change={stats.changes.students}
              />
              <MetricCard
                title="Cursos a cargo"
                value={stats.totals.courses_count}
                icon="fa-book-open"
                decorativeIcon="fa-book-open"
              />
              <MetricCard
                title="Clases realizadas"
                value={stats.totals.classes_completed}
                icon="fa-calendar-check"
                decorativeIcon="fa-calendar-check"
                change={stats.changes.classes_completed}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.25fr_0.85fr_1.2fr]">
              <Panel title="Asistencia por curso" icon="fa-chart-column">
                <CourseAttendanceChart courses={stats.courses} />
              </Panel>
              <Panel title="Estado de asistencia" icon="fa-chart-pie">
                <AttendanceDonut attendance={stats.attendance} />
              </Panel>
              <Panel title="Evolución de la asistencia" icon="fa-chart-line" subtitle={trendLabel}>
                <AttendanceTrend trend={stats.trend} />
              </Panel>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_1.05fr_1.25fr]">
              <Panel title="Cursos con mayor y menor asistencia" icon="fa-trophy">
                <CourseExtremes courses={stats.courses} />
              </Panel>
              <Panel title="Estudiantes con más inasistencias" icon="fa-user-xmark">
                <TopAbsences students={stats.top_absences} />
              </Panel>
              <Panel title="Últimas clases registradas" icon="fa-clock">
                <RecentClasses classes={stats.recent_classes} />
              </Panel>
            </div>
          </div>
        )
      )}

      {stats && (
        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
          {selectedCourseLabel ? `Curso seleccionado: ${selectedCourseLabel}. ` : ""}
          El total de cursos corresponde a tus cursos asignados. Las variaciones comparan estudiantes
          y clases con el periodo anterior equivalente. Las ausencias y porcentajes se estiman con el
          roster registrado en la primera clase finalizada de cada grupo; estudiantes fuera de ese
          roster no generan faltas estimadas. El sistema no registra ausencias justificadas.
        </p>
      )}
    </section>
  );
}
