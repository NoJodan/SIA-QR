import api, { ensureCsrf } from "./api";

/**
 * Login de administrador por sesión Django (NO JWT).
 * Reutiliza la instancia `api` (withCredentials + CSRF + ensureCsrf).
 */
export async function adminLogin(email, password) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  await ensureCsrf();
  const res = await api.post("/api/auth/admin/login/", {
    email: normalizedEmail,
    password,
  });
  return res.data;
}

const authService = { adminLogin };

export default authService;
