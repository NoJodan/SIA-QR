import api from "./api";

// B1: resolver token QR -> sesión + clase + expiración + already_marked.
export const resolveToken = (token) =>
  api.get("/api/attendance/resolve/", { params: { token } }).then((r) => r.data);

// B2: marcar asistencia (geo opcional, idempotente).
export const markAttendance = (payload) =>
  api.post("/api/attendance/mark/", payload).then((r) => ({ data: r.data, status: r.status }));

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

// A2: marcaciones de la clase, todas sus sesiones (profesor dueño o admin).
// page_size opcional (máx. 50 en el backend); sin él, el default del servidor.
export const getClassAttendances = (classId, page = 1, pageSize) =>
  api
    .get(`/api/attendance/classes/${classId}/attendances/`, {
      params: pageSize ? { page, page_size: pageSize } : { page },
    })
    .then((r) => r.data);

// RF-ADM-07: historial de auditoría (solo admin). La respuesta trae
// `stats` (total, professors, administrators, last_activity) del
// queryset ya filtrado, así que KPIs y tabla salen de un solo request.
export const fetchAuditLogs = (params = {}, page = 1, pageSize = 10) =>
  api
    .get("/api/attendance/audit-logs/", {
      params: { ...params, page, page_size: pageSize },
    })
    .then((r) => r.data);
