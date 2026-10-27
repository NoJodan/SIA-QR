import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MultiSelect from "../components/MultiSelect";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { getGroupsCache, setGroupsCache } from "../services/academic";
import api from "../services/api";
import {
  MAX_EXPORT_ROWS,
  MAX_PDF_ROWS,
  downloadReport,
  getReportPreview,
  reportErrorMessage,
} from "../services/reports";
import { CLASS_STATUS_COLORS, CLASS_STATUS_LABELS, MODALITY_LABELS } from "../utils/classMeta";
import { formatBogota } from "../utils/dates";

const PAGE_SIZE = 10;

const cardCls = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const selectCls = `${inputCls} appearance-none pr-9`;
const labelCls =
  "mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600";
const primaryBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#B3200E] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtnCls =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40";

function Field({ id, icon, label, help, helpId, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelCls}>
        <i className={`fa-solid ${icon} text-[#B3200E]/80`} aria-hidden="true" />
        {label}
      </label>
      {children}
      {help && (
        <p id={helpId} className="mt-1 text-xs text-slate-400">
          {help}
        </p>
      )}
    </div>
  );
}

function ChevronSelect({ id, value, onChange, disabled, children }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={onChange} disabled={disabled} className={selectCls}>
        {children}
      </select>
      <i
        className="fa-solid fa-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
        aria-hidden="true"
      />
    </div>
  );
}

function ReportesIllustration() {
  return (
    <div
      aria-hidden="true"
      className="hidden h-28 w-28 shrink-0 items-center justify-center rounded-full bg-red-50 sm:flex lg:h-32 lg:w-32"
    >
      <svg viewBox="0 0 128 128" className="h-24 w-24 lg:h-28 lg:w-28" fill="none" role="presentation">
        <circle cx="64" cy="64" r="54" fill="#FDEDEA" />
        <rect x="28" y="24" width="54" height="76" rx="9" fill="#fff" stroke="#B3200E" strokeWidth="3" />
        <rect x="43" y="17" width="24" height="13" rx="5" fill="#B3200E" />
        <path d="M40 46l4 4 7-7" stroke="#B3200E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="57" y1="46" x2="71" y2="46" stroke="#F3B8B1" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 62l4 4 7-7" stroke="#B3200E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="57" y1="62" x2="69" y2="62" stroke="#F3B8B1" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 78l4 4 7-7" stroke="#B3200E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="57" y1="78" x2="67" y2="78" stroke="#F3B8B1" strokeWidth="3" strokeLinecap="round" />
        <rect x="66" y="62" width="44" height="42" rx="7" fill="#fff" stroke="#B3200E" strokeWidth="3" />
        <path d="M67 75h42" stroke="#B3200E" strokeWidth="3" />
        <path d="M78 57v9M99 57v9" stroke="#B3200E" strokeWidth="3" strokeLinecap="round" />
        <circle cx="80" cy="87" r="3" fill="#B3200E" />
        <circle cx="94" cy="87" r="3" fill="#F3B8B1" />
        <circle cx="80" cy="97" r="3" fill="#F3B8B1" />
        <circle cx="94" cy="97" r="3" fill="#B3200E" />
      </svg>
    </div>
  );
}

// Trae todas las páginas (page_size 50) de un endpoint paginado DRF.
// Tope de seguridad: 20 páginas (1000 ítems). Si hay más, avisa en consola
// y la UI lo indica: refina filtros o pagina en el servidor.
async function fetchAll(path, params = {}) {
  const items = [];
  let url = path;
  let query = { page_size: 50, ...params };
  let truncated = false;
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await api.get(url, { params: query });
    const results = Array.isArray(data) ? data : data.results || [];
    items.push(...results);
    if (Array.isArray(data) || !data.next) break;
    url = data.next;
    query = {};
    if (i === 19 && data.next) truncated = true;
  }
  if (truncated) {
    // eslint-disable-next-line no-console
    console.warn(`[Reportes] fetchAll truncado a 1000 ítems en ${path}: hay más páginas.`);
  }
  return items;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const emptyFilters = {
  courseId: "",
  groupId: "",
  classId: "",
  sessionId: "",
  dateFrom: "",
  dateTo: "",
  registeredFrom: "",
  registeredTo: "",
  document: "",
  studentCode: "",
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
  const [truncatedNote, setTruncatedNote] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const searchSeq = useRef(0);
  const classesSeq = useRef(0);

  // Carga en cascada: grupos propios (prof) o todos (admin).
  useEffect(() => {
    setTruncatedNote("");
    const cached = getGroupsCache(isAdmin);
    if (cached) {
      setGroups(cached);
      setGroupsLoading(false);
      if (cached.length >= 1000) {
        setTruncatedNote("La lista de grupos se truncó a 1000: refina filtros si falta alguno.");
      }
      return;
    }
    setGroupsLoading(true);
    const path = isAdmin ? "/api/academic/admin/groups/" : "/api/academic/my-groups/";
    fetchAll(path)
      .then((items) => {
        setGroupsCache(isAdmin, items);
        setGroups(items);
        if (items.length >= 1000) {
          setTruncatedNote("La lista de grupos se truncó a 1000: refina filtros si falta alguno.");
        }
      })
      .catch(() => setError("No se pudieron cargar los grupos para los filtros."))
      .finally(() => setGroupsLoading(false));
  }, [isAdmin]);

  // Clases del grupo seleccionado (cascada grupo -> clases).
  useEffect(() => {
    const seq = classesSeq.current + 1;
    classesSeq.current = seq;
    setClasses([]);
    if (!draft.groupId) return;
    setClassesLoading(true);
    const path = isAdmin
      ? `/api/academic/admin/groups/${draft.groupId}/classes/`
      : `/api/academic/groups/${draft.groupId}/classes/`;
    fetchAll(path)
      .then((items) => {
        if (seq === classesSeq.current) setClasses(items);
      })
      .catch(() => {
        if (seq === classesSeq.current) setError("No se pudieron cargar las clases del grupo.");
      })
      .finally(() => {
        if (seq === classesSeq.current) setClassesLoading(false);
      });
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
    // classId acepta multiselección coma-separada (backend MultipleUUIDField
    // tolera lista, coma o ?class_id=a&class_id=b).
    if (filters.classId) p.class_id = filters.classId;
    if (filters.sessionId && filters.sessionId.trim()) {
      p.session_id = filters.sessionId.trim();
    }
    if (filters.dateFrom) p.date_from = filters.dateFrom;
    if (filters.dateTo) p.date_to = filters.dateTo;
    if (filters.registeredFrom) p.registered_from = filters.registeredFrom;
    if (filters.registeredTo) p.registered_to = filters.registeredTo;
    if (filters.document && filters.document.trim()) {
      p.document = filters.document.trim();
    }
    if (filters.studentCode && filters.studentCode.trim()) {
      p.student_code = filters.studentCode.trim();
    }
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
    const seq = searchSeq.current + 1;
    searchSeq.current = seq;
    setLoading(true);
    setError("");
    try {
      const data = await getReportPreview(buildParams(filters), pageNum, PAGE_SIZE);
      if (seq !== searchSeq.current) return;
      setResults(data.results || []);
      setCount(data.count || 0);
      setSearched(true);
    } catch (err) {
      const { status, message } = await reportErrorMessage(err, "No se pudo cargar el reporte.");
      if (seq !== searchSeq.current) return;
      if (status === 403) {
        setError("No tienes permiso para ver este reporte.");
      } else {
        setError(message);
      }
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, [buildParams]);

  const handleBuscar = () => {
    // Usa draft.search directo: el valor con debounce quedaba stale si el
    // usuario pulsaba Buscar antes de los 300 ms (MEDIO 2 QA).
    if (isAdmin && draft.professorId.trim() && !UUID_RE.test(draft.professorId.trim())) {
      setError("El ID de profesor debe ser un UUID válido.");
      setShowAdvanced(true);
      return;
    }
    if (draft.sessionId.trim() && !UUID_RE.test(draft.sessionId.trim())) {
      setError("El ID de sesión debe ser un UUID válido.");
      return;
    }
    const filters = { ...draft };
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

  const setMultiClass = (selected) => {
    setDraft((prev) => ({ ...prev, classId: selected.join(",") }));
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const overCapXlsx = count > MAX_EXPORT_ROWS;
  const overCapPdf = count > MAX_PDF_ROWS;
  const canXlsx = searched && !loading && !downloading && count > 0 && !overCapXlsx;
  const canPdf = searched && !loading && !downloading && count > 0 && !overCapPdf;

  return (
    <div className="space-y-4">
      <section className={`${cardCls} sm:p-6`}>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#B3200E] text-white shadow-sm">
                <i className="fa-solid fa-clipboard-check text-xl" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-900">Reportes de asistencia</h1>
                  {searched && (
                    <span className="inline-flex items-center rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-semibold text-[#B3200E]">
                      {count} registro(s)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Filtra y genera el reporte de asistencia de tus cursos.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDownload("xlsx")}
                disabled={!canXlsx}
                className={primaryBtnCls}
              >
                <i className="fa-solid fa-download" aria-hidden="true" />
                {downloading === "xlsx" ? "Generando..." : "Descargar Excel"}
              </button>
              <button
                type="button"
                onClick={() => handleDownload("pdf")}
                disabled={!canPdf}
                title={`PDF limitado a ${MAX_PDF_ROWS} registros`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#B3200E]/40 bg-white px-4 py-2.5 text-sm font-semibold text-[#B3200E] transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fa-solid fa-file-pdf" aria-hidden="true" />
                {downloading === "pdf" ? "Generando..." : "Descargar PDF"}
              </button>
            </div>
          </div>
          <ReportesIllustration />
        </div>

        {overCapXlsx && searched && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            El reporte supera el máximo de {MAX_EXPORT_ROWS} registros para Excel. Refina los filtros.
          </p>
        )}
        {!overCapXlsx && overCapPdf && searched && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            El PDF admite hasta {MAX_PDF_ROWS} registros (Excel hasta {MAX_EXPORT_ROWS}). Refina los filtros para PDF.
          </p>
        )}
      </section>

      <section className={`${cardCls} relative z-20`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field id="rep-curso" icon="fa-graduation-cap" label="Curso">
            <ChevronSelect
              id="rep-curso"
              value={draft.courseId}
              onChange={set("courseId")}
              disabled={groupsLoading}
            >
              <option value="">Todos</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </ChevronSelect>
          </Field>

          <Field id="rep-grupo" icon="fa-users" label="Grupo">
            <ChevronSelect
              id="rep-grupo"
              value={draft.groupId}
              onChange={set("groupId")}
              disabled={groupsLoading}
            >
              <option value="">Todos</option>
              {visibleGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.course?.name} · G{g.group_code} ({g.term_period})
                </option>
              ))}
            </ChevronSelect>
          </Field>

          <Field
            id="rep-clase"
            icon="fa-book"
            label="Clase(s)"
            help={draft.groupId && !classesLoading ? "Sin selección = todas las clases." : undefined}
          >
            <MultiSelect
              id="rep-clase"
              options={classes.map((c) => ({ value: c.id, label: c.title }))}
              value={draft.classId ? draft.classId.split(",").filter(Boolean) : []}
              onChange={setMultiClass}
              disabled={!draft.groupId || classesLoading}
              placeholder={
                !draft.groupId
                  ? "Elige un grupo primero"
                  : classesLoading
                    ? "Cargando clases..."
                    : "Selecciona una o varias clases"
              }
              ariaLabel="Clases del grupo"
            />
          </Field>
        </div>

        {truncatedNote && (
          <p role="status" className="mt-3 text-xs text-amber-700">{truncatedNote}</p>
        )}
      </section>

      <section className={cardCls}>
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-800">
          <i className="fa-solid fa-calendar-days text-[#B3200E]" aria-hidden="true" />
          Periodo de búsqueda
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="rep-desde" icon="fa-calendar-day" label="Desde (AAAA-MM-DD)">
            <input
              id="rep-desde"
              type="date"
              value={draft.dateFrom}
              onChange={set("dateFrom")}
              className={inputCls}
            />
          </Field>
          <Field id="rep-hasta" icon="fa-calendar-day" label="Hasta (AAAA-MM-DD)">
            <input
              id="rep-hasta"
              type="date"
              value={draft.dateTo}
              onChange={set("dateTo")}
              className={inputCls}
            />
          </Field>
          <Field id="rep-documento" icon="fa-id-card" label="Documento">
            <input
              id="rep-documento"
              value={draft.document}
              onChange={set("document")}
              placeholder="N.º documento"
              className={inputCls}
            />
          </Field>
          {isAdmin && (
            <Field id="rep-sesion" icon="fa-qrcode" label="ID de sesión">
              <input
                id="rep-sesion"
                value={draft.sessionId}
                onChange={set("sessionId")}
                placeholder="UUID de la sesión"
                className={inputCls}
              />
            </Field>
          )}
        </div>
      </section>

      <section
        id="rep-avanzados"
        aria-labelledby="rep-avanzados-title"
        className={`${cardCls} ${showAdvanced ? "" : "hidden"}`}
      >
        <h2
          id="rep-avanzados-title"
          className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-800"
        >
          <i className="fa-solid fa-filter text-[#B3200E]" aria-hidden="true" />
          Filtros adicionales
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="rep-codigo" icon="fa-hashtag" label="Código estudiante">
            <input
              id="rep-codigo"
              value={draft.studentCode}
              onChange={set("studentCode")}
              placeholder="Código"
              className={inputCls}
            />
          </Field>

          <Field id="rep-search" icon="fa-magnifying-glass" label="Documentos, código o nombre">
            <SearchBar
              id="rep-search"
              value={draft.search}
              onChange={(v) => setDraft((p) => ({ ...p, search: v }))}
              placeholder="Buscar estudiante..."
            />
          </Field>

          <Field id="rep-estado" icon="fa-list-check" label="Estado de clase">
            <ChevronSelect id="rep-estado" value={draft.classStatus} onChange={set("classStatus")}>
              <option value="">Todos</option>
              <option value="SCHEDULED">Programada</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="COMPLETED">Finalizada</option>
              <option value="CANCELLED">Cancelada</option>
            </ChevronSelect>
          </Field>

          <Field id="rep-modalidad" icon="fa-chalkboard-user" label="Modalidad">
            <ChevronSelect id="rep-modalidad" value={draft.modality} onChange={set("modality")}>
              <option value="">Todas</option>
              <option value="PRESENTIAL">Presencial</option>
              <option value="VIRTUAL">Mediada</option>
            </ChevronSelect>
          </Field>

          <Field id="rep-ubicacion" icon="fa-location-dot" label="Ubicación">
            <ChevronSelect id="rep-ubicacion" value={draft.hasLocation} onChange={set("hasLocation")}>
              <option value="all">Todas</option>
              <option value="true">Con ubicación</option>
              <option value="false">Sin ubicación</option>
            </ChevronSelect>
          </Field>

          {isAdmin && (
            <>
              <Field id="rep-reg-desde" icon="fa-clock" label="Registro desde">
                <input
                  id="rep-reg-desde"
                  type="date"
                  value={draft.registeredFrom}
                  onChange={set("registeredFrom")}
                  className={inputCls}
                />
              </Field>

              <Field id="rep-reg-hasta" icon="fa-clock" label="Registro hasta">
                <input
                  id="rep-reg-hasta"
                  type="date"
                  value={draft.registeredTo}
                  onChange={set("registeredTo")}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {isAdmin && (
            <Field
              id="rep-profesor"
              icon="fa-user-tie"
              label="ID de profesor (solo admin)"
              help="UUID v4 del profesor. Se valida antes de buscar."
              helpId="rep-profesor-ayuda"
            >
              <input
                id="rep-profesor"
                value={draft.professorId}
                onChange={set("professorId")}
                placeholder="UUID del profesor"
                inputMode="text"
                aria-describedby="rep-profesor-ayuda"
                className={inputCls}
              />
            </Field>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleBuscar} disabled={loading} className={primaryBtnCls}>
          <i
            className={`fa-solid ${loading ? "fa-spinner fa-spin" : "fa-magnifying-glass"}`}
            aria-hidden="true"
          />
          {loading ? "Buscando..." : "Buscar"}
        </button>
        <button type="button" onClick={handleLimpiar} className={secondaryBtnCls}>
          <i className="fa-solid fa-eraser" aria-hidden="true" />
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          aria-controls="rep-avanzados"
          className={`ml-auto inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 ${
            showAdvanced
              ? "border-[#B3200E]/30 bg-red-50 text-[#B3200E] hover:bg-red-50"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <i className="fa-solid fa-filter" aria-hidden="true" />
          Filtros adicionales
          <i
            className={`fa-solid ${showAdvanced ? "fa-chevron-down" : "fa-chevron-up"} text-[10px] transition-transform`}
            aria-hidden="true"
          />
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && (
        <div className={`${cardCls} animate-pulse`} aria-hidden="true">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <div className={`${cardCls} text-center`}>
          <p aria-hidden="true" className="text-3xl text-slate-300">
            <i className="fa-solid fa-file-export" />
          </p>
          <p className="mt-2 text-sm text-slate-600">Sin resultados para los filtros elegidos.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
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
                  <tr key={r.id} className="transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <p className="break-words font-medium text-slate-800">{r.student_name}</p>
                      <p className="break-words text-xs text-slate-500">
                        {r.student_code} · {r.document_number}
                      </p>
                    </td>
                    <td className="break-words px-4 py-3 text-slate-600">
                      {r.course_name}
                      <span className="block text-xs text-slate-400">
                        G{r.group_code} · {r.term_period}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="break-words text-slate-700">{r.class_title}</p>
                      <span
                        className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs ${CLASS_STATUS_COLORS[r.class_status] || "border border-slate-200 bg-slate-100 text-slate-600"}`}
                      >
                        {CLASS_STATUS_LABELS[r.class_status] || r.class_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {MODALITY_LABELS[r.modality] || r.modality}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBogota(r.registered_at)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${r.has_location ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}
                      >
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
