/**
 * Marcar un aviso como leído. Sin señal (o con la sesión vencida) queda guardado y sube solo: es de valor fijo. Nunca lanza ni
 * bloquea: marcar leído es lo más barato que hace el cobrador y no puede costarle un error.
 *
 * Vive aparte de `notifications.service` para no cerrar un ciclo: la cola importa ese servicio y esto importa la cola.
 */
import { markRead } from './notifications.service';
import { queueForLater } from './sync/sync.service';

export async function markReadOrQueue(id: string): Promise<void> {
  try {
    const res = await markRead(id);
    if (res.status === 'offline' || res.status === 'unauthenticated') await queueForLater({ kind: 'notification.read', id });
  } catch {
    /* cosmético */
  }
}
