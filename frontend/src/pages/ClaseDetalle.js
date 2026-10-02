import React, { useCallback, useEffect, useRef, useState } from "react";
import ProfHeader from "../components/ProfHeader";
import QrDisplay from "../components/QrDisplay";
import { getCurrentSession, getSessionAttendances, rotateCurrentSession } from "../services/attendance";
import { getGroupClass } from "../services/academic";
import { formatBogota } from "../utils/dates";

// QR automático: ensure (clase + sesión vigente) cada 10s, lista viva cada 5s.
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
  const sessionRef = useRef(null);
  sessionRef.current = session;

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
        // Fix TTL instantánea: reconciliar vida útil del QR desde la sesión
        // vigente (ttl_minutes) en vez de solo classItem.qr_duration_minutes.
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
  }, [group.id, classItem.id]);

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
        const next = {
          session_id: res.data.session_id,
          attend_url: res.data.attend_url,
          expires_at: res.data.expires_at,
        };
        setSession(next);        saveCached(classItem.id, next);
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
  }, [group.id, classItem.id]);

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
  // m4: booleano nombrado hasStartsIn en deps (no `startsIn != null` inline
  // ni eslint-disable): el intervalo solo se recrea al entrar/salir del
  // estado pendiente, no en cada tick.
  const hasStartsIn = startsIn != null;
  useEffect(() => {
    if (phase !== "pending" || !hasStartsIn) return;
    const id = setInterval(() => setStartsIn((v) => (v == null ? v : Math.max(0, v - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, hasStartsIn]);

  const loadList = useCallback(
    async (sessionId, p = page) => {
      if (!sessionId) return;
      const data = await getSessionAttendances(sessionId, p);
      setRows(Array.isArray(data) ? data : data.results || []);
      setCount(data.count ?? (Array.isArray(data) ? data.length : 0));
    },
    [page]
  );

  // Polling 5s de la lista viva (restricción No-Redis: sin WebSocket).
  useEffect(() => {
    if (!session?.session_id) return;
    loadList(session.session_id, 1).catch(() => {});
    const id = setInterval(() => loadList(session.session_id, page).catch(() => {}), LIST_MS);
    return () => clearInterval(id);
  }, [session?.session_id, page, loadList]);

  const showQr = phase === "live" && session?.attend_url;

  return (
    <div>
      <ProfHeader
        title={classItem.title}
        subtitle={`${group.course?.name} · Grupo ${group.group_code}`}
        onBack={onBack}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-2">
          <p className="text-sm text-gray-500">Inicio</p>
          <p className="font-semibold text-gray-800">{formatBogota(startTime)}</p>
          <p className="text-sm text-gray-500 mt-3">Duración</p>
          <p className="font-semibold text-gray-800">{classItem.duration_minutes} min</p>
          <p className="text-sm text-gray-500 mt-3">Vida útil del QR</p>
          <p className="font-semibold text-gray-800">{qrMinutes} min</p>
          <p className="text-sm text-gray-500 mt-3">Modalidad · Estado</p>
          <p className="font-semibold text-gray-800">{classItem.modality} · {classStatus}</p>
          <div className="pt-4">
            {phase === "pending" && (
              <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                La clase aún no inicia — el QR aparecerá automáticamente en {formatStartsIn(startsIn)}.
              </p>
            )}
            {phase === "live" && (
              <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                ● QR activo - escanea el código para tomar asistencia.
              </p>
            )}
            {phase === "finished" && (
              <p className="text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                La clase finalizó — ya no se generan códigos QR.
              </p>
            )}
            {phase === "loading" && (
              <p className="text-sm text-gray-500">Conectando con la sesión…</p>
            )}
          </div>
          {error && <p className="text-sm text-red-600 pt-2">{error}</p>}
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
          {showQr ? (
            <QrDisplay
              attendUrl={session.attend_url}
              expiresAt={session.expires_at}
              onExpired={() => ensure().catch(() => {})}
            />
          ) : phase === "live" ? (
            <div className="w-64 min-h-48 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-sm text-gray-500 text-center">
                Sesión activa en otro dispositivo — el QR se muestra donde inició la clase.
              </p>
              <button
                onClick={() => rotateHere().catch(() => {})}
                disabled={rotating}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
              >
                {rotating ? "Mostrando…" : "Mostrar en este dispositivo"}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Rota el QR aquí (revoca el anterior).
              </p>
              {rotateError && <p className="text-xs text-red-600 text-center">{rotateError}</p>}
            </div>
          ) : phase === "pending" ? (
            <div className="w-48 h-48 border-2 border-dashed border-amber-300 rounded-xl flex flex-col items-center justify-center gap-1">
              <p className="text-2xl font-bold text-amber-600">{formatStartsIn(startsIn)}</p>
              <p className="text-sm text-gray-400 text-center px-4">QR pendiente</p>
            </div>
          ) : phase === "finished" ? (
            <div className="w-48 h-48 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center">
              <p className="text-sm text-gray-400 text-center px-4">Clase finalizada</p>
            </div>
          ) : (
            <div className="w-48 h-48 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center">
              <p className="text-sm text-gray-400 text-center px-4">Conectando…</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-800">
            Asistencia {count > 0 && <span className="text-gray-500 font-normal">({count})</span>}
          </h3>
          {session && (
            <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">
              ● en vivo (5s)
            </span>
          )}
        </div>
        {!session ? (
          <p className="text-sm text-gray-500">El QR aparecerá solo al iniciar la ventana de la clase.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no hay marcaciones registradas.</p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {rows.map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{a.student_name}</p>
                    <p className="text-xs text-gray-500">{a.student_code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-700">{formatBogota(a.registered_at)}</p>
                    <p className="text-xs text-gray-500">
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
              <span className="text-xs text-gray-500">Página {page}</span>
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
      </div>
    </div>
  );
}
