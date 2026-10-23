// Única implementación de GPS del frontend (profesor y estudiante la reusan).
// RNF-06: la geo nunca debe bloquear; por eso rechaza con un código tipado y
// cada pantalla decide si continúa sin ubicación.
const GEO_TIMEOUT_MS = 8000;

/**
 * Resuelve { latitude, longitude, accuracy } o rechaza con:
 * - "unsupported" si el navegador no soporta geolocalización
 * - "denied" si el usuario rechazó el permiso / no hay permiso
 * - "timeout" si no resolvió a tiempo
 * - "unavailable" si el navegador no pudo determinar la posición
 */
export function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      (err) => {
        if (err?.code === 1) reject(new Error("denied"));
        else if (err?.code === 3) reject(new Error("timeout"));
        else reject(new Error("unavailable"));
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 }
    );
  });
}
