import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { createPortal } from "react-dom";

function remainingMs(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function formatCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// QR único: sin auto-rotación ni refetch. onExpired solo marca expirado
// local (el padre detiene el poll y limpia caché, sin re-llamar ensure).
export default function QrDisplay({ attendUrl, expiresAt, size = 220, onExpired }) {
  const [now, setNow] = React.useState(Date.now());
  const [expanded, setExpanded] = React.useState(false);
  const [expiredLocal, setExpiredLocal] = React.useState(false);
  const calledRef = React.useRef(false);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Al cambiar de sesión/expiración se reinicia el flag local.
  React.useEffect(() => {
    setExpiredLocal(false);
    calledRef.current = false;
  }, [expiresAt, attendUrl]);

  const left = remainingMs(expiresAt);
  const expired = left <= 0 || expiredLocal;
  void now;

  // Expiración local única: fija el estado y avisa al padre una vez,
  // sin refetch ni guards de visibilidad.
  React.useEffect(() => {
    if (left <= 0 && !calledRef.current) {
      calledRef.current = true;
      setExpiredLocal(true);
      if (onExpired) onExpired();
    }
  }, [left, onExpired]);

  // Retorno de foco: guarda el elemento enfocado al abrir el modal y lo
  // restaura al cerrar (accesibilidad del diálogo).
  const triggerRef = React.useRef(null);
  const openExpanded = (event) => {
    triggerRef.current = event?.currentTarget ?? document.activeElement;
    setExpanded(true);
  };

  React.useEffect(() => {
    if (!expanded) return undefined;

    const previousOverflow = document.body.style.overflow;
    const opener = triggerRef.current ?? document.activeElement;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setExpanded(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [expanded]);

  const countdownText = expired ? "00:00" : formatCountdown(left);

  return (
    <div className="flex flex-col items-center gap-3">
      {attendUrl ? (
        <button
          type="button"
          onClick={openExpanded}
          disabled={expired}
          aria-label="Ampliar código QR a pantalla completa"
          aria-expanded={expanded}
          className={`p-4 rounded-xl border-2 bg-white transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600 ${
            expired
              ? "border-red-300 opacity-60 cursor-not-allowed"
              : "border-gray-200 cursor-zoom-in hover:scale-[1.02]"
          }`}
        >
          <QRCodeSVG value={attendUrl} size={size} level="M" />
        </button>
      ) : (
        <div
          className="flex items-center justify-center bg-gray-50 text-gray-400 text-sm"
          style={{ width: size, height: size }}
        >
          Sin QR
        </div>
      )}
      {expiresAt && (
        <p className={`text-sm font-semibold ${expired ? "text-red-600" : "text-green-700"}`}>
          {expired ? `Expirado — ${countdownText}` : `Expira en ${countdownText}`}
        </p>
      )}
      <p className="text-xs text-gray-400 text-center max-w-xs">
        {attendUrl ? "Haz clic en el QR para ampliarlo y facilitar el escaneo" : "Escanea el código con la cámara de tu celular"}
      </p>

      {expanded && attendUrl && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Código QR de asistencia ampliado"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-slate-950 px-5 py-16 text-white sm:gap-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setExpanded(false)}
            aria-label="Cerrar código QR ampliado"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-7 sm:top-7"
          >
            <span aria-hidden="true">×</span>
          </button>

          <div className="text-center">
            <h2 className="text-xl font-bold sm:text-2xl">QR de asistencia</h2>
            {expiresAt && (
              <p className={`mt-2 text-sm font-semibold ${expired ? "text-red-300" : "text-emerald-300"}`}>
                {expired ? `Expirado — ${countdownText}` : `Expira en ${countdownText}`}
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-3 shadow-2xl sm:p-5">
            <QRCodeSVG
              value={attendUrl}
              size={size}
              level="M"
              style={{ width: "min(70vmin, 720px)", height: "auto", maxWidth: "82vw", maxHeight: "70vh" }}
            />
          </div>

          <p className="text-center text-sm text-slate-300">Escanea el código con la cámara de tu celular</p>
        </div>,
        document.body
      )}
    </div>
  );
}
