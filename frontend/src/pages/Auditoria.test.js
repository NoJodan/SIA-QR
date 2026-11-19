import { buildParams, emptyFilters } from "./Auditoria";

const filters = (extra = {}) => ({ ...emptyFilters, ...extra });

test("solo acción: envía sus event_type unidos", () => {
  expect(
    buildParams(filters({ actionTypes: ["group_created", "group_updated"] })),
  ).toEqual({ event_type: "group_created,group_updated" });
});

test("solo módulo: envía sus event_type unidos", () => {
  expect(buildParams(filters({ moduleTypes: ["qr_rotated"] }))).toEqual({
    event_type: "qr_rotated",
  });
});

test("acción y módulo: solo los event_type en común (intersección)", () => {
  const params = buildParams(
    filters({
      actionTypes: ["group_created", "class_updated"],
      moduleTypes: ["class_updated", "class_deleted"],
    }),
  );
  expect(params.event_type).toBe("class_updated");
});

test("acción y módulo disjuntos: centinela __ninguno__", () => {
  const params = buildParams(
    filters({ actionTypes: ["group_created"], moduleTypes: ["qr_rotated"] }),
  );
  expect(params.event_type).toBe("__ninguno__");
});

test("Limpiar (filtros vacíos) no envía parámetros", () => {
  expect(buildParams(emptyFilters)).toEqual({});
});

test("búsqueda solo de espacios se descarta", () => {
  expect(buildParams(filters({ q: "   " }))).toEqual({});
});

test("conserva los demás filtros junto a la intersección", () => {
  const params = buildParams(
    filters({
      q: "  Ana  ",
      subject: "Matematicas",
      ordering: "actor",
      actionTypes: ["group_created"],
      moduleTypes: ["group_created", "group_deleted"],
    }),
  );
  expect(params).toEqual({
    q: "Ana",
    subject: "Matematicas",
    ordering: "actor",
    event_type: "group_created",
  });
});
