import React, { useEffect, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminGetGroupClasses } from "../services/academic";
import { formatBogota } from "../utils/dates";
import useDebounce from "../utils/useDebounce";

const modalityLabels = {
  PRESENTIAL: "Presencial",
  VIRTUAL: "Virtual",
};

const classStatusLabels = {
  SCHEDULED: "Programada",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Finalizada",
  CANCELLED: "Cancelada",
};

const classStatusColors = {
  SCHEDULED: "bg-amber-50 text-amber-700 border border-amber-200",
  IN_PROGRESS: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  COMPLETED: "bg-slate-100 text-slate-600 border border-slate-200",
  CANCELLED: "bg-red-50 text-red-700 border border-red-200",
};

export default function AdminCursoDetalle({ group, onBack }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [statusView, setStatusView] = useState("ALL");
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

  const visibleClasses =
    statusView === "ALL" ? classes : classes.filter((c) => c.status === statusView);

  return (
    <div>
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <button
          onClick={onBack}
          className="text-sm text-[#B3200E] hover:text-[#941B0B] hover:underline mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 rounded"
        >
          ← Volver
        </button>
        <h2 className="text-2xl font-bold text-slate-800 break-words">{group.course?.name}</h2>
        <p className="text-sm text-slate-500 mt-1 break-words">
          {group.professor?.full_name} · Grupo {group.group_code} · {group.term_period}
        </p>
      </section>
      <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3 mb-4 flex flex-col md:flex-row md:items-center gap-2">
        <div className="w-full md:max-w-sm">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="filtro-estado-admin" className="text-xs font-medium text-slate-600">
            Filtrar vista
          </label>
          <select
            id="filtro-estado-admin"
            value={statusView}
            onChange={(e) => setStatusView(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          >
            <option value="ALL">Todas</option>
            <option value="SCHEDULED">Programadas</option>
            <option value="IN_PROGRESS">En progreso</option>
            <option value="COMPLETED">Finalizadas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
        </div>
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
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 mt-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && visibleClasses.length === 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">
            📅
          </p>
          <p className="mt-2 text-sm text-slate-600">No hay clases programadas.</p>
        </div>
      )}
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {visibleClasses.map((c) => (
          <li
            key={c.id}
            className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-[#B3200E]/20 transition"
          >
            <p className="font-semibold text-slate-800 break-words">{c.title}</p>
            <p className="text-sm text-slate-500 break-words">
              {formatBogota(c.start_time)} · {c.duration_minutes} min · QR {c.qr_duration_minutes ?? 10} min
            </p>
            <p className="mt-2 inline-flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {modalityLabels[c.modality] || c.modality}
              </span>
              <span
                className={`inline-flex items-center text-xs px-2 py-1 rounded-full ${classStatusColors[c.status] || "bg-slate-100 text-slate-600 border border-slate-200"}`}
              >
                {classStatusLabels[c.status] || c.status}
              </span>
            </p>
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setEditing(c)}
                aria-label={`Editar ${c.title}`}
                className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              >
                Editar
              </button>
              <span className="px-3 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-400 rounded-lg">
                Ver
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} clase(s)`} />
    </div>
  );
}
