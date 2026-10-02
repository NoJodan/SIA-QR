import React, { useId, useState } from "react";
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
    qr_duration_minutes: initial?.qr_duration_minutes ?? 10,
    modality: initial?.modality || "PRESENTIAL",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const baseId = useId();
  const errorId = `${baseId}-error`;

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

  const titleId = `${baseId}-title`;
  const dateId = `${baseId}-date`;
  const timeId = `${baseId}-time`;
  const durationId = `${baseId}-duration`;
  const ttlId = `${baseId}-ttl`;
  const hasError = Boolean(error);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      <div>
        <label htmlFor={titleId} className="block text-sm font-medium text-slate-700">
          Título
        </label>
        <input
          id={titleId}
          type="text"
          placeholder="Ej. Repaso parcial 2"
          title="Título de la clase"
          value={form.title}
          onChange={set("title")}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          maxLength={150}
        />
        <p className="mt-1 text-xs text-slate-500">Nombre visible para los estudiantes.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={dateId} className="block text-sm font-medium text-slate-700">
            Fecha
          </label>
          <input
            id={dateId}
            type="date"
            value={form.date}
            onChange={set("date")}
            title="Fecha de la clase"
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          />
          <p className="mt-1 text-xs text-slate-500">Día de la clase.</p>
        </div>
        <div>
          <label htmlFor={timeId} className="block text-sm font-medium text-slate-700">
            Hora
          </label>
          <input
            id={timeId}
            type="time"
            value={form.time}
            onChange={set("time")}
            title="Hora de inicio"
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          />
          <p className="mt-1 text-xs text-slate-500">Hora de inicio.</p>
        </div>
        <div>
          <label htmlFor={durationId} className="block text-sm font-medium text-slate-700">
            Duración (min)
          </label>
          <input
            id={durationId}
            type="number"
            min={1}
            value={form.duration_minutes}
            onChange={set("duration_minutes")}
            placeholder="90"
            title="Duración de la clase en minutos"
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          />
          <p className="mt-1 text-xs text-slate-500">Duración total de la clase.</p>
        </div>
        <div>
          <label htmlFor={ttlId} className="block text-sm font-medium text-slate-700">
            Vida útil del QR (min)
          </label>
          <input
            id={ttlId}
            type="number"
            min={1}
            max={120}
            value={form.qr_duration_minutes}
            onChange={set("qr_duration_minutes")}
            placeholder="10"
            title="Vida útil del QR en minutos (1-120)"
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20"
          />
          <p className="mt-1 text-xs text-slate-500">Vida útil del QR (1–120 min).</p>
        </div>
      </div>
      <fieldset>
        <legend className="block text-sm font-medium text-slate-700">Modalidad</legend>
        <div
          role="radiogroup"
          aria-label="Modalidad"
          className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
          <label
            htmlFor={`${baseId}-mod-pres`}
            className={`cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
              form.modality === "PRESENTIAL"
                ? "bg-white text-[#B3200E] shadow-sm border border-[#B3200E]/20"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <input
              id={`${baseId}-mod-pres`}
              type="radio"
              name={`${baseId}-modality`}
              value="PRESENTIAL"
              checked={form.modality === "PRESENTIAL"}
              onChange={set("modality")}
              className="sr-only"
            />
            Presencial
          </label>
          <label
            htmlFor={`${baseId}-mod-virt`}
            className={`cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
              form.modality === "VIRTUAL"
                ? "bg-white text-[#B3200E] shadow-sm border border-[#B3200E]/20"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <input
              id={`${baseId}-mod-virt`}
              type="radio"
              name={`${baseId}-modality`}
              value="VIRTUAL"
              checked={form.modality === "VIRTUAL"}
              onChange={set("modality")}
              className="sr-only"
            />
            Virtual
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">Define si la clase es presencial o virtual.</p>
      </fieldset>
      {error && (
        <p id={errorId} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-[#B3200E] hover:bg-[#941B0B] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
        >
          {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear clase"}
        </button>
      </div>
    </form>
  );
}
