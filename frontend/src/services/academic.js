import api from "./api";

// Caché de módulo de grupos para los filtros de Reportes: evita repetir hasta
// 20 requests al cambiar de pestaña. Se invalida en cada mutación de grupo.
let groupsCache = { true: null, false: null };
export const getGroupsCache = (isAdmin) => groupsCache[isAdmin];
export const setGroupsCache = (isAdmin, items) => {
  groupsCache[isAdmin] = items;
};
export const invalidateGroupsCache = () => {
  groupsCache = { true: null, false: null };
};

const unwrap = (data) => (Array.isArray(data) ? { results: data, count: data.length } : data);
const params = (search, page, pageSize, status) => {
  const p = {};
  if (search) p.search = search;
  if (page) p.page = page;
  if (pageSize) p.page_size = pageSize;
  if (status) p.status = status;
  return p;
};

export const getMyGroups = (search = "", page = 1) =>
  api.get("/api/academic/my-groups/", { params: params(search, page) }).then((r) => unwrap(r.data));
export const createMyGroup = (name) =>
  api.post("/api/academic/my-groups/", { name }).then((r) => {
    invalidateGroupsCache();
    return r.data;
  });
export const updateMyGroup = (groupId, name) =>
  api.patch(`/api/academic/my-groups/${groupId}/`, { name }).then((r) => {
    invalidateGroupsCache();
    return r.data;
  });
export const deleteMyGroup = (groupId) =>
  api.delete(`/api/academic/my-groups/${groupId}/`).then((r) => {
    invalidateGroupsCache();
    return r.data;
  });
export const getGroupClasses = (groupId, search = "", page = 1, status = "") =>
  api
    .get(`/api/academic/groups/${groupId}/classes/`, { params: params(search, page, null, status) })
    .then((r) => unwrap(r.data));
export const createGroupClass = (groupId, payload) =>
  api.post(`/api/academic/groups/${groupId}/classes/`, payload).then((r) => r.data);
export const getGroupClass = (groupId, classId) =>
  api.get(`/api/academic/groups/${groupId}/classes/${classId}/`).then((r) => r.data);
export const updateGroupClass = (groupId, classId, payload) =>
  api.patch(`/api/academic/groups/${groupId}/classes/${classId}/`, payload).then((r) => r.data);
export const deleteGroupClass = (groupId, classId) =>
  api.delete(`/api/academic/groups/${groupId}/classes/${classId}/`).then((r) => r.data);

// Admin: solo lectura de cursos + edición de clases
export const adminGetGroups = (search = "", page = 1) =>
  api.get("/api/academic/admin/groups/", { params: params(search, page) }).then((r) => unwrap(r.data));
export const adminGetGroup = (groupId) =>
  api.get(`/api/academic/admin/groups/${groupId}/`).then((r) => r.data);
export const adminGetGroupClasses = (groupId, search = "", page = 1, status = "") =>
  api
    .get(`/api/academic/admin/groups/${groupId}/classes/`, { params: params(search, page, null, status) })
    .then((r) => unwrap(r.data));
export const adminUpdateGroupClass = (groupId, classId, payload) =>
  api.patch(`/api/academic/admin/groups/${groupId}/classes/${classId}/`, payload).then((r) => r.data);

// Clase al momento: B3 crea ScheduledClass IN_PROGRESS + sesión QR atómica.
// payload opcional: { title, modality, duration_minutes, qr_duration_minutes,
// geofence_latitude, geofence_longitude, geofence_accuracy }.
// Solo PRESENTIAL usa la geocerca (el backend ignora coords en VIRTUAL).
export const createInstantClass = (groupId, payload = {}) =>
  api.post(`/api/academic/groups/${groupId}/classes/instant/`, payload).then((r) => r.data);

// Rango del salón (solo presencial): fija/reubica la referencia GPS del
// profesor. Idempotente: un POST posterior sobrescribe la ubicación.
export const setClassGeofence = (groupId, classId, payload = {}) =>
  api
    .post(`/api/academic/groups/${groupId}/classes/${classId}/geofence/`, payload)
    .then((r) => r.data);

// Estado del rango (sin coordenadas): { geofence_active, geofence_radius_m }.
export const getClassGeofence = (groupId, classId) =>
  api.get(`/api/academic/groups/${groupId}/classes/${classId}/geofence/`).then((r) => r.data);

// Revoca el QR vigente y emite uno nuevo (201). Resuelve a { data, status }:
// 201 live, 202 pending, 410 finalizada/expirada, 409/503 reintentables.
export const rotateCurrentSession = (groupId, classId) =>
  api
    .post(`/api/academic/groups/${groupId}/classes/${classId}/current-session/rotate/`)
    .then((r) => ({ data: r.data, status: r.status }))
    .catch((err) => {
      if (err?.response) return { data: err.response.data, status: err.response.status };
      throw err;
    });
