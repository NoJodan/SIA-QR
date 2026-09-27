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
      <h2 className="text-xl font-bold text-gray-800">Cursos</h2>
      <p className="text-sm text-gray-500 mb-4">{count} curso(s)</p>
      <div className="mb-4">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar curso..." />
      </div>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-gray-500">Cargando cursos...</p>}
      {!loading && groups.length === 0 && <p className="text-gray-500">No hay cursos.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelectGroup && onSelectGroup(g)}
            className="text-left bg-white p-5 rounded-xl shadow border border-gray-100 hover:border-blue-300"
          >
            <h3 className="text-lg font-bold text-gray-800">{g.course?.name}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {g.professor?.full_name} · {g.professor?.employee_code} · {g.professor?.email}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Grupo {g.group_code} · {g.term_period} · {g.classes_count ?? 0} clase(s)
            </p>
          </button>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
