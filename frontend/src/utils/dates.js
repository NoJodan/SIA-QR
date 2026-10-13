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

// ISO del momento actual en hora de Bogotá (offset fijo -05:00, sin DST).
export function nowBogotaISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-05:00`;
}
