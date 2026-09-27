import React from "react";
import ProfHeader from "../components/ProfHeader";
import { formatBogota } from "../utils/dates";

export default function ClaseDetalle({ group, classItem, onBack }) {
  return (
    <div>
      <ProfHeader
        title={classItem.title}
        subtitle={`${group.course?.name} · Grupo ${group.group_code}`}
        onBack={onBack}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-2">
          <p className="text-sm text-gray-500">Inicio</p>
          <p className="font-semibold text-gray-800">{formatBogota(classItem.start_time)}</p>
          <p className="text-sm text-gray-500 mt-3">Duración</p>
          <p className="font-semibold text-gray-800">{classItem.duration_minutes} min</p>
          <p className="text-sm text-gray-500 mt-3">Vida útil del QR</p>
          <p className="font-semibold text-gray-800">{classItem.qr_duration_minutes ?? 15} min</p>
          <p className="text-sm text-gray-500 mt-3">Modalidad · Estado</p>
          <p className="font-semibold text-gray-800">{classItem.modality} · {classItem.status}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
          <div className="w-48 h-48 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center">
            <p className="text-sm text-gray-400 text-center px-4">QR pendiente</p>
          </div>
        </div>
      </div>
      <div className="mt-6 bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-2">Asistencia</h3>
        <p className="text-sm text-gray-500">Aún no hay marcaciones registradas.</p>
      </div>
    </div>
  );
}
