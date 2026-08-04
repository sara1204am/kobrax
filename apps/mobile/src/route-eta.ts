/**
 * Las cuentas de la vista previa de la ruta (S3). Puras, sin red ni React: se testean solas.
 *
 * El server manda `etaMinutes` = minutos desde la salida hasta cada parada (tramos reales + la
 * permanencia en las anteriores). Acá se convierten en la hora que el cobrador lee, y se arma el
 * dibujo de respaldo para cuando no hubo motor de ruteo.
 */
import type { LngLat } from './maps/tiles';

/** "09:30 AM" — `offsetMin` minutos después de `departure`. */
export function clockAt(departure: Date, offsetMin: number): string {
  const t = new Date(departure.getTime() + offsetMin * 60_000);
  const h = t.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} ${ampm}`;
}

/** "3h 45m" · "45m". Sin datos, un guión: mejor eso que un cero que parece medido. */
export function humanDuration(minutes?: number): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "12.4 km". */
export function humanDistance(km?: number): string {
  return km == null ? '—' : `${km.toFixed(1)} km`;
}

/**
 * El recorrido de respaldo: rectas entre las paradas que tienen punto, en el orden actual.
 * Se usa cuando el server no pudo calcular la geometría (sin señal, o con OSRM caído). Se ve por
 * dónde va el recorrido, aunque no por qué calles.
 */
export function straightLine(stops: { latitude?: number; longitude?: number }[]): LngLat[] {
  return stops
    .filter((s): s is LngLat => s.latitude != null && s.longitude != null)
    .map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
}
