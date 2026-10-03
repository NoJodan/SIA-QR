import React, { useCallback, useEffect, useState } from "react";
import api, { ensureCsrf, googleLoginUrl } from "../services/api";
import { markAttendance, resolveToken } from "../services/attendance";
import { formatBogota } from "../utils/dates";
import logo from "../assets/logo.png";
import "./AttendQR.css";

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

// RNF-06: la geo es opcional y NO bloqueante. El navegador entrega
// 13-16 decimales; se redondea en el cliente (lat/lon 8, accuracy 2)
// como primera barrera (el backend también tolera/redondea).
function toFixedOrNull(v, dec) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(dec));
}

// M1: registro inicial real del estudiante (RF-EST-03). El nombre viene de
// Google (solo lectura); se exigen código/documento/teléfono/dirección
// reales; el backend valida unicidad con 409 legible.
function StudentProfileForm({ initial, onSaved, notice }) {
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
    "mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#B3200E] focus:outline-none focus:ring-4 focus:ring-red-100 aria-invalid:border-red-400";
  const fields = [
    { key: "document_number", label: "Número de documento", autoComplete: "off" },
    { key: "student_code", label: "Código estudiantil", autoComplete: "off" },
    { key: "phone_number", label: "Teléfono", type: "tel", autoComplete: "tel" },
    { key: "address", label: "Dirección", autoComplete: "street-address", wide: true },
  ];

  return (
    <form
      onSubmit={submit}
      aria-busy={saving}
      className="relative w-full overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_22px_65px_rgba(27,43,52,0.10)] sm:p-7"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#70100A] via-[#B3200E] to-[#E29A58]" aria-hidden="true" />
      <header className="mb-5 flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-[#B3200E]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#B3200E]">Un solo paso</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Completa tu perfil</h1>
          <p className="mt-1 text-sm leading-5 text-slate-500">Necesitamos estos datos para asociar tu asistencia a tu registro.</p>
        </div>
      </header>

      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#D33B25] to-[#941B0B] text-sm font-bold text-white">
          {(suggestedName || initial?.email || "E").charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Cuenta institucional</span>
          <strong className="mt-0.5 block truncate text-sm text-slate-800">{suggestedName || initial?.email || "Estudiante"}</strong>
          {suggestedName && initial?.email && <span className="block truncate text-xs text-slate-500">{initial.email}</span>}
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Google</span>
      </div>

      <p className="mb-4 text-xs text-slate-500">
        Los campos marcados con <span className="font-bold text-[#B3200E]">*</span> son obligatorios.
        {suggestedName && " Tu nombre viene de Google y no se puede editar."}
      </p>

      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {fields.map(({ key, label, type, autoComplete, wide }) => (
          <div key={key} className={wide ? "sm:col-span-2" : ""}>
            <label htmlFor={`student-${key}`} className="text-xs font-semibold text-slate-700">
              {label} <span className="text-[#B3200E]">*</span>
            </label>
            <input
              id={`student-${key}`}
              type={type || "text"}
              autoComplete={autoComplete}
              className={inputCls}
              value={form[key]}
              onChange={set(key)}
              maxLength={key === "phone_number" ? 20 : key === "address" ? 500 : 50}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `student-${key}-error` : undefined}
            />
            {errors[key] && (
              <p id={`student-${key}-error`} className="mt-1.5 text-xs font-medium text-red-600">
                {errors[key]}
              </p>
            )}
          </div>
        ))}
      </div>
      {(errors._global || notice) && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">
          {errors._global || notice}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B3200E] to-[#991B0F] px-4 py-3 text-sm font-bold text-white shadow-md shadow-red-900/15 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {saving ? "Guardando perfil…" : "Guardar perfil"}
        {!saving && (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
        <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Tus datos se usan para identificar tu asistencia.
      </p>
    </form>
  );
}

function AttendHeader() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#D33B25] via-[#B3200E] to-[#941B0B] px-4 py-3 text-white shadow-lg shadow-red-900/15 sm:px-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white p-2 shadow-sm ring-1 ring-white/50">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain object-center -translate-y-1"
        />
      </span>
      <div>
        <p className="text-[15px] font-extrabold leading-tight tracking-tight">SIA-QR</p>
        <p className="mt-1 text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-white/85">
          Universidad del Tolima
        </p>
      </div>
    </div>
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
    // Solo se envía ubicación si el GPS resolvió (ready); en cualquier
    // otro estado se fuerza null (no bloqueante). El botón NO se
    // deshabilita en pending: se puede firmar sin ubicación.
    const geoReady = geoState === "ready";
    const payload = {
      token,
      latitude: geoReady ? toFixedOrNull(geo.latitude, 8) : null,
      longitude: geoReady ? toFixedOrNull(geo.longitude, 8) : null,
      accuracy: geoReady ? toFixedOrNull(geo.accuracy, 2) : null,
    };
    const finishOk = (data) => {
      try {
        localStorage.removeItem(PENDING_TOKEN_KEY);
      } catch {
        // sin almacenamiento: nada que limpiar
      }
      setResult(data);
      setPhase(data.already_marked ? "already" : "done");
    };
    const markOnce = (body) => markAttendance(body);
    try {
      const { data } = await markOnce(payload);
      finishOk(data);
    } catch (err) {
      const st = err?.response?.status;
      if (st === 401) {
        setPhase("login");
      } else if (st === 404) {
        setError("El código QR no es válido.");
        setPhase("error");
      } else if (st === 400) {
        // Red de seguridad RNF-06: si el backend rechazó el payload
        // (p. ej. ubicación con formato inesperado), reintentar UNA vez
        // sin ubicación antes de mostrar error.
        const sentGeo =
          payload.latitude !== null ||
          payload.longitude !== null ||
          payload.accuracy !== null;
        if (sentGeo) {
          try {
            const { data } = await markOnce({
              token,
              latitude: null,
              longitude: null,
              accuracy: null,
            });
            finishOk(data);
            return;
          } catch (retryErr) {
            const rst = retryErr?.response?.status;
            const rdata = retryErr?.response?.data || {};
            if (rst === 412 || rdata?.needs_profile) {
              setError(
                rdata?.error ||
                  "Completa tu perfil de estudiante para marcar asistencia."
              );
              setShowProfileForm(true);
              setPhase("ready");
              return;
            }
            if (rst === 404) {
              setError("El código QR no es válido.");
              setPhase("error");
              return;
            }
            if (rst === 409 || rst === 410) {
              setError(
                rdata?.error ||
                  "El código expiró o ya registraste tu asistencia."
              );
              setPhase("error");
              return;
            }
            // El reintento sin ubicación también falló: mensaje legible
            // (RNF-06) y se queda en "ready" para reintentar.
            setError(
              rdata?.error ||
                "Ubicación inválida, reintentando sin ubicación."
            );
            setPhase("ready");
            return;
          }
        } else {
          const d = err?.response?.data || {};
          setError(
            d.error ||
              fieldError(d, "token") ||
              "No se pudo registrar la asistencia, intenta de nuevo."
          );
          setPhase("error");
        }
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
        : "Sin ubicación — igual puedes firmar";
  const geoBadgeCls =
    geoState === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : geoState === "pending"
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : "border-slate-200 bg-slate-50 text-slate-500";
  const profileRequired = Boolean(
    showProfileForm || user?.needs_profile || session?.needs_profile
  );

  if (phase === "no-token") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-4">
        <div className="w-full max-w-md space-y-4">
          <AttendHeader />
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <h1 className="text-xl font-bold text-slate-900">Firma tu asistencia</h1>
            <p className="text-sm text-slate-600">Falta el token del código QR. Escanea el QR proyectado por tu profesor.</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "login") {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-white via-[#F8FAFC] to-red-50/60 px-4 py-5 sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-red-100/60 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-orange-100/50 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col">
          <AttendHeader />
          <main className="flex flex-1 items-center py-8">
            <section className="relative w-full overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-[0_22px_65px_rgba(27,43,52,0.10)] backdrop-blur sm:p-9">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#70100A] via-[#B3200E] to-[#E29A58]" aria-hidden="true" />
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 to-orange-50 text-[#A92719] shadow-sm">
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#B3200E]">
                  Acceso seguro
                </p>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
                  Firma tu asistencia
                </h1>
                <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">
                  Inicia sesión con tu cuenta institucional para validar el código QR y continuar con tu asistencia.
                </p>
              </div>

              <div className="mt-7 flex items-center gap-3 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg font-bold text-[#4285F4] shadow-sm" aria-hidden="true">
                  G
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <strong className="block text-sm font-semibold text-slate-800">Usa tu correo institucional</strong>
                  <span className="mt-0.5 block text-xs text-slate-500">Tu cuenta @ut.edu.co</span>
                </span>
                <svg className="h-5 w-5 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

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
                className="mt-4 flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-[#9F1D10] bg-gradient-to-r from-[#B3200E] to-[#991B0F] px-4 py-3 text-sm font-bold text-white shadow-md shadow-red-900/15 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 focus-visible:ring-offset-2"
              >
                <svg className="h-5 w-5 shrink-0 rounded-full bg-white p-0.5" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
                  <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
                  <path fill="#FBBC05" d="M12.6 27.5a12 12 0 0 1 0-7.1v-5.3H5.8a20 20 0 0 0 0 17.7l6.8-5.3Z" />
                  <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9A19.7 19.7 0 0 0 24 4 20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
                </svg>
                <span>Continuar con Google</span>
                <svg className="ml-auto h-4 w-4 text-white/75" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>

              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">
                <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Autenticación protegida por Google
              </div>
            </section>
          </main>
          <footer className="flex items-center justify-center gap-2 pb-1 pt-3 text-center text-xs text-slate-400">
            <span>© {new Date().getFullYear()} Universidad del Tolima</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Conexión segura
            </span>
          </footer>
        </div>
      </div>
    );
  }

  if (phase === "resolving") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-4">
        <div className="w-full max-w-md space-y-4">
          <AttendHeader />
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="animate-pulse text-sm text-slate-500">Validando código QR…</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-4">
        <div className="w-full max-w-md space-y-4">
          <AttendHeader />
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
              Revisa e intenta de nuevo
            </span>
            <h1 className="text-xl font-bold text-red-700">No se pudo continuar</h1>
            <p className="text-sm text-slate-600">{error}</p>
            <button
              onClick={resolve}
              className="rounded-xl bg-[#B3200E] px-4 py-2 text-sm font-medium text-white hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done" || phase === "already") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F8FAFC] p-4">
        <div className="w-full max-w-md space-y-4">
          <AttendHeader />
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {phase === "already" ? "Ya firmada" : "Firma exitosa"}
            </span>
            <h1 className="text-2xl font-bold text-slate-900">
              {phase === "already" ? "Asistencia ya registrada" : "¡Asistencia registrada!"}
            </h1>
            {session && (
              <p className="text-sm text-slate-600">
                {session.class?.title} · {session.group?.course_name}
              </p>
            )}
            {result?.registered_at && (
              <p className="text-sm font-semibold text-slate-800">
                Hora: {formatBogota(result.registered_at)}
              </p>
            )}
            {user?.email && <p className="text-xs text-slate-400">{user.email}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (profileRequired) {
    return (
      <div className="flex min-h-dvh flex-col bg-gradient-to-br from-slate-50 via-[#F8FAFC] to-red-50/40 px-4 py-5 sm:px-6 sm:py-7">
        <header className="mx-auto w-full max-w-md">
          <AttendHeader />
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 items-center py-7">
          <StudentProfileForm
            initial={user}
            onSaved={handleProfileSaved}
            notice={error}
          />
        </main>
        <footer className="mx-auto flex w-full max-w-md items-center justify-center gap-2 pb-1 pt-3 text-center text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span>Universidad del Tolima <span className="px-1 text-slate-300">·</span> Acceso seguro</span>
        </footer>
      </div>
    );
  }

  // phase === "ready"
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-br from-slate-50 via-[#F8FAFC] to-red-50/40 px-4 py-5 sm:px-6 sm:py-7">
      <header className="mx-auto w-full max-w-md">
        <AttendHeader />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 items-center py-8">
        <section className="w-full space-y-6 rounded-3xl border border-slate-200/90 bg-white p-6 text-center shadow-[0_18px_55px_rgba(27,43,52,0.08)] sm:p-8">
          <div className="text-center">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#B3200E]">
              Registro de asistencia
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Confirma tu asistencia
            </h1>
          </div>
          {session && (
            <div className="relative space-y-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/90 p-4 pl-5 text-left text-sm sm:p-5 sm:pl-6">
              <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#B3200E] to-orange-300" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Clase actual
              </p>
              <p className="text-base font-bold text-slate-900">{session.class?.title}</p>
              <p className="font-medium text-slate-600">
                {session.group?.course_name} · Grupo {session.group?.group_code}
              </p>
              <p className="pt-1 text-xs text-slate-500">
                Código válido hasta {formatBogota(session.expires_at)}
              </p>
            </div>
          )}
          <div className="attend-sign-stage">
            <button
              type="button"
              onClick={handleMark}
              disabled={marking}
              aria-busy={marking}
              className={`attend-sign-button${marking ? " is-loading" : ""}`}
              aria-label={marking ? "Registrando asistencia" : "Firmar asistencia"}
            >
              {marking ? (
                <span className="attend-sign-spinner" aria-hidden="true" />
              ) : (
                <span className="attend-sign-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
              )}
              <span className="attend-sign-label">{marking ? "Registrando…" : "Firmar asistencia"}</span>
              <span className="attend-sign-caption">{marking ? "Un momento" : "Toca para registrar"}</span>
            </button>
            <p className="attend-sign-status" role="status" aria-live="polite">
              {marking ? "Validando tu asistencia…" : "Tu registro está listo"}
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${geoBadgeCls}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {geoLabel}
            </span>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          </div>
          {user?.email && <p className="text-center text-xs text-slate-400">{user.email}</p>}
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-md items-center justify-center gap-2 pb-1 pt-3 text-center text-xs text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        <span>Universidad del Tolima <span className="px-1 text-slate-300">·</span> Acceso seguro</span>
      </footer>
    </div>
  );
}
