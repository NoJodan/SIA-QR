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
  SCHEDULED: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-red-50 text-red-700",
  CANCELLED: "bg-red-50 text-red-700",
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
        onSelectClass(data.class, initialSession);
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

  return (
    <div>
      <ProfHeader
        title={group.course?.name}
        subtitle={`Grupo ${group.group_code} · ${group.term_period}`}
        onBack={onBack}
      />
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <input
          value={instantTitle}
          onChange={(e) => setInstantTitle(e.target.value)}
          placeholder="Título inmediata (opcional)"
          maxLength={150}
          className="border rounded-lg px-3 py-2 text-sm text-gray-800"
        />
        <label className="text-sm text-gray-600">
          TTL QR (min)
          <input
            type="number"
            min={1}
            max={120}
            value={instantTtl}
            onChange={(e) => setInstantTtl(e.target.value)}
            className="ml-2 w-20 border rounded-lg px-3 py-2 text-sm text-gray-800"
          />
        </label>
        <button
          onClick={handleInstant}
          disabled={instantLoading}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {instantLoading ? "Creando..." : "⚡ inmediata"}
        </button>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] text-white rounded-lg text-sm font-medium"
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
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
              <button onClick={() => onSelectClass && onSelectClass(c)} className="text-left w-full min-w-0 flex-1">
                <p className="font-semibold text-gray-800 hover:text-[#B3200E]">{c.title}</p>
                <p className="text-sm text-gray-500 break-words">
                  {formatBogota(c.start_time)} · {c.duration_minutes} min · QR {c.qr_duration_minutes ?? 10} min
                </p>
              </button>
              <span className={`inline-flex flex-wrap items-center gap-1 text-xs px-2 py-1 rounded-full self-start ${classStatusColors[c.status] || "bg-gray-100 text-gray-600"}`}>
                <span>{modalityLabels[c.modality] || c.modality}</span>
                <span aria-hidden="true">·</span>
                <span>{classStatusLabels[c.status] || c.status}</span>
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
