import React, { useEffect, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import ProfHeader from "../components/ProfHeader";
import SearchBar from "../components/SearchBar";
import { createInstantClass, deleteGroupClass, getGroupClasses } from "../services/academic";
import { formatBogota } from "../utils/dates";
import useDebounce from "../utils/useDebounce";

export default function CursoDetalle({ group, onBack, onSelectClass }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [instantLoading, setInstantLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const debounced = useDebounce(search, 300);

  const load = (s = debounced, p = page) =>
    getGroupClasses(group.id, s, p).then((data) => {
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

  useEffect(() => {
    // ponytail: polling 30s en lugar de WebSocket (restricción No-Redis)
    const id = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, debounced, page]);

  const totalPages = Math.max(1, Math.ceil(count / 10));

  const handleInstant = async () => {
    setInstantLoading(true);
    try {
      await createInstantClass(group.id);
      await load();
    } catch {
      setError("No se pudo crear la clase inmediata.");
    } finally {
      setInstantLoading(false);
    }
  };

  const handleDelete = async (classId) => {
    if (!window.confirm("¿Eliminar esta clase?")) return;
    try {
      await deleteGroupClass(group.id, classId);
      await load();
    } catch {
      setError("No se pudo eliminar la clase.");
    }
  };

  return (
    <div>
      <ProfHeader
        title={group.course?.name}
        subtitle={`Grupo ${group.group_code} · ${group.term_period}`}
        onBack={onBack}
      />
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleInstant}
          disabled={instantLoading}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {instantLoading ? "Creando..." : "⚡ inmediata"}
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          📅 Programar
        </button>
      </div>
      <div className="mb-4">
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
      </div>
      {showCreate && (
        <Modal title="Programar clase" onClose={() => setShowCreate(false)}>
          <CreateClassForm
            groupId={group.id}
            onCreated={async () => { setShowCreate(false); await load(); }}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Editar clase" onClose={() => setEditing(null)}>
          <CreateClassForm
            groupId={group.id}
            initial={editing}
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
            <div className="flex justify-between items-start gap-2">
              <button onClick={() => onSelectClass && onSelectClass(c)} className="text-left flex-1">
                <p className="font-semibold text-gray-800 hover:text-blue-700">{c.title}</p>
                <p className="text-sm text-gray-500">
                  {formatBogota(c.start_time)} · {c.duration_minutes} min · QR {c.qr_duration_minutes ?? 15} min
                </p>
              </button>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                {c.modality} · {c.status}
              </span>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setEditing(c)}
                className="px-3 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                className="px-3 py-1 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 rounded-lg"
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
