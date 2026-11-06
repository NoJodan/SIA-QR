import React, { useEffect, useMemo, useState } from "react";
import {
  AttendanceDonut,
  AttendanceTrend,
  CourseAttendanceChart,
  CourseExtremes,
  LoadingGrid,
  MetricCard,
  Panel,
  PERIOD_OPTIONS,
  RecentClasses,
  StatsToolbar,
  TopAttendances,
} from "../components/StatsPanels";
import { getStats } from "../services/stats";

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

    getStats({ period, courseId }, { signal: controller.signal })
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
      ? "Histórico"
      : PERIOD_OPTIONS.find((option) => option.value === period)?.label;

  return (
    <section className="relative z-10 mx-auto min-h-full w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
      <header className="mb-3 flex min-h-12 items-center sm:mb-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[25px] font-bold leading-none tracking-tight text-[#7d120c] sm:text-[28px]">
            <i className="fa-solid fa-chart-simple text-[21px] sm:text-2xl" aria-hidden="true" />
            Resumen
          </h1>
          <p className="mt-1.5 text-[11px] leading-tight text-slate-600 sm:text-xs">
            Visualiza las estadísticas de asistencia de tus clases y cursos.
          </p>
        </div>
      </header>

      <StatsToolbar
        icon="fa-graduation-cap"
        title="Mis cursos"
        subtitle="Información de tus clases y estudiantes"
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
                hasComparison={period !== "all"}
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
                hasComparison={period !== "all"}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,1.2fr)]">
              <Panel title="Estudiantes distintos por curso" icon="fa-chart-column">
                <CourseAttendanceChart courses={stats.courses} />
              </Panel>
              <Panel title="Asistencias con y sin localización" icon="fa-location-dot">
                <AttendanceDonut attendance={stats.attendance} />
              </Panel>
              <Panel title="Evolución de la asistencia" icon="fa-chart-line" subtitle={trendLabel}>
                <AttendanceTrend trend={stats.trend} granularity={stats.granularity} />
              </Panel>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.25fr)]">
              <Panel title="Cursos con más y menos marcaciones" icon="fa-trophy">
                <CourseExtremes courses={stats.courses} />
              </Panel>
              <Panel title="Estudiantes con más marcaciones" icon="fa-user-check">
                <TopAttendances students={stats.top_attendance} />
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
          El total de cursos corresponde {courseId ? "al curso filtrado" : "a tus cursos asignados"}. Las
          variaciones comparan estudiantes y clases con el periodo anterior equivalente. Las asistencias
          cuentan una marcación por estudiante y clase finalizada; la localización se registra solo si el
          estudiante la comparte.
        </p>
      )}
    </section>
  );
}
