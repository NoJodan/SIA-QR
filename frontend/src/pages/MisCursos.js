import React, { useEffect, useState } from "react";
import CourseForm from "../components/CourseForm";
import Modal from "../components/Modal";
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
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <ProfHeader title="Mis Cursos" subtitle={`${count} curso(s)`} />
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Nuevo curso
          </button>
        )}
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
      {showForm && (
        <Modal title="Nuevo curso" onClose={() => setShowForm(false)}>
          <CourseForm submitLabel="Crear curso" onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </Modal>
      )}
      {loading && (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}
      {!loading && groups.length === 0 && !showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">
            📚
          </p>
          <p className="mt-2 text-sm text-slate-600">No tienes cursos. Crea el primero.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            Programar primera clase
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div
            key={g.id}
            className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-[#B3200E]/30 transition"
          >
            {editingId === g.id ? (
              <CourseForm
                initialName={g.course?.name || ""}
                submitLabel="Guardar"
                onSubmit={(name) => handleUpdate(g.id, name)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <button
                  onClick={() => onSelectGroup && onSelectGroup(g)}
                  aria-label={`Ver ${g.course?.name}`}
                  className="text-left w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                >
                  <h3 className="text-lg font-bold text-slate-800 hover:text-[#B3200E] break-words">{g.course?.name}</h3>
                  <p className="text-sm text-slate-500 mt-1">{g.classes_count ?? 0} clase(s)</p>
                </button>
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setEditingId(g.id)}
                    aria-label={`Editar ${g.course?.name}`}
                    className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(g.id)}
                    aria-label={`Eliminar ${g.course?.name}`}
                    className="px-3 py-1 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                  >
                    Eliminar
                  </button>
                  <button
                    onClick={() => onSelectGroup && onSelectGroup(g)}
                    aria-label={`Ver ${g.course?.name}`}
                    className="px-3 py-1 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-[#B3200E] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
                  >
                    Ver
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} curso(s)`} />
    </div>
  );
}
