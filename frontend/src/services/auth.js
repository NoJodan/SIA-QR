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

export async function adminGetStudents(search = "", page = 1) {
  const params = { page };
  if (search) params.search = search;
  const res = await api.get("/api/auth/admin/students/", { params });
  return res.data;
}

export async function adminClearUsers() {
  const res = await api.post("/api/auth/admin/clear-users/");
  return res.data;
}
