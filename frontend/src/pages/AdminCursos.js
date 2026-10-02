import React, { useEffect, useState } from "react";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminGetGroups } from "../services/academic";
import useDebounce from "../utils/useDebounce";

export default function AdminCursos({ onSelectGroup }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const debounced = useDebounce(search, 300);

  useEffect(() => {
    setLoading(true);
    adminGetGroups(debounced, page)
      .then((data) => {
        setGroups(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => setError("No se pudieron cargar los cursos."))
      .finally(() => setLoading(false));
  }, [debounced, page]);

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <div>
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Cursos</h2>
        <p className="text-sm text-slate-500 mt-1">{count} curso(s)</p>
      </section>
      <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3 mb-4">
        <div className="w-full md:max-w-sm">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar curso..." />
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
        </p>
      )}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}
      {!loading && !error && groups.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">
            📚
          </p>
          <p className="mt-2 text-sm text-slate-600">No hay cursos.</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelectGroup && onSelectGroup(g)}
            aria-label={`Ver ${g.course?.name}`}
            className="text-left bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-[#B3200E]/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            <h3 className="text-lg font-bold text-slate-800 break-words">{g.course?.name}</h3>
            <p className="text-sm text-slate-500 mt-1 break-words">
              {g.professor?.full_name} · {g.professor?.employee_code} · {g.professor?.email}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Grupo {g.group_code} · {g.term_period} · {g.classes_count ?? 0} clase(s)
            </p>
          </button>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} curso(s)`} />
    </div>
  );
}
