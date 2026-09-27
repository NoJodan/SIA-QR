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

// C1: fija la cookie `csrftoken` vía GET /api/auth/csrf/.
export const ensureCsrf = () => {
  if (csrfReady) return Promise.resolve();
  if (!csrfPromise) {
    csrfPromise = api
      .get("/api/auth/csrf/")
      .then(() => {
        csrfReady = true;
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
  }
  return config;
});

export const googleLoginUrl = (next) =>
  `${API_BASE}/api/auth/google/login/${next ? `?next=${encodeURIComponent(next)}` : ""}`;

export default api;
