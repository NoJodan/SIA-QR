// Etiquetas y colores de modalidad/estado de clase (única fuente en la UI).
export const MODALITY_LABELS = {
  PRESENTIAL: "Presencial",
  VIRTUAL: "Mediada",
};

export const CLASS_STATUS_LABELS = {
  SCHEDULED: "Programada",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Finalizada",
  CANCELLED: "Cancelada",
};

export const CLASS_STATUS_COLORS = {
  SCHEDULED: "bg-amber-50 text-amber-700 border border-amber-200",
  IN_PROGRESS: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  COMPLETED: "bg-slate-100 text-slate-600 border border-slate-200",
  CANCELLED: "bg-red-50 text-red-700 border border-red-200",
};

// El backend cierra la clase de forma perezosa (solo al consultar
// current-session), así que el estado visible se deriva del reloj sin
// contradecir lo ya persistido.
export function effectiveClassStatus(clase, now = Date.now()) {
  const persisted = clase?.status;
  if (persisted === "CANCELLED" || persisted === "COMPLETED") return persisted;
  const start = Date.parse(clase?.start_time);
  const rawMinutes = clase?.duration_minutes;
  const minutes = rawMinutes == null || rawMinutes === "" ? NaN : Number(rawMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(minutes)) return persisted;
  if (now >= start + minutes * 60000) return "COMPLETED";
  if (persisted === "IN_PROGRESS") return "IN_PROGRESS";
  if (now >= start) return "IN_PROGRESS";
  return "SCHEDULED";
}
