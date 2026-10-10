/**
 * Geografía mínima compartida (web y móvil). Una sola fórmula de distancia: antes vivía solo en el panel y el móvil la iba a
 * duplicar para «estoy aquí» y las candidatas cercanas.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Distancia en línea recta entre dos puntos, en km (fórmula de Haversine).
 *
 * ponytail: fórmula esférica, sin corrección por el achatamiento de la Tierra. El error es de metros en distancias urbanas —
 * irrelevante para decidir si una casa entra en un radio de dos kilómetros o cuánto falta para llegar.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371; // radio medio de la Tierra
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** «450 m» / «2,3 km»: lo que se le dice al cobrador. */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 10) * 100} m`.replace(/^0 m$/, 'aquí');
  return `${km.toFixed(1).replace('.', ',')} km`;
}
