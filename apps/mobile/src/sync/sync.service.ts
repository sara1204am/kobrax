/**
 * El motor de sync (epic H1.1–H1.4). Drena la cola cuando hay red y mantiene el contador que
 * muestra el `OfflineIndicator`.
 *
 * Reglas que no se negocian:
 *  - **Nunca borra un dato que no subió.** Un fallo cuenta el intento y nada más.
 *  - **Un ítem que falla no traba a los que siguen.** Son independientes por diseño (ver `queue.ts`).
 *  - **Sin red corta ya.** Si el primero no salió por falta de señal, los demás tampoco van a salir:
 *    seguir intentando sólo gasta batería.
 *
 * `ponytail:` no hay backoff con temporizadores propios. El drenaje ya corre atado a eventos (al
 * reconectar, al abrir la app, y cada 60 s con red), así que el reintento espaciado sale de eso.
 * Un ítem que falló 3 veces deja de intentarse solo y espera a que el cobrador toque "reintentar":
 * si algo está mal de verdad, martillar el servidor cada minuto no lo va a arreglar.
 */
import * as db from '../db';
import { useNetStore } from '../store/net';
import { pendingActions, send } from './queue';

/** Después de esto, el ítem queda esperando un reintento manual. */
const MAX_ATTEMPTS = 3;
/** Cada cuánto se drena mientras la app está abierta y con red. */
const CICLO_MS = 60_000;

export interface DrainResult {
  sent: number;
  failed: number;
  /** Quedó algo sin intentar porque se cortó (sin red o sesión vencida). */
  stopped: 'offline' | 'auth' | null;
}

let corriendo = false;

/**
 * Sube lo pendiente. `force` ignora el techo de intentos — es el botón "reintentar ahora", donde
 * el cobrador está mirando y decidió que quiere que se intente igual.
 */
export async function drain(userId: string, opts: { force?: boolean } = {}): Promise<DrainResult> {
  const res: DrainResult = { sent: 0, failed: 0, stopped: null };
  // Dos drenajes a la vez subirían la misma acción dos veces en paralelo, y la idempotencia
  // protege el pago pero no el resto.
  if (corriendo) return res;
  corriendo = true;
  try {
    for (const item of await pendingActions(userId)) {
      if (!opts.force && item.attempts >= MAX_ATTEMPTS) continue;

      const r = await send(item.action);
      if (r.status === 'ok') {
        await db.dequeue(item.id);
        res.sent += 1;
        continue;
      }
      if (r.status === 'offline' || r.status === 'auth') {
        res.stopped = r.status;
        break; // sin red o sin sesión: lo que sigue va a fallar igual
      }
      await db.markFailed(item.id, r.message);
      res.failed += 1;
    }
  } finally {
    corriendo = false;
    await refreshPendingCount(userId);
  }
  return res;
}

/** Deja el contador del indicador al día. Se llama al encolar y al terminar un drenaje. */
export async function refreshPendingCount(userId: string): Promise<number> {
  const n = await db.pendingCount(userId);
  useNetStore.getState().setPending(n);
  return n;
}

/**
 * Arranca el motor: drena ya, en cada reconexión y cada minuto con red. Devuelve el `stop` para
 * el desmontaje. **Sin red no despierta nada** — en un teléfono de gama baja bajo el sol, la
 * batería es parte de la UX (epic §3.3.2).
 */
export function startSync(userId: string): () => void {
  void drain(userId);

  let ultimaConexion = useNetStore.getState().isConnected;
  const unsub = useNetStore.subscribe((s) => {
    // Sólo el flanco de subida: de sin red a con red. Sin esto, cada cambio del store dispararía.
    if (s.isConnected && !ultimaConexion) void drain(userId);
    ultimaConexion = s.isConnected;
  });

  const timer = setInterval(() => {
    if (useNetStore.getState().isConnected) void drain(userId);
  }, CICLO_MS);

  return () => {
    unsub();
    clearInterval(timer);
  };
}
