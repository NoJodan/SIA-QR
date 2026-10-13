import React, { useEffect, useState } from "react";
import CreateClassForm from "../components/CreateClassForm";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import ProfHeader from "../components/ProfHeader";
import SearchBar from "../components/SearchBar";
import { createInstantClass, deleteGroupClass, getGroupClasses } from "../services/academic";
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
  const [statusView, setStatusView] = useState("ALL");
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

  // B3: TTL/título opcionales desde el frontend (el backend usa defaults).
  const [instantTitle, setInstantTitle] = useState("");
  const [instantTtl, setInstantTtl] = useState(10);

  const handleInstant = async () => {
    setInstantLoading(true);
    setError("");
    try {
      // B3: crea clase IN_PROGRESS + sesión QR en transacción atómica.
      const payload = {};
      if (instantTitle.trim()) payload.title = instantTitle.trim();
      const ttlNum = Number(instantTtl);
      if (Number.isFinite(ttlNum) && ttlNum >= 1 && ttlNum <= 120) {
        payload.qr_duration_minutes = ttlNum;
      }
      const data = await createInstantClass(group.id, payload);
      // Fix aviso fantasma: la B3 devuelve la sesión con attend_url mostrable.
      // Se pasa al detalle para hidratar el QR antes del primer ensure
      // (el GET current-session reusado devuelve attend_url null por hash
      // irreversible). Navegar primero, recargar la lista en segundo plano.
      if (data?.class && onSelectClass) {
        const s = data?.session;
        const initialSession =
          s?.session_id && s?.attend_url
            ? { session_id: s.session_id, attend_url: s.attend_url, expires_at: s.expires_at }
            : null;
        // Reconcilia TTL: el backend persiste qr_duration_minutes, pero si la
        // respuesta trae el default viejo se corrige con s.ttl_minutes.
        const cls = { ...data.class };
        if (s?.ttl_minutes != null && Number(cls.qr_duration_minutes) !== Number(s.ttl_minutes)) {
          cls.qr_duration_minutes = s.ttl_minutes;
        }
        onSelectClass(cls, initialSession);
        load().catch(() => {});
      } else {
        await load();
      }
    } catch (err) {
      setError(
        err?.response?.data?.error || "No se pudo crear la clase inmediata."
      );
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

  const visibleClasses =
    statusView === "ALL" ? classes : classes.filter((c) => c.status === statusView);

  return (
    <div>
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
        <ProfHeader
          title={group.course?.name}
          subtitle={`Grupo ${group.group_code} · ${group.term_period}`}
          onBack={onBack}
        />
        <div className="flex flex-wrap items-center gap-2">
          <details className="group">
            <summary
              className="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-details-marker]:hidden"
              aria-label="Opciones de clase inmediata"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
              {instantLoading ? "Creando..." : "⚡ Inmediata"}
              <span aria-hidden="true" className="text-xs text-slate-400 group-open:rotate-180 transition-transform">
                ▾
              </span>
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div>
                <label htmlFor="instant-title" className="block text-xs font-medium text-slate-600">
                  Título inmediata (opcional)
                </label>
                <input
                  id="instant-title"
                  value={instantTitle}
                  onChange={(e) => setInstantTitle(e.target.value)}
                  placeholder="Título inmediata (opcional)"
                  maxLength={150}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
                />
              </div>
              <div>
                <label htmlFor="instant-ttl" className="block text-xs font-medium text-slate-600">
                  TTL QR (min)
                </label>
                <input
                  id="instant-ttl"
                  type="number"
                  min={1}
                  max={120}
                  value={instantTtl}
                  onChange={(e) => setInstantTtl(e.target.value)}
                  className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
                />
              </div>
              <button
                onClick={handleInstant}
                disabled={instantLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
                {instantLoading ? "Creando..." : "Crear ahora"}
              </button>
            </div>
          </details>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📅 Programar
          </button>
        </div>
      </section>
      <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3 mb-4 flex flex-col md:flex-row md:items-center gap-2">
        <div className="w-full md:max-w-sm">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Buscar clase..." />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="filtro-estado" className="text-xs font-medium text-slate-600">
            Filtrar vista
          </label>
          <select
            id="filtro-estado"
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
      {loading && (
        <div className="grid gap-4 md:grid-cols-2 mt-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 flex gap-2">
                <div className="h-6 w-16 rounded-full bg-slate-100" />
                <div className="h-6 w-16 rounded-full bg-slate-100" />
              </div>
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
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            Programar primera clase
          </button>
        </div>
      )}
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {visibleClasses.map((c) => (
          <li
            key={c.id}
            className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-[#B3200E]/20 transition"
          >
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
              <button
                onClick={() => onSelectClass && onSelectClass(c)}
                aria-label={`Ver ${c.title}`}
                className="text-left w-full min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              >
                <p className="font-semibold text-slate-800 hover:text-[#B3200E] break-words">{c.title}</p>
                <p className="text-sm text-slate-500 break-words">
                  {formatBogota(c.start_time)} · {c.duration_minutes} min · QR {c.qr_duration_minutes ?? 10} min
                </p>
              </button>
              <span className="inline-flex flex-wrap items-center gap-1 self-start">
                <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {modalityLabels[c.modality] || c.modality}
                </span>
                <span
                  className={`inline-flex items-center text-xs px-2 py-1 rounded-full ${classStatusColors[c.status] || "bg-slate-100 text-slate-600 border border-slate-200"}`}
                >
                  {classStatusLabels[c.status] || c.status}
                </span>
              </span>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setEditing(c)}
                aria-label={`Editar ${c.title}`}
                className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                aria-label={`Eliminar ${c.title}`}
                className="px-3 py-1 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
              >
                Eliminar
              </button>
              <button
                onClick={() => onSelectClass && onSelectClass(c)}
                aria-label={`Ver ${c.title}`}
                className="px-3 py-1 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-[#B3200E] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              >
                Ver
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} clase(s)`} />
    </div>
  );
}
