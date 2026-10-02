import React, { useState } from "react";
import { adminUpdateGroupClass, createGroupClass, updateGroupClass } from "../services/academic";
import { combineDateTimeToISO, todayISODate } from "../utils/dates";

function isoToBogotaDateTime(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}

export default function CreateClassForm({ groupId, initial = null, onCreated, onUpdated, onCancel, isAdmin = false }) {
  const seed = initial ? isoToBogotaDateTime(initial.start_time) : null;
  const [form, setForm] = useState({
    date: seed?.date || todayISODate(),
    time: seed?.time || "08:00",
    title: initial?.title || "",
    duration_minutes: initial?.duration_minutes || 90,
    qr_duration_minutes: initial?.qr_duration_minutes || 15,
    modality: initial?.modality || "PRESENTIAL",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const editing = Boolean(initial);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.date || !form.time) {
      setError("Completa título, fecha y hora.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        start_time: combineDateTimeToISO(form.date, form.time),
        duration_minutes: Number(form.duration_minutes),
        qr_duration_minutes: Number(form.qr_duration_minutes),
        modality: form.modality,
      };
      if (editing) {
        const updated = isAdmin
          ? await adminUpdateGroupClass(groupId, initial.id, payload)
          : await updateGroupClass(groupId, initial.id, payload);
        onUpdated && onUpdated(updated);
      } else {
        const created = await createGroupClass(groupId, payload);
        setForm((f) => ({ ...f, title: "" }));
        onCreated && onCreated(created);
      }
    } catch (err) {
      const data = err?.response?.data;
      setError(
        (data && (data.start_time?.[0] || data.duration_minutes?.[0] || data.qr_duration_minutes?.[0] || data.title?.[0] || data.detail)) ||
          (editing ? "No se pudo actualizar la clase." : "No se pudo crear la clase.")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-gray-600">Fecha
          <input type="date" value={form.date} onChange={set("date")} title="Fecha de la clase" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800" />
        </label>
        <label className="text-sm text-gray-600">Hora (Bogotá)
          <input type="time" value={form.time} onChange={set("time")} title="Hora de inicio (Bogotá)" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800" />
        </label>
        <label className="text-sm text-gray-600 md:col-span-2">Título
          <input
            type="text" placeholder="Ej. Repaso parcial 2" title="Título de la clase" value={form.title} onChange={set("title")}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800" maxLength={150}
          />
        </label>
        <label className="text-sm text-gray-600">Duración (min)
          <input
            type="number" min={1} value={form.duration_minutes} onChange={set("duration_minutes")}
            placeholder="90" title="Duración de la clase en minutos" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800"
          />
        </label>
        <label className="text-sm text-gray-600">Vida útil del QR (min)
          <input
            type="number" min={1} max={120} value={form.qr_duration_minutes} onChange={set("qr_duration_minutes")}
            placeholder="15" title="Vida útil del QR en minutos (1-120)" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800"
          />
          <span className="text-xs text-gray-400">Vida útil del QR</span>
        </label>
        <label className="text-sm text-gray-600 md:col-span-2">Modalidad
          <select value={form.modality} onChange={set("modality")} title="Modalidad de la clase" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm text-gray-800">
            <option value="PRESENTIAL">Presencial</option>
            <option value="VIRTUAL">Virtual</option>
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit" disabled={saving}
          className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear clase"}
        </button>
        {onCancel && (
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
