import React, { useEffect, useRef, useState } from "react";
import Modal from "../components/Modal";
import Pagination from "../components/Pagination";
import SearchBar from "../components/SearchBar";
import { adminClearUsers, adminGetStudents } from "../services/auth";
import useDebounce from "../utils/useDebounce";

// Solo el backend valida el email; aquí únicamente se oculta el botón.
const PURGE_ADMIN_EMAIL = "admin_sia@ut.edu.co";

export default function Estudiantes({ user }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeText, setPurgeText] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  const [notice, setNotice] = useState("");
  const debounced = useDebounce(search, 300);
  const seqRef = useRef(0);

  const isPurgeAdmin =
    String(user?.email || "")
      .trim()
      .toLowerCase() === PURGE_ADMIN_EMAIL;

  useEffect(() => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    setError("");
    adminGetStudents(debounced, page)
      .then((data) => {
        if (seq !== seqRef.current) return;
        setStudents(data.results || []);
        setCount(data.count || 0);
      })
      .catch(() => {
        if (seq === seqRef.current) setError("No se pudieron cargar los estudiantes.");
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [debounced, page, reloadKey]);

  const closePurge = () => {
    if (purging) return;
    setPurgeOpen(false);
    setPurgeText("");
    setPurgeError("");
  };

  const handlePurge = async () => {
    if (purgeText.trim() !== "BORRAR" || purging) return;
    setPurging(true);
    setPurgeError("");
    try {
      const data = await adminClearUsers();
      setNotice(
        `Limpieza completada. Eliminados: ${data.students} estudiante(s), ${data.professors} profesor(es), ` +
          `${data.courses} curso(s), ${data.groups} grupo(s), ${data.classes} clase(s), ` +
          `${data.sessions} sesión(es) QR y ${data.attendances} asistencia(s).`
      );
      setPurgeOpen(false);
      setPurgeText("");
      setPage(1);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setPurgeError(err?.response?.data?.error || "No se pudo ejecutar la limpieza.");
    } finally {
      setPurging(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <div>
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Estudiantes</h2>
          <p className="text-sm text-slate-500 mt-1">{count} estudiante(s)</p>
        </div>
        {isPurgeAdmin && (
          <button
            type="button"
            onClick={() => setPurgeOpen(true)}
            className="self-start sm:self-auto shrink-0 rounded-xl border-2 border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-600 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            Limpiar profesores y estudiantes
          </button>
        )}
      </section>

      {notice && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 mb-4">
          {notice}
        </p>
      )}

      <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 backdrop-blur rounded-xl p-3 mb-4">
        <div className="w-full md:max-w-sm">
          <SearchBar
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Buscar estudiante..."
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
        </p>
      )}

      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="h-4 w-2/3 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && students.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p aria-hidden="true" className="text-3xl">
            🎓
          </p>
          <p className="mt-2 text-sm text-slate-600">No hay estudiantes.</p>
        </div>
      )}

      {!loading && students.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[720px] w-full text-left text-sm text-slate-700">
            <caption className="sr-only">Listado de estudiantes</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nombre</th>
                <th scope="col" className="px-4 py-3 font-semibold">Código</th>
                <th scope="col" className="px-4 py-3 font-semibold">Documento</th>
                <th scope="col" className="px-4 py-3 font-semibold">Correo</th>
                <th scope="col" className="px-4 py-3 font-semibold">Teléfono</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800 break-words">{s.full_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.student_code}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.document_number}</td>
                  <td className="px-4 py-3 break-all">{s.email}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.phone_number || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={setPage} countLabel={`${count} estudiante(s)`} />

      {purgeOpen && (
        <Modal title="Limpiar profesores y estudiantes" onClose={closePurge}>
          <div className="space-y-4 text-sm text-slate-700">
            <p>
              Esta acción elimina <strong>todos los profesores y estudiantes</strong> registrados, junto con sus
              perfiles, cursos, grupos, clases, sesiones QR y asistencias.
            </p>
            <p>Se preservan los administradores, la lista blanca de profesores y los registros de auditoría.</p>
            <div>
              <label htmlFor="confirmar-borrado" className="block font-medium text-slate-800 mb-1">
                Escribe <strong>BORRAR</strong> para confirmar
              </label>
              <input
                id="confirmar-borrado"
                type="text"
                value={purgeText}
                onChange={(e) => setPurgeText(e.target.value)}
                autoComplete="off"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
            {purgeError && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {purgeError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closePurge}
                disabled={purging}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePurge}
                disabled={purgeText.trim() !== "BORRAR" || purging}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                {purging ? "Eliminando..." : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
