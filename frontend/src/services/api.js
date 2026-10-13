import axios from "axios";

export const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";
export const FRONTEND_BASE =
  (typeof window !== "undefined" && window.location.origin) || "http://localhost:3000";

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  // C1: envía X-CSRFToken en mutaciones (Django SessionAuthentication).
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
  withXSRFToken: true,
});

let csrfReady = false;
let csrfPromise = null;
// Token en memoria para despliegue cross-site: document.cookie no ve la
// cookie de otro dominio, así que se toma del JSON de /api/auth/csrf/.
let csrfTokenMemory = null;

// C1: fija la cookie `csrftoken` vía GET /api/auth/csrf/.
export const ensureCsrf = () => {
  if (csrfReady) return Promise.resolve();
  if (!csrfPromise) {
    csrfPromise = api
      .get("/api/auth/csrf/")
      .then((res) => {
        csrfReady = true;
        const t = res?.data?.csrfToken;
        if (t) csrfTokenMemory = t;
      })
      .catch(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
};

// Fire-and-forget al cargar el SPA para que el primer POST ya lleve CSRF.
ensureCsrf();

api.interceptors.request.use(async (config) => {
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch", "delete"].includes(method)) {
    try {
      await ensureCsrf();
    } catch {
      // No bloquea: el backend responderá 403 CSRF y se verá el error real.
    }
    // Cross-site: el header se arma desde memoria (document.cookie no ve
    // la cookie del dominio del backend). Si no hay token en memoria,
    // axios usa el mecanismo por cookie como antes (local).
    if (csrfTokenMemory) {
      config.headers = config.headers || {};
      config.headers["X-CSRFToken"] = csrfTokenMemory;
    }
  }
  return config;
});

// Reintento único ante 403 CSRF: el token en memoria puede desincronizarse
// de la cookie (ej. login en el admin Django en otro tab rota el token).
// Se refresca el token y se reintenta la petición una sola vez.
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const res = error?.response;
    const cfg = error?.config || {};
    const detail = res?.data?.detail || "";
    if (res?.status === 403 && detail.includes("CSRF") && !cfg._csrfRetried) {
      cfg._csrfRetried = true;
      csrfReady = false;
      csrfPromise = null;
      try {
        await ensureCsrf();
        if (csrfTokenMemory) {
          cfg.headers = cfg.headers || {};
          cfg.headers["X-CSRFToken"] = csrfTokenMemory;
        }
        return api.request(cfg);
      } catch {
        // Si el refresco falla, cae al error original.
      }
    }
    return Promise.reject(error);
  }
);

export const googleLoginUrl = (next) =>
  `${API_BASE}/api/auth/google/login/${next ? `?next=${encodeURIComponent(next)}` : ""}`;

export default api;
