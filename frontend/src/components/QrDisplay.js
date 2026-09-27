import React from "react";
import { QRCodeSVG } from "qrcode.react";

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

export default function QrDisplay({ attendUrl, expiresAt, size = 220, onExpired }) {
  const [now, setNow] = React.useState(Date.now());
  // Dispara onExpired una sola vez por cada expiresAt (refetch del QR).
  const firedRef = React.useRef(null);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = remainingMs(expiresAt);
  const expired = left <= 0;
  void now;

  React.useEffect(() => {
    if (expired && onExpired && firedRef.current !== expiresAt) {
      firedRef.current = expiresAt;
      onExpired();
    }
  }, [expired, expiresAt, onExpired]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`p-4 rounded-xl border-2 bg-white ${
          expired ? "border-red-300 opacity-60" : "border-gray-200"
        }`}
      >
        {attendUrl ? (
          <QRCodeSVG value={attendUrl} size={size} level="M" />
        ) : (
          <div
            className="flex items-center justify-center bg-gray-50 text-gray-400 text-sm"
            style={{ width: size, height: size }}
          >
            Sin QR
          </div>
        )}
      </div>
      {expiresAt && (
        <p className={`text-sm font-semibold ${expired ? "text-red-600" : "text-green-700"}`}>
          {expired ? "renovando…" : `Expira en ${formatCountdown(left)}`}
        </p>
      )}
      {/* El token crudo nunca se muestra como texto (anti-replay visual). */}
      <p className="text-xs text-gray-400 text-center max-w-xs">
        Escanea el código con la cámara de tu celular
      </p>
    </div>
  );
}
