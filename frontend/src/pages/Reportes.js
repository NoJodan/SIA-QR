import React, { useCallback, useEffect, useMemo, useState } from "react";
import Pagination from "../components/Pagination";
import ProfHeader from "../components/ProfHeader";
import SearchBar from "../components/SearchBar";
import api from "../services/api";
import {
  MAX_EXPORT_ROWS,
  downloadReport,
  getReportPreview,
  reportErrorMessage,
} from "../services/reports";
import { formatBogota } from "../utils/dates";
import useDebounce from "../utils/useDebounce";

const PAGE_SIZE = 10;

const modalityLabels = { PRESENTIAL: "Presencial", VIRTUAL: "Virtual" };
const statusLabels = {
  SCHEDULED: "Programada",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Finalizada",
  CANCELLED: "Cancelada",
};
const statusColors = {
  SCHEDULED: "bg-amber-50 text-amber-700 border border-amber-200",
  IN_PROGRESS: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  COMPLETED: "bg-slate-100 text-slate-600 border border-slate-200",
  CANCELLED: "bg-red-50 text-red-700 border border-red-200",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20";
const labelCls = "block text-xs font-medium text-slate-600 mb-1";

// Trae todas las páginas (page_size 50) de un endpoint paginado DRF.
async function fetchAll(path, params = {}) {
  const items = [];
  let url = path;
  let query = { page_size: 50, ...params };
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await api.get(url, { params: query });
    const results = Array.isArray(data) ? data : data.results || [];
    items.push(...results);
    if (Array.isArray(data) || !data.next) break;
    url = data.next;
    query = {};
  }
  return items;
}

const emptyFilters = {
  courseId: "",
  groupId: "",
  classId: "",
  dateFrom: "",
  dateTo: "",
  search: "",
  classStatus: "",
  modality: "",
  hasLocation: "all",
  professorId: "",
};

export default function Reportes({ isAdmin = false }) {
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(null);
  const [results, setResults] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(null);
  const debouncedSearch = useDebounce(draft.search, 300);

  // Carga en cascada: grupos propios (prof) o todos (admin).
  useEffect(() => {
    setGroupsLoading(true);
    const path = isAdmin ? "/api/academic/admin/groups/" : "/api/academic/my-groups/";
    fetchAll(path)
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [isAdmin]);

  // Clases del grupo seleccionado (cascada grupo -> clases).
  useEffect(() => {
    setClasses([]);
    if (!draft.groupId) return;
    setClassesLoading(true);
    const path = isAdmin
      ? `/api/academic/admin/groups/${draft.groupId}/classes/`
      : `/api/academic/groups/${draft.groupId}/classes/`;
    fetchAll(path)
      .then(setClasses)
      .catch(() => setClasses([]))
      .finally(() => setClassesLoading(false));
  }, [draft.groupId, isAdmin]);

  const courses = useMemo(() => {
    const seen = new Map();
    groups.forEach((g) => {
      const c = g.course;
      if (c && !seen.has(c.id)) seen.set(c.id, c);
    });
    return [...seen.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [groups]);

  const visibleGroups = useMemo(() => {
    if (!draft.courseId) return groups;
    return groups.filter((g) => g.course?.id === draft.courseId);
  }, [groups, draft.courseId]);

  const buildParams = useCallback((filters) => {
    const p = {};
    if (filters.courseId) p.course_id = filters.courseId;
    if (filters.groupId) p.group_id = filters.groupId;
    if (filters.classId) p.class_id = filters.classId;
    if (filters.dateFrom) p.date_from = filters.dateFrom;
    if (filters.dateTo) p.date_to = filters.dateTo;
    if (filters.search.trim()) p.search = filters.search.trim();
    if (filters.classStatus) p.class_status = filters.classStatus;
    if (filters.modality) p.modality = filters.modality;
    if (filters.hasLocation && filters.hasLocation !== "all") {
      p.has_location = filters.hasLocation;
    }
    if (isAdmin && filters.professorId.trim()) {
      p.professor_id = filters.professorId.trim();
    }
    return p;
  }, [isAdmin]);

  const runSearch = useCallback(async (filters, pageNum) => {
    setLoading(true);
    setError("");
    try {
      const data = await getReportPreview(buildParams(filters), pageNum, PAGE_SIZE);
      setResults(data.results || []);
      setCount(data.count || 0);
      setSearched(true);
    } catch (err) {
      const { status, message } = await reportErrorMessage(err, "No se pudo cargar el reporte.");
      if (status === 401) {
        window.location.href = isAdmin ? "/admin-login" : "/login";
        return;
      }
      if (status === 403) {
        setError("No tienes permiso para ver este reporte.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [buildParams, isAdmin]);

  const handleBuscar = () => {
    const filters = { ...draft, search: debouncedSearch };
    setDraft(filters);
    setApplied(filters);
    setPage(1);
    runSearch(filters, 1);
  };

  const handlePage = (next) => {
    setPage(next);
    if (applied) runSearch(applied, next);
  };

  const handleLimpiar = () => {
    setDraft(emptyFilters);
    setApplied(null);
    setResults([]);
    setCount(0);
    setPage(1);
    setSearched(false);
    setError("");
  };

  const handleDownload = async (fmt) => {
    if (!applied) return;
    setDownloading(fmt);
    setError("");
    try {
      await downloadReport(buildParams(applied), fmt);
    } catch (err) {
      const { status, message } = await reportErrorMessage(err, "No se pudo descargar el reporte.");
      if (status === 401) {
        window.location.href = isAdmin ? "/admin-login" : "/login";
        return;
      }
      if (status === 403) {
        setError("No tienes permiso para descargar este reporte.");
      } else {
        setError(message);
      }
    } finally {
      setDownloading(null);
    }
  };

  const set = (key) => (e) => {
    const value = e.target.value;
    setDraft((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "courseId" ? { groupId: "", classId: "" } : null),
      ...(key === "groupId" ? { classId: "" } : null),
    }));
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const overCap = count > MAX_EXPORT_ROWS;
  const canDownload = searched && !loading && !downloading && count > 0 && !overCap;

  return (
    <div>
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <ProfHeader
          title="Reportes de asistencia"
          subtitle={searched ? `${count} registro(s)` : "Filtra y genera el reporte"}
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleDownload("xlsx")}
            disabled={!canDownload}
            className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading === "xlsx" ? "Generando..." : "Descargar Excel"}
          </button>
          <button
            onClick={() => handleDownload("pdf")}
            disabled={!canDownload}
            className="px-4 py-2 bg-white border border-[#B3200E]/40 text-[#B3200E] hover:bg-red-50 rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading === "pdf" ? "Generando..." : "Descargar PDF"}
          </button>
        </div>
        {overCap && searched && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            El reporte supera el máximo de {MAX_EXPORT_ROWS} registros para descarga. Refina los filtros.
          </p>
        )}
      </section>

      <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div>
            <label htmlFor="rep-curso" className={labelCls}>Curso</label>
            <select id="rep-curso" value={draft.courseId} onChange={set("courseId")} className={inputCls} disabled={groupsLoading}>
              <option value="">Todos</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rep-grupo" className={labelCls}>Grupo</label>
            <select id="rep-grupo" value={draft.groupId} onChange={set("groupId")} className={inputCls} disabled={groupsLoading}>
              <option value="">Todos</option>
              {visibleGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.course?.name} · G{g.group_code} ({g.term_period})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rep-clase" className={labelCls}>Clase</label>
            <select id="rep-clase" value={draft.classId} onChange={set("classId")} className={inputCls} disabled={!draft.groupId || classesLoading}>
              <option value="">{!draft.groupId ? "Elige un grupo" : "Todas"}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rep-desde" className={labelCls}>Desde (AAAA-MM-DD)</label>
            <input id="rep-desde" type="date" value={draft.dateFrom} onChange={set("dateFrom")} className={inputCls} />
          </div>
          <div>
            <label htmlFor="rep-hasta" className={labelCls}>Hasta (AAAA-MM-DD)</label>
            <input id="rep-hasta" type="date" value={draft.dateTo} onChange={set("dateTo")} className={inputCls} />
          </div>
          <div>
            <label htmlFor="rep-search" className={labelCls}>Documento, código o nombre</label>
            <SearchBar value={draft.search} onChange={(v) => setDraft((p) => ({ ...p, search: v }))} placeholder="Buscar estudiante..." />
          </div>
          <div>
            <label htmlFor="rep-estado" className={labelCls}>Estado de clase</label>
            <select id="rep-estado" value={draft.classStatus} onChange={set("classStatus")} className={inputCls}>
              <option value="">Todos</option>
              <option value="SCHEDULED">Programada</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="COMPLETED">Finalizada</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
          </div>
          <div>
            <label htmlFor="rep-modalidad" className={labelCls}>Modalidad</label>
            <select id="rep-modalidad" value={draft.modality} onChange={set("modality")} className={inputCls}>
              <option value="">Todas</option>
              <option value="PRESENTIAL">Presencial</option>
              <option value="VIRTUAL">Virtual</option>
            </select>
          </div>
          <div>
            <label htmlFor="rep-ubicacion" className={labelCls}>Ubicación</label>
            <select id="rep-ubicacion" value={draft.hasLocation} onChange={set("hasLocation")} className={inputCls}>
              <option value="all">Todas</option>
              <option value="true">Con ubicación</option>
              <option value="false">Sin ubicación</option>
            </select>
          </div>
          {isAdmin && (
            <div>
              <label htmlFor="rep-profesor" className={labelCls}>ID de profesor (solo admin)</label>
              <input
                id="rep-profesor"
                value={draft.professorId}
                onChange={set("professorId")}
                placeholder="UUID del profesor"
                className={inputCls}
              />
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleBuscar}
            disabled={loading}
            className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
          <button
            onClick={handleLimpiar}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            Limpiar
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
        </p>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-pulse" aria-hidden="true">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl text-slate-300">
            <i className="fa-solid fa-file-export"></i>
          </p>
          <p className="mt-2 text-sm text-slate-600">Sin resultados para los filtros elegidos.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Estudiante</th>
                  <th className="px-4 py-3">Curso / Grupo</th>
                  <th className="px-4 py-3">Clase</th>
                  <th className="px-4 py-3">Modalidad</th>
                  <th className="px-4 py-3">Registrado</th>
                  <th className="px-4 py-3">Ubicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 break-words">{r.student_name}</p>
                      <p className="text-xs text-slate-500 break-words">{r.student_code} · {r.document_number}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 break-words">
                      {r.course_name}
                      <span className="block text-xs text-slate-400">G{r.group_code} · {r.term_period}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700 break-words">{r.class_title}</p>
                      <span className={`mt-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full ${statusColors[r.class_status] || "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                        {statusLabels[r.class_status] || r.class_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        {modalityLabels[r.modality] || r.modality}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatBogota(r.registered_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border ${r.has_location ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                        {r.has_location ? "Sí" : "No"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && results.length > 0 && (
        <Pagination page={page} totalPages={totalPages} onChange={handlePage} countLabel={`${count} registro(s)`} />
      )}
    </div>
  );
}
