import React, { useCallback, useEffect, useState } from "react";
import api, { ensureCsrf, googleLoginUrl } from "../services/api";
import { markAttendance, resolveToken } from "../services/attendance";
import { formatBogota } from "../utils/dates";

const GEO_TIMEOUT_MS = 8000;
const PENDING_TOKEN_KEY = "siaqr_pending_token";

function readToken() {
  const fromUrl = new URLSearchParams(window.location.search).get("token") || "";
  if (fromUrl) {
    // M4: guarda el token antes de cualquier redirección a Google para
    // reanudar /attend al volver aunque se pierda el ?next=.
    try {
      localStorage.setItem(PENDING_TOKEN_KEY, fromUrl);
    } catch {
      // almacenamiento no disponible: se sigue con el token de la URL
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(PENDING_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function requestLocation(setGeo, setGeoState) {
  if (!("geolocation" in navigator)) {
    setGeoState("unsupported");
    return;
  }
  setGeoState("pending");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setGeo({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      });
      setGeoState("ready");
    },
    () => setGeoState("denied"), // NO bloqueante: se marca sin ubicación
    { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 }
  );
}

function fieldError(data, key) {
  const v = data?.[key];
  if (!v) return "";
  return Array.isArray(v) ? v[0] : String(v);
}

// M1: registro inicial real del estudiante (RF-EST-03). El nombre viene de
// Google (solo lectura); se exigen código/documento/teléfono/dirección
// reales; el backend valida unicidad con 409 legible.
function StudentProfileForm({ initial, onSaved }) {
  const suggestedName = [initial?.suggested_first_name || initial?.first_name || "", initial?.suggested_last_name || initial?.last_name || ""].join(" ").trim();
  const [form, setForm] = useState({
    student_code: initial?.student_code || "",
    document_number: initial?.document_number || "",
    phone_number: initial?.phone_number || "",
    address: initial?.address || "",
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await ensureCsrf();
      const { data } = await api.patch("/api/auth/me/", {
        student_code: form.student_code.trim(),
        document_number: form.document_number.trim(),
        phone_number: form.phone_number.trim(),
        address: form.address.trim(),
      });
      onSaved(data);
    } catch (err) {
      const st = err?.response?.status;
      const d = err?.response?.data || {};
      if (st === 409 || st === 400) {
        setErrors({
          student_code: fieldError(d, "student_code"),
          document_number: fieldError(d, "document_number"),
          phone_number: fieldError(d, "phone_number"),
          address: fieldError(d, "address"),
          _global: d.error || "",
        });
      } else {
        setErrors({ _global: "No se pudo guardar el perfil, intenta de nuevo." });
      }
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800";

  return (
    <form onSubmit={submit} className="space-y-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-amber-800">
        Completa tu perfil de estudiante para marcar asistencia
      </p>
      {(suggestedName || initial?.email) && (
        <p className="text-xs text-gray-600 bg-white border border-amber-100 rounded-lg px-3 py-2">
          Registrado como: {suggestedName || "—"}{initial?.email ? ` (${initial.email})` : ""}
        </p>
      )}
      {suggestedName && (
        <p className="text-xs text-gray-500">Nombre tomado de tu cuenta de Google (solo lectura).</p>
      )}
      <div>
        <label className="text-xs text-gray-600">Número de documento *</label>
        <input className={inputCls} value={form.document_number} onChange={set("document_number")} maxLength={50} />
        {errors.document_number && <p className="text-xs text-red-600 mt-1">{errors.document_number}</p>}
      </div>
      <div>
        <label className="text-xs text-gray-600">Código estudiantil *</label>
        <input className={inputCls} value={form.student_code} onChange={set("student_code")} maxLength={50} />
        {errors.student_code && <p className="text-xs text-red-600 mt-1">{errors.student_code}</p>}
      </div>
      <div>
        <label className="text-xs text-gray-600">Teléfono *</label>
        <input type="tel" className={inputCls} value={form.phone_number} onChange={set("phone_number")} maxLength={20} />
        {errors.phone_number && <p className="text-xs text-red-600 mt-1">{errors.phone_number}</p>}
      </div>
      <div>
        <label className="text-xs text-gray-600">Dirección *</label>
        <input className={inputCls} value={form.address} onChange={set("address")} maxLength={500} />
        {errors.address && <p className="text-xs text-red-600 mt-1">{errors.address}</p>}
      </div>
      {errors._global && <p className="text-xs text-red-600">{errors._global}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm"
      >
        {saving ? "Guardando…" : "Guardar perfil y continuar"}
      </button>
    </form>
  );
}

export default function AttendQR() {
  const [token] = useState(readToken);
  const [phase, setPhase] = useState(token ? "resolving" : "no-token");
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [result, setResult] = useState(null);
  const [geo, setGeo] = useState({ latitude: null, longitude: null, accuracy: null });
  const [geoState, setGeoState] = useState("idle");
  const [showProfileForm, setShowProfileForm] = useState(false);

  const attendUrl = `${window.location.origin}/attend?token=${encodeURIComponent(token)}`;

  const resolve = useCallback(async () => {
    if (!token) return;
    setPhase("resolving");
    setError("");
    try {
      const data = await resolveToken(token);
      setSession(data);
      if (data.needs_profile) setShowProfileForm(true);
      if (data.already_marked) {
        setPhase("already");
      } else {
        setPhase("ready");
      }
    } catch (err) {
      const st = err?.response?.status;
      if (st === 401) {
        setPhase("login");
      } else if (st === 404) {
        setError("El código QR no es válido.");
        setPhase("error");
      } else if (st === 410) {
        setError(
          err?.response?.data?.error || "El código QR expiró o la clase ya finalizó."
        );
        setPhase("error");
      } else {
        setError("No se pudo validar el código. Revisa tu conexión e intenta de nuevo.");
        setPhase("error");
      }
    }
  }, [token]);

  useEffect(() => {
    resolve();
    api
      .get("/api/auth/me/")
      .then((r) => {
        setUser(r.data);
        if (r.data?.needs_profile) setShowProfileForm(true);
      })
      .catch(() => setUser(null));
  }, [resolve]);

  // La geolocalización solo se solicita cuando el QR ya está listo para
  // marcar (no al resolver ni en login/error).
  useEffect(() => {
    if (phase === "ready") requestLocation(setGeo, setGeoState);
  }, [phase]);

  const handleMark = async () => {
    setMarking(true);
    setError("");
    try {
      const { data } = await markAttendance({
        token,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy: geo.accuracy,
      });
      try {
        localStorage.removeItem(PENDING_TOKEN_KEY);
      } catch {
        // sin almacenamiento: nada que limpiar
      }
      setResult(data);
      setPhase(data.already_marked ? "already" : "done");
    } catch (err) {
      const st = err?.response?.status;
      if (st === 401) {
        setPhase("login");
      } else if (st === 404) {
        setError("El código QR no es válido.");
        setPhase("error");
      } else if (st === 412 || err?.response?.data?.needs_profile) {
        setError(
          err?.response?.data?.error ||
            "Completa tu perfil de estudiante para marcar asistencia."
        );
        setShowProfileForm(true);
        // Se queda en "ready" mostrando el formulario, no en "error".
        setPhase("ready");
        api
          .get("/api/auth/me/")
          .then((r) => setUser(r.data))
          .catch(() => {});
      } else if (st === 409 || st === 410) {
        setError(
          err?.response?.data?.error || "El código expiró o ya registraste tu asistencia."
        );
        setPhase("error");
      } else if (st === 403) {
        setError("Solo los estudiantes pueden marcar asistencia con esta cuenta.");
        setPhase("error");
      } else {
        setError("No se pudo registrar la asistencia, intenta de nuevo.");
        setPhase("error");
      }
    } finally {
      setMarking(false);
    }
  };

  const handleProfileSaved = (meData) => {
    setUser(meData);
    setShowProfileForm(false);
    setError("");
    resolve();
  };

  const geoLabel =
    geoState === "ready"
      ? "Ubicación registrada"
      : geoState === "pending"
        ? "Obteniendo ubicación (opcional)…"
        : "Sin ubicación — igual puedes marcar";

  if (phase === "no-token") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow border border-gray-100 text-center space-y-3">
          <h1 className="text-2xl font-bold text-gray-800">SIA-QR</h1>
          <p className="text-sm text-gray-600">Falta el token del código QR. Escanea el QR proyectado por tu profesor.</p>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow border border-gray-100 flex flex-col items-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-800">SIA-QR</h1>
          <p className="text-sm text-gray-600 text-center">
            Inicia sesión con tu correo institucional (@ut.edu.co) para marcar tu asistencia.
          </p>
          <a
            href={googleLoginUrl(attendUrl)}
            onClick={() => {
              // M4: respaldo local por si el ?next= no sobrevive al OAuth.
              try {
                localStorage.setItem(PENDING_TOKEN_KEY, token);
              } catch {
                // sin almacenamiento: el ?next= sigue siendo el camino principal
              }
            }}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-center"
          >
            Iniciar sesión con Google Institucional
          </a>
        </div>
      </div>
    );
  }

  if (phase === "resolving") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <p className="text-gray-500">Validando código QR…</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow border border-gray-100 text-center space-y-4">
          <h1 className="text-xl font-bold text-red-700">No se pudo continuar</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={resolve}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done" || phase === "already") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-green-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-xl shadow border border-green-200 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <h1 className="text-2xl font-bold text-green-700">
            {phase === "already" ? "Asistencia ya registrada" : "¡Asistencia registrada!"}
          </h1>
          {session && (
            <p className="text-sm text-gray-600">
              {session.class?.title} · {session.group?.course_name}
            </p>
          )}
          {result?.registered_at && (
            <p className="text-sm font-semibold text-gray-800">
              Hora: {formatBogota(result.registered_at)} (Bogotá)
            </p>
          )}
          {user?.email && <p className="text-xs text-gray-400">{user.email}</p>}
        </div>
      </div>
    );
  }

  // phase === "ready"
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow border border-gray-100 space-y-4">
        <h1 className="text-2xl font-bold text-gray-800 text-center">Marcar asistencia</h1>
        {session && (
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
            <p className="font-semibold text-gray-800">{session.class?.title}</p>
            <p className="text-gray-600">
              {session.group?.course_name} · Grupo {session.group?.group_code}
            </p>
            <p className="text-gray-500">Expira: {formatBogota(session.expires_at)}</p>
          </div>
        )}
        {(showProfileForm || user?.needs_profile || session?.needs_profile) && (
          <StudentProfileForm initial={user} onSaved={handleProfileSaved} />
        )}
        <p className="text-xs text-gray-500 text-center">📍 {geoLabel}</p>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <button
          onClick={handleMark}
          disabled={marking}
          className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-lg"
        >
          {marking ? "Registrando…" : "MARCAR ASISTENCIA"}
        </button>
        {user?.email && <p className="text-xs text-gray-400 text-center">{user.email}</p>}
      </div>
    </div>
  );
}
