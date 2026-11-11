import React, { useEffect, useState } from "react";
import Skeleton from "../components/Skeleton";

export default function Auditoria() {
  // Vista WIP: endpoint GET /api/attendance/audit-logs/ existe; conectar cuando
  // se defina el diseño de la tabla. El timeout solo simula la carga del skeleton.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#B3200E] text-white shadow-sm">
            <i className="fa-solid fa-clipboard-user text-xl" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">Auditoría</h1>
            <p className="mt-1 text-sm text-slate-500">
              Registro de acciones administrativas del sistema.
            </p>
          </div>
        </div>
      </section>

      {loading ? (
        <>
          <p role="status" className="sr-only">Cargando registros de auditoría...</p>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-9 w-9 !rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="hidden h-4 w-28 sm:block !bg-slate-100" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#B3200E]/10 text-[#B3200E]">
            <i className="fa-solid fa-clipboard-user text-xl" aria-hidden="true" />
          </div>
          <p role="status" className="mt-3 text-sm text-slate-600">No hay registros de auditoría.</p>
        </div>
      )}
    </div>
  );
}
