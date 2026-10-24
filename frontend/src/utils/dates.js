export function formatBogota(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

export function todayISODate(timeZone = "America/Bogota") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Construye un ISO con offset de Bogotá (-05:00, sin DST) a partir de fecha+hora locales.
export function combineDateTimeToISO(date, time) {
  return `${date}T${time}:00-05:00`;
}

// Fecha y hora numéricas de Bogotá (dd/mm/aaaa, hh:mm).
export function formatBogotaNumeric(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

// Separa un ISO en fecha y hora locales de Bogotá (para inputs date/time).
export function isoToBogotaDateTime(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}
