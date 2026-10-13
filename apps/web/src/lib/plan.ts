/**
 * El **adaptador de datos** de la planificación de rutas: lo que hay en la URL → la query de los créditos
 * en mora disponibles (`GET /mora`, F4/08: la parada es por CRÉDITO, no por caso).
 *
 * Función pura, como `carteraQuery` y `moraQuery`: quien pide es el server component. Todo lo que
 * viaja se valida antes de salir — un filtro inventado en la URL no puede dejar la pantalla entera
 * sin mora.
 */
import { haversineKm } from '@kobrax/shared';
import { COLLECTION_PRIORITIES, VisitOutcome, type MoraCreditListItem } from '@kobrax/shared';

/**
 * Una ubicación dibujable de un deudor: lo mínimo que usan el mapa y la lista.
 *
 * F4/12: puede ser **la de un garante o un familiar**, no solo la del propio cliente. `id` es el de `client_locations`
 * (lo que la parada guarda como su ubicación concreta); `ownerName` dice de quién es cuando no es del cliente.
 */
export interface PlanLocation {
  id?: string;
  locationType?: string;
  latitude: number;
  longitude: number;
  address?: string;
  ownerName?: string;
  ownerRelation?: string;
  /** La foto principal de la ubicación (la primera): se ve chica en el mapa para reconocer la casa. */
  photoUrl?: string;
}

/**
 * Un crédito en mora que se puede sumar a una ruta. `id` es el **creditId**: es lo que viaja a
 * `POST /routes/generate` (`creditIds`) y a `add-stop`.
 *
 * `zone` y `locations` salen de `GET /mora` (opcionales: hay deudores sin dirección cargada). La búsqueda
 * por área, el mapa y la columna de coordenadas dependen de ellas.
 */
export interface AvailableCredit {
  id: string;
  clientId: string;
  clientName?: string;
  creditCode?: string;
  amount?: number;
  currency?: string;
  daysPastDue?: number;
  /** El responsable del crédito: marca como «ayuda» al que lo toma de otro. */
  assigneeId?: string;
  zone?: string;
  locations?: PlanLocation[];
}

/** Una fila de `GET /mora` → lo que usa el planificador. */
export function toAvailable(row: MoraCreditListItem): AvailableCredit {
  return {
    id: row.creditId,
    clientId: row.clientId,
    clientName: row.clientName,
    creditCode: row.code,
    amount: row.balance ?? row.overdueAmount,
    currency: row.currency,
    daysPastDue: row.daysPastDue,
    assigneeId: row.responsibleId,
    zone: row.zone,
    locations: row.locations,
  };
}

/** Cuánta mora se trae para elegir. Es el techo de la API (`limit ≤ 100`), no una elección. */
export const AVAILABLE_LIMIT = 100;

/**
 * El mínimo de paradas por cobrador.
 *
 * 🔴 **Mínimo, no máximo** (decisión de la dueña): no se bloquea al noveno cliente, se avisa cuando
 * alguien queda corto. Ocho es lo que el negocio arma hoy.
 *
 * ⚠️ Vive acá y no en Settings porque **no existe ninguna configuración de cuenta**: las columnas
 * `accounts.settings`/`configuration` están en el schema y ninguna línea de la API las lee. El día
 * que exista, este número se muda allá y la pantalla no cambia.
 */
export const DEFAULT_MIN_STOPS = 8;

/** «No visitado desde»: cuántos días atrás. `never` es el caso estricto, sin ninguna visita. */
export const VISIT_AGES = ['never', '7', '15', '30'] as const;

/** Rangos de mora que ofrece el panel. El valor es lo que viaja: `min-max`, con `max` opcional. */
export const DPD_RANGES = ['1-7', '8-15', '16-30', '31-60', '61-90', '90-'] as const;

export interface PlanParams {
  date?: string;
  /** A quién se le está armando la ruta. */
  collectorId?: string;
  /** Cuántas paradas debería tener como mínimo. */
  minStops?: string;
  q?: string;
  dpd?: string;
  /** Categorías de mora (códigos de la cuenta, separados por coma). */
  categoria?: string;
  /** Prioridad del episodio de mora (códigos separados por coma). */
  prioridad?: string;
  zona?: string;
  saldoMin?: string;
  saldoMax?: string;
  promesa?: string;
  /** «Última visita»: `never` o los días sin visita (`VISIT_AGES`). */
  visita?: string;
  /** Resultado de la última visita (`VisitOutcome`, separados por coma). */
  resultado?: string;
  /** `'todos'` = también la mora de otros cobradores, para ayudar. Por defecto, sólo la del suyo. */
  cartera?: string;
  sort?: string;
  dir?: string;
}

const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_CODE = /^[A-Za-z0-9_-]{1,16}$/;
const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Los que la API sabe ordenar. `distance` no está: la cercanía todavía no existe en el servidor. */
const SORTS = ['priority', 'daysPastDue', 'balance', 'createdAt'] as const;

export function minStops(params: PlanParams): number {
  const n = Number(params.minStops);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.trunc(n) : DEFAULT_MIN_STOPS;
}

/**
 * ¿Se está mirando la cartera de todo el equipo?
 *
 * 🔴 **Por defecto NO.** «Cada uno lo suyo» es la regla; tomar la mora de otro es **ayuda puntual de
 * esa jornada** y tiene que ser una decisión explícita, no el estado inicial de la pantalla.
 */
export function helpingOthers(params: PlanParams): boolean {
  return params.cartera === 'todos';
}

/** ¿Hay algún filtro puesto? El cobrador y el día no cuentan: son de qué se está planificando. */
export function hasPlanFilters(params: PlanParams): boolean {
  return Boolean(
    params.q?.trim() ||
      params.dpd ||
      params.categoria ||
      params.prioridad ||
      params.zona ||
      params.saldoMin ||
      params.saldoMax ||
      params.promesa ||
      params.visita ||
      params.resultado ||
      helpingOthers(params),
  );
}

/**
 * La query de los créditos en mora que se pueden asignar (`GET /mora`: por defecto sólo los vencidos).
 *
 * 🔴 **`excludeRouted` va siempre**: lo que ya es parada de una ruta de ese día no se ofrece. Sin eso,
 * dos supervisores mandan a dos cobradores a la misma puerta la misma mañana. `day` es el día que se
 * planifica (o el de la ruta que se edita).
 *
 * `outcome` se compara contra la ÚLTIMA visita del crédito; `notVisitedSince` viaja como `YYYY-MM-DD`.
 */
export function availableQuery(params: PlanParams, day: string): URLSearchParams {
  const query = new URLSearchParams({ limit: String(AVAILABLE_LIMIT), excludeRouted: day });

  // Sólo la suya, salvo que se pida ayudar. Sin cobrador elegido no se acota: no hay a quién.
  if (!helpingOthers(params) && params.collectorId && IS_UUID.test(params.collectorId)) {
    query.set('assigneeId', params.collectorId);
  }

  if (params.q?.trim()) query.set('q', params.q.trim());

  const dpd = (DPD_RANGES as readonly string[]).includes(params.dpd ?? '') ? params.dpd!.split('-') : null;
  if (dpd) {
    if (dpd[0]) query.set('dpdMin', dpd[0]);
    if (dpd[1]) query.set('dpdMax', dpd[1]);
  }

  // La categoría la configura cada cuenta: se valida la forma del código, y la API ignora el desconocido.
  const categorias = [...new Set((params.categoria ?? '').split(',').map((c) => c.trim()).filter((c) => CATEGORY_CODE.test(c)))];
  if (categorias.length) query.set('category', categorias.join(','));
  const prioridades = list(params.prioridad, COLLECTION_PRIORITIES);
  if (prioridades.length) query.set('priority', prioridades.join(','));

  if (params.zona?.trim()) query.set('zone', params.zona.trim());
  for (const [key, param] of [
    ['balanceMin', params.saldoMin],
    ['balanceMax', params.saldoMax],
  ] as const) {
    const n = Number(param);
    if (param?.trim() && Number.isFinite(n) && n >= 0) query.set(key, String(n));
  }

  if (params.promesa === 'true' || params.promesa === 'false') query.set('hasPromise', params.promesa);

  const resultados = list(params.resultado, Object.values(VisitOutcome));
  if (resultados.length) query.set('outcome', resultados.join(','));

  if (params.visita === 'never') query.set('neverVisited', 'true');
  else if ((VISIT_AGES as readonly string[]).includes(params.visita ?? '')) {
    query.set('notVisitedSince', shiftDays(day, -Number(params.visita)));
  }

  if (params.sort && (SORTS as readonly string[]).includes(params.sort)) {
    query.set('sort', params.sort);
    query.set('dir', params.dir === 'asc' ? 'asc' : 'desc');
  } else {
    // Lo más urgente primero: es el mismo criterio con el que se mira Mora.
    query.set('sort', 'priority');
    query.set('dir', 'desc');
  }

  return query;
}

/** Las columnas que ordena el navegador, porque la API no las sabe ordenar. */
export type LocalSort = 'client' | 'zone' | 'coords';

/**
 * Hasta dónde se sugiere mora sin ruta alrededor de una ruta armada, en kilómetros (en línea recta, desde cada parada).
 * Es lo que se camina o se maneja de más para una visita preventiva: pasado eso ya es otra ruta.
 */
export const SUGGEST_KM = 1;

/** Radios que ofrece la búsqueda por área, en kilómetros. Media cuadra no es un área; 20 km es la ciudad. */
export const RADIUS_KM = [0.5, 1, 2, 5] as const;

export interface Point {
  latitude: number;
  longitude: number;
}

/**
 * Distancia en línea recta entre dos puntos, en kilómetros (haversine).
 *
 * 🔴 **Es la distancia del pájaro, no la de la calle.** Sirve para «¿esto queda cerca?», que es la
 * pregunta al armar una ruta; la distancia real por las calles la da OSRM y **cuesta una llamada por
 * recorrido**, así que no puede correr mientras alguien arrastra un círculo por el mapa.
 *
 * ponytail: fórmula esférica, sin corrección por el achatamiento de la Tierra. El error es de metros
 * en distancias urbanas — irrelevante para decidir si una casa entra en un radio de dos kilómetros.
 */
export { haversineKm } from '@kobrax/shared';

/**
 * Los que caen **dentro del círculo**.
 *
 * 🔴 Entra si **alguna** de sus ubicaciones cae adentro. Quien no tiene ubicación cargada **queda afuera**, y no es un descuido: el área pregunta «qué
 * hay acá», y de esa persona no se sabe dónde está. Meterla igual haría que una ruta armada por
 * zona termine con una parada en la otra punta.
 */
export function withinRadius<T extends { locations?: Point[] }>(rows: T[], center: Point, km: number): T[] {
  // 🔴 **Cualquiera de sus ubicaciones**: el cliente puede vivir lejos y trabajar adentro del círculo (o tener un garante ahí).
  return rows.filter((r) => (r.locations ?? []).some((loc) => haversineKm(center, loc) <= km));
}

/**
 * Ordenar la mora que se está viendo por una columna que el servidor no sabe ordenar.
 *
 * 🔴 Ordenar en el navegador es correcto **acá y no en las tablas del panel**: esta lista no pagina.
 * Lo que llegó es lo que se ve y lo que se puede elegir, así que acomodarlo no esconde nada — y
 * cuántas trajo de cuántas hay ya está escrito arriba de la lista.
 *
 * Quien no tiene el dato va **al final en los dos sentidos**: un cliente sin zona no es «la zona que
 * va primero alfabéticamente», es uno del que no se sabe dónde está. Ponerlo primero al invertir
 * llenaría la cabecera de filas vacías justo cuando se busca lo contrario.
 */
export function sortAvailable<
  T extends { clientName?: string; zone?: string; locations?: { latitude: number }[] },
>(rows: T[], key: LocalSort, dir: 'asc' | 'desc'): T[] {
  const factor = dir === 'asc' ? 1 : -1;
  const valor = (c: T): string | number | undefined => {
    if (key === 'client') return c.clientName?.trim().toLowerCase();
    if (key === 'zone') return c.zone?.trim().toLowerCase();
    // Por latitud: agrupa de norte a sur, que es lo que sirve para armar una ruta compacta.
    return c.locations?.[0]?.latitude;
  };

  return [...rows].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va === undefined || vb === undefined) return va === vb ? 0 : va === undefined ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb)) * factor;
  });
}

/** Una lista separada por comas → los valores que se conocen. Lo inventado se descarta. */
function list(raw: string | undefined, values: readonly string[]): string[] {
  if (!raw?.trim()) return [];
  const valid = new Set<string>(values);
  return [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => valid.has(v)))];
}

/** Días antes o después de un `YYYY-MM-DD`, en UTC (es un día civil, no un instante). */
export function shiftDays(day: string, delta: number): string {
  const base = IS_DAY.test(day) ? day : new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * La ubicación que se usa si nadie eligió otra: **el domicilio del propio cliente**; si no tiene, otra suya; si no, la
 * primera que haya (una de un garante). Es la misma regla con la que la API resuelve «la principal» de un cliente:
 * con dos criterios, el pin del mapa y la dirección de la parada podrían apuntar a lugares distintos.
 */
export function defaultLocation(locations?: PlanLocation[]): PlanLocation | undefined {
  if (!locations || locations.length === 0) return undefined;
  const own = locations.filter((l) => !l.ownerName);
  return own.find((l) => l.locationType === 'HOME') ?? own[0] ?? locations[0];
}

/** Suma minutos a una hora `HH:mm` (da la vuelta a las 24 h). Con una hora inválida devuelve `—`. */
export function addMinutes(hhmm: string, minutes: number): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return '—';
  const total = (((Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Las paradas que llegan DESPUÉS de la hora fija de su visita agendada (decisión 9: la hora fija es restricción dura y el
 * choque se muestra siempre). `start` es la hora de salida (`HH:mm`); `etaMinutes`, los minutos desde la salida.
 */
export function clockConflicts(stops: { id: string; etaMinutes?: number; scheduledTime?: string }[], start: string): string[] {
  return stops
    .filter((s) => s.scheduledTime && s.etaMinutes != null)
    .filter((s) => {
      const arrives = addMinutes(start, s.etaMinutes!);
      // Se compara como texto `HH:mm`: es lo que se muestra, y el orden lexicográfico de la hora es el cronológico.
      return arrives !== '—' && arrives > s.scheduledTime!;
    })
    .map((s) => s.id);
}
