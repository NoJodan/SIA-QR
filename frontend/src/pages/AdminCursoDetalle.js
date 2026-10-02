import React, { useEffect, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminGetGroupClasses } from "../services/academic";
import { formatBogota } from "../utils/dates";
import useDebounce from "../utils/useDebounce";

export default function AdminCursoDetalle({ group, onBack }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const debounced = useDebounce(search, 300);

  const load = (s = debounced, p = page) =>
    adminGetGroupClasses(group.id, s, p).then((data) => {
      setClasses(data.results || []);
      setCount(data.count || 0);
    });

  useEffect(() => {
    setLoading(true);
    load(debounced, page)
      .catch(() => setError("No se pudieron cargar las clases."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, debounced, page]);

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <div>
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline mb-2">← Volver</button>
      <h2 className="text-xl font-bold text-gray-800">{group.course?.name}</h2>
      <p className="text-sm text-gray-500 mb-4">
        {group.professor?.full_name} · Grupo {group.group_code} · {group.term_period}
      </p>
      <div className="mb-4">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
      </div>
      {editing && (
        <Modal title="Editar clase" onClose={() => setEditing(null)}>
          <CreateClassForm
            groupId={group.id}
            initial={editing}
            isAdmin
            onUpdated={async () => { setEditing(null); await load(); }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {loading && <p className="text-gray-500 mt-4">Cargando clases...</p>}
      {error && <p className="text-red-600 mt-4">{error}</p>}
      {!loading && !error && classes.length === 0 && (
        <p className="text-gray-500 mt-4">No hay clases programadas.</p>
      )}
      <ul className="mt-4 space-y-3">
        {classes.map((c) => (
          <li key={c.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <p className="font-semibold text-gray-800 break-words">{c.title}</p>
            <p className="text-sm text-gray-500 break-words">
              {formatBogota(c.start_time)} · {c.duration_minutes} min · QR {c.qr_duration_minutes ?? 10} min
            </p>
            <p className="text-xs text-gray-400 mt-1">{c.modality} · {c.status}</p>
            <button
              onClick={() => setEditing(c)}
              className="mt-2 px-3 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
            >
              Editar
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
