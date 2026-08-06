/**
 * Qué se encola y cómo se envía. La parte de **escritura** del offline.
 *
 * Todo lo que entra acá es idempotente o append-only (plan §D3): reintentarlo no duplica nada. Esa
 * es la condición para poder encolarlo — si una acción no cumple, no se encola, se pide señal.
 *
 * **Los ítems de la cola son independientes entre sí.** Por eso la foto de una visita viaja DENTRO
 * de la visita y no como un ítem aparte: si fueran dos, el segundo dependería de que el primero
 * hubiera salido bien, y una cola con dependencias entre ítems necesita un grafo, reintentos
 * encadenados y un orden que respetar. Acá el que falla se saltea y no arrastra a nadie.
 */
import type { AgendaOutcome, AgendaPostponeStep } from '@kobrax/shared';
import * as db from '../db';
import { uploadImage } from '../uploads.service';
import { addVisitEvidence, createVisit, type CreateVisitInput } from '../field.service';
import { createPayment, type NewPayment } from '../payments.service';
import { completeItem, createItem, postponeItem, type CreateAgendaInput } from '../agenda.service';
import { getUserId } from '../session';

/** Una foto todavía en el teléfono. Se sube al drenar; **se guarda la ruta, no los bytes**. */
export interface PendingPhoto {
  uri: string;
  mimeType?: string;
}

export type QueuedAction =
  /**
   * La visita lleva **adentro** lo que cierra la parada: la foto, el cobro y la promesa. Es una
   * sola acción y no tres porque el pago necesita el id de la visita para su clave de idempotencia
   * (`visit-<id>`), y ese id no existe hasta que la visita sale. Encolándolas juntas, la clave se
   * arma al enviar y reintentar sigue sin poder cobrarle dos veces al deudor.
   */
  | {
      kind: 'visit';
      input: CreateVisitInput;
      photo?: PendingPhoto;
      payment?: Omit<NewPayment, 'receiptUrl' | 'receiptHash'>;
      promise?: CreateAgendaInput;
    }
  | { kind: 'payment'; input: NewPayment; idempotencyKey: string; photo?: PendingPhoto }
  | { kind: 'agenda.create'; input: CreateAgendaInput }
  | { kind: 'agenda.complete'; id: string; outcome: AgendaOutcome; notes?: string }
  // `AgendaPostponeStep` y no `number`: posponer es en pasos fijos, y el tipo del dominio ya lo
  // dice. Guardar un número libre dejaría entrar a la cola algo que el server va a rechazar.
  | { kind: 'agenda.postpone'; id: string; minutes: AgendaPostponeStep };

/** Cómo se llama cada cosa en la lista de pendientes que ve el cobrador. */
export const ACTION_LABEL: Record<QueuedAction['kind'], string> = {
  visit: 'Visita registrada',
  payment: 'Pago cobrado',
  'agenda.create': 'Gestión agendada',
  'agenda.complete': 'Gestión ejecutada',
  'agenda.postpone': 'Gestión pospuesta',
};

/**
 * Guarda la acción para subirla después. **No recibe el userId**: lo saca de la sesión guardada,
 * que es lo único disponible en modo avión — preguntarle al server quién es no es una opción.
 *
 * Devuelve `false` si no hay sesión: sin dueño no se encola nada, porque después no habría forma
 * de saber de quién es ese pago.
 */
export async function enqueue(action: QueuedAction): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;
  await db.enqueue({
    userId,
    kind: action.kind,
    payload: action,
    idempotencyKey: action.kind === 'payment' ? action.idempotencyKey : undefined,
  });
  return true;
}

/** Lo que puede pasarle a un envío. `auth` corta el drenaje entero: sin sesión no sube nada más. */
export type SendResult = { status: 'ok' } | { status: 'offline' } | { status: 'auth' } | { status: 'error'; message: string };

/**
 * Sube una acción. Es el único lugar que sabe traducir lo guardado a llamadas del API — y usa
 * **los mismos services que las pantallas**, no un cliente HTTP propio.
 */
export async function send(action: QueuedAction): Promise<SendResult> {
  switch (action.kind) {
    case 'visit': {
      const visita = await createVisit(action.input);
      if (visita.status !== 'ok') return mapMutate(visita);

      // Desde acá, la visita YA quedó registrada en el server. Nada de lo que siga puede devolver
      // un fallo que haga reintentar toda la acción: repetirla duplicaría la parada visitada.
      let foto: { url: string; hash: string } | undefined;
      if (action.photo) {
        const subida = await uploadImage(action.photo.uri, action.photo.mimeType);
        if (subida.status === 'ok') {
          foto = { url: subida.url, hash: subida.hash };
          await addVisitEvidence(visita.data.id, { type: 'PHOTO', fileUrl: foto.url, fileHash: foto.hash });
        }
      }

      if (action.payment) {
        // La llave sale de la visita, que el server creó una sola vez: reintentar no cobra dos veces.
        await createPayment(
          { ...action.payment, receiptUrl: foto?.url, receiptHash: foto?.hash },
          `visit-${visita.data.id}`,
        );
      }

      if (action.promise) await createItem(action.promise);

      return { status: 'ok' };
    }
    case 'payment': {
      // Si hay comprobante, se sube primero: el pago lo referencia.
      let input = action.input;
      if (action.photo && !input.receiptUrl) {
        const subida = await uploadImage(action.photo.uri, action.photo.mimeType);
        if (subida.status === 'ok') input = { ...input, receiptUrl: subida.url, receiptHash: subida.hash };
      }
      // La clave de idempotencia es **la de cuando se encoló**: reintentar no vuelve a cobrar.
      return mapMutate(await createPayment(input, action.idempotencyKey));
    }
    case 'agenda.create':
      return mapMutate(await createItem(action.input));
    case 'agenda.complete':
      return mapMutate(await completeItem(action.id, action.outcome, action.notes));
    case 'agenda.postpone':
      return mapMutate(await postponeItem(action.id, action.minutes));
  }
}

function mapMutate(res: { status: string; message?: string }): SendResult {
  if (res.status === 'ok') return { status: 'ok' };
  if (res.status === 'offline') return { status: 'offline' };
  if (res.status === 'unauthenticated') return { status: 'auth' };
  return { status: 'error', message: res.message ?? 'No se pudo subir' };
}

/** Lo pendiente, ya deserializado, para pintarlo en la hoja de pendientes. */
export async function pendingActions(userId: string): Promise<
  { id: number; action: QueuedAction; attempts: number; lastError: string | null; createdAt: number }[]
> {
  const rows = await db.pending(userId);
  return rows.map((r) => ({
    id: r.id,
    action: JSON.parse(r.payload) as QueuedAction,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
  }));
}
