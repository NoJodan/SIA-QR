import api from "./api";

// B1: resolver token QR -> sesión + clase + expiración + already_marked.
export const resolveToken = (token) =>
  api.get("/api/attendance/resolve/", { params: { token } }).then((r) => r.data);

// B2: marcar asistencia (geo opcional, idempotente).
export const markAttendance = (payload) =>
  api.post("/api/attendance/mark/", payload).then((r) => ({ data: r.data, status: r.status }));

// A1 (fallback interno, sin uso en la UI automática): generar sesión QR
// sobre una clase (profesor dueño).
export const createClassSession = (groupId, classId, payload = {}) =>
  api
    .post(`/api/academic/groups/${groupId}/classes/${classId}/sessions/`, payload)
    .then((r) => r.data);

// QR automático: sesión vigente idempotente (profesor dueño).
// Resuelve siempre a { data, status }: 200 live, 202 pending, 410 finished.
// GET puro (sin CSRF); el backend responde `Cache-Control: no-store`.
export const getCurrentSession = (groupId, classId) =>
  api
    .get(`/api/academic/groups/${groupId}/classes/${classId}/current-session/`)
    .then((r) => ({ data: r.data, status: r.status }))
    .catch((err) => {
      if (err?.response) return { data: err.response.data, status: err.response.status };
      throw err;
    });

// M1 (opción b): rotar el QR para mostrarlo en este dispositivo.
// POST con CSRF (mutación). Resuelve a { data, status }: 201 live,
// 202 pending, 410 finished, 409/503 reintentables.
export const rotateCurrentSession = (groupId, classId, payload = {}) =>
  api
    .post(`/api/academic/groups/${groupId}/classes/${classId}/current-session/rotate/`, payload)
    .then((r) => ({ data: r.data, status: r.status }))
    .catch((err) => {
      if (err?.response) return { data: err.response.data, status: err.response.status };
      throw err;
    });

// A2: lista paginada de marcaciones de una sesión (profesor dueño).
export const getSessionAttendances = (sessionId, page = 1) =>
  api
    .get(`/api/attendance/sessions/${sessionId}/attendances/`, { params: { page } })
    .then((r) => r.data);
