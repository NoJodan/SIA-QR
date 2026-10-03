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

  const fields = [
    { key: "document_number", label: "Número de documento", autoComplete: "off" },
    { key: "student_code", label: "Código estudiantil", autoComplete: "off" },
    { key: "phone_number", label: "Teléfono", type: "tel", autoComplete: "tel" },
    { key: "address", label: "Dirección", autoComplete: "street-address" },
  ];

  return (
    <form
      onSubmit={submit}
      aria-busy={saving}
      className="attend-profile-form"
    >
      <header className="attend-profile-form-heading">
        <span className="attend-profile-step" aria-hidden="true">01</span>
        <div>
          <p className="attend-profile-kicker">Antes de firmar</p>
          <h2>Completa tu perfil</h2>
          <p>Registra estos datos una sola vez para continuar con tu asistencia.</p>
        </div>
      </header>

      <section className="attend-profile-account" aria-label="Cuenta institucional">
        <span className="attend-profile-avatar" aria-hidden="true">
          {(suggestedName || initial?.email || "E").charAt(0).toUpperCase()}
        </span>
        <span className="attend-profile-account-copy">
          <span className="attend-profile-account-label">Cuenta institucional</span>
          <strong>{suggestedName || initial?.email || "Estudiante"}</strong>
          {suggestedName && initial?.email && <span>{initial.email}</span>}
        </span>
        <span className="attend-profile-google-mark" aria-label="Cuenta de Google">G</span>
      </section>

      {suggestedName && (
        <p className="attend-profile-readonly">
          Tu nombre se obtiene de Google y no se puede editar aquí.
        </p>
      )}

      <div className="attend-profile-fields">
        {fields.map(({ key, label, type, autoComplete }) => (
          <div key={key} className={`attend-profile-field${key === "address" ? " is-wide" : ""}`}>
            <label htmlFor={`student-${key}`}>
              {label}<span aria-hidden="true"> *</span>
            </label>
            <input
              id={`student-${key}`}
              type={type || "text"}
              autoComplete={autoComplete}
              className="attend-profile-input"
              value={form[key]}
              onChange={set(key)}
              maxLength={key === "phone_number" ? 20 : key === "address" ? 500 : 50}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `student-${key}-error` : undefined}
            />
            {errors[key] && (
              <p id={`student-${key}-error`} className="attend-profile-field-error">
                {errors[key]}
              </p>
            )}
          </div>
        ))}
      </div>
      {(errors._global || notice) && (
        <p className="attend-profile-global-error" role="alert">
          {errors._global || notice}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="attend-profile-submit"
      >
        <span>{saving ? "Guardando perfil…" : "Guardar y continuar"}</span>
        {!saving && (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <p className="attend-profile-privacy">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  const profileRequired = Boolean(
    showProfileForm || user?.needs_profile || session?.needs_profile
  );
  const completed = phase === "done" || phase === "already";

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
      <main className="attend-login-page">
        <div className="attend-login-shell">
          <header className="attend-login-brand">
            <img src={logo} alt="" />
            <span>
              <strong>SIA-QR</strong>
              <small>Universidad del Tolima</small>
            </span>
            <span className="attend-login-portal">Portal estudiantil</span>
          </header>

          <section className="attend-login-card">
            <div className="attend-login-card-topline" aria-hidden="true" />
            <div className="flex flex-col items-center text-center">
              <div className="attend-login-icon">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="attend-login-eyebrow">Acceso seguro</p>
              <h1>Firma tu asistencia</h1>
              <p className="attend-login-description">
                Inicia sesión con tu cuenta institucional para validar el código QR y continuar con tu asistencia.
              </p>
            </div>

            <div className="attend-login-account-hint">
              <span className="attend-login-google-letter" aria-hidden="true">
                G
              </span>
              <span>
                <strong>Usa tu correo institucional</strong>
                <small>Tu cuenta @ut.edu.co</small>
              </span>
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
              className="attend-login-google-button"
            >
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
                <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
                <path fill="#FBBC05" d="M12.6 27.5a12 12 0 0 1 0-7.1v-5.3H5.8a20 20 0 0 0 0 17.7l6.8-5.3Z" />
                <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9A19.7 19.7 0 0 0 24 4 20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
              </svg>
              <span>Continuar con Google</span>
              <svg className="attend-login-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>

            <p className="attend-login-privacy">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Autenticación protegida por Google
            </p>
          </section>
          <footer className="attend-login-footer">
            <span>© {new Date().getFullYear()} Universidad del Tolima</span>
            <span><i aria-hidden="true" /> Conexión segura</span>
          </footer>
        </div>
      </main>
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

  if (profileRequired && !completed) {
    return (
      <main className="attend-profile-page">
        <div className="attend-profile-content">
          <header className="attend-profile-brand">
            <img src={logo} alt="" />
            <span>
              <strong>SIA-QR</strong>
              <small>Universidad del Tolima</small>
            </span>
            <span className="attend-profile-brand-label">Portal estudiantil</span>
          </header>
          <section className="attend-profile-card">
            <div className="attend-profile-card-topline" aria-hidden="true" />
            <div className="attend-profile-heading">
              <p className="attend-portal-eyebrow">Registro de asistencia</p>
              <h1>Confirma tu asistencia</h1>
              <p>Completa tus datos para continuar con el registro de esta clase.</p>
            </div>
            <div className="attend-profile-progress" aria-label="Paso 1 de 2: perfil del estudiante">
              <div className="attend-profile-progress-item is-current">
                <span>1</span>
                <strong>Tu perfil</strong>
              </div>
              <span className="attend-profile-progress-line" aria-hidden="true" />
              <div className="attend-profile-progress-item">
                <span>2</span>
                <strong>Asistencia</strong>
              </div>
            </div>
            <StudentProfileForm
              initial={user}
              onSaved={handleProfileSaved}
              notice={error}
            />
          </section>
          <p className="attend-profile-page-footer">
            <span className="attend-secure-dot" aria-hidden="true" />
            Acceso seguro con tu cuenta institucional
          </p>
        </div>
      </main>
    );
  }

  const classData = session?.class;
  const groupData = session?.group;

  return (
    <div className="attend-portal">
      <div className="attend-portal-shell">
        <header className="attend-portal-topbar">
          <div className="attend-portal-brand" aria-label="SIA-QR, Universidad del Tolima">
            <img src={logo} alt="" className="attend-portal-logo" />
            <span className="attend-portal-brand-copy">
              <span className="attend-portal-brand-name">SIA-QR</span>
              <span className="attend-portal-brand-school">Universidad del Tolima</span>
            </span>
          </div>
          <span className="attend-portal-label">Portal estudiantil</span>
        </header>

        {session && (
          <section className="attend-class-context" aria-label="Información de la clase">
            <div className="attend-class-heading">
              <p className="attend-portal-eyebrow">Clase actual</p>
              <h2 className="attend-course-name">
                {groupData?.course_name || classData?.title}
              </h2>
              {groupData?.course_name && classData?.title && (
                <p className="attend-class-title">{classData.title}</p>
              )}
            </div>
            <div className="attend-class-details">
              {classData?.start_time && (
                <span className="attend-detail-item">
                  <span className="attend-detail-dot" aria-hidden="true" />
                  {formatBogota(classData.start_time)}
                </span>
              )}
              {groupData?.group_code && (
                <span className="attend-detail-item">Grupo {groupData.group_code}</span>
              )}
              {session.expires_at && (
                <span className="attend-detail-item">
                  QR válido hasta {formatBogota(session.expires_at)}
                </span>
              )}
            </div>
          </section>
        )}

        <main className="attend-portal-main">
          <div className="attend-portal-heading">
            <p className="attend-portal-eyebrow">Registro de asistencia</p>
            <h1>
              {completed
                ? phase === "already" ? "Asistencia ya registrada" : "¡Asistencia registrada!"
                : "Confirma tu asistencia"}
            </h1>
          </div>

          <div className="attend-portal-stage">
            <button
              type="button"
              onClick={handleMark}
              disabled={marking || completed}
              aria-busy={marking}
              aria-label={
                completed
                  ? phase === "already" ? "La asistencia ya estaba registrada" : "Asistencia registrada"
                  : marking ? "Registrando asistencia" : "Firmar asistencia"
              }
              className={`attend-portal-button${marking ? " is-loading" : ""}${completed ? " is-success" : ""}`}
            >
              <span className="attend-button-symbol" aria-hidden="true">
                <svg className="attend-icon-idle" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
                  <circle cx="12" cy="12" r="3.25" />
                  <circle className="attend-target-dot" cx="12" cy="12" r="1.1" />
                </svg>
                <svg className="attend-icon-success" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path className="attend-check-path" d="m5 12 4 4L19 6" />
                </svg>
              </span>
              <span className="attend-button-spinner" aria-hidden="true" />
              <span className="attend-button-label">
                {completed
                  ? phase === "already" ? "Ya estaba firmada" : "Asistencia firmada"
                  : marking ? "Registrando…" : "Firmar asistencia"}
              </span>
              <span className="attend-button-caption">
                {completed ? "Registro confirmado" : marking ? "Un momento" : "Toca para registrar"}
              </span>
            </button>

            <p className={`attend-status-note${completed ? " is-success" : ""}`} role="status" aria-live="polite">
              {completed
                ? phase === "already"
                  ? "Tu asistencia ya estaba registrada para esta clase."
                  : "Tu asistencia quedó registrada para esta clase."
                : marking ? "Validando tu asistencia…" : "Sesión disponible"}
            </p>
            {error && <p className="attend-inline-error" role="alert">{error}</p>}
            {!completed && (
              <span className="attend-location-note">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                {geoLabel}
              </span>
            )}
          </div>

          {result?.registered_at && (
            <p className="attend-registered-at">Registrada: {formatBogota(result.registered_at)}</p>
          )}
          {user?.email && <p className="attend-student-email">{user.email}</p>}
        </main>

        <footer className="attend-portal-footer">
          <span>Universidad del Tolima <span aria-hidden="true">·</span> SIA-QR</span>
          <span className="attend-footer-status">
            <span className="attend-secure-dot" aria-hidden="true" />
            Conexión segura
          </span>
        </footer>
      </div>
    </div>
  );
}
