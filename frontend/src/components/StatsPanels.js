import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const PERIOD_OPTIONS = [
  { value: "1d", label: "Último día" },
  { value: "1w", label: "Última semana" },
  { value: "1m", label: "Último mes" },
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Último año" },
  { value: "all", label: "Todo el periodo" },
];

export const numberFormat = new Intl.NumberFormat("es-CO");
const monthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  year: "numeric",
  timeZone: "America/Bogota",
});
const shortMonthFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  timeZone: "America/Bogota",
});
const shortMonthYearFormat = new Intl.DateTimeFormat("es-CO", {
  month: "short",
  year: "2-digit",
  timeZone: "America/Bogota",
});
const shortDayFormat = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
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

// El backend envía fechas sin hora; anclarlas a mediodía en Colombia evita correrse un día.
const parseBogotaDate = (value) => new Date(`${value}T12:00:00-05:00`);

export function ChangeBadge({ change, total, hasComparison = true }) {
  if (!hasComparison || change === null || change === undefined) {
    return (
      <span className="text-[11px] font-medium text-slate-400">
        {hasComparison && total > 0 ? "Nuevo en el periodo" : "Sin comparación"}
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

export function MetricCard({
  title,
  value,
  icon,
  decorativeIcon,
  change,
  hint,
  suffix = "",
  hasComparison = true,
}) {
  const formattedValue =
    value === null || value === undefined
      ? "—"
      : `${numberFormat.format(value)}${suffix}`;

  return (
    <article className="relative flex min-h-[78px] items-center gap-3 overflow-hidden rounded-xl border border-rose-100 bg-white px-3 py-2.5 shadow-[0_3px_12px_rgba(115,13,7,0.06)] sm:gap-3.5 sm:px-2.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e51f2b] to-[#b40b1b] text-lg text-white shadow-sm">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </span>
      <div className="relative z-10 min-w-0 flex-1 pb-1">
        <p className="text-[22px] font-bold leading-none tracking-tight text-[#7d120c]">
          {formattedValue}
        </p>
        <p className="mt-1 truncate text-[10px] leading-tight text-slate-600">{title}</p>
        {hint && (
          <p className="mt-0.5 truncate text-[9px] leading-tight text-slate-400">{hint}</p>
        )}
      </div>
      <i
        className={`fa-solid ${decorativeIcon || icon} pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[34px] text-rose-100/80`}
        aria-hidden="true"
      />
      {change !== undefined && (
        <div className="absolute bottom-1.5 right-2 z-10">
          <ChangeBadge change={change} total={value} hasComparison={hasComparison} />
        </div>
      )}
    </article>
  );
}

export function FilterSelect({ label, icon, value, onChange, children, className = "" }) {
  return (
    <label className="relative inline-flex w-full min-w-0 flex-none items-center lg:w-auto xl:max-w-[220px]">
      <span className="sr-only">{label}</span>
      <i
        className={`fa-solid ${icon} pointer-events-none absolute left-3 text-[11px] text-[#9b211b]`}
        aria-hidden="true"
      />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 w-full min-w-0 appearance-none truncate rounded-xl border border-rose-100 bg-[#fffafa] pl-9 pr-9 text-[11px] font-semibold text-slate-700 shadow-sm outline-none transition hover:border-rose-200 hover:bg-white focus:border-[#b3200e]/50 focus:ring-2 focus:ring-[#b3200e]/10 ${className}`}
      >
        {children}
      </select>
      <i
        className="fa-solid fa-chevron-down pointer-events-none absolute right-3 text-[9px] text-slate-400"
        aria-hidden="true"
      />
    </label>
  );
}

export function StatsToolbar({
  icon,
  title,
  subtitle,
  period,
  onPeriodChange,
  courseId,
  onCourseChange,
  courses,
  professorId,
  onProfessorChange,
  professors = [],
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/80 bg-white/75 p-3 shadow-[0_8px_24px_rgba(115,13,7,0.07)] backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#951b16] to-[#67100b] text-white shadow-[0_4px_10px_rgba(103,16,11,0.2)]">
          <i className={`fa-solid ${icon} text-lg`} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold leading-tight text-[#70100a]">{title}</p>
          <p className="mt-1 truncate text-[10px] leading-tight text-slate-500">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
        {professors.length > 0 && (
          <FilterSelect
            label="Filtrar por profesor"
            icon="fa-chalkboard-user"
            value={professorId}
            onChange={onProfessorChange}
            className="xl:min-w-[158px]"
          >
            <option value="">Todos los profesores</option>
            {professors.map((professor) => (
              <option key={professor.id} value={professor.id}>
                {professor.name}
              </option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect
          label="Filtrar por curso"
          icon="fa-book-open"
          value={courseId}
          onChange={onCourseChange}
          className="xl:min-w-[156px]"
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
          icon="fa-calendar-days"
          value={period}
          onChange={onPeriodChange}
          className="xl:min-w-[148px]"
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

export function Panel({ title, icon, subtitle, children, className = "" }) {
  return (
    <section className={`${cardClass} min-w-0 ${className}`}>
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

export function EmptyState({ children }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
      <i className="fa-solid fa-chart-simple text-xl text-rose-200" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function CourseAttendanceChart({ courses = [] }) {
  if (!courses.length) {
    return <EmptyState>No hay cursos con clases finalizadas en este periodo.</EmptyState>;
  }

  return (
    <div className="h-[220px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={courses} margin={{ top: 18, right: 5, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#f1e7e8" vertical={false} />
          <XAxis
            dataKey="name"
            tickFormatter={(name) => (name.length > 12 ? `${name.slice(0, 11)}…` : name)}
            interval={courses.length > 5 ? "preserveStartEnd" : 0}
            tick={{ fontSize: 8, fill: "#475569" }}
            axisLine={{ stroke: "#e2d5d7" }}
            tickLine={false}
            tickMargin={7}
          />
          {/* shortcut: eje fijo 0-50 por requisito; un curso con más de 50 asistentes se recorta. */}
          <YAxis
            domain={[0, 50]}
            ticks={[0, 10, 20, 30, 40, 50]}
            allowDecimals={false}
            tick={{ fontSize: 8, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => [numberFormat.format(value), "Asistentes"]}
            contentStyle={{ borderRadius: 10, borderColor: "#f3d9dc", fontSize: 11 }}
          />
          <Bar dataKey="students" name="Asistentes" fill="#c91c2a" radius={[5, 5, 0, 0]} maxBarSize={34}>
            <LabelList
              dataKey="students"
              position="top"
              formatter={(value) => numberFormat.format(value)}
              style={{ fill: "#334155", fontSize: 9, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AttendanceDonut({ attendance }) {
  if (!attendance.total) {
    return <EmptyState>No hay asistencias registradas en este periodo.</EmptyState>;
  }

  const data = [
    { name: "Con localización", value: attendance.with_location },
    { name: "Sin localización", value: attendance.without_location },
  ];

  return (
    <div className="flex min-h-[220px] items-center justify-center gap-1">
      <div className="relative h-[190px] w-[58%] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="82%"
              paddingAngle={attendance.with_location && attendance.without_location ? 2 : 0}
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
          <span className="text-xl font-bold text-slate-800">
            {numberFormat.format(attendance.total)}
          </span>
          <span className="text-[10px] text-slate-500">asistencias</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {data.map((item, index) => (
          <div key={item.name} className="flex min-w-0 items-start gap-1.5 text-[10px]">
            <span
              className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index] }}
              aria-hidden="true"
            />
            <span className="min-w-0 text-slate-600">
              {item.name}
              <strong className="block text-slate-800">{numberFormat.format(item.value)}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AttendanceTrend({ trend = [], granularity = "month", showYear = trend.length > 12 }) {
  if (!trend.some((item) => item.present > 0)) {
    return <EmptyState>No hay asistencias registradas en este periodo.</EmptyState>;
  }

  const labelFormat =
    granularity === "day" ? shortDayFormat : showYear ? shortMonthYearFormat : shortMonthFormat;
  const chartData = trend.map((item) => ({
    ...item,
    // Intl es-CO intercala "de" entre mes y año ("ene de 25"); el eje necesita "ene 25".
    label: labelFormat
      .format(parseBogotaDate(item.month))
      .replace(".", "")
      .replace(" de ", " "),
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
            allowDecimals={false}
            tick={{ fontSize: 9, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(_label, payload) =>
              payload?.[0]?.payload?.month
                ? (granularity === "day" ? dateFormat : monthFormat).format(
                    parseBogotaDate(payload[0].payload.month),
                  )
                : ""
            }
            formatter={(value) => [
              value == null ? "Sin datos" : numberFormat.format(value),
              "Asistencias",
            ]}
            contentStyle={{ borderRadius: 10, borderColor: "#f3d9dc", fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="present"
            connectNulls={false}
            stroke="#c91c2a"
            strokeWidth={2}
            fill="url(#attendanceTrendFill)"
            dot={{ r: 3, fill: "#c91c2a", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#c91c2a" }}
          >
            <LabelList
              dataKey="present"
              position="top"
              formatter={(value) => numberFormat.format(value)}
              style={{ fill: "#334155", fontSize: 9, fontWeight: 600 }}
            />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CourseExtremes({ courses = [] }) {
  const ratedCourses = courses.filter((course) => course.classes_completed > 0);
  if (!ratedCourses.length) {
    return <EmptyState>No hay cursos con datos de asistencia para comparar.</EmptyState>;
  }

  const best = [...ratedCourses].sort(
    (a, b) => b.present - a.present || a.name.localeCompare(b.name),
  )[0];
  const lowest = [...ratedCourses].sort(
    (a, b) => a.present - b.present || a.name.localeCompare(b.name),
  )[0];
  if (ratedCourses.length === 1 || best.present === lowest.present) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">
            {ratedCourses.length === 1 ? "Asistencias del curso" : "Asistencias de los cursos"}
          </p>
          <p className="truncate text-[11px] font-semibold text-slate-700">
            {ratedCourses.length === 1 ? best.name : `${ratedCourses.length} cursos`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
          {numberFormat.format(best.present)} asistencias
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
            {numberFormat.format(course.present)} asistencias
          </span>
        </div>
      ))}
    </div>
  );
}

export function TopAttendances({ students = [] }) {
  if (!students.length) {
    return <EmptyState>Aún no hay asistencias registradas en este periodo.</EmptyState>;
  }

  return (
    <ol className="divide-y divide-slate-100">
      {students.map((student, index) => (
        <li key={student.student_id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
          <span className="w-5 shrink-0 text-[11px] font-semibold text-slate-500">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">
            {student.name}
          </span>
          <span className="shrink-0 text-[10px] font-semibold text-emerald-700">
            {numberFormat.format(student.attendances)}{" "}
            {student.attendances === 1 ? "asistencia" : "asistencias"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RecentClasses({ classes = [] }) {
  if (!classes.length) {
    return <EmptyState>No hay clases finalizadas dentro del periodo seleccionado.</EmptyState>;
  }

  return (
    <div className="w-full min-w-0">
      <table className="w-full table-fixed border-collapse text-left text-[9px] sm:text-[10px]">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[49%]" />
          <col className="w-[25%]" />
        </colgroup>
        <thead>
          <tr className="bg-rose-50 text-[#70100a]">
            <th className="rounded-l-lg px-1.5 py-2 font-semibold sm:px-2">Fecha</th>
            <th className="px-1.5 py-2 font-semibold sm:px-2">Curso</th>
            <th className="rounded-r-lg px-1.5 py-2 text-right font-semibold sm:px-2">
              Asistencia
            </th>
          </tr>
        </thead>
        <tbody>
          {classes.map((classItem) => (
            <tr key={classItem.id} className="border-b border-slate-100 last:border-0">
              <td className="whitespace-nowrap px-1.5 py-2 text-slate-600 sm:px-2">
                {dateFormat.format(new Date(classItem.start_time))}
              </td>
              <td className="overflow-hidden px-1.5 py-2 sm:px-2">
                <span className="block truncate font-medium text-slate-700">
                  {classItem.course_name}
                </span>
                <span className="block truncate text-[8px] text-slate-400 sm:text-[9px]">
                  {classItem.title}
                </span>
              </td>
              <td className="whitespace-nowrap px-1.5 py-2 text-right sm:px-2">
                <span
                  className="inline-flex max-w-full items-center justify-end gap-1 font-semibold text-slate-700"
                  title={`${numberFormat.format(classItem.present)} asistencias registradas`}
                  aria-label={`${numberFormat.format(classItem.present)} asistencias registradas`}
                >
                  <i
                    className={`fa-solid fa-circle-check shrink-0 text-[11px] ${
                      classItem.present ? "text-emerald-500" : "text-slate-300"
                    }`}
                    aria-hidden="true"
                  />
                  {numberFormat.format(classItem.present)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadingGrid({ count = 3 }) {
  const metricColumns = count >= 5 ? "sm:grid-cols-2 xl:grid-cols-5" : "sm:grid-cols-3";
  return (
    <div className="space-y-3" aria-label="Cargando estadísticas">
      <div className={`grid gap-3 ${metricColumns}`}>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="h-[78px] animate-pulse rounded-xl border border-rose-100 bg-rose-50/60"
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <div
            key={`panel-${item}`}
            className="h-56 animate-pulse rounded-xl border border-rose-100 bg-rose-50/40"
          />
        ))}
      </div>
    </div>
  );
}
