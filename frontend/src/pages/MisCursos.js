import React, { useEffect, useState } from "react";
import CourseForm from "../components/CourseForm";
import Pagination from "../components/Pagination";
import ProfHeader from "../components/ProfHeader";
import SearchBar from "../components/SearchBar";
import { createMyGroup, deleteMyGroup, getMyGroups, updateMyGroup } from "../services/academic";
import useDebounce from "../utils/useDebounce";

export default function MisCursos({ onSelectGroup }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const debounced = useDebounce(search, 300);
  const PAGE_SIZE = 9;

  const load = (s, p) => {
    setLoading(true);
    getMyGroups(s, p)
      .then((data) => {
        setGroups(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => setError("No se pudieron cargar tus cursos."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(debounced, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, page]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const handleCreate = async (name) => {
    const created = await createMyGroup(name);
    setGroups((prev) => [...prev, created]);
    setShowForm(false);
  };

  const handleUpdate = async (id, name) => {
    const updated = await updateMyGroup(id, name);
    setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Eliminar este curso y todas sus clases?")) return;
    await deleteMyGroup(id).catch(() => {
      setError("No se pudo eliminar el curso.");
      throw new Error("delete-failed");
    });
    load(debounced, page);
  };

  return (
    <div>
      <ProfHeader title="Mis Cursos" subtitle={`${count} curso(s)`} />
      {error && <p className="text-red-600 mb-4">{error}</p>}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-lg text-sm font-medium"
          >
            + Nuevo curso
          </button>
        )}
        <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar curso..." />
      </div>
      {showForm && (
        <div className="mb-4">
          <CourseForm submitLabel="Crear curso" onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}
      {loading && <p className="text-gray-500">Cargando cursos...</p>}
      {!loading && groups.length === 0 && !showForm && (
        <p className="text-gray-500">No tienes cursos. Crea el primero.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className="bg-white p-5 rounded-xl shadow border border-gray-100">
            {editingId === g.id ? (
              <CourseForm
                initialName={g.course?.name || ""}
                submitLabel="Guardar"
                onSubmit={(name) => handleUpdate(g.id, name)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <button onClick={() => onSelectGroup && onSelectGroup(g)} className="text-left w-full">
                  <h3 className="text-lg font-bold text-gray-800 hover:text-[#B3200E] break-words">{g.course?.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{g.classes_count ?? 0} clase(s)</p>
                </button>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setEditingId(g.id)}
                    className="px-3 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(g.id)}
                    className="px-3 py-1 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 rounded-lg"
                  >
                    Eliminar
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
