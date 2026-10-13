import React, { useCallback, useEffect, useRef, useState } from "react";
import QrDisplay from "../components/QrDisplay";
import { getCurrentSession, getSessionAttendances } from "../services/attendance";
import { getGroupClass } from "../services/academic";
import { formatBogota } from "../utils/dates";

// QR único sin auto-rotación: ensure (clase + sesión vigente) cada 10s,
// lista viva POR SESIÓN ÚNICA cada 5s (getSessionAttendances por session_id).
// Sin botón Generar/Rotar: A1 y rotate están deprecated en backend
// (410 rotation_disabled). Fases: loading | pending | live | expired | finished.
// - expired (410 qr_expired): QR único vencido en ventana, no hay S2;
//   se detiene el poll ensure y se limpia el caché.
// - finished (410 finished): clase cerrada o fuera de ventana.
// m4: el QR vive en memoria + sessionStorage (alcance de pestaña);
// se limpia al expirar/finalizar.
const ENSURE_MS = 10000;
const LIST_MS = 5000;
const MODALITY_LABELS = {
  PRESENTIAL: "Presencial",
  VIRTUAL: "Virtual",
};
const CLASS_STATUS_LABELS = {
  SCHEDULED: "Programada",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Finalizada",
  CANCELLED: "Cancelada",
};
const CLASS_STATUS_COLORS = {
  SCHEDULED: "bg-amber-50 text-amber-700 border-amber-100",
  IN_PROGRESS: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-red-50 text-red-700 border-red-100",
  CANCELLED: "bg-red-50 text-red-700 border-red-100",
};

const cacheKey = (classId) => `siaqr:current-session:${classId}`;
const isExpired = (cached) => {
  if (!cached?.expires_at) return false;
  return new Date(cached.expires_at).getTime() <= Date.now();
};
const loadCached = (classId) => {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(classId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isExpired(parsed)) {
      try { window.sessionStorage.removeItem(cacheKey(classId)); } catch { /* noop */ }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
const saveCached = (classId, value) => {
  try {
    if (isExpired(value)) return;
    window.sessionStorage.setItem(cacheKey(classId), JSON.stringify(value));
  } catch {
    // sessionStorage no disponible: se sigue mostrando el QR en memoria.
  }
};
const clearCached = (classId) => {
  try {
    window.sessionStorage.removeItem(cacheKey(classId));
  } catch {
    // noop
  }
};
// Sesión inicial B3 válida: trae attend_url mostrable y no está expirada.
// No duplica por has_ever del backend (S1 única por clase).
const asUsableInitial = (s) => {
  if (!s?.session_id || !s?.attend_url) return null;
  if (isExpired(s)) return null;
  return { session_id: s.session_id, attend_url: s.attend_url, expires_at: s.expires_at };
};

function formatStartsIn(totalSeconds) {
  if (totalSeconds == null) return "…";
  const total = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatClassStart(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export default function ClaseDetalle({ group, classItem, initialSession, onBack }) {
  // Hidratación prioritaria: initialSession B3 (con attend_url) sobre caché.
  const usableInitial = asUsableInitial(initialSession);
  // Máquina de estados del QR único: loading | pending | live | expired | finished.
  const [phase, setPhase] = useState(usableInitial ? "live" : "loading");
  const [session, setSession] = useState(() => usableInitial);
  const [startsIn, setStartsIn] = useState(null);
  const [startTime, setStartTime] = useState(classItem.start_time);
  const [classStatus, setClassStatus] = useState(classItem.status);
  const [qrMinutes, setQrMinutes] = useState(classItem.qr_duration_minutes ?? 10);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  const ensureIdRef = useRef(null);

  const stopEnsure = useCallback(() => {
    if (ensureIdRef.current) {
      clearInterval(ensureIdRef.current);
      ensureIdRef.current = null;
    }
  }, []);

  const handleExpired = useCallback(() => {
    // Fase expired (QR único vencido): detiene ensure y limpia caché.
    setPhase((prev) => (prev === "finished" ? prev : "expired"));
    clearCached(classItem.id);
    stopEnsure();
  }, [classItem.id, stopEnsure]);

  // ensure: estado de la clase + sesión vigente única (idempotente, sin reload).
  const ensure = useCallback(async () => {
    try {
      const [cls, cur] = await Promise.all([
        getGroupClass(group.id, classItem.id).catch(() => null),
        getCurrentSession(group.id, classItem.id),
      ]);
      if (cls) {
        setClassStatus(cls.status);
        setStartTime(cls.start_time);
      }
      if (cur.status === 200) {
        const d = cur.data || {};
        if (d.ttl_minutes != null && Number.isFinite(Number(d.ttl_minutes))) {
          setQrMinutes(Number(d.ttl_minutes));
        }
        setPhase("live");
        setError("");
        setStartsIn(null);
        if (d.attend_url) {
          // S1 creada en este poll: trae el QR mostrable.
          const next = {
            session_id: d.session_id,
            attend_url: d.attend_url,
            expires_at: d.expires_at,
          };
          setSession(next);
          saveCached(classItem.id, next);
        } else if (d.session_id === sessionRef.current?.session_id && sessionRef.current?.attend_url) {
          // Mismo session_id con QR en memoria: conserva, solo refresca expiración.
          const kept = { ...sessionRef.current, expires_at: d.expires_at };
          if (isExpired(kept)) {
            handleExpired();
            setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
          } else {
            setSession(kept);
            saveCached(classItem.id, kept);
          }
        } else if (d.session_id === loadCached(classItem.id)?.session_id && loadCached(classItem.id)?.attend_url) {
          // Misma sesión tras reload con caché válida: conserva el QR.
          const cached = loadCached(classItem.id);
          const kept = { ...cached, expires_at: d.expires_at };
          if (isExpired(kept)) {
            handleExpired();
            setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
          } else {
            setSession(kept);
            saveCached(classItem.id, kept);
          }
        } else {
          // Sesión válida creada en otro dispositivo (hash irreversible):
          // sin rotación disponible, se muestra aviso sin botón.
          setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
        }
      } else if (cur.status === 202) {
        setPhase("pending");
        setStartsIn(cur.data?.starts_in_s ?? null);
      } else if (cur.status === 410) {
        const reason = cur.data?.reason;
        const state = cur.data?.state;
        if (state === "expired" || reason === "qr_expired" || reason === "rotation_disabled") {
          // QR único expirado o rotación deshabilitada: fase expired fija.
          const prev = sessionRef.current;
          setSession({
            session_id: cur.data?.session_id || prev?.session_id || null,
            attend_url: null,
            expires_at: cur.data?.expires_at || prev?.expires_at || null,
          });
          setPhase("expired");
          setStartsIn(null);
          clearCached(classItem.id);
          stopEnsure();
        } else {
          setPhase("finished");
          setStartsIn(null);
          setSession(null);
          clearCached(classItem.id);
        }
      } else {
        setError(cur.data?.error || "No se pudo obtener la sesión actual.");
      }
    } catch {
      // Poll silencioso: no se pisa el QR visible ante un fallo puntual.
    }
  }, [group.id, classItem.id, handleExpired, stopEnsure]);

  // Primer ensure inmediato + poll cada 10s (se detiene en expired).
  useEffect(() => {
    ensure().catch(() => {});
    const id = setInterval(() => ensure().catch(() => {}), ENSURE_MS);
    ensureIdRef.current = id;
    return () => {
      clearInterval(id);
      if (ensureIdRef.current === id) ensureIdRef.current = null;
    };
  }, [ensure]);

  // Hidrata el QR al montar con prioridad initialSession > caché.
  useEffect(() => {
    if (usableInitial) {
      setSession(usableInitial);
      setPhase("live");
      saveCached(classItem.id, usableInitial);
      return;
    }
    const cached = loadCached(classItem.id);
    if (cached?.session_id) setSession(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classItem.id]);

  // Cuenta regresiva local del pending (el poll la resincroniza cada 10s).
  const hasStartsIn = startsIn != null;
  useEffect(() => {
    if (phase !== "pending" || !hasStartsIn) return;
    const id = setInterval(() => setStartsIn((v) => (v == null ? v : Math.max(0, v - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, hasStartsIn]);

  // Lista viva POR SESIÓN ÚNICA (sin acumulada multi-sesión).
  const loadList = useCallback(
    async (p = page) => {
      const sid = sessionRef.current?.session_id;
      if (!sid) {
        setRows([]);
        setCount(0);
        return;
      }
      const data = await getSessionAttendances(sid, p);
      setRows(Array.isArray(data) ? data : data.results || []);
      setCount(data.count ?? (Array.isArray(data) ? data.length : 0));
    },
    [page]
  );

  // Polling 5s de la lista viva (restricción No-Redis: sin WebSocket).
  useEffect(() => {
    loadList(page).catch(() => {});
    const id = setInterval(() => loadList(page).catch(() => {}), LIST_MS);
    return () => clearInterval(id);
  }, [classItem.id, session?.session_id, page, loadList]);

  const showQr = phase === "live" && session?.attend_url;
  const showExpiredQr = phase === "expired" && session?.attend_url;
  const modalityLabel = MODALITY_LABELS[classItem.modality] || classItem.modality;
  const statusLabel = CLASS_STATUS_LABELS[classStatus] || classStatus;
  const statusColor = CLASS_STATUS_COLORS[classStatus] || "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="space-y-6">
      <header>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#B3200E] hover:text-[#941B0B] mb-4 transition-colors"
        >
          <span className="w-6 h-6 rounded-full bg-red-50 flex items-center justify-center text-xs">
            <i className="fa-solid fa-arrow-left"></i>
          </span>
          <span>Volver</span>
        </button>
        <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
          {classItem.title}
        </h2>
        <p className="text-slate-500 font-medium mt-1">
          {group.course?.name} · Grupo {group.group_code}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white rounded-3xl p-5 md:p-7 shadow-sm border border-slate-100/80 flex flex-col justify-between gap-6">
          <div>
            <div className="flex items-start gap-3 mb-5">
              <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-[#B3200E] flex-shrink-0 mt-0.5">
                <i className="fa-regular fa-clock text-sm"></i>
              </div>
              <div>
                <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase block">
                  Detalles de la sesión
                </span>
                <h3 className="text-xl font-bold text-slate-900">Información de la clase</h3>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider block mb-1">INICIO</span>
                <p className="text-sm font-semibold text-slate-800">{formatClassStart(startTime)}</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider block mb-1">DURACIÓN</span>
                <p className="text-sm font-semibold text-slate-800">{classItem.duration_minutes} min</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider block mb-1">VIDA ÚTIL DEL QR</span>
                <p className="text-sm font-semibold text-slate-800">{qrMinutes} min</p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <span className="text-[11px] font-bold text-slate-400 tracking-wider block mb-1">MODALIDAD · ESTADO</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">{modalityLabel}</span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold ${statusColor}`}>
                    {statusLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {phase === "pending" && (
              <div className="bg-amber-50 border border-amber-100 text-amber-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span>La clase aún no inicia — el QR aparecerá automáticamente en {formatStartsIn(startsIn)}.</span>
              </div>
            )}
            {phase === "live" && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></span>
                <span><strong>QR activo</strong> - Escanea para firmar asistencia.</span>
              </div>
            )}
            {phase === "expired" && (
              <div className="bg-orange-50 border border-orange-100 text-orange-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"></span>
                <span>El código QR expiró — ya no se aceptan marcaciones con este QR.</span>
              </div>
            )}
            {phase === "finished" && (
              <div className="bg-gray-100 border border-gray-200 text-gray-700 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl">
                La clase finalizó — ya no se generan códigos QR.
              </div>
            )}
            {phase === "loading" && (
              <div className="bg-slate-50 border border-slate-100 text-slate-600 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl">
                Conectando con la sesión…
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center gap-2">
                <i className="fa-solid fa-circle-info text-red-500 flex-shrink-0"></i>
                <span>{error}</span>
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-5 bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100/80 flex flex-col items-center justify-between text-center gap-5">
          <div className="bg-[#B3200E] text-white text-xs font-semibold px-4 py-1.5 rounded-full inline-flex items-center gap-2 shadow-sm">
            <i className="fa-solid fa-qrcode text-xs"></i>
            <span>QR de asistencia</span>
          </div>

          {showQr ? (
            <QrDisplay
              key={session.session_id}
              attendUrl={session.attend_url}
              expiresAt={session.expires_at}
              size={180}
              onExpired={handleExpired}
            />
          ) : showExpiredQr ? (
            <QrDisplay
              key={session.session_id}
              attendUrl={session.attend_url}
              expiresAt={session.expires_at}
              size={180}
              onExpired={handleExpired}
            />
          ) : phase === "live" ? (
            <div className="w-full min-h-56 flex flex-col items-center justify-center gap-3 p-4">
              <p className="text-sm text-slate-500">
                Sesión activa en otro dispositivo — el QR se muestra donde inició la clase.
              </p>
              <p className="text-xs text-slate-400">La rotación está deshabilitada (QR único).</p>
            </div>
          ) : phase === "expired" ? (
            <div className="w-48 h-48 border-2 border-dashed border-orange-300 rounded-3xl flex flex-col items-center justify-center gap-1">
              <p className="text-2xl font-bold text-orange-600">00:00</p>
              <p className="text-sm text-slate-500 px-4">Expirado</p>
            </div>
          ) : phase === "pending" ? (
            <div className="w-48 h-48 border-2 border-dashed border-amber-300 rounded-3xl flex flex-col items-center justify-center gap-1">
              <p className="text-2xl font-bold text-amber-600">{formatStartsIn(startsIn)}</p>
              <p className="text-sm text-slate-400 px-4">QR pendiente</p>
            </div>
          ) : phase === "finished" ? (
            <div className="w-48 h-48 border-2 border-dashed border-slate-300 rounded-3xl flex items-center justify-center">
              <p className="text-sm text-slate-400 px-4">Clase finalizada</p>
            </div>
          ) : (
            <div className="w-48 h-48 border-2 border-dashed border-slate-300 rounded-3xl flex items-center justify-center">
              <p className="text-sm text-slate-400 px-4">Conectando…</p>
            </div>
          )}
        </section>
      </div>

      <section className="bg-white rounded-3xl p-5 md:p-7 shadow-sm border border-slate-100/80 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg md:text-xl font-bold text-slate-900">
            Asistencia {count > 0 && <span className="text-slate-500 font-normal">({count})</span>}
          </h3>
          <div className="flex items-center gap-2">
            {session && (
              <span className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>en vivo (5s)</span>
              </span>
            )}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {!session && phase !== "finished" && phase !== "expired"
              ? "El QR aparecerá solo al iniciar la ventana de la clase."
              : "Aún no hay marcaciones registradas."}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{a.student_name}</p>
                    <p className="text-xs text-slate-500">{a.student_code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-700">{formatBogota(a.registered_at)}</p>
                    <p className="text-xs text-slate-500">
                      {a.has_location ? "📍 con ubicación" : "sin ubicación"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg"
              >
                Anterior
              </button>
              <span className="text-xs text-slate-500">Página {page}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={rows.length < 10}
                className="px-3 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg"
              >
                Siguiente
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
