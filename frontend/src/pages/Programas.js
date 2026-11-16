import React, { useEffect, useRef, useState } from "react";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import Skeleton from "../components/Skeleton";
import { adminCreateProgram, adminDeleteProgram, adminUpdateProgram, getPrograms } from "../services/academic";
import useDebounce from "../utils/useDebounce";

const AREAS = ["Presencial", "IDEAD"];
const PAGE_SIZE = 50;

// DRF: `{field: ["msg"]}`, `{error: "..."}` o un cuerpo de texto plano.
const apiError = (err, fallback) => {
  const data = err?.response?.data;
  if (typeof data === "string") return data;
  const first = data?.error ?? data?.detail ?? Object.values(data || {})[0];
  const message = Array.isArray(first) ? first[0] : first;
  return typeof message === "string" && message ? message : fallback;
};

const EMPTY_FORM = { name: "", code: "", area: "Presencial" };

export default function Programas() {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const debounced = useDebounce(search, 300);
  const seqRef = useRef(0);

  const load = (s, p) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    setError("");
    getPrograms(s, p)
      .then((data) => {
        if (seq !== seqRef.current) return;
        setPrograms(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => {
        if (seq === seqRef.current) setError("No se pudieron cargar los programas.");
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    load(debounced, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, page]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (program) => {
    setEditing(program);
    setForm({ name: program.name, code: program.code, area: program.area });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    if (!form.code) {
      setFormError("El código es obligatorio.");
      return;
    }
    // Solo dígitos (el input ya filtra); se muestra/guarda como 4 dígitos.
    const code = form.code.padStart(4, "0");
    setFormError("");
    setSaving(true);
    try {
      const payload = { name, code, area: form.area };
      if (editing) await adminUpdateProgram(editing.id, payload);
      else await adminCreateProgram(payload);
      setModalOpen(false);
      load(debounced, page);
    } catch (err) {
      setFormError(apiError(err, "No se pudo guardar el programa."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (program) => {
    if (!window.confirm(`¿Eliminar el programa ${program.name}?`)) return;
    setError("");
    try {
      await adminDeleteProgram(program.id);
      // La página actual pudo quedar vacía: DRF respondería 404 al recargarla.
      if (programs.length === 1 && page > 1) setPage(page - 1);
      else load(debounced, page);
    } catch (err) {
      setError(apiError(err, "No se pudo eliminar el programa."));
    }
  };

  return (
    <div>
      <section className="relative mb-10 flex min-h-[132px] items-center justify-between gap-4 overflow-hidden rounded-xl px-4 py-5 text-white shadow-[0_8px_20px_-8px_rgba(76,18,24,0.35)] bg-[linear-gradient(110deg,#5A0A05,#B3200E)] sm:bg-[radial-gradient(ellipse_at_43%_115%,rgba(196,39,15,0.62)_0_29%,transparent_30%),linear-gradient(120deg,#5A0A05_0%,#8E1409_53%,#A81A0C_53.2%,#B3200E_54%,#FDF1EE_54.3%,#FFFFFF_100%)]">
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-[#C4270F] text-xl">
            <i className="fa-solid fa-university" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">Programas</h2>
            {loading ? (
              <>
                <p role="status" className="sr-only">Cargando programas...</p>
                <Skeleton className="mt-1 h-4 w-24 !bg-white/40" />
              </>
            ) : (
              <p className="mt-0.5 text-xs text-red-100/90">
                {`${count} ${count === 1 ? "programa" : "programas"}`}
              </p>
            )}
            <button
              type="button"
              onClick={openCreate}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-[#B3200E] shadow-sm transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
            >
              <i className="fa-solid fa-plus" aria-hidden="true" /> Nuevo programa
            </button>
          </div>
        </div>
        <div className="relative z-10 hidden w-52 shrink-0 lg:block xl:w-56" aria-hidden="true">
          <svg viewBox="0 0 240 110" className="h-auto w-full">
            <ellipse cx="118" cy="94" rx="105" ry="12" fill="#efc7c9" opacity=".45" />
            <path d="M37 73h79l25 10-78 12-27-10z" fill="#B3200E" />
            <path d="M41 65h76l23 9-78 12-25-9z" fill="#fff3ef" />
            <path d="M44 57h71l24 9-77 12-25-9z" fill="#C4270F" />
            <path d="M51 48h64l24 9-77 12-24-9z" fill="#f8e6e2" />
            <path d="M56 42h62l22 8-77 12-22-8z" fill="#8E1409" />
          </svg>
        </div>
      </section>

      <div className="mb-4">
        <SearchBar
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Buscar programa..."
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
        </p>
      )}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="animate-pulse rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 shrink-0 rounded-2xl bg-slate-200" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="h-3 w-1/3 rounded bg-slate-100" />
                </div>
              </div>
              <div className="mt-6 space-y-2">
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="h-3 w-2/5 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && programs.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#B3200E]/10 text-[#B3200E]">
            <i className="fa-solid fa-university text-xl" aria-hidden="true"></i>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {search ? "No se encontraron programas para tu búsqueda." : "No hay programas."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#B3200E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
            >
              <i className="fa-solid fa-plus" aria-hidden="true"></i>
              Crear programa
            </button>
          )}
        </div>
      )}
      {!loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {programs.map((p) => (
            <article
              key={p.id}
              className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#B3200E]/25 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none"
            >
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-8 h-28 w-40 rounded-full bg-[#B3200E]/5 blur-2xl" />
              <div className="relative flex items-start gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#C4270F] to-[#8E1409] text-white shadow-[0_10px_20px_-10px_rgba(179,32,14,0.8)]">
                  <i className="fa-solid fa-university text-xl" aria-hidden="true"></i>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-slate-900 break-words group-hover:text-[#B3200E]">
                    {p.name}
                    <span className="ml-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {p.area}
                    </span>
                    <span className="ml-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {p.code}
                    </span>
                  </h3>
                  <div className="mt-2">
                    {p.courses && p.courses.length > 0 ? (
                      <ul className="space-y-0.5 text-sm text-slate-600">
                        {p.courses.map((c) => (
                          <li key={c.group_id} className="break-words">
                            {c.name} <span className="text-slate-400">· Grupo {c.group_code}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">Sin cursos</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-6">
                <button
                  onClick={() => openEdit(p)}
                  aria-label={`Editar ${p.name}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#B3200E] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#941B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                >
                  <i className="fa-solid fa-pen" aria-hidden="true"></i>
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  aria-label={`Eliminar ${p.name}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-2 text-xs font-semibold text-[#B3200E] transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                >
                  <i className="fa-regular fa-trash-can" aria-hidden="true"></i>
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} ${count === 1 ? "programa" : "programas"}`} />

      {modalOpen && (
        <Modal title={editing ? "Editar programa" : "Nuevo programa"} onClose={closeModal}>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="program-name" className="block text-sm font-medium text-slate-700">
                Nombre
              </label>
              <input
                id="program-name"
                type="text"
                required
                maxLength={150}
                placeholder="Ej. Ingeniería de Sistemas"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
              />
            </div>
            <div>
              <label htmlFor="program-code" className="block text-sm font-medium text-slate-700">
                Código
              </label>
              <input
                id="program-code"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="Código programa"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                }
                onBlur={() =>
                  setForm((f) => ({ ...f, code: f.code ? f.code.padStart(4, "0") : "" }))
                }
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
              />
            </div>
            <div>
              <label htmlFor="program-area" className="block text-sm font-medium text-slate-700">
                Área
              </label>
              <select
                id="program-area"
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
              >
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 text-sm border border-slate-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm bg-[#B3200E] text-white rounded-xl disabled:opacity-50"
              >
                {saving ? "Guardando..." : editing ? "Guardar" : "Crear"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
