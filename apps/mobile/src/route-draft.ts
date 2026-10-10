/**
 * Borrador de la ruta que se arma en el mapa (Rutas S2, §5.5).
 *
 * La pantalla **nunca escribe directo en el server**: cada toque (agregar, quitar, mover) cambia este
 * borrador local, que se persiste y después se sincroniza — al toque si hay red, cuando vuelva si no.
 * Es el mismo camino con conexión y sin conexión: no hay una rama "offline" que se pruebe menos.
 *
 * La sincronización va **por diferencia, no por historial**: se compara lo que el cobrador quiere
 * contra lo que tiene el server y se aplican las diferencias. Eso la hace idempotente —reintentar no
 * duplica— y evita ordenar una cola de operaciones y resolver conflictos entre ellas.
 *
 * **P6 lo enganchó al motor de sync, y NO lo absorbió en la cola de acciones.** El plan decía
 * "se enchufa ahí y se borra", pero al llegar se vio que no correspondía: la cola sube *acciones
 * puntuales* (un pago, una visita) y esto es un *estado* que se edita muchas veces y se sincroniza
 * por diferencia. Encolar cada toque como una acción desharía justo lo que lo hace idempotente.
 * Lo que sí faltaba —y era un problema real— es que el borrador **sólo se reintentaba cuando el
 * cobrador volvía a la pantalla y tocaba algo**: ahora `flushPendingDraft` corre en cada drenaje.
 *
 * ponytail: la persistencia sigue en SecureStore y no se mudó a SQLite. Son ids, ~40 bytes por
 * parada (una ruta de 16 son 640 B), así que el techo de ~2 KB no está cerca. Mudarlo por prolijidad
 * sería churn sin ganancia. Si una ruta llegara a cientos de paradas, ahí sí va a `db.ts`.
 */
import * as SecureStore from 'expo-secure-store';
import { nuevoId } from './ids';
import { addStop, createRoute, getRoute, removeStop, updateStop, type RouteStopItem } from './routes.service';
import { getUserId, ROUTE_DRAFT_KEY, routeDraftKey } from './session';

export interface RouteDraft {
  /** Ruta en el server. `null` mientras el recorrido sólo existe en el teléfono. */
  routeId: string | null;
  /**
   * El id con el que se pide crear la ruta (`POST /routes`), fijado la primera vez y **guardado antes de
   * llamar**: si la respuesta se pierde, el reintento manda el mismo id y el server devuelve la ruta ya creada
   * en vez de crear otra (o chocar con «ya hay una ruta hoy»).
   */
  createId?: string;
  /** Fecha de la ruta (`YYYY-MM-DD`): un borrador de ayer no se le aplica a la jornada de hoy. */
  date: string;
  /** Los créditos elegidos, **en el orden del recorrido** (una parada = un crédito). */
  creditIds: string[];
  /** Cliente de cada crédito — el server necesita ambos para crear la parada. */
  clientByCredit: Record<string, string>;
  /**
   * La ubicación elegida de cada crédito (si el cliente tiene varias). Ausente = que el servidor use la principal. Opcional:
   * un borrador viejo, sin este campo, sigue siendo válido.
   */
  locationByCredit?: Record<string, string>;
}

export function emptyDraft(date: string): RouteDraft {
  return { routeId: null, date, creditIds: [], clientByCredit: {} };
}

// ── Persistencia ──────────────────────────────────────────────────────────────

/**
 * El borrador es **del usuario**: la clave lleva su id. Sin usuario no hay dónde guardarlo (ni de quién sea).
 * La clave vieja, sin sufijo, no se migra: se borra al primer acceso, porque no se sabe de quién era.
 */
async function draftKey(): Promise<string | null> {
  const userId = await getUserId();
  return userId ? routeDraftKey(userId) : null;
}

/**
 * Los borradores del usuario, **uno por día** (D-6: se puede armar la ruta de mañana sin pisar la de hoy). Se guardan juntos
 * bajo la misma clave —`SecureStore` no permite listar claves, y así «borrar los del usuario» sigue siendo una sola
 * operación—. El formato viejo (un único borrador) se lee como un mapa de un solo día: no hace falta migrar nada.
 */
export type DraftMap = Record<string, RouteDraft>;

const isDraft = (d: unknown): d is RouteDraft =>
  !!d && typeof d === 'object' && Array.isArray((d as RouteDraft).creditIds) && typeof (d as RouteDraft).date === 'string';

/** Lo guardado, normalizado. Un valor ilegible o de otra forma es un mapa vacío (nunca tira). */
export function parseDrafts(raw: string | null): DraftMap {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (isDraft(value)) return { [value.date]: value }; // formato viejo: un solo borrador
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k, v]) => isDraft(v) && v.date === k)) as DraftMap;
    }
  } catch {
    /* ilegible: se pisa */
  }
  return {};
}

async function readDrafts(key: string): Promise<DraftMap> {
  return parseDrafts(await SecureStore.getItemAsync(key));
}

/** Lo que vale la pena seguir guardando: nada de días pasados, ni borradores vacíos sin ruta. */
export function pruneDrafts(drafts: DraftMap, today: string): DraftMap {
  return Object.fromEntries(
    Object.entries(drafts).filter(([date, d]) => date >= today && (d.creditIds.length > 0 || d.routeId)),
  );
}

export async function loadDraft(date: string): Promise<RouteDraft> {
  await SecureStore.deleteItemAsync(ROUTE_DRAFT_KEY); // legado sin dueño: se descarta
  const key = await draftKey();
  if (!key) return emptyDraft(date);
  // El de otro día no se arrastra: cada jornada arranca con SU borrador, o limpia.
  return (await readDrafts(key))[date] ?? emptyDraft(date);
}

/** Todos los borradores pendientes del usuario (para sincronizar los de varios días). */
export async function loadAllDrafts(): Promise<DraftMap> {
  const key = await draftKey();
  return key ? readDrafts(key) : {};
}

export async function saveDraft(draft: RouteDraft): Promise<void> {
  const key = await draftKey();
  if (!key) return;
  const all = await readDrafts(key);
  // La pantalla guarda su copia en memoria, que puede no tener el `createId` que `flushDraft` fijó en un intento
  // fallido: se conserva el guardado, o el reintento mandaría OTRO id y duplicaría la ruta si el primero llegó.
  let toSave = draft;
  const prev = all[draft.date];
  if (!draft.createId && !draft.routeId && prev?.createId && !prev.routeId) toSave = { ...draft, createId: prev.createId };
  // Los días que ya pasaron y los borradores vacíos sin ruta no se siguen guardando.
  const next = { ...all, [toSave.date]: toSave };
  await SecureStore.setItemAsync(key, JSON.stringify(next));
}

/** Quita el borrador de UN día (la ruta de ese día ya quedó armada) y poda los días que ya pasaron. */
export async function dropDraft(date: string, today: string): Promise<void> {
  const key = await draftKey();
  if (!key) return;
  const { [date]: _gone, ...rest } = await readDrafts(key);
  const kept = pruneDrafts(rest, today);
  if (Object.keys(kept).length === 0) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, JSON.stringify(kept));
}

export async function clearDraft(): Promise<void> {
  await SecureStore.deleteItemAsync(ROUTE_DRAFT_KEY);
  const key = await draftKey();
  if (key) await SecureStore.deleteItemAsync(key);
}

// ── Ediciones (puras: la pantalla guarda el resultado) ────────────────────────

export function withStop(draft: RouteDraft, creditId: string, clientId: string, locationId?: string): RouteDraft {
  if (draft.creditIds.includes(creditId)) return draft; // dos toques sobre el mismo pin
  return {
    ...draft,
    creditIds: [...draft.creditIds, creditId],
    clientByCredit: { ...draft.clientByCredit, [creditId]: clientId },
    ...(locationId ? { locationByCredit: { ...draft.locationByCredit, [creditId]: locationId } } : {}),
  };
}

export function withoutStop(draft: RouteDraft, creditId: string): RouteDraft {
  const { [creditId]: _out, ...rest } = draft.clientByCredit;
  const { [creditId]: _loc, ...locs } = draft.locationByCredit ?? {};
  return {
    ...draft,
    creditIds: draft.creditIds.filter((id) => id !== creditId),
    clientByCredit: rest,
    ...(draft.locationByCredit ? { locationByCredit: locs } : {}),
  };
}

/** Mueve una parada `delta` lugares (−1 sube, +1 baja). Fuera de rango, no hace nada. */
export function moveStop(draft: RouteDraft, creditId: string, delta: number): RouteDraft {
  const from = draft.creditIds.indexOf(creditId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.creditIds.length) return draft;
  const creditIds = [...draft.creditIds];
  creditIds.splice(to, 0, creditIds.splice(from, 1)[0]!);
  return { ...draft, creditIds };
}

// ── Sincronización ────────────────────────────────────────────────────────────

export interface StopDiff {
  /** Créditos que hay que crear como parada. */
  toAdd: string[];
  /** Paradas del server que ya no están en el borrador (id de parada). */
  toRemove: string[];
  /** Paradas a mover: id de parada + posición final (1-based). */
  toMove: { stopId: string; sequenceOrder: number }[];
}

/**
 * Qué le falta al server para quedar como el borrador. Función pura — es el corazón del slice y se
 * testea sola. Las paradas ya gestionadas (visitadas/omitidas) **no se tocan**: son historia de la
 * jornada, no parte del recorrido que se está armando.
 */
export function diffStops(creditIds: string[], serverStops: RouteStopItem[]): StopDiff {
  const editable = serverStops.filter((s) => s.status === 'PENDING');
  const byCredit = new Map(editable.filter((s) => s.creditId).map((s) => [s.creditId!, s]));

  const toAdd = creditIds.filter((id) => !byCredit.has(id));
  const toRemove = editable.filter((s) => !s.creditId || !creditIds.includes(s.creditId)).map((s) => s.id);

  // La posición final se cuenta sobre el recorrido completo, incluidas las paradas ya gestionadas
  // que quedan adelante: el número que se manda es la posición real en la ruta.
  const fixed = serverStops.length - editable.length;
  const toMove: StopDiff['toMove'] = [];
  creditIds.forEach((creditId, i) => {
    const stop = byCredit.get(creditId);
    const target = fixed + i + 1;
    if (stop && stop.sequenceOrder !== target) toMove.push({ stopId: stop.id, sequenceOrder: target });
  });

  return { toAdd, toRemove, toMove };
}

export type FlushResult = { status: 'ok'; draft: RouteDraft } | { status: 'offline' } | { status: 'error'; message: string };

/**
 * Aplica el borrador contra el server. Devuelve el borrador actualizado (puede traer `routeId` nuevo).
 * Sin conexión corta y avisa: lo local queda intacto para el próximo intento.
 *
 * `createRoute` lo inyecta el caller —crear la ruta del día necesita el `collectorId` de la sesión—
 * y sólo se llama si todavía no hay ninguna. Recibe el **id de la ruta**, que viaja en el pedido: se genera una
 * vez y se persiste en el borrador ANTES de llamar, así un reintento tras un timeout no crea una segunda ruta.
 */
export async function flushDraft(
  draft: RouteDraft,
  createRoute: (id: string) => Promise<{ status: string; data?: { id: string }; message?: string }>,
): Promise<FlushResult> {
  if (draft.creditIds.length === 0 && !draft.routeId) return { status: 'ok', draft };

  let routeId = draft.routeId;
  if (!routeId) {
    if (!draft.createId) {
      draft = { ...draft, createId: nuevoId() };
      await saveDraft(draft);
    }
    const created = await createRoute(draft.createId!);
    if (created.status === 'offline') return { status: 'offline' };
    if (created.status !== 'ok' || !created.data) return { status: 'error', message: created.message ?? 'No se pudo crear la ruta' };
    routeId = created.data.id;
  }

  const current = await getRoute(routeId);
  if (current.status === 'offline') return { status: 'offline' };
  if (current.status !== 'ok') return { status: 'error', message: 'No se pudo leer la ruta' };

  const diff = diffStops(draft.creditIds, current.data.stops ?? []);

  for (const stopId of diff.toRemove) {
    const res = await removeStop(routeId, stopId);
    if (res.status === 'offline') return { status: 'offline' };
    if (res.status === 'error') return { status: 'error', message: res.message };
  }
  for (const creditId of diff.toAdd) {
    const res = await addStop(routeId, {
      clientId: draft.clientByCredit[creditId]!,
      creditId,
      ...(draft.locationByCredit?.[creditId] ? { locationId: draft.locationByCredit[creditId] } : {}),
    });
    if (res.status === 'offline') return { status: 'offline' };
    if (res.status === 'error') return { status: 'error', message: res.message };
  }
  // El orden se recalcula recién acá: agregar y quitar ya movieron las posiciones.
  const after = await getRoute(routeId);
  if (after.status === 'offline') return { status: 'offline' };
  if (after.status === 'ok') {
    for (const move of diffStops(draft.creditIds, after.data.stops ?? []).toMove) {
      const res = await updateStop(routeId, move.stopId, { sequenceOrder: move.sequenceOrder });
      if (res.status === 'offline') return { status: 'offline' };
      if (res.status === 'error') return { status: 'error', message: res.message };
    }
  }

  const synced: RouteDraft = { ...draft, routeId };
  await saveDraft(synced);
  return { status: 'ok', draft: synced };
}

/**
 * Sincroniza los borradores de **todos los días** (hoy y los próximos) sin que haya una pantalla abierta. Lo llama el motor
 * de sync en cada drenaje. Un día que ya pasó sin haberse creado la ruta se descarta: el servidor no arma rutas del pasado.
 *
 * Devuelve el peor resultado: `'offline'` si alguno no salió por falta de señal, `'error'` si alguno falló, `'ok'` si se
 * sincronizó algo y `'nothing'` cuando no había nada — que es el caso normal y no cuesta red.
 */
export async function flushPendingDrafts(
  collectorId: string,
  today: string,
): Promise<'ok' | 'nothing' | 'offline' | 'error'> {
  const all = await loadAllDrafts();
  let outcome: 'ok' | 'nothing' | 'offline' | 'error' = 'nothing';
  for (const date of Object.keys(all).sort()) {
    const draft = all[date]!;
    if (date < today) {
      // Ya pasó: si nunca llegó a crearse, no hay nada que rescatar (y la API la rechazaría con ROUTE_PAST_DATE).
      if (!draft.routeId) await dropDraft(date, today);
      continue;
    }
    if (draft.creditIds.length === 0) continue;
    const res = await flushDraft(draft, (id) => createRoute({ id, collectorId, plannedDate: date }));
    if (res.status === 'offline') return 'offline';
    if (res.status === 'error') outcome = 'error';
    else if (outcome === 'nothing') outcome = 'ok';
  }
  return outcome;
}

/**
 * Sincroniza el borrador de UN día. Se conserva por las pantallas que ya lo usan; el motor de sync usa
 * `flushPendingDrafts`.
 */
export async function flushPendingDraft(
  collectorId: string,
  date: string,
): Promise<'ok' | 'nothing' | 'offline' | 'error'> {
  const draft = await loadDraft(date);
  if (draft.creditIds.length === 0) return 'nothing';
  // Con `routeId` ya existe en el server; igual se corre el flush, porque puede haber quedado a
  // medias (paradas agregadas y el orden sin aplicar). El diff resuelve qué falta y no duplica.
  const res = await flushDraft(draft, (id) => createRoute({ id, collectorId, plannedDate: date }));
  return res.status === 'ok' ? 'ok' : res.status === 'offline' ? 'offline' : 'error';
}
