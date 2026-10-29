import React, { useCallback, useEffect, useRef, useState } from "react";
import QrDisplay from "../components/QrDisplay";
import { getClassAttendances, getCurrentSession } from "../services/attendance";
import { getGroupClass, rotateCurrentSession, setClassGeofence } from "../services/academic";
import {
  CLASS_STATUS_COLORS,
  CLASS_STATUS_LABELS,
  MODALITY_LABELS,
  effectiveClassStatus,
} from "../utils/classMeta";
import { formatBogota, formatBogotaNumeric } from "../utils/dates";
import { getDevicePosition } from "../utils/geolocation";
import useNow from "../utils/useNow";

// QR único: ensure (clase + sesión vigente) cada 10s y lista de marcaciones de
// la CLASE (todas sus sesiones QR, getClassAttendances) cada 5s. Ambos polls se
// detienen al terminar: expired | finished | error.
// Fases: loading | pending | live | expired | finished | error.
// - expired (410 qr_expired): QR únicos vencidos; "Mostrar QR de nuevo" rota.
// - finished (410 finished): clase cerrada o fuera de ventana.
// - error: fallo de conexión o 401/403/404; el poll se detiene hasta reintentar.
// m4: el QR vive en memoria + sessionStorage (alcance de pestaña).
const ENSURE_MS = 10000;
const LIST_MS = 5000;

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

export default function ClaseDetalle({ group, classItem, initialSession, onBack }) {
  // Hidratación prioritaria: initialSession B3 (con attend_url) sobre caché.
  const usableInitial = asUsableInitial(initialSession);
  // Máquina de estados del QR único: loading | pending | live | expired | finished.
  const [phase, setPhase] = useState(usableInitial ? "live" : "loading");
  const [session, setSession] = useState(() => usableInitial);
  const [startsIn, setStartsIn] = useState(null);
  const [startTime, setStartTime] = useState(classItem.start_time);
  const [classStatus, setClassStatus] = useState(classItem.status);
  const [geofenceActive, setGeofenceActive] = useState(Boolean(classItem.geofence_active));
  const [geofenceRadius, setGeofenceRadius] = useState(classItem.geofence_radius_m ?? 25);
  const [geofenceSaving, setGeofenceSaving] = useState(false);
  const [geofenceError, setGeofenceError] = useState("");
  const [qrMinutes, setQrMinutes] = useState(classItem.qr_duration_minutes ?? 10);
  const [error, setError] = useState("");
  const [rotating, setRotating] = useState(false);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const now = useNow();
  const sessionRef = useRef(null);
  sessionRef.current = session;
  // Una sola petición de ensure a la vez: evita polls solapados.
  const ensureBusyRef = useRef(false);
  // Secuencia de la lista: descarta respuestas que ya no son la última.
  const listSeqRef = useRef(0);
  // Secuencia de rotación: un ensure en vuelo no puede pisar el QR rotado.
  const rotateSeqRef = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Ambos polls se detienen al cerrar/expirar la sesión o al fallar.
  const stopped = phase === "finished" || phase === "expired" || phase === "error";

  const handleExpired = useCallback(() => {
    // Fase expired (QR vencido): limpia caché; el poll se detiene por `stopped`.
    setPhase((prev) => (prev === "finished" ? prev : "expired"));
    clearCached(classItem.id);
  }, [classItem.id]);

  // ensure: estado de la clase + sesión vigente única (idempotente, sin reload).
  const ensure = useCallback(async () => {
    if (ensureBusyRef.current) return;
    ensureBusyRef.current = true;
    const rotateSeq = rotateSeqRef.current;
    try {
      const [cls, cur] = await Promise.all([
        getGroupClass(group.id, classItem.id).catch(() => null),
        getCurrentSession(group.id, classItem.id),
      ]);
      // Rotación iniciada durante el poll: su 201 manda, esta respuesta es vieja.
      if (rotateSeq !== rotateSeqRef.current) return;
      if (cls) {
        setClassStatus(cls.status);
        setStartTime(cls.start_time);
        // Rango del salón: estado derivado en backend (se "apaga" solo al
        // finalizar la clase), refrescado en cada poll de 10s.
        setGeofenceActive(Boolean(cls.geofence_active));
        if (cls.geofence_radius_m != null) setGeofenceRadius(cls.geofence_radius_m);
      }
      if (cur.status === 200) {
        const d = cur.data || {};
        if (d.ttl_minutes != null && Number.isFinite(Number(d.ttl_minutes))) {
          setQrMinutes(Number(d.ttl_minutes));
        }
        setPhase("live");
        setError("");
        setStartsIn(null);
        setClassStatus("IN_PROGRESS");
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
          // sin QR en este navegador; "Mostrar QR de nuevo" permite rotarlo.
          setSession({ session_id: d.session_id, attend_url: null, expires_at: d.expires_at });
        }
      } else if (cur.status === 202) {
        setPhase("pending");
        setError("");
        setStartsIn(cur.data?.starts_in_s ?? null);
      } else if (cur.status === 410) {
        const reason = cur.data?.reason;
        const state = cur.data?.state;
        const prev = sessionRef.current;
        if (state === "expired" || reason === "qr_expired" || reason === "rotation_disabled") {
          // QR expirado: fase expired (el poll se detiene por `stopped`).
          setSession({
            session_id: cur.data?.session_id || prev?.session_id || null,
            attend_url: null,
            expires_at: cur.data?.expires_at || prev?.expires_at || null,
          });
          setPhase("expired");
          setStartsIn(null);
          clearCached(classItem.id);
        } else {
          setPhase("finished");
          setStartsIn(null);
          // Conserva el id: la clase terminada sigue listando sus marcaciones.
          setSession({
            session_id: cur.data?.session_id || prev?.session_id || null,
            attend_url: null,
            expires_at: null,
          });
          clearCached(classItem.id);
          setClassStatus(cur.data?.status === "CANCELLED" ? "CANCELLED" : "COMPLETED");
        }
      } else if ([401, 403, 404].includes(cur.status)) {
        // Sin permiso o clase inexistente: no tiene sentido seguir consultando.
        setError(cur.data?.error || "No se pudo obtener la sesión de la clase.");
        setPhase("error");
      } else {
        const message = cur.data?.error || "No se pudo obtener la sesión actual.";
        setError(message);
        if (phaseRef.current === "loading") setPhase("error");
      }
    } catch {
      // Poll silencioso: no se pisa el QR visible ante un fallo puntual.
      if (phaseRef.current === "loading") {
        setError("No se pudo conectar con la sesión de la clase.");
        setPhase("error");
      }
    } finally {
      ensureBusyRef.current = false;
    }
  }, [group.id, classItem.id, handleExpired]);

  // Primer ensure inmediato + poll cada 10s (se detiene al parar la sesión).
  useEffect(() => {
    if (stopped) return undefined;
    const tick = () => {
      if (!document.hidden) ensure().catch(() => {});
    };
    tick();
    const id = setInterval(tick, ENSURE_MS);
    return () => clearInterval(id);
  }, [ensure, stopped]);

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

  // Marcaciones de la clase (todas sus sesiones QR, no solo la vigente).
  const loadList = useCallback(
    async (p = page) => {
      const seq = listSeqRef.current + 1;
      listSeqRef.current = seq;
      const data = await getClassAttendances(classItem.id, p);
      if (seq !== listSeqRef.current) return;
      const total = data.count ?? (Array.isArray(data) ? data.length : 0);
      setRows(Array.isArray(data) ? data : data.results || []);
      setCount(total);
      // El total puede bajar (página eliminada): vuelve a la primera.
      if (p > 1 && (p - 1) * 10 >= total) setPage(1);
    },
    [classItem.id, page]
  );

  // Polling 5s de la lista de la clase (restricción No-Redis: sin WebSocket).
  // Aun detenido (finished) se carga una vez: la clase terminada conserva su lista.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) loadList(page).catch(() => {});
    };
    tick();
    if (stopped) return undefined;
    const id = setInterval(tick, LIST_MS);
    return () => clearInterval(id);
  }, [classItem.id, page, loadList, stopped]);

  // Fija la referencia GPS del salón con la ubicación actual del profesor.
  // Idempotente: un nuevo POST sobrescribe (reubicar/reintentar).
  const handleFixGeofence = async () => {
    setGeofenceSaving(true);
    setGeofenceError("");
    try {
      const pos = await getDevicePosition();
      const saved = await setClassGeofence(group.id, classItem.id, {
        latitude: Number(pos.latitude.toFixed(8)),
        longitude: Number(pos.longitude.toFixed(8)),
        accuracy: pos.accuracy != null ? Number(pos.accuracy.toFixed(2)) : null,
      });
      if (saved) {
        setGeofenceActive(Boolean(saved.geofence_active));
        if (saved.geofence_radius_m != null) setGeofenceRadius(saved.geofence_radius_m);
      }
      // Refresca el resto de datos de la clase (estado/QR) en segundo plano.
      ensure().catch(() => {});
    } catch (err) {
      const geoCode = err?.message;
      setGeofenceError(
        ["unsupported", "denied", "timeout", "unavailable"].includes(geoCode)
          ? "No se pudo obtener tu ubicación. Revisa el permiso de GPS del navegador e inténtalo de nuevo."
          : err?.response?.data?.error || "No se pudo fijar el rango del salón, inténtalo de nuevo."
      );
    } finally {
      setGeofenceSaving(false);
    }
  };

  // Reintenta el ensure tras un fallo: `stopped` vuelve a false y el poll arranca.
  const handleRetry = () => {
    setError("");
    setPhase("loading");
  };

  // Revoca el QR vigente y emite uno nuevo (201). 202/410 cambian de fase.
  const handleRotate = async () => {
    rotateSeqRef.current += 1;
    setRotating(true);
    setError("");
    try {
      const { data, status } = await rotateCurrentSession(group.id, classItem.id);
      if (status === 201 && data?.attend_url) {
        const next = {
          session_id: data.session_id,
          attend_url: data.attend_url,
          expires_at: data.expires_at,
        };
        setSession(next);
        saveCached(classItem.id, next);
        if (data.ttl_minutes != null) setQrMinutes(Number(data.ttl_minutes));
        setStartsIn(null);
        setPhase("live");
      } else if (status === 202) {
        setSession(null);
        setStartsIn(data?.starts_in_s ?? null);
        setPhase("pending");
      } else if (status === 410) {
        clearCached(classItem.id);
        // Conserva el id para que la lista de la clase terminada no se borre.
        setSession({
          session_id: data?.session_id || sessionRef.current?.session_id || null,
          attend_url: null,
          expires_at: null,
        });
        setStartsIn(null);
        setPhase("finished");
      } else {
        setError(data?.error || "No se pudo generar un nuevo QR. Inténtalo de nuevo.");
      }
    } catch {
      setError("No se pudo generar un nuevo QR. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRotating(false);
    }
  };

  const isPresential = classItem.modality === "PRESENTIAL";
  const displayStatus = effectiveClassStatus(
    { ...classItem, status: classStatus, start_time: startTime || classItem.start_time },
    now
  );
  const canFixGeofence = isPresential && displayStatus === "IN_PROGRESS" && !geofenceActive;
  // Conteo de la página visible (la lista se paginó en backend, 10 por página).
  const insideCount = rows.filter((a) => a.inside_range === true).length;
  const outsideCount = rows.filter((a) => a.inside_range === false).length;

  const showQr = phase === "live" && session?.attend_url;
  const showExpiredQr = phase === "expired" && session?.attend_url;
  const modalityLabel = MODALITY_LABELS[classItem.modality] || classItem.modality;
  const statusLabel = CLASS_STATUS_LABELS[displayStatus] || displayStatus;
  const statusColor = CLASS_STATUS_COLORS[displayStatus] || "bg-slate-100 text-slate-600 border-slate-200";

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
                <p className="text-sm font-semibold text-slate-800">{formatBogotaNumeric(startTime)}</p>
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
                {phase === "error" && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="ml-auto shrink-0 px-3 py-1 rounded-lg bg-[#B3200E] hover:bg-[#941B0B] text-white text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                  >
                    Reintentar
                  </button>
                )}
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
              <p className="text-xs text-slate-400">Al mostrar uno nuevo se revoca el QR anterior.</p>
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
          ) : phase === "error" ? (
            <div className="w-48 h-48 border-2 border-dashed border-red-200 rounded-3xl flex items-center justify-center">
              <p className="text-sm text-slate-400 px-4">Sin conexión</p>
            </div>
          ) : (
            <div className="w-48 h-48 border-2 border-dashed border-slate-300 rounded-3xl flex items-center justify-center">
              <p className="text-sm text-slate-400 px-4">Conectando…</p>
            </div>
          )}

          {/* QR perdido (otro dispositivo) o vencido: se puede emitir uno nuevo. */}
          {(phase === "expired" || (phase === "live" && !session?.attend_url)) && (
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotating}
              className="inline-flex items-center gap-2 rounded-xl bg-[#B3200E] hover:bg-[#941B0B] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
            >
              <i className="fa-solid fa-qrcode" aria-hidden="true"></i>
              <span>{rotating ? "Generando…" : "Mostrar QR de nuevo"}</span>
            </button>
          )}

          {/* Rango del salón (solo presencial): estado + fijar referencia. */}
          <div className="w-full space-y-3">
            {!isPresential ? (
              <p className="bg-slate-50 border border-slate-200 text-slate-600 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl">
                Clase mediada — no usa rango de ubicación.
              </p>
            ) : geofenceActive ? (
              <p className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0"></span>
                <span>Rango activo · {geofenceRadius} m</span>
              </p>
            ) : classStatus === "IN_PROGRESS" ? (
              <p className="bg-amber-50 border border-amber-100 text-amber-800 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                <span>Rango inactivo — sin ubicación del profesor.</span>
              </p>
            ) : null}

            {geofenceError && (
              <p className="bg-red-50 border border-red-100 text-red-700 text-xs md:text-sm font-medium px-4 py-3 rounded-2xl">
                {geofenceError}
              </p>
            )}

            {canFixGeofence && (
              <button
                type="button"
                onClick={handleFixGeofence}
                disabled={geofenceSaving}
                aria-label="Fijar rango del salón con tu ubicación actual"
                className="w-full inline-flex flex-col items-center gap-0.5 rounded-2xl bg-[#B3200E] hover:bg-[#941B0B] px-4 py-3 text-white font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              >
                <span className="text-sm">{geofenceSaving ? "Ubicando…" : "📍 Fijar rango del salón"}</span>
                <span className="text-[11px] font-normal text-white/85">
                  Usa tu ubicación actual como referencia ({geofenceRadius} m)
                </span>
              </button>
            )}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-3xl p-5 md:p-7 shadow-sm border border-slate-100/80 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg md:text-xl font-bold text-slate-900">
            Asistencia {count > 0 && <span className="text-slate-500 font-normal">({count})</span>}
          </h3>
          <div className="flex items-center gap-2">
            {insideCount > 0 || outsideCount > 0 ? (
              <span
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap ${
                  outsideCount > 0
                    ? "bg-amber-50 border-amber-100 text-amber-700"
                    : "bg-emerald-50 border-emerald-100 text-emerald-700"
                }`}
              >
                {insideCount} en rango · {outsideCount} fuera de rango
              </span>
            ) : null}
            {session && !stopped && (
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
                    <p
                      className={`text-xs ${
                        a.inside_range === false ? "text-amber-700 font-medium" : "text-slate-500"
                      }`}
                    >
                      {a.inside_range === true
                        ? `✅ En rango (${a.distance_m} m)`
                        : a.inside_range === false
                          ? a.distance_m != null
                            ? `⚠️ Fuera de Rango (${a.distance_m} m)`
                            : "⚠️ Fuera de Rango (sin ubicación)"
                          : a.has_location
                            ? "📍 con ubicación"
                            : "sin ubicación"}
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
                disabled={page * 10 >= count}
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
