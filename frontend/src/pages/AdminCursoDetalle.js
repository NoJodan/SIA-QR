import React, { useEffect, useRef, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminGetGroupClasses } from "../services/academic";
import { getClassAttendances } from "../services/attendance";
import {
  CLASS_STATUS_COLORS,
  CLASS_STATUS_LABELS,
  MODALITY_LABELS,
  effectiveClassStatus,
} from "../utils/classMeta";
import { formatBogotaDate, formatBogotaTime } from "../utils/dates";
import { courseIcon } from "../utils/courseIcon";
import useDebounce from "../utils/useDebounce";
import useNow from "../utils/useNow";

const CLASS_CARD_ACCENT = "bg-[#B3200E]";
const STATUS_ICON = {
  SCHEDULED: "fa-regular fa-clock",
  IN_PROGRESS: "fa-solid fa-circle",
  COMPLETED: "fa-solid fa-check",
  CANCELLED: "fa-solid fa-ban",
};
const MODALITY_ICON = {
  PRESENTIAL: "fa-solid fa-location-dot",
  VIRTUAL: "fa-solid fa-video",
};

export default function AdminCursoDetalle({ group, onBack }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [statusView, setStatusView] = useState("ALL");
  const [detailClass, setDetailClass] = useState(null);
  const [attendances, setAttendances] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState("");
  const debounced = useDebounce(search, 300);
  const now = useNow();
  const seqRef = useRef(0);
  const attSeqRef = useRef(0);

  const load = (s = debounced, p = page, st = statusView) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setError("");
    return adminGetGroupClasses(group.id, s, p, st === "ALL" ? "" : st)
      .then((data) => {
        if (seq !== seqRef.current) return;
        setClasses(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => {
        if (seq === seqRef.current) setError("No se pudieron cargar las clases.");
      });
  };

  useEffect(() => {
    setLoading(true);
    load(debounced, page).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, debounced, page, statusView]);

  useEffect(() => {
    const id = setInterval(() => load(), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, debounced, page, statusView]);

  const totalPages = Math.max(1, Math.ceil(count / 10));

  const openDetails = async (c) => {
    const seq = attSeqRef.current + 1;
    attSeqRef.current = seq;
    setDetailClass(c);
    setAttendances([]);
    setAttError("");
    setAttLoading(true);
    const rows = [];
    try {
      // El endpoint pagina (page_size máx. 50): recorrer hasta la última página.
      for (let p = 1; ; p += 1) {
        const data = await getClassAttendances(c.id, p, 50);
        if (seq !== attSeqRef.current) return;
        const pageRows = data.results || [];
        rows.push(...pageRows);
        // Sin `next` es la última página; sin filas, cortar evita un bucle infinito.
        if (!data.next || pageRows.length === 0) break;
      }
      if (seq === attSeqRef.current) setAttendances(rows);
    } catch {
      if (seq === attSeqRef.current) setAttError("No se pudieron cargar las asistencias.");
    } finally {
      if (seq === attSeqRef.current) setAttLoading(false);
    }
  };

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="course-back-link mb-2">
          ← Volver
        </button>
      )}
      <section className="course-banner mb-4">
        <svg className="course-banner-waves" preserveAspectRatio="none" viewBox="0 0 500 320" aria-hidden="true">
          <path d="M500,0 C380,0 280,50 150,160 C50,240 100,320 0,320 L500,320 Z" fill="#ffdede" opacity="0.4" />
          <path d="M500,80 C400,100 350,180 250,230 C150,280 180,320 100,320 L500,320 Z" fill="#ffcdcd" opacity="0.5" />
        </svg>
        <div aria-hidden="true" className="course-banner-dots course-banner-dots-top" />
        <div aria-hidden="true" className="course-banner-dots course-banner-dots-bottom" />
        <div className="course-banner-left">
          <div className="course-banner-title-wrap">
            <div className="course-banner-icon">
              <i className={`fa-solid ${courseIcon(group.course?.name)}`} aria-hidden="true" />
            </div>
            <div className="course-banner-title-area">
              <span className="course-group-pill"><i className="fa-solid fa-layer-group" aria-hidden="true" />Grupo {group.group_code} · {group.term_period}</span>
              <h2>{group.course?.name}</h2>
            </div>
          </div>
          <p className="course-banner-desc">Vista de administrador (solo lectura de cursos, edición de clases permitida).</p>
        </div>
      </section>

      <div className="sticky top-0 z-10 mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center">
        <div className="w-full md:max-w-sm">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="filtro-estado-admin2" className="text-xs font-medium text-slate-600">
            Filtrar vista
          </label>
          <select
            id="filtro-estado-admin2"
            value={statusView}
            onChange={(e) => { setStatusView(e.target.value); setPage(1); }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          >
            <option value="ALL">Todas</option>
            <option value="SCHEDULED">Programadas</option>
            <option value="IN_PROGRESS">En progreso</option>
            <option value="COMPLETED">Finalizadas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
        </div>
      </div>

      {editing && (
        <Modal title="Editar clase" onClose={() => setEditing(null)}>
          <CreateClassForm
            groupId={group.id}
            initial={editing}
            isAdmin
            onUpdated={async () => { setEditing(null); await load(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {detailClass && (
        <Modal title={`Asistencias · ${detailClass.title}`} onClose={() => setDetailClass(null)}>
          {attLoading && <p className="text-sm text-slate-500">Cargando asistencias…</p>}
          {!attLoading && attError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {attError}
            </p>
          )}
          {!attLoading && !attError && attendances.length === 0 && (
            <p className="text-sm text-slate-500">Sin marcaciones registradas.</p>
          )}
          {!attLoading && attendances.length > 0 && (
            <ul className="space-y-2">
              {attendances.map((a) => (
                <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-semibold text-slate-800">{a.student_name || a.student?.first_name}</p>
                  <p className="text-xs text-slate-500">
                    {formatBogotaDate(a.registered_at)} · {formatBogotaTime(a.registered_at)} · {a.inside_range === false ? "Fuera de rango" : a.inside_range === true ? "Dentro de rango" : "Sin rango"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 mt-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && classes.length === 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">📅</p>
          <p className="mt-2 text-sm text-slate-600">No hay clases programadas.</p>
        </div>
      )}
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {classes.map((c) => {
          const status = effectiveClassStatus(c, now);
          return (
            <li key={c.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#B3200E]/25 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${CLASS_CARD_ACCENT}`} />
              <div className="p-5 pl-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${CLASS_STATUS_COLORS[status] || "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                    <i className={STATUS_ICON[status]} aria-hidden="true" /> {CLASS_STATUS_LABELS[status] || status}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    <i className={MODALITY_ICON[c.modality] || "fa-solid fa-circle-info"} aria-hidden="true" /> {MODALITY_LABELS[c.modality] || c.modality}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900 break-words group-hover:text-[#B3200E]">{c.title}</h3>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
                  <li className="inline-flex items-center gap-1.5"><i className="fa-regular fa-calendar" aria-hidden="true" />{formatBogotaDate(c.start_time)}</li>
                  <li className="inline-flex items-center gap-1.5"><i className="fa-regular fa-clock" aria-hidden="true" />{formatBogotaTime(c.start_time)} · {c.duration_minutes} min</li>
                  <li className="inline-flex items-center gap-1.5"><i className="fa-solid fa-qrcode" aria-hidden="true" />QR {c.qr_duration_minutes ?? 10} min</li>
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => openDetails(c)} aria-label={`Ver detalles de ${c.title}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40">
                    <i className="fa-regular fa-eye" aria-hidden="true" /> Ver detalles
                  </button>
                  <button type="button" onClick={() => setEditing(c)} aria-label={`Editar ${c.title}`} className="inline-flex items-center gap-1.5 rounded-xl bg-[#B3200E] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40">
                    <i className="fa-solid fa-pen" aria-hidden="true" /> Editar
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} clase(s)`} />
    </div>
  );
}
