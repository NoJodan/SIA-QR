import api from "./api";

// Tope de filas para descargas (espejo de MAX_EXPORT_ROWS del backend).
export const MAX_EXPORT_ROWS = 5000;

// Preview paginado del reporte (format=json). Devuelve { count, results, ... }.
export const getReportPreview = (params = {}, page = 1, pageSize = 10) =>
  api
    .get("/api/attendance/reports/", {
      params: { ...params, format: "json", page, page_size: pageSize },
    })
    .then((r) => r.data);

const filenameFromHeader = (header, fallback) => {
  if (!header) return fallback;
  // RFC 5987: filename*=UTF-8''... tiene prioridad sobre filename="...".
  const starred = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (starred && starred[1]) {
    try {
      return decodeURIComponent(starred[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return starred[1].trim();
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quoted && quoted[1]) return quoted[1];
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  if (bare && bare[1]) return bare[1].trim();
  return fallback;
};

// Descarga xlsx/pdf como blob y dispara el guardado con el filename del header.
export const downloadReport = async (params = {}, format = "xlsx") => {
  const res = await api.get("/api/attendance/reports/", {
    params: { ...params, format },
    responseType: "blob",
  });
  const header = res.headers?.["content-disposition"] || "";
  const filename = filenameFromHeader(header, `siaqr_reporte.${format}`);
  const blob =
    res.data instanceof Blob
      ? res.data
      : new Blob([res.data], { type: res.headers?.["content-type"] });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  return { filename, blob };
};

// Extrae un mensaje legible de un error axios (incluye blobs de error).
export const reportErrorMessage = async (err, fallback) => {
  const status = err?.response?.status;
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      const msg =
        parsed?.error ||
        Object.values(parsed || {})?.flat?.()?.join?.(" ") ||
        text;
      if (msg) return { status, message: String(msg).slice(0, 300) };
    } catch {
      // Sigue al fallback.
    }
  }
  const msg =
    data?.error ||
    (typeof data === "string" ? data : null) ||
    Object.values(data || {})?.flat?.()?.join?.(" ") ||
    err?.message;
  return { status, message: String(msg || fallback || "No se pudo cargar el reporte.").slice(0, 300) };
};
