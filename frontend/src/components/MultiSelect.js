import React, { useEffect, useId, useRef, useState } from "react";

// Multiselect controlado con checkboxes nativos. El popup no usa portal:
// queda dentro de la tarjeta, así que esa tarjeta no debe recortar overflow.
export default function MultiSelect({
  id,
  options = [],
  value = [],
  onChange,
  placeholder = "Selecciona...",
  disabled = false,
  ariaLabel = "Opciones",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const popupRef = useRef(null);
  const fallbackId = useId();
  const buttonId = id || fallbackId;
  const listId = `${buttonId}-list`;

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Al abrir, el foco entra al popup para que el teclado pueda recorrerlo.
  useEffect(() => {
    if (!open) return;
    const first = popupRef.current?.querySelector("[data-ms-option]");
    if (first) first.focus();
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const toggleOption = (optionValue) => {
    const next = value.includes(optionValue)
      ? value.filter((item) => item !== optionValue)
      : [...value, optionValue];
    onChange(next);
  };

  const handlePopupKeyDown = (event) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      close();
      buttonRef.current?.focus();
      return;
    }
    const items = Array.from(popupRef.current?.querySelectorAll("[data-ms-option]") || []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    let nextIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(items.length - 1, index + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    items[nextIndex].focus();
  };

  const handleRootBlur = (event) => {
    if (open && event.relatedTarget && !rootRef.current?.contains(event.relatedTarget)) {
      close();
    }
  };

  const selectedOptions = options.filter((option) => value.includes(option.value));
  const buttonLabel =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : `${selectedOptions.length} clases seleccionadas`;

  return (
    <div ref={rootRef} onKeyDown={handlePopupKeyDown} onBlur={handleRootBlur} className="relative">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm focus:border-[#B3200E] focus:outline-none focus:ring-2 focus:ring-[#B3200E]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
          selectedOptions.length ? "text-slate-800" : "text-slate-400"
        }`}
      >
        <span className="truncate">{buttonLabel}</span>
        <i
          className={`fa-solid fa-chevron-down shrink-0 text-[10px] transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={popupRef}
          id={listId}
          role="group"
          aria-label={ariaLabel}
          className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <button
            type="button"
            data-ms-option
            aria-pressed={value.length === 0}
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
          >
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                value.length === 0
                  ? "border-[#B3200E] bg-[#B3200E] text-white"
                  : "border-slate-300 bg-white"
              }`}
            >
              {value.length === 0 && <i className="fa-solid fa-check text-[9px]" />}
            </span>
            Todas las clases
          </button>

          <div className="my-1 border-t border-slate-100" />

          {options.length === 0 && (
            <p className="px-2 py-2 text-sm text-slate-400">No hay clases disponibles.</p>
          )}

          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                data-ms-option
                checked={value.includes(option.value)}
                onChange={() => toggleOption(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#B3200E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B3200E]/40"
              />
              <span className="break-words">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
