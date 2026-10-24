import { effectiveClassStatus } from "./classMeta";

const START = Date.parse("2026-10-24T10:00:00-05:00");
const clase = (extra = {}) => ({
  status: "SCHEDULED",
  start_time: "2026-10-24T10:00:00-05:00",
  duration_minutes: 60,
  ...extra,
});

test("deriva SCHEDULED/IN_PROGRESS/COMPLETED del reloj", () => {
  expect(effectiveClassStatus(clase(), START - 1)).toBe("SCHEDULED");
  expect(effectiveClassStatus(clase(), START)).toBe("IN_PROGRESS");
  expect(effectiveClassStatus(clase(), START + 30 * 60000)).toBe("IN_PROGRESS");
  expect(effectiveClassStatus(clase(), START + 60 * 60000)).toBe("COMPLETED");
});

test("respeta CANCELLED/COMPLETED persistidos", () => {
  expect(effectiveClassStatus(clase({ status: "CANCELLED" }), START - 60000)).toBe("CANCELLED");
  expect(effectiveClassStatus(clase({ status: "COMPLETED" }), START - 60000)).toBe("COMPLETED");
});

test("respeta IN_PROGRESS persistido antes de la hora de inicio", () => {
  expect(effectiveClassStatus(clase({ status: "IN_PROGRESS" }), START - 60000)).toBe("IN_PROGRESS");
});

test("datos inválidos: devuelve el estado persistido", () => {
  expect(effectiveClassStatus(clase({ start_time: "no-es-fecha" }), START)).toBe("SCHEDULED");
  expect(effectiveClassStatus(clase({ duration_minutes: null }), START)).toBe("SCHEDULED");
  expect(effectiveClassStatus(clase({ duration_minutes: "abc" }), START)).toBe("SCHEDULED");
});
