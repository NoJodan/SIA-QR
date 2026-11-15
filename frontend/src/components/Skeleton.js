import React from "react";

// Base slate-200 para tarjetas blancas; usar `!bg-...` en className para
// fondos distintos (ej. cabeceras en degradado rojo).
export default function Skeleton({ className = "" }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}
