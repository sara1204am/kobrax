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
import { todayISO } from '../agenda-form';
import { flushPendingDrafts } from '../route-draft';
import { getUserId } from '../session';
import { useNetStore } from '../store/net';
import { enqueue, pendingActions, send, stabilize, type QueuedAction, type SendResult } from './queue';
import { writeProvisionalClient, writeProvisionalCredit } from './optimistic';

/** Después de esto, el ítem queda esperando un reintento manual. */
const MAX_ATTEMPTS = 3;
/** Cada cuánto se drena mientras la app está abierta y con red. */
const CICLO_MS = 60_000;

export interface DrainResult {
  sent: number;
  failed: number;
  /** Quedó algo sin intentar porque se cortó (sin red o sesión vencida). */
  stopped: 'offline' | 'auth' | 'upgrade' | null;
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

      // Un ítem que explota (archivo ilegible, bug de una acción) NO puede tumbar el drenaje ni dejar sin subir a
      // los que siguen: se cuenta como fallo pasajero y queda a la vista con su motivo.
      let r: SendResult;
      try {
        // Los ítems viejos (sin ids) reciben un id estable ANTES de enviarse, y se guarda en la fila.
        r = await send(await stabilize(item.id, item.action));
      } catch (e) {
        r = { status: 'error', message: e instanceof Error ? e.message : 'Falló el envío' };
      }
      if (r.status === 'ok') {
        await db.dequeue(item.id);
        res.sent += 1;
        continue;
      }
      if (r.status === 'offline' || r.status === 'auth' || r.status === 'upgrade') {
        res.stopped = r.status;
        break; // sin red, sin sesión o app vieja: lo que sigue va a fallar igual (y nada se descarta ni cuenta intento)
      }
      if (r.permanent) await db.markRejected(item.id, r.message);
      else await db.markFailed(item.id, r.message);
      res.failed += 1;
    }

    // El recorrido armado en el mapa no viaja por la cola —es un estado que se sincroniza por
    // diferencia, no una acción—, pero sí tiene que reintentarse solo. Antes se quedaba en el
    // teléfono hasta que el cobrador volviera a la pantalla y tocara un pin.
    if (!res.stopped) {
      const draft = await flushPendingDrafts(userId, todayISO());
      if (draft === 'offline') res.stopped = 'offline';
    }
  } finally {
    corriendo = false;
    await refreshPendingCount(userId);
  }
  return res;
}

/**
 * Lo que usan las pantallas: guardar la acción para más tarde y dejar el contador al día.
 *
 * `true` = quedó guardada y el cobrador puede seguir trabajando; `false` = no se pudo (sin sesión),
 * y ahí sí hay que decírselo, porque su trabajo NO está a salvo.
 */
export async function queueForLater(action: QueuedAction): Promise<boolean> {
  const guardada = await enqueue(action);
  if (guardada) {
    // Que el alta offline se vea ya (búsqueda, ficha, préstamos del cliente) hasta que la cola la suba.
    // Es cosmético: si falla, el alta igual está a salvo en la cola.
    try {
      if (action.kind === 'client.create') await writeProvisionalClient(action.input);
      else if (action.kind === 'credit.create') await writeProvisionalCredit(action.input);
    } catch {
      /* ver arriba */
    }
    const userId = await getUserId();
    if (userId) await refreshPendingCount(userId);
  }
  return guardada;
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
