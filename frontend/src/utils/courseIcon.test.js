import { courseIcon } from "./courseIcon";

test("matemáticas usa la calculadora", () => {
  expect(courseIcon("Matemáticas")).toBe("fa-calculator");
});

test("minería de datos usa la base de datos", () => {
  expect(courseIcon("Minería de datos")).toBe("fa-database");
});

test("programación usa el ícono de código", () => {
  expect(courseIcon("Programación Orientada a Objetos")).toBe("fa-code");
});

test("derecho usa la balanza", () => {
  expect(courseIcon("Derecho Constitucional")).toBe("fa-scale-balanced");
});

test.each([
  ["Física I", "fa-flask"],
  ["Inglés Técnico", "fa-book-open"],
  ["Historia Universal", "fa-landmark"],
  ["Economía", "fa-chart-line"],
  ["Enfermería", "fa-heart-pulse"],
  ["Artes Plásticas", "fa-palette"],
  ["Ingeniería Civil", "fa-compass-drafting"],
  ["Redes Informáticas", "fa-network-wired"],
  ["Seguridad Informática", "fa-network-wired"],
  ["Inteligencia Artificial", "fa-database"],
])("%s usa el ícono %s", (name, icon) => {
  expect(courseIcon(name)).toBe(icon);
});

test("informática sola sigue usando el ícono de código", () => {
  expect(courseIcon("Informática")).toBe("fa-code");
});

test("cursos no reconocidos usan el ícono por defecto", () => {
  expect(courseIcon("Curso inventado")).toBe("fa-graduation-cap");
  expect(courseIcon("")).toBe("fa-graduation-cap");
  expect(courseIcon(null)).toBe("fa-graduation-cap");
});
