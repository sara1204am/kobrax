/**
 * Cliente del motor de ruteo (Rutas S3). OSRM self-hosted: distancia y tiempo **por calles**, no en
 * línea recta, y el orden óptimo de las paradas.
 *
 * Se levanta con el `docker-compose` del repo (servicio `osrm`, ver ahí la puesta en marcha) y se
 * apunta con `OSRM_URL`. El móvil NUNCA le habla directo: pasa por la API, que es la que cachea el
 * resultado y la que hay que tocar el día que el motor se cambie.
 *
 * **Nunca tira: devuelve `null`.** Si OSRM está caído, tarda, o las paradas no tienen coordenadas, el
 * preview se degrada a línea recta (S3 §5.4) — el cobrador no se queda sin poder iniciar su jornada
 * porque un servicio de infraestructura no contestó.
 */
import { Injectable, Logger } from '@nestjs/common';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface OsrmRoute {
  distanceM: number;
  durationS: number;
  /** La polilínea por las calles, en orden. */
  geometry: LatLng[];
  /** Un tramo por par de paradas consecutivas: `legs.length === puntos - 1`. */
  legs: { distanceM: number; durationS: number }[];
}

/** Lo mismo que `route`, más en qué orden conviene visitar los puntos que se mandaron. */
export interface OsrmTrip extends OsrmRoute {
  /** Índices de los puntos de entrada, en el orden óptimo. `[0,2,1]` = el tercero va segundo. */
  order: number[];
}

const TIMEOUT_MS = 5_000;

@Injectable()
export class OsrmService {
  private readonly log = new Logger(OsrmService.name);
  private readonly base = (process.env.OSRM_URL ?? 'http://localhost:5000').replace(/\/$/, '');

  /** El recorrido tal cual, en el orden dado. */
  async route(points: LatLng[]): Promise<OsrmRoute | null> {
    const body = await this.get('route', points, 'overview=full&geometries=geojson&annotations=false');
    const found = body?.routes?.[0];
    return found ? toRoute(found) : null;
  }

  /**
   * El mismo recorrido, reordenado óptimamente. `source=first` deja la primera parada donde está —el
   * cobrador ya salió para allá— y `roundtrip=false` no lo obliga a volver al inicio.
   */
  async trip(points: LatLng[]): Promise<OsrmTrip | null> {
    const body = await this.get('trip', points, 'source=first&roundtrip=false&overview=full&geometries=geojson');
    const found = body?.trips?.[0];
    if (!found || !body?.waypoints) return null;
    // `waypoints[i].waypoint_index` = en qué posición del viaje quedó el punto i. Se invierte para
    // obtener "qué punto va en cada posición", que es lo que necesita quien reordena.
    // Arranca lleno de -1 (y no disperso) a propósito: sobre un array con huecos, `some`/`includes`
    // los saltean y una respuesta incompleta pasaría la validación.
    const order = new Array<number>(points.length).fill(-1);
    body.waypoints.forEach((w, i) => {
      const at = w?.waypoint_index;
      if (at != null && at >= 0 && at < order.length) order[at] = i;
    });
    if (order.includes(-1)) return null;
    return { ...toRoute(found), order };
  }

  private async get(service: 'route' | 'trip', points: LatLng[], query: string): Promise<OsrmBody | null> {
    // Con menos de dos puntos no hay recorrido que calcular, y OSRM responde error.
    if (points.length < 2) return null;
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const url = `${this.base}/${service}/v1/car/${coords}?${query}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        this.log.warn(`OSRM ${service} respondió ${res.status}`);
        return null;
      }
      const body = (await res.json()) as OsrmBody;
      // `NoRoute` es normal: dos puntos sin calle que los una. No es un error del servicio.
      if (body.code !== 'Ok') {
        this.log.warn(`OSRM ${service}: ${body.code}`);
        return null;
      }
      return body;
    } catch (e) {
      this.log.warn(`OSRM ${service} no respondió: ${(e as Error).message}`);
      return null;
    }
  }
}

// ── Forma de la respuesta de OSRM (sólo lo que se usa) ───────────────────────
interface OsrmBody {
  code?: string;
  routes?: OsrmPath[];
  trips?: OsrmPath[];
  waypoints?: { waypoint_index?: number }[];
}
interface OsrmPath {
  distance: number;
  duration: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { distance: number; duration: number }[];
}

function toRoute(p: OsrmPath): OsrmRoute {
  return {
    distanceM: p.distance,
    durationS: p.duration,
    // GeoJSON viene [lng,lat]; adentro de Kobrax todo viaja como {latitude,longitude}.
    geometry: (p.geometry?.coordinates ?? []).map(([longitude, latitude]) => ({ latitude, longitude })),
    legs: (p.legs ?? []).map((l) => ({ distanceM: l.distance, durationS: l.duration })),
  };
}
