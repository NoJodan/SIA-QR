import React, { useEffect, useRef, useState } from "react";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminGetGroups } from "../services/academic";
import { courseIcon } from "../utils/courseIcon";
import useDebounce from "../utils/useDebounce";

export default function AdminCursos({ onSelectGroup }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const debounced = useDebounce(search, 300);
  const seqRef = useRef(0);
  const PAGE_SIZE = 10;

  const load = (s, p) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    setError("");
    adminGetGroups(s, p)
      .then((data) => {
        if (seq !== seqRef.current) return;
        setGroups(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => {
        if (seq === seqRef.current) setError("No se pudieron cargar los cursos.");
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

  return (
    <div>
      <section className="relative mb-10 flex min-h-[132px] items-center justify-between gap-4 overflow-hidden rounded-xl px-4 py-5 text-white shadow-[0_8px_20px_-8px_rgba(76,18,24,0.35)] bg-[linear-gradient(110deg,#5A0A05,#B3200E)] sm:bg-[radial-gradient(ellipse_at_43%_115%,rgba(196,39,15,0.62)_0_29%,transparent_30%),linear-gradient(120deg,#5A0A05_0%,#8E1409_53%,#A81A0C_53.2%,#B3200E_54%,#FDF1EE_54.3%,#FFFFFF_100%)]">
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-[#C4270F] text-xl">
            <i className="fa-solid fa-book-open" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">Cursos (Admin)</h2>
            <p className="mt-0.5 text-xs text-red-100/90">
              {loading ? "Cargando cursos…" : `${count} ${count === 1 ? "curso" : "cursos"}`}
            </p>
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
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar curso..." />
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
            </div>
          ))}
        </div>
      )}
      {!loading && !error && groups.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#B3200E]/10 text-[#B3200E]">
            <i className="fa-solid fa-graduation-cap text-xl" aria-hidden="true"></i>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {search ? "No se encontraron cursos para tu búsqueda." : "No hay cursos."}
          </p>
        </div>
      )}
      {!loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <article
              key={g.id}
              className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#B3200E]/25 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none"
            >
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-8 h-28 w-40 rounded-full bg-[#B3200E]/5 blur-2xl" />
              <div className="relative flex items-start gap-4">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#C4270F] to-[#8E1409] text-white shadow-[0_10px_20px_-10px_rgba(179,32,14,0.8)]">
                  <i className={`fa-solid ${courseIcon(g.course?.name)} text-xl`} aria-hidden="true"></i>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-slate-900 break-words group-hover:text-[#B3200E]">
                    {g.course?.name} <span className="text-sm font-semibold text-slate-500">· Grupo {g.group_code}</span>
                  </h3>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {g.professor?.full_name} · {g.professor?.employee_code}
                  </p>
                  <p className="text-sm text-slate-500">
                    {g.classes_count ?? 0} {(g.classes_count ?? 0) === 1 ? "clase" : "clases"}
                  </p>
                </div>
              </div>
              <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-6">
                <button
                  onClick={() => onSelectGroup && onSelectGroup(g)}
                  aria-label={`Ver ${g.course?.name} · Grupo ${g.group_code}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                >
                  <i className="fa-regular fa-eye" aria-hidden="true"></i>
                  Ver curso
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} ${count === 1 ? "curso" : "cursos"}`} />
    </div>
  );
}
