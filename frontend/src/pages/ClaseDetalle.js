import React, { useCallback, useEffect, useRef, useState } from "react";
import QrDisplay from "../components/QrDisplay";
import { getCurrentSession, getSessionAttendances, rotateCurrentSession } from "../services/attendance";
import { getReportPreview } from "../services/reports";
import { getGroupClass } from "../services/academic";
import { formatBogota } from "../utils/dates";

// QR automático: ensure (clase + sesión vigente) cada 10s, lista viva
// ACUMULADA POR CLASE cada 5s (vía reportes con filtro class_id: S1+S2, no se
// vacía al rotar; fallback a la lista de la sesión vigente si el reporte falla).
// Sin botón Generar manual: A1 queda solo como fallback interno del backend.
// M1 (opción b): si el live reusado no trae attend_url (sesión creada en otro
// dispositivo — el token crudo es irreversible, solo se guarda su hash), la UI
// ofrece "Mostrar en este dispositivo", que rota (revoca la anterior + crea una
// nueva con attend_url mostrable). Workaround documentado: proyectar siempre
// desde el dispositivo donde se rotó por última vez.
// m4: el QR vive en memoria + sessionStorage (alcance de pestaña, no persiste
// entre sesiones como localStorage); se limpia al finalizar/expirar.
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
  // Así el QR inmediato se muestra <3s sin caer en la rama "otro dispositivo"
  // del primer ensure (attend_url null por hash irreversible). Sin auto-rotate.
  const usableInitial = asUsableInitial(initialSession);
  // Máquina de estados del QR automático: loading | pending | live | finished.
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
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState("");
  // Rotación backend S1→S2 (TTL expirado + ventana vigente, RF-PROF-05/07):
  // banner transitorio + contador para la etiqueta "sesión N" del QR.
  const [rotationNotice, setRotationNotice] = useState("");
  const [rotationCount, setRotationCount] = useState(0);
  const rotationTimer = useRef(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  // Limpia el timer del banner transitorio al desmontar.
  useEffect(() => () => {
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
  }, []);

  const flagRotation = useCallback((newSessionId) => {
    setRotationCount((c) => c + 1);
    const short = String(newSessionId).slice(-8);
    setRotationNotice(`QR renovado — el anterior ya no es válido (nueva sesión …${short}).`);
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    rotationTimer.current = setTimeout(() => setRotationNotice(""), 10000);
  }, []);

  // ensure: estado de la clase + sesión vigente (idempotente, sin reload).
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
        // Reconciliar vida útil del QR desde la sesión vigente (ttl_minutes)
        // en vez de solo classItem.qr_duration_minutes (puede traer default viejo).
        if (d.ttl_minutes != null && Number.isFinite(Number(d.ttl_minutes))) {
          setQrMinutes(Number(d.ttl_minutes));
        }
        setPhase("live");
        setError("");
        setStartsIn(null);
        if (d.attend_url) {
          // Sesión creada/rotada en este poll: trae el QR mostrable.
          const next = {
            session_id: d.session_id,
            attend_url: d.attend_url,
            expires_at: d.expires_at,
          };
          const prev = sessionRef.current;
          if (prev?.session_id && d.session_id !== prev.session_id) {
            // Rotación backend (TTL expirado + ventana IN_PROGRESS => S2 con
            // nuevo session_id/token): NO es grace/storage/rotate-auto del
            // front — el comportamiento esperado SÍ es regenerar en ventana
            // (RF-PROF-05/07). attend_url presente la distingue del caso
            // "otro dispositivo" (attend_url null de los guards de abajo).
            flagRotation(d.session_id);
          }
          setSession(next);
          saveCached(classItem.id, next);
        } else if (d.session_id === sessionRef.current?.session_id && sessionRef.current?.attend_url) {
          // Guard conservador: mismo session_id y QR en memoria (p. ej. sesión
          // B3 hidratada vía initialSession): no pisar con attend_url null del
          // GET reusado. Solo se refresca expires_at.
          const kept = { ...sessionRef.current, expires_at: d.expires_at };
          if (isExpired(kept)) {
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
            setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
          } else {
            setSession(kept);
            saveCached(classItem.id, kept);
          }
        } else {
          // session_id difiere del QR en memoria/caché: sesión válida creada
          // en otro navegador/dispositivo (su token crudo no es recuperable,
          // solo se guarda el hash). Aquí sí corresponde el aviso + Rotar.
          setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
        }
      } else if (cur.status === 202) {
        setPhase("pending");
        setStartsIn(cur.data?.starts_in_s ?? null);
      } else if (cur.status === 410) {
        setPhase("finished");
        setStartsIn(null);
        // m4: al finalizar, el QR cacheado deja de ser válido: limpiar.
        setSession(null);
        clearCached(classItem.id);
      } else {
        setError(cur.data?.error || "No se pudo obtener la sesión actual.");
      }
    } catch {
      // Poll silencioso: no se pisa el QR visible ante un fallo puntual.
    }
  }, [group.id, classItem.id, flagRotation]);

  // M1 (opción b): rotar el QR para mostrarlo en este dispositivo.
  // Revoca la sesión activa previa y trae un attend_url nuevo proyectable.
  const rotateHere = useCallback(async () => {
    setRotating(true);
    setRotateError("");
    try {
      const res = await rotateCurrentSession(group.id, classItem.id);
      if (res.status === 201 && res.data?.attend_url) {
        if (res.data?.ttl_minutes != null && Number.isFinite(Number(res.data.ttl_minutes))) {
          setQrMinutes(Number(res.data.ttl_minutes));
        }
        const prev = sessionRef.current;
        const next = {
          session_id: res.data.session_id,
          attend_url: res.data.attend_url,
          expires_at: res.data.expires_at,
        };
        if (prev?.session_id && res.data.session_id !== prev.session_id) {
          flagRotation(res.data.session_id);
        }
        setSession(next);
        saveCached(classItem.id, next);
        setPhase("live");
        setError("");
      } else if (res.status === 202) {
        setPhase("pending");
        setStartsIn(res.data?.starts_in_s ?? null);
      } else if (res.status === 410) {
        setPhase("finished");
        setSession(null);
        clearCached(classItem.id);
      } else {
        setRotateError(res.data?.error || "No se pudo mostrar el QR aquí, intenta de nuevo.");
      }
    } catch {
      setRotateError("No se pudo mostrar el QR aquí, intenta de nuevo.");
    } finally {
      setRotating(false);
    }
  }, [group.id, classItem.id, flagRotation]);

  // Primer ensure inmediato + poll cada 10s.
  useEffect(() => {
    ensure().catch(() => {});
    const id = setInterval(() => ensure().catch(() => {}), ENSURE_MS);
    return () => clearInterval(id);
  }, [ensure]);

  // Hidrata el QR al montar con prioridad initialSession > caché (mismo
  // session_id tras reload). El saveCached es inmediato, antes del primer
  // ensure, para que el guard conservador tenga con qué comparar.
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
  // Booleano nombrado hasStartsIn en deps (no `startsIn != null` inline):
  // el intervalo solo se recrea al entrar/salir del estado pendiente, no en cada tick.
  const hasStartsIn = startsIn != null;
  useEffect(() => {
    if (phase !== "pending" || !hasStartsIn) return;
    const id = setInterval(() => setStartsIn((v) => (v == null ? v : Math.max(0, v - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, hasStartsIn]);

  // Lista viva ACUMULADA POR CLASE (S1+S2): el endpoint de reportes acepta
  // filtro class_id y devuelve las marcaciones de TODAS las sesiones de la
  // clase — al rotar S1→S2 la lista NO se vacía ni se resetea. Alternativa
  // backend (no implementada a propósito): endpoint dedicado de agregados por
  // clase; con la restricción No-Redis y el filtro class_id existente, el
  // reporte paginado ya cubre el caso sin tocar el back. Fallback: lista de
  // la sesión vigente si el reporte falla.
  const loadList = useCallback(
    async (p = page) => {
      try {
        const data = await getReportPreview({ class_id: classItem.id }, p, 10);
        const list = Array.isArray(data) ? data : data.results || [];
        setRows(list);
        setCount(data.count ?? (Array.isArray(data) ? data.length : 0));
        return;
      } catch {
        // Fallback a la sesión vigente.
      }
      const sid = sessionRef.current?.session_id;
      if (!sid) return;
      const data = await getSessionAttendances(sid, p);
      setRows(Array.isArray(data) ? data : data.results || []);
      setCount(data.count ?? (Array.isArray(data) ? data.length : 0));
    },
    [page, classItem.id]
  );

  // Polling 5s de la lista viva (restricción No-Redis: sin WebSocket).
  // Incluye session.session_id para refrescar justo al rotar S1→S2.
  useEffect(() => {
    loadList(page).catch(() => {});
    const id = setInterval(() => loadList(page).catch(() => {}), LIST_MS);
    return () => clearInterval(id);
  }, [classItem.id, session?.session_id, page, loadList]);

  const showQr = phase === "live" && session?.attend_url;
  // Etiqueta corta de sesión para el QR (verificación visual del session_id).
  const sessionLabel = session?.session_id
    ? `sesión …${String(session.session_id).slice(-8)}`
    : null;
  // Sesiones distintas presentes en la lista (S1+S2 tras rotar).
  const sessionsInRows = new Set(
    (rows || []).map((r) => r.session_id).filter(Boolean)
  );
  const multiSession = sessionsInRows.size > 1;
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
            {rotationNotice && phase === "live" && (
              <div className="bg-sky-50 border border-sky-100 text-sky-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0"></span>
                <span>{rotationNotice}</span>
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
              onExpired={() => ensure().catch(() => {})}
              sessionLabel={sessionLabel}
              rotationCount={rotationCount}
              phase={phase}
            />
          ) : phase === "live" ? (
            <div className="w-full min-h-56 flex flex-col items-center justify-center gap-3 p-4">
              <p className="text-sm text-slate-500">
                Sesión activa en otro dispositivo — el QR se muestra donde inició la clase.
              </p>
              <button
                onClick={() => rotateHere().catch(() => {})}
                disabled={rotating}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
              >
                {rotating ? "Mostrando…" : "Mostrar en este dispositivo"}
              </button>
              <p className="text-xs text-slate-400">Rota el QR aquí (revoca el anterior).</p>
              {rotateError && <p className="text-xs text-red-600">{rotateError}</p>}
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
            {multiSession && (
              <span className="bg-sky-50 border border-sky-100 text-sky-700 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap">
                acumulada · todas las sesiones
              </span>
            )}
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
            {!session && phase !== "finished"
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
                      {multiSession && a.session_id && (
                        <span className="ml-1 text-slate-400">· …{String(a.session_id).slice(-8)}</span>
                      )}
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
