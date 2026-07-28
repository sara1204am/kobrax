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
 * ponytail: cola chica y propia porque la general (WatermelonDB) es P6. Cuando llegue, esto se
 * enchufa ahí y se borra. Se guarda en SecureStore, el mismo mecanismo de `biometric.ts` e
 * `import.service.ts` (cero deps nuevas); son sólo ids, ~40 bytes por parada. Si una ruta llegara a
 * cientos de paradas, mudarlo a `expo-file-system` antes de que SecureStore se queje del tamaño.
 */
import * as SecureStore from 'expo-secure-store';
import { addStop, getRoute, removeStop, updateStop, type RouteStopItem } from './routes.service';

const KEY = 'kobrax.route.draft';

export interface RouteDraft {
  /** Ruta en el server. `null` mientras el recorrido sólo existe en el teléfono. */
  routeId: string | null;
  /** Fecha de la ruta (`YYYY-MM-DD`): un borrador de ayer no se le aplica a la jornada de hoy. */
  date: string;
  /** Los casos elegidos, **en el orden del recorrido**. */
  caseIds: string[];
  /** Cliente de cada caso — el server necesita ambos para crear la parada. */
  clientByCase: Record<string, string>;
}

export function emptyDraft(date: string): RouteDraft {
  return { routeId: null, date, caseIds: [], clientByCase: {} };
}

// ── Persistencia ──────────────────────────────────────────────────────────────

export async function loadDraft(date: string): Promise<RouteDraft> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return emptyDraft(date);
  try {
    const draft = JSON.parse(raw) as RouteDraft;
    // Un borrador de otro día no se arrastra: la jornada de hoy arranca limpia.
    return draft.date === date ? draft : emptyDraft(date);
  } catch {
    return emptyDraft(date);
  }
}

export async function saveDraft(draft: RouteDraft): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(draft));
}

export async function clearDraft(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

// ── Ediciones (puras: la pantalla guarda el resultado) ────────────────────────

export function withStop(draft: RouteDraft, caseId: string, clientId: string): RouteDraft {
  if (draft.caseIds.includes(caseId)) return draft; // dos toques sobre el mismo pin
  return {
    ...draft,
    caseIds: [...draft.caseIds, caseId],
    clientByCase: { ...draft.clientByCase, [caseId]: clientId },
  };
}

export function withoutStop(draft: RouteDraft, caseId: string): RouteDraft {
  const { [caseId]: _out, ...rest } = draft.clientByCase;
  return { ...draft, caseIds: draft.caseIds.filter((id) => id !== caseId), clientByCase: rest };
}

/** Mueve una parada `delta` lugares (−1 sube, +1 baja). Fuera de rango, no hace nada. */
export function moveStop(draft: RouteDraft, caseId: string, delta: number): RouteDraft {
  const from = draft.caseIds.indexOf(caseId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.caseIds.length) return draft;
  const caseIds = [...draft.caseIds];
  caseIds.splice(to, 0, caseIds.splice(from, 1)[0]!);
  return { ...draft, caseIds };
}

// ── Sincronización ────────────────────────────────────────────────────────────

export interface StopDiff {
  /** Casos que hay que crear como parada. */
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
export function diffStops(caseIds: string[], serverStops: RouteStopItem[]): StopDiff {
  const editable = serverStops.filter((s) => s.status === 'PENDING');
  const byCase = new Map(editable.filter((s) => s.caseId).map((s) => [s.caseId!, s]));

  const toAdd = caseIds.filter((id) => !byCase.has(id));
  const toRemove = editable.filter((s) => !s.caseId || !caseIds.includes(s.caseId)).map((s) => s.id);

  // La posición final se cuenta sobre el recorrido completo, incluidas las paradas ya gestionadas
  // que quedan adelante: el número que se manda es la posición real en la ruta.
  const fixed = serverStops.length - editable.length;
  const toMove: StopDiff['toMove'] = [];
  caseIds.forEach((caseId, i) => {
    const stop = byCase.get(caseId);
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
 * y sólo se llama si todavía no hay ninguna.
 */
export async function flushDraft(
  draft: RouteDraft,
  createRoute: () => Promise<{ status: string; data?: { id: string }; message?: string }>,
): Promise<FlushResult> {
  if (draft.caseIds.length === 0 && !draft.routeId) return { status: 'ok', draft };

  let routeId = draft.routeId;
  if (!routeId) {
    const created = await createRoute();
    if (created.status === 'offline') return { status: 'offline' };
    if (created.status !== 'ok' || !created.data) return { status: 'error', message: created.message ?? 'No se pudo crear la ruta' };
    routeId = created.data.id;
  }

  const current = await getRoute(routeId);
  if (current.status === 'offline') return { status: 'offline' };
  if (current.status !== 'ok') return { status: 'error', message: 'No se pudo leer la ruta' };

  const diff = diffStops(draft.caseIds, current.data.stops ?? []);

  for (const stopId of diff.toRemove) {
    const res = await removeStop(routeId, stopId);
    if (res.status === 'offline') return { status: 'offline' };
    if (res.status === 'error') return { status: 'error', message: res.message };
  }
  for (const caseId of diff.toAdd) {
    const res = await addStop(routeId, { clientId: draft.clientByCase[caseId]!, caseId });
    if (res.status === 'offline') return { status: 'offline' };
    if (res.status === 'error') return { status: 'error', message: res.message };
  }
  // El orden se recalcula recién acá: agregar y quitar ya movieron las posiciones.
  const after = await getRoute(routeId);
  if (after.status === 'offline') return { status: 'offline' };
  if (after.status === 'ok') {
    for (const move of diffStops(draft.caseIds, after.data.stops ?? []).toMove) {
      const res = await updateStop(routeId, move.stopId, { sequenceOrder: move.sequenceOrder });
      if (res.status === 'offline') return { status: 'offline' };
      if (res.status === 'error') return { status: 'error', message: res.message };
    }
  }

  const synced: RouteDraft = { ...draft, routeId };
  await saveDraft(synced);
  return { status: 'ok', draft: synced };
}
