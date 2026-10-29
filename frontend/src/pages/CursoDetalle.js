import React, { useEffect, useRef, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { createInstantClass, deleteGroupClass, getGroupClasses } from "../services/academic";
import {
  CLASS_STATUS_COLORS,
  CLASS_STATUS_LABELS,
  MODALITY_LABELS,
  effectiveClassStatus,
} from "../utils/classMeta";
import { formatBogotaDate, formatBogotaTime } from "../utils/dates";
import { getDevicePosition } from "../utils/geolocation";
import { courseIcon } from "../utils/courseIcon";
import useDebounce from "../utils/useDebounce";
import useNow from "../utils/useNow";

// Cambia esta clase para modificar el color del acento lateral de las tarjetas.
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

export default function CursoDetalle({ group, onBack, onSelectClass }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [instantLoading, setInstantLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [statusView, setStatusView] = useState("ALL");
  const debounced = useDebounce(search, 300);
  const now = useNow();
  const seqRef = useRef(0);

  const load = (s = debounced, p = page, st = statusView) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setError("");
    return getGroupClasses(group.id, s, p, st === "ALL" ? "" : st)
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
    // ponytail: polling 30s en lugar de WebSocket (restricción No-Redis)
    const id = setInterval(() => load(), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, debounced, page, statusView]);

  const totalPages = Math.max(1, Math.ceil(count / 10));

  // B3: TTL/título opcionales desde el frontend (el backend usa defaults).
  const [instantTitle, setInstantTitle] = useState("");
  const [instantTtl, setInstantTtl] = useState(10);
  const [instantModality, setInstantModality] = useState("PRESENTIAL");

  const handleInstant = async () => {
    setInstantLoading(true);
    setError("");
    setNotice("");
    // Aviso de rango sin GPS: la clase se crea igual (RNF-06: el GPS nunca
    // impide dar clase); el reintento vive en ClaseDetalle.
    let geoNotice = "";
    try {
      // B3: crea clase IN_PROGRESS + sesión QR en transacción atómica.
      const payload = { modality: instantModality };
      if (instantTitle.trim()) payload.title = instantTitle.trim();
      const ttlNum = Number(instantTtl);
      if (Number.isFinite(ttlNum) && ttlNum >= 1 && ttlNum <= 120) {
        payload.qr_duration_minutes = ttlNum;
      }
      if (instantModality === "PRESENTIAL") {
        // Geocerca automática: fija la referencia GPS del salón al crear la
        // clase presencial. Si el permiso falla, se sigue creando sin rango.
        try {
          const pos = await getDevicePosition();
          payload.geofence_latitude = Number(pos.latitude.toFixed(8));
          payload.geofence_longitude = Number(pos.longitude.toFixed(8));
          if (pos.accuracy != null) payload.geofence_accuracy = Number(pos.accuracy.toFixed(2));
        } catch {
          geoNotice =
            "Clase creada sin rango de ubicación: no se concedió el permiso de GPS. Podrás fijarlo desde el detalle de la clase.";
        }
      }
      const data = await createInstantClass(group.id, payload);
      if (geoNotice) setNotice(geoNotice);
      // Fix aviso fantasma: la B3 devuelve la sesión con attend_url mostrable.
      // Se pasa al detalle para hidratar el QR antes del primer ensure
      // (el GET current-session reusado devuelve attend_url null por hash
      // irreversible). Navegar primero, recargar la lista en segundo plano.
      if (data?.class && onSelectClass) {
        const s = data?.session;
        const initialSession =
          s?.session_id && s?.attend_url
            ? { session_id: s.session_id, attend_url: s.attend_url, expires_at: s.expires_at }
            : null;
        // Reconcilia TTL: el backend persiste qr_duration_minutes, pero si la
        // respuesta trae el default viejo se corrige con s.ttl_minutes.
        const cls = { ...data.class };
        if (s?.ttl_minutes != null && Number(cls.qr_duration_minutes) !== Number(s.ttl_minutes)) {
          cls.qr_duration_minutes = s.ttl_minutes;
        }
        onSelectClass(cls, initialSession);
        load();
      } else {
        await load();
      }
    } catch (err) {
      setError(
        err?.response?.data?.error || "No se pudo crear la clase inmediata."
      );
    } finally {
      setInstantLoading(false);
    }
  };

  const handleDelete = async (classId) => {
    if (!window.confirm("¿Eliminar esta clase?")) return;
    try {
      await deleteGroupClass(group.id, classId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || "No se pudo eliminar la clase.");
    }
  };

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="course-back-link">
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

          <p className="course-banner-desc">Crea clases de manera inmediata o programa para más tarde. Luego podrás verlas en la lista de abajo.</p>

          <div className="course-banner-actions mt-3">
            <details className="group">
              <summary
                className="course-instant-summary"
                aria-label="Opciones de clase inmediata"
              >
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                {instantLoading ? "Creando..." : "Clase inmediata"}
                <span aria-hidden="true" className="course-summary-caret">›</span>
              </summary>
              <div className="course-instant-panel">
                <div>
                  <label htmlFor="instant-title" className="course-input-label">
                    Título inmediata (opcional)
                  </label>
                  <input
                    id="instant-title"
                    value={instantTitle}
                    onChange={(e) => setInstantTitle(e.target.value)}
                    placeholder="Título inmediata (opcional)"
                    maxLength={150}
                    className="course-input"
                  />
                </div>
                <div>
                  <label htmlFor="instant-ttl" className="course-input-label">
                    TTL QR (min)
                  </label>
                  <input
                    id="instant-ttl"
                    type="number"
                    min={1}
                    max={120}
                    value={instantTtl}
                    onChange={(e) => setInstantTtl(e.target.value)}
                    className="course-input course-input-ttl"
                  />
                </div>
                <div>
                  <span id="instant-modality-label" className="course-input-label">
                    Modalidad
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="instant-modality-label"
                    className="course-modality-group"
                  >
                    {[
                      { value: "PRESENTIAL", label: "Presencial" },
                      { value: "VIRTUAL", label: "Mediada" },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        htmlFor={`instant-mod-${opt.value}`}
                        className={`course-modality-option ${instantModality === opt.value ? "selected" : ""}`}
                      >
                        <input
                          id={`instant-mod-${opt.value}`}
                          type="radio"
                          name="instant-modality"
                          value={opt.value}
                          checked={instantModality === opt.value}
                          onChange={(e) => setInstantModality(e.target.value)}
                          className="sr-only"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleInstant}
                  disabled={instantLoading}
                  className="course-create-now"
                >
                  <span aria-hidden="true" className="course-dot" />
                  {instantLoading ? "Creando..." : "Crear ahora"}
                </button>
              </div>
            </details>

            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="course-schedule-btn"
            >
              <i className="fa-regular fa-calendar" aria-hidden="true" /> Programar clase
            </button>
          </div>
        </div>

        <div className="course-banner-right">
          <div className="course-banner-illustration">
            <svg viewBox="0 0 400 250" role="img" aria-label="Ilustración de libros y computador">
              <defs>
                <linearGradient id="laptop-shell" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#d8d8df" />
                </linearGradient>
                <linearGradient id="screen-glow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#34343b" />
                  <stop offset="1" stopColor="#17171d" />
                </linearGradient>
                <linearGradient id="book-cover" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#d92b2b" />
                  <stop offset="1" stopColor="#8a0808" />
                </linearGradient>
              </defs>
              <ellipse cx="205" cy="221" rx="172" ry="18" fill="#ad5656" opacity=".12" />
              <ellipse cx="214" cy="210" rx="145" ry="13" fill="#f5caca" opacity=".46" />

              <g transform="translate(5 98)" filter="drop-shadow(0 8px 7px rgba(120, 20, 20, .14))">
                <path d="m20 79 82-31 45 17-82 32z" fill="#780707" />
                <path d="m20 72 82-31 45 17-82 31z" fill="#fff" />
                <path d="m20 66 82-31 45 17-82 31z" fill="url(#book-cover)" />
                <path d="m20 57 82-31 45 17-82 31z" fill="#fff" />
                <path d="m20 51 82-31 45 17-82 31z" fill="#b20d0d" />
                <path d="m20 79 45 17v12L20 91z" fill="#760707" />
                <path d="m65 96 82-31v12l-82 31z" fill="#f5eeee" />
                <path d="m27 55 74-28 33 12-74 28z" fill="#d92b2b" />
                <path d="m34 65 67-25 25 9-67 26z" fill="#ed3e3e" opacity=".9" />
              </g>

              <g transform="translate(300 125)" filter="drop-shadow(0 6px 6px rgba(120, 20, 20, .12))">
                <path d="M23 49V17" stroke="#8a0808" strokeWidth="3" />
                <path d="M23 28C3 23 0 9 2 3c13 2 22 12 21 25Z" fill="#bb1717" />
                <path d="M23 31C27 11 41 5 49 6c-1 14-10 24-26 25Z" fill="#e14343" />
                <path d="M22 39C5 38-3 28-4 21c13-1 23 6 28 16Z" fill="#8f0b0b" />
                <path d="M8 47h31l-5 32H14z" fill="#fff" stroke="#e5caca" strokeWidth="2" />
                <ellipse cx="23.5" cy="47" rx="15.5" ry="4" fill="#f7e8e8" />
                <path d="M15 56h17" stroke="#f1d8d8" strokeWidth="2" />
              </g>

              <g transform="translate(98 32)" filter="drop-shadow(0 12px 10px rgba(95, 15, 15, .16))">
                <rect x="38" y="4" width="166" height="117" rx="10" fill="#a7a3a5" />
                <rect x="42" y="7" width="158" height="110" rx="7" fill="#34343a" stroke="#8a2424" strokeWidth="3" />
                <rect x="49" y="14" width="144" height="96" rx="3" fill="url(#screen-glow)" />
                <circle cx="121" cy="10" r="1.7" fill="#d9bcbc" />
                <g transform="translate(121 60)">
                  <ellipse cx="0" cy="22" rx="39" ry="5" fill="#08080a" opacity=".35" />
                  <path d="m0-23 39 15L0 7-39-8z" fill="#ed3434" />
                  <path d="m-23-2v18q23 14 46 0V-2L0 7z" fill="#9f0b0b" />
                  <path d="M35-6v24" stroke="#f4b4b4" strokeWidth="2" />
                  <circle cx="35" cy="20" r="3" fill="#e54343" />
                  <path d="M-29 28h58" stroke="#e5b7b7" strokeWidth="2" opacity=".55" />
                </g>
                <path d="m25 121 190 0 39 32H-14z" fill="url(#laptop-shell)" stroke="#d3ced0" strokeWidth="2" />
                <path d="m39 126 158 0 20 17H20z" fill="#6a6265" />
                <path d="m48 129 139 0 14 11H35z" fill="#81797b" />
                <path d="m88 143 54 0 8 7H79z" fill="#c8c2c4" />
                <path d="m-14 153 268 0-10 7H-4z" fill="#aaa4a6" />
                <path d="m31 124 185 0" stroke="#fff" strokeWidth="2" opacity=".8" />
              </g>

              <g transform="translate(64 224) rotate(-17)">
                <rect x="0" y="0" width="92" height="7" rx="3.5" fill="#c51919" />
                <rect x="12" y="1.5" width="62" height="2" rx="1" fill="#fff" opacity=".8" />
                <path d="m92 0 12 3.5L92 7z" fill="#d7a47b" />
                <path d="m101 2 3 1.5-3 1.5z" fill="#493b35" />
              </g>
            </svg>
          </div>
        </div>
      </section>
      <div className="sticky top-0 z-10 mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center">
        <div className="w-full md:max-w-sm">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="filtro-estado" className="text-xs font-medium text-slate-600">
            Filtrar vista
          </label>
          <select
            id="filtro-estado"
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
      {showCreate && (
        <Modal title="Programar clase" onClose={() => setShowCreate(false)}>
          <CreateClassForm
            groupId={group.id}
            onCreated={async () => { setShowCreate(false); await load(); }}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Editar clase" onClose={() => setEditing(null)}>
          <CreateClassForm
            groupId={group.id}
            initial={editing}
            onUpdated={async () => { setEditing(null); await load(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 mt-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 flex gap-2">
                <div className="h-6 w-16 rounded-full bg-slate-100" />
                <div className="h-6 w-16 rounded-full bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {notice}
        </p>
      )}
      {!loading && !error && classes.length === 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">
            📅
          </p>
          <p className="mt-2 text-sm text-slate-600">No hay clases programadas.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            Programar primera clase
          </button>
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
              <button type="button" onClick={() => onSelectClass && onSelectClass(c)} aria-label={`Ver ${c.title}`} className="mt-3 block w-full text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40">
                <h3 className="text-lg font-bold text-slate-900 break-words group-hover:text-[#B3200E]">{c.title}</h3>
              </button>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <li className="inline-flex items-center gap-1.5"><i className="fa-regular fa-calendar" aria-hidden="true" />{formatBogotaDate(c.start_time)}</li>
                <li className="inline-flex items-center gap-1.5"><i className="fa-regular fa-clock" aria-hidden="true" />{formatBogotaTime(c.start_time)} · {c.duration_minutes} min</li>
                <li className="inline-flex items-center gap-1.5"><i className="fa-solid fa-qrcode" aria-hidden="true" />QR {c.qr_duration_minutes ?? 10} min</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => onSelectClass && onSelectClass(c)} aria-label={`Ver detalles de ${c.title}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40">
                  <i className="fa-regular fa-eye" aria-hidden="true" /> Ver detalles
                </button>
                <button type="button" onClick={() => handleDelete(c.id)} aria-label={`Eliminar ${c.title}`} className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-3.5 py-2 text-xs font-semibold text-[#B3200E] transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40">
                  <i className="fa-regular fa-trash-can" aria-hidden="true" /> Eliminar
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
