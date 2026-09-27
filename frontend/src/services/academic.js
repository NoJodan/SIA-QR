import api from "./api";
import { nowBogotaISO } from "../utils/dates";

const unwrap = (data) => (Array.isArray(data) ? { results: data, count: data.length } : data);
const params = (search, page, pageSize) => {
  const p = {};
  if (search) p.search = search;
  if (page) p.page = page;
  if (pageSize) p.page_size = pageSize;
  return p;
};

export const getMyGroups = (search = "", page = 1) =>
  api.get("/api/academic/my-groups/", { params: params(search, page) }).then((r) => unwrap(r.data));
export const createMyGroup = (name) =>
  api.post("/api/academic/my-groups/", { name }).then((r) => r.data);
export const updateMyGroup = (groupId, name) =>
  api.patch(`/api/academic/my-groups/${groupId}/`, { name }).then((r) => r.data);
export const deleteMyGroup = (groupId) =>
  api.delete(`/api/academic/my-groups/${groupId}/`).then((r) => r.data);
export const getGroupClasses = (groupId, search = "", page = 1) =>
  api.get(`/api/academic/groups/${groupId}/classes/`, { params: params(search, page) }).then((r) => unwrap(r.data));
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
export const adminGetGroupClasses = (groupId, search = "", page = 1) =>
  api.get(`/api/academic/admin/groups/${groupId}/classes/`, { params: params(search, page) }).then((r) => unwrap(r.data));
export const adminUpdateGroupClass = (groupId, classId, payload) =>
  api.patch(`/api/academic/admin/groups/${groupId}/classes/${classId}/`, payload).then((r) => r.data);

// Clase al momento: usa el endpoint de creación existente.
export const createInstantClass = (groupId) => {
  const hm = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return createGroupClass(groupId, {
    title: `Clase inmediata ${hm}`,
    start_time: nowBogotaISO(),
    duration_minutes: 60,
    qr_duration_minutes: 15,
    modality: "PRESENTIAL",
  });
};
