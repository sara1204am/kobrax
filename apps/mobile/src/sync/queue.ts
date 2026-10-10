/**
 * Qué se encola y cómo se envía. La parte de **escritura** del offline.
 *
 * Todo lo que entra acá es idempotente o append-only (plan §D3): reintentarlo no duplica nada. Esa
 * es la condición para poder encolarlo — si una acción no cumple, no se encola, se pide señal.
 *
 * **Idempotencia = un id puesto por el teléfono.** Cada escritura repetible (gestión, agendado, visita, alta de
 * cliente/préstamo, nota…) lleva un `id` generado UNA vez al abrir la pantalla (`nuevoId()`), y el server
 * devuelve la fila ya guardada si lo recibe de nuevo. Los pagos usan su `Idempotency-Key`. Las ediciones de la
 * ficha viajan con valores fijos (no incrementos). Con eso un reintento —incluido el que sigue a un timeout,
 * donde no se sabe si el pedido llegó— no puede duplicar nada.
 *
 * **Los ítems de la cola son independientes entre sí.** La visita compuesta (visita + foto + cobro + promesa)
 * viaja como UNA acción porque el pago necesita el id de la visita para su clave (`visit-<id>`); pero **lo que
 * falla después de que la visita salió NO se pierde ni se reintenta junto con ella**: se re-encola como su
 * propio ítem (ver `sendVisit`). Así el que falla no arrastra a nadie y nada se descarta en silencio.
 */
import type {
  AgendaOutcome,
  AgendaPostponeStep,
  NewCreditNote,
  RecoveryActivityInput,
  RouteStatus,
  UpdateAgendaInput,
} from '@kobrax/shared';
import * as db from '../db';
import { nuevoId } from '../ids';
import { deleteQueuePhoto, persistPhoto, photoExists, type PendingPhoto } from '../queue-photos';
import { uploadImage, type UploadResult } from '../uploads.service';
import { addVisitEvidence, createVisit, type CreateVisitInput } from '../field.service';
import { createPayment, type NewPayment } from '../payments.service';
import { updateRouteStatus } from '../routes.service';
import {
  createClient,
  removeContact,
  removeLocation,
  updateClient,
  updateContact,
  updateLocation,
  type NewClientInput,
  type NewContactInput,
  type NewLocationInput,
  type UpdateClientPatch,
} from '../clients.service';
import { clearArrears, createCredit, markArrears, type ClearArrearsInput, type NewCreditInput } from '../credits.service';
import {
  addClientContact,
  addClientLocation,
  cancelItem,
  clientContextLive,
  completeItem,
  createItem,
  deleteItem,
  postponeItem,
  rescheduleItem,
  updateItem,
  type CreateAgendaInput,
  type NewClientContact,
  type NewClientLocation,
  type RescheduleAgendaInput,
} from '../agenda.service';
import { addMoraActivity, addMoraNote, setMoraPriority, type PinnablePriority } from '../mora.service';
import { getUserId } from '../session';
import { confirmProvisionalRow, dropProvisionalRow } from './optimistic';
import { withAgendaExplanation } from './agenda-conflicts';

export type { PendingPhoto } from '../queue-photos';

/**
 * Versión de la forma del payload guardado. **Falta = 0** (ítems anteriores a esta versión: sin ids ni `v`).
 * Sube cuando cambia la forma de forma incompatible; una fila con `v` mayor a ésta la escribió una app más
 * nueva y esta no sabe enviarla → queda como «no soportada» a la vista, no se manda ni se pierde.
 *  · 0 → 1: ids en todas las escrituras repetibles, `toTime` al posponer, partes sueltas de la visita.
 *
 * F4/08: se quitó `case.activity` y los `caseId` **sin subir la versión del payload** — el cambio de esquema local
 * (`SCHEMA_VERSION` 3, ver `db.ts`) borra la cola entera, así que ningún ítem viejo llega acá. Un ítem
 * `case.activity` que aparezca igual (base restaurada a mano) cae en «no soportado», visible y descartable.
 */
export const QUEUE_VERSION = 1;

/** Prefijo de los ids que el teléfono inventa para algo que todavía no existe en el server (teléfono/dirección nuevos). */
export const LOCAL_ID_PREFIX = 'local:';

export type QueuedAction =
  /**
   * La visita lleva **adentro** lo que cierra la parada: la foto, el cobro y la promesa. Es una
   * sola acción y no tres porque el pago necesita el id de la visita para su clave de idempotencia
   * (`visit-<id>`), y ese id no existe hasta que la visita sale. Si algo de eso falla DESPUÉS de que la visita
   * quedó registrada, se re-encola como ítem propio (`payment`, `agenda.create`, `visit.evidence`).
   */
  | {
      kind: 'visit';
      input: CreateVisitInput;
      photo?: PendingPhoto;
      /** La foto que ya subió con señal antes de cortarse (se sella contra la visita y es el comprobante del cobro). */
      photoUploaded?: { url: string; hash: string };
      payment?: Omit<NewPayment, 'receiptUrl' | 'receiptHash'>;
      promise?: CreateAgendaInput;
    }
  | { kind: 'payment'; input: NewPayment; idempotencyKey: string; photo?: PendingPhoto }
  | { kind: 'agenda.create'; input: CreateAgendaInput }
  /**
   * Iniciar o cerrar la jornada. Idempotente porque lleva el **estado destino**, no un incremento:
   * reintentarlo deja la ruta donde ya estaba. Sin esto, una jornada iniciada sin señal quedaba
   * `PLANNED` en el servidor y la app volvía a ofrecer "Iniciar ruta" al reconectar.
   */
  | { kind: 'route.status'; routeId: string; status: RouteStatus; /** Por qué se cierra con paradas sin gestionar (D-5). */ reason?: string }
  /**
   * Alta de cliente y de préstamo en la calle. Idempotentes porque **el id lo pone el teléfono**
   * (`nuevoId()`): si la cola reintenta, el server reconoce esa alta en vez de crear otra.
   *
   * El préstamo se encola DESPUÉS del cliente y la cola es FIFO, así que cuando le toca, su
   * cliente ya subió. Si el cliente falla, el préstamo también falla —el server no encuentra al
   * dueño— y ambos quedan para el próximo intento: nada se pierde y nada queda huérfano.
   */
  | { kind: 'client.create'; input: NewClientInput }
  | { kind: 'credit.create'; input: NewCreditInput }
  /**
   * Marcar en mora y poner al día, desde la ficha del deudor.
   *
   * Marcar es idempotente: escribe la misma fecha de arranque y no abre una segunda cobranza.
   *
   * 🔴 **Poner al día viaja con la fecha ya resuelta, nunca con el modo `next_period`.** Ese modo
   * avanza un período *desde donde esté*, así que reintentarlo correría el vencimiento dos veces y
   * el deudor se ganaría un mes. La pantalla calcula la fecha con `addPeriods` de shared —la misma
   * que usa el server— y encola `date`, que escribe un valor fijo.
   */
  | { kind: 'arrears.mark'; creditId: string; days?: number }
  | { kind: 'arrears.clear'; creditId: string; input: ClearArrearsInput }
  /** Idempotente en el server: completar una gestión ya ejecutada devuelve la misma gestión. */
  | { kind: 'agenda.complete'; id: string; outcome: AgendaOutcome; notes?: string }
  /**
   * `AgendaPostponeStep` y no `number`: posponer es en pasos fijos, y el tipo del dominio ya lo dice.
   *
   * 🔴 `toTime` es la hora **absoluta** a la que queda (calculada al encolar). Con ella un reintento deja la
   * gestión en el mismo lugar; `minutes` solo es relativo y cada repetición la correría otro tanto. Los ítems
   * viejos (sin `toTime`) siguen enviando `minutes`, que es lo único que tienen.
   */
  | { kind: 'agenda.postpone'; id: string; minutes: AgendaPostponeStep; toTime?: string }
  /**
   * Cancelar y reagendar. Un reintento no puede duplicar nada porque el server **sólo las acepta
   * sobre una gestión SCHEDULED**: si la primera ya entró, la segunda rebota con "no se puede
   * ejecutar" en vez de cancelar de nuevo o crear una segunda gestión reagendada.
   */
  | { kind: 'agenda.cancel'; id: string; reasonCode: string }
  /**
   * Editar y eliminar una gestión sin señal. El `patch` lleva todos los campos del formulario (valores, no incrementos), así que
   * repetirlo deja lo mismo. Solo quien la creó puede hacerlo: si no, el servidor rechaza (403) y la hoja de pendientes lo explica.
   */
  | { kind: 'agenda.update'; id: string; patch: UpdateAgendaInput }
  | { kind: 'agenda.delete'; id: string }
  | { kind: 'agenda.reschedule'; id: string; input: RescheduleAgendaInput }
  /**
   * Gestión con resultado y promesa sobre un crédito (al día o en mora; es la única vía de gestiones: ya no hay
   * caso). **Idempotente porque `input.id` lo pone el teléfono** (`nuevoId()`): el servidor guarda la gestión con
   * ese id y un reintento devuelve la ya guardada, así que una gestión con promesa no se duplica (ni su
   * agenda_item). Incluye el rastro de «Llamar/WhatsApp/Navegar» (una nota).
   */
  | { kind: 'mora.activity'; creditId: string; input: RecoveryActivityInput & { id: string } }
  /** Nota del crédito. Idempotente por `input.id` del teléfono; el servidor reconoce el id y no la duplica. */
  | { kind: 'credit.note'; creditId: string; input: NewCreditNote & { id: string } }
  /** Fijar (o soltar con `null`) la prioridad de un crédito. Valor fijo: reintentar deja lo mismo. */
  | { kind: 'mora.priority'; creditId: string; priority: PinnablePriority | null }
  /**
   * La foto de una visita ya registrada cuyo sellado de evidencia falló (parte suelta de `visit`). Si la foto
   * ya subió, viaja `uploaded` y no se sube de nuevo.
   */
  | { kind: 'visit.evidence'; visitId: string; photo?: PendingPhoto; uploaded?: { url: string; hash: string } }
  /**
   * Aviso, no trabajo: una foto que debía viajar con un pago o una visita ya no estaba en el teléfono (o no se
   * pudo subir). Nace rechazado y queda a la vista hasta que el cobrador lo descarta — nunca en silencio.
   */
  | { kind: 'photo.lost'; detail: string }
  /**
   * Edición de los datos sueltos del cliente: `PATCH` con valores fijos → idempotente por naturaleza.
   */
  | { kind: 'client.update'; clientId: string; patch: UpdateClientPatch }
  /**
   * Teléfonos del cliente.
   *  · `add` (desde «agendar», endpoint de agenda): **el endpoint no acepta id**, así que no es repetible a
   *    ciegas. Se vuelve repetible con búsqueda previa: antes de crear se mira si el server ya tiene ese
   *    número y, si lo tiene, se reutiliza. `localId` (`local:<uuid>`) es el nombre provisional con el que la
   *    pantalla lo ofreció; al subir se guarda `localId → id real` y un `agenda.create` que lo cita lo traduce.
   *  · `update` / `remove`: valores fijos y borrado (un 404 al borrar = ya estaba borrado).
   */
  | { kind: 'client.contact'; clientId: string; op: 'add'; localId: string; input: NewClientContact }
  | { kind: 'client.contact'; clientId: string; op: 'update'; contactId: string; input: Partial<NewContactInput> }
  | { kind: 'client.contact'; clientId: string; op: 'remove'; contactId: string }
  /** Ídem para direcciones (búsqueda previa por tipo + dirección). */
  | { kind: 'client.location'; clientId: string; op: 'add'; localId: string; input: NewClientLocation }
  | { kind: 'client.location'; clientId: string; op: 'update'; locationId: string; input: NewLocationInput }
  | { kind: 'client.location'; clientId: string; op: 'remove'; locationId: string };

/**
 * Una fila que esta versión de la app no sabe enviar: tipo desconocido, payload dañado o escrito por una app más
 * nueva. **No tira el drenaje**: se muestra, se rechaza como «no soportada» y se puede descartar.
 */
export interface UnsupportedAction {
  kind: 'unsupported';
  /** El tipo tal como estaba guardado (para el motivo que ve el cobrador). */
  rawKind: string;
  reason: string;
}

export type PendingAction = QueuedAction | UnsupportedAction;

/**
 * `ponytail:` **qué de la edición de la ficha se encola y qué no.** Se encolan los datos sueltos del cliente
 * (`client.update`) y los cambios y bajas de teléfonos/direcciones: son valores fijos, repetibles. NO se
 * encolan las altas de teléfono/dirección de `cliente/editar` (endpoint de clientes), garantes, garantías ni el
 * crédito: sus POST no aceptan id y devuelven ids que los cambios posteriores del mismo guardado necesitan, así
 * que reintentarlos a ciegas duplicaría. Esos guardados siguen pidiendo señal, y la pantalla lo dice.
 */

/** Cómo se llama cada cosa en la lista de pendientes que ve el cobrador. */
export const ACTION_LABEL: Record<QueuedAction['kind'], string> = {
  visit: 'Visita registrada',
  payment: 'Pago cobrado',
  'agenda.create': 'Gestión agendada',
  'agenda.complete': 'Gestión ejecutada',
  'agenda.postpone': 'Gestión pospuesta',
  'route.status': 'Estado de la jornada',
  'client.create': 'Cliente nuevo',
  'credit.create': 'Préstamo nuevo',
  'arrears.mark': 'Préstamo marcado en mora',
  'arrears.clear': 'Préstamo puesto al día',
  'agenda.cancel': 'Gestión cancelada',
  'agenda.update': 'Gestión editada',
  'agenda.delete': 'Gestión eliminada',
  'agenda.reschedule': 'Gestión reagendada',
  'mora.activity': 'Gestión registrada',
  'credit.note': 'Nota del crédito',
  'mora.priority': 'Prioridad del crédito',
  'visit.evidence': 'Foto de la visita',
  'photo.lost': 'Foto que no se pudo adjuntar',
  'client.update': 'Datos del cliente',
  'client.contact': 'Teléfono del cliente',
  'client.location': 'Dirección del cliente',
};

/** El texto de la lista de pendientes para cualquier tipo, incluidos los que esta versión no conoce. */
export function actionLabel(kind: string): string {
  return (ACTION_LABEL as Record<string, string | undefined>)[kind] ?? 'Acción pendiente (no soportada)';
}

const KNOWN_KINDS = new Set<string>(Object.keys(ACTION_LABEL));

/** Las fotos de la cola que cuelgan de una acción (para borrar sus copias al descartarla). */
function photosOf(action: PendingAction): PendingPhoto[] {
  if (action.kind === 'visit' || action.kind === 'payment' || action.kind === 'visit.evidence') {
    return action.photo ? [action.photo] : [];
  }
  return [];
}

/**
 * Guarda la acción para subirla después. **No recibe el userId**: lo saca de la sesión guardada,
 * que es lo único disponible en modo avión — preguntarle al server quién es no es una opción.
 *
 * Devuelve `false` si no hay sesión: sin dueño no se encola nada, porque después no habría forma
 * de saber de quién es ese pago.
 *
 * Si la acción lleva una foto, se copia a un directorio durable de la app (ver `queue-photos.ts`) y se encola
 * esa ruta: la de la cámara está en caché y el sistema puede borrarla antes de que haya señal.
 */
export async function enqueue(action: QueuedAction): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;
  let stored = action;
  if ((action.kind === 'visit' || action.kind === 'payment' || action.kind === 'visit.evidence') && action.photo) {
    stored = { ...action, photo: await persistPhoto(action.photo) };
  }
  await db.enqueue({
    userId,
    kind: stored.kind,
    payload: { ...stored, v: QUEUE_VERSION },
    idempotencyKey: stored.kind === 'payment' ? stored.idempotencyKey : undefined,
  });
  return true;
}

/** Un ítem que nace rechazado (un aviso persistente). Falla en silencio sólo si ni siquiera hay sesión. */
async function enqueueRejected(action: QueuedAction, message: string): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;
  const id = await db.enqueue({ userId, kind: action.kind, payload: { ...action, v: QUEUE_VERSION } });
  await db.markRejected(id, message);
  return true;
}

/**
 * Descarta un ítem a pedido del cobrador (sólo para lo rechazado o no soportado, ver `pendientes`): borra la
 * fila y las copias de fotos que colgaban de ella. Es lo único que borra algo de la cola sin que haya subido.
 */
export async function discardPending(rowId: number, action: PendingAction): Promise<void> {
  for (const p of photosOf(action)) await deleteQueuePhoto(p.uri);
  try {
    if (action.kind === 'client.create' && action.input.id) await dropProvisionalRow('client', action.input.id);
    if (action.kind === 'credit.create' && action.input.id) await dropProvisionalRow('credit', action.input.id, action.input.clientId);
  } catch {
    // Quitar la fila provisional es cosmético: la próxima hidratación la limpia.
  }
  await db.dequeue(rowId);
}

/**
 * Completa los ids que le faltan a una acción guardada **antes** de existir los ids (`v` 0). Si faltaba alguno
 * se devuelve una acción NUEVA (y quien la llama la persiste, ver `stabilize`); si no, la misma.
 */
export function withStableIds(action: PendingAction): PendingAction {
  switch (action.kind) {
    case 'agenda.create':
      return action.input.id ? action : { ...action, input: { ...action.input, id: nuevoId() } };
    case 'client.create':
      return action.input.id ? action : { ...action, input: { ...action.input, id: nuevoId() } };
    case 'credit.create':
      return action.input.id ? action : { ...action, input: { ...action.input, id: nuevoId() } };
    case 'visit': {
      const needsVisit = !action.input.id;
      const needsPromise = !!action.promise && !action.promise.id;
      if (!needsVisit && !needsPromise) return action;
      return {
        ...action,
        input: needsVisit ? { ...action.input, id: nuevoId() } : action.input,
        promise: action.promise && needsPromise ? { ...action.promise, id: nuevoId() } : action.promise,
      };
    }
    default:
      return action;
  }
}

/**
 * Antes de enviar un ítem viejo (guardado sin ids) se le genera un id estable y **se guarda en la fila ANTES de
 * mandarlo**: si el envío se corta, el reintento usa ese mismo id y el server no duplica.
 */
export async function stabilize(rowId: number, action: PendingAction): Promise<PendingAction> {
  const next = withStableIds(action);
  if (next !== action) await db.updatePayload(rowId, { ...next, v: QUEUE_VERSION });
  return next;
}

/** Lo que puede pasarle a un envío. `auth` corta el drenaje entero: sin sesión no sube nada más. */
/**
 * `permanent`: el server **rechazó** la acción (un 4xx: datos inválidos, sin permiso, ya no aplica).
 * Reintentarla no la arregla —el mismo pedido recibe la misma respuesta—, así que no se reintenta sola:
 * queda a la vista con su motivo. Un 5xx o un 408/429 son pasajeros y sí se reintentan.
 *
 * `offline` cubre «no hay red» Y «el server no contestó a tiempo»; `outcomeUnknown` marca lo segundo (el pedido
 * pudo haber llegado). Para la cola son lo mismo —reintentable— y es seguro por los ids (ver el tope del archivo).
 */
export type SendResult =
  | { status: 'ok' }
  | { status: 'offline'; outcomeUnknown?: boolean }
  | { status: 'auth' }
  /** 426: esta versión de la app ya no es compatible. No es un rechazo: lo pendiente espera a que se actualice. */
  | { status: 'upgrade' }
  | { status: 'error'; message: string; permanent?: boolean; code?: string };

const LOST_PHOTO = 'La foto ya no está en el teléfono (el sistema la borró). Descartá este aviso.';

function unsupported(rawKind: string, reason: string): UnsupportedAction {
  return { kind: 'unsupported', rawKind, reason };
}

/**
 * Sube una acción. Es el único lugar que sabe traducir lo guardado a llamadas del API — y usa
 * **los mismos services que las pantallas**, no un cliente HTTP propio.
 */
export async function send(action: PendingAction): Promise<SendResult> {
  switch (action.kind) {
    case 'unsupported':
      return { status: 'error', message: `No soportado: ${action.reason}`, permanent: true };
    case 'visit':
      return sendVisit(action);
    case 'visit.evidence': {
      let foto = action.uploaded;
      if (!foto) {
        if (!action.photo) return { status: 'error', message: 'La foto de la visita no se guardó en el teléfono.', permanent: true };
        if (!(await photoExists(action.photo.uri))) return { status: 'error', message: LOST_PHOTO, permanent: true };
        const up = await uploadImage(action.photo.uri, action.photo.mimeType);
        if (up.status !== 'ok') return mapUpload(up);
        foto = { url: up.url, hash: up.hash };
      }
      const ev = await addVisitEvidence(action.visitId, { type: 'PHOTO', fileUrl: foto.url, fileHash: foto.hash });
      if (ev.status === 'ok') await deleteQueuePhoto(action.photo?.uri);
      return mapMutate(ev);
    }
    case 'photo.lost':
      return { status: 'error', message: action.detail, permanent: true };
    case 'payment': {
      // Si hay comprobante, se sube primero: el pago lo referencia.
      let input = action.input;
      if (action.photo && !input.receiptUrl) {
        if (!(await photoExists(action.photo.uri))) {
          // El cobro es plata: sale igual, sin comprobante, y el aviso queda a la vista (nunca en silencio).
          await enqueueRejected({ kind: 'photo.lost', detail: `Un cobro subió sin su comprobante: ${LOST_PHOTO}` }, LOST_PHOTO);
        } else {
          const subida = await uploadImage(action.photo.uri, action.photo.mimeType);
          if (subida.status === 'ok') input = { ...input, receiptUrl: subida.url, receiptHash: subida.hash };
          else if (subida.status === 'offline' || subida.status === 'unauthenticated') return mapUpload(subida);
          else await enqueueRejected({ kind: 'photo.lost', detail: `Un cobro subió sin su comprobante: ${subida.message}` }, subida.message);
        }
      }
      // La clave de idempotencia es **la de cuando se encoló**: reintentar no vuelve a cobrar.
      const res = await createPayment(input, action.idempotencyKey);
      if (res.status === 'ok') await deleteQueuePhoto(action.photo?.uri);
      return mapMutate(res);
    }
    case 'agenda.create': {
      const resolved = await resolveLocalIds(action.input);
      if ('wait' in resolved) return { status: 'error', message: resolved.wait };
      return mapMutate(await createItem(resolved.input));
    }
    case 'route.status':
      return mapMutate(await updateRouteStatus(action.routeId, action.status, action.reason));
    case 'client.create': {
      const res = await createClient(action.input);
      if (res.status === 'ok' && action.input.id) await confirmProvisional('client', action.input.id);
      return mapMutate(res);
    }
    case 'credit.create': {
      const res = await createCredit(action.input);
      if (res.status === 'ok' && action.input.id) await confirmProvisional('credit', action.input.id, action.input.clientId);
      return mapMutate(res);
    }
    case 'arrears.mark':
      return mapMutate(await markArrears(action.creditId, action.days));
    case 'arrears.clear':
      return mapMutate(await clearArrears(action.creditId, action.input));
    // Las cuatro acciones sobre una gestión existente pueden chocar con lo que otra persona hizo mientras no había señal: si el
    // servidor las rechaza, la hoja de pendientes explica QUÉ pasó (`agenda-conflicts.ts`) en vez de repetir el mensaje crudo.
    case 'agenda.complete': {
      const res = await completeItem(action.id, action.outcome, action.notes);
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'agenda.postpone': {
      const res = await postponeItem(action.id, action.minutes, action.toTime);
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'agenda.cancel': {
      const res = await cancelItem(action.id, action.reasonCode);
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'agenda.update': {
      const res = await updateItem(action.id, action.patch);
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'agenda.delete': {
      // Un 404 es «ya no existe»: eliminada (por este mismo pedido que se repitió) o por otra persona. Es el resultado buscado.
      const res = await deleteItem(action.id);
      if (res.status === 'error' && res.httpStatus === 404) return { status: 'ok' };
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'agenda.reschedule': {
      const res = await rescheduleItem(action.id, action.input);
      return withAgendaExplanation(mapMutate(res), httpStatusOf(res));
    }
    case 'mora.activity':
      return mapMutate(await addMoraActivity(action.creditId, action.input));
    case 'mora.priority':
      return mapMutate(await setMoraPriority(action.creditId, action.priority));
    case 'credit.note':
      return mapMutate(await addMoraNote(action.creditId, action.input));
    case 'client.update':
      return mapMutate(await updateClient(action.clientId, action.patch));
    case 'client.contact':
      return sendClientContact(action);
    case 'client.location':
      return sendClientLocation(action);
  }
}

// ── Visita compuesta ──────────────────────────────────────────────────────────

/**
 * Visita + foto + cobro + promesa, en ese orden. La visita es lo que decide el resultado del ítem; **lo demás ya
 * no puede hacerlo fallar**: repetir toda la acción duplicaría la parada visitada. Lo que no salga se
 * RE-ENCOLA como ítem propio (el cobro con su misma clave de idempotencia, la promesa con su id, la foto como
 * `visit.evidence`) y queda a la vista en pendientes — antes se descartaba en silencio.
 */
async function sendVisit(action: Extract<QueuedAction, { kind: 'visit' }>): Promise<SendResult> {
  const visita = await createVisit(action.input);
  if (visita.status !== 'ok') return mapMutate(visita);
  const visitId = visita.data.id;

  const resto: QueuedAction[] = [];
  const avisos: { action: QueuedAction; message: string }[] = [];

  let foto: { url: string; hash: string } | undefined = action.photoUploaded;
  if (foto) {
    const ev = await addVisitEvidence(visitId, { type: 'PHOTO', fileUrl: foto.url, fileHash: foto.hash });
    if (ev.status !== 'ok') resto.push({ kind: 'visit.evidence', visitId, uploaded: foto });
  } else if (action.photo) {
    if (!(await photoExists(action.photo.uri))) {
      avisos.push({ action: { kind: 'photo.lost', detail: `La foto de una visita no se adjuntó: ${LOST_PHOTO}` }, message: LOST_PHOTO });
    } else {
      const subida = await uploadImage(action.photo.uri, action.photo.mimeType);
      if (subida.status === 'ok') {
        foto = { url: subida.url, hash: subida.hash };
        const ev = await addVisitEvidence(visitId, { type: 'PHOTO', fileUrl: foto.url, fileHash: foto.hash });
        // Subió: la copia del teléfono ya no hace falta; si el sellado falló se reintenta con la URL, sin re-subir.
        await deleteQueuePhoto(action.photo.uri);
        if (ev.status !== 'ok') resto.push({ kind: 'visit.evidence', visitId, uploaded: foto });
      } else {
        resto.push({ kind: 'visit.evidence', visitId, photo: action.photo });
      }
    }
  }

  if (action.payment) {
    // La llave sale de la visita, que el server creó una sola vez: reintentar no cobra dos veces.
    const input: NewPayment = { ...action.payment, receiptUrl: foto?.url, receiptHash: foto?.hash, visitId };
    const key = `visit-${visitId}`;
    const pago = await createPayment(input, key);
    if (pago.status !== 'ok') resto.push({ kind: 'payment', input, idempotencyKey: key });
  }

  if (action.promise) {
    const promise = action.promise.id ? action.promise : { ...action.promise, id: nuevoId() };
    const prom = await createItem(promise);
    if (prom.status !== 'ok') resto.push({ kind: 'agenda.create', input: promise });
  }

  for (const a of avisos) await enqueueRejected(a.action, a.message);
  for (const a of resto) {
    if (!(await enqueue(a))) {
      // Sin sesión no hay dónde guardarlas. Se devuelve un fallo pasajero: la visita se repite con su mismo id
      // (el server devuelve la ya creada), el cobro con su misma clave y la promesa con su mismo id.
      return { status: 'error', message: 'No se pudo guardar en el teléfono lo que faltaba de la visita.' };
    }
  }
  return { status: 'ok' };
}

// ── Teléfonos y direcciones del cliente ───────────────────────────────────────

const idMapKey = (localId: string) => `idmap:${localId}`;

/**
 * Traduce los ids provisionales (`local:…`) de un agendado a los reales. Si el teléfono/dirección todavía no
 * subió, devuelve `wait`: es un fallo pasajero, no un rechazo — el ítem espera su turno.
 */
async function resolveLocalIds(input: CreateAgendaInput): Promise<{ input: CreateAgendaInput } | { wait: string }> {
  const details = (input.details ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of ['contactId', 'locationId'] as const) {
    const value = details[field];
    if (typeof value !== 'string' || !value.startsWith(LOCAL_ID_PREFIX)) continue;
    const real = await db.getMeta(idMapKey(value));
    if (!real) {
      return { wait: field === 'contactId' ? 'Espera a que suba el teléfono nuevo del cliente.' : 'Espera a que suba la dirección nueva del cliente.' };
    }
    patch[field] = real;
  }
  if (Object.keys(patch).length === 0) return { input };
  return { input: { ...input, details: { ...input.details, ...patch } } };
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
/** Mismo número aunque uno traiga el prefijo de país («+591 700-12345» = «70012345»). Con menos de 7 dígitos, sólo igualdad exacta. */
function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 7 && (x.endsWith(y) || y.endsWith(x));
}
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

async function sendClientContact(action: Extract<QueuedAction, { kind: 'client.contact' }>): Promise<SendResult> {
  if (action.op === 'update') return mapMutate(await updateContact(action.clientId, action.contactId, action.input));
  if (action.op === 'remove') return mapGone(await removeContact(action.clientId, action.contactId));

  if (await db.getMeta(idMapKey(action.localId))) return { status: 'ok' }; // ya subió (se perdió el borrado de la fila)
  // El endpoint no acepta id: antes de crear se mira si el server ya lo tiene (un intento anterior que llegó).
  const ctx = await clientContextLive(action.clientId);
  if (ctx.status === 'offline') return { status: 'offline' };
  if (ctx.status === 'unauthenticated') return { status: 'auth' };
  if (ctx.status === 'ok') {
    const igual = ctx.data.contacts.find(
      (c) => c.contactType === action.input.contactType && samePhone(c.value, action.input.value),
    );
    if (igual) {
      await db.setMeta(idMapKey(action.localId), igual.id);
      return { status: 'ok' };
    }
  }
  const res = await addClientContact(action.clientId, action.input);
  if (res.status === 'ok') await db.setMeta(idMapKey(action.localId), res.data.id);
  return mapMutate(res);
}

async function sendClientLocation(action: Extract<QueuedAction, { kind: 'client.location' }>): Promise<SendResult> {
  if (action.op === 'update') return mapMutate(await updateLocation(action.clientId, action.locationId, action.input));
  if (action.op === 'remove') return mapGone(await removeLocation(action.clientId, action.locationId));

  if (await db.getMeta(idMapKey(action.localId))) return { status: 'ok' };
  const ctx = await clientContextLive(action.clientId);
  if (ctx.status === 'offline') return { status: 'offline' };
  if (ctx.status === 'unauthenticated') return { status: 'auth' };
  if (ctx.status === 'ok') {
    const igual = ctx.data.locations.find(
      (l) => l.locationType === action.input.locationType && norm(l.address) === norm(action.input.address),
    );
    if (igual) {
      await db.setMeta(idMapKey(action.localId), igual.id);
      return { status: 'ok' };
    }
  }
  const res = await addClientLocation(action.clientId, action.input);
  if (res.status === 'ok') await db.setMeta(idMapKey(action.localId), res.data.id);
  return mapMutate(res);
}

// ── Lo provisional se confirma al subir ───────────────────────────────────────

/** Cuando el alta offline sube, la fila provisional deja de estar marcada como pendiente. No hace fallar el envío. */
async function confirmProvisional(kind: 'client' | 'credit', id: string, clientId?: string): Promise<void> {
  try {
    await confirmProvisionalRow(kind, id, clientId);
  } catch {
    // Es cosmética: la próxima hidratación reemplaza la fila igual.
  }
}

// ── Mapeo de resultados ───────────────────────────────────────────────────────

/** El código HTTP de un rechazo, si lo hubo. */
function httpStatusOf(res: { status: string; httpStatus?: number }): number | undefined {
  return res.status === 'error' ? res.httpStatus : undefined;
}

function mapMutate(res: { status: string; message?: string; httpStatus?: number; reason?: string; code?: string }): SendResult {
  if (res.status === 'ok') return { status: 'ok' };
  if (res.status === 'offline') return res.reason === 'timeout' ? { status: 'offline', outcomeUnknown: true } : { status: 'offline' };
  if (res.status === 'unauthenticated') return { status: 'auth' };
  // El corte de versión no descarta nada: el drenaje se detiene y la cola espera a la actualización.
  if (res.status === 'error' && res.httpStatus === 426) return { status: 'upgrade' };
  return { status: 'error', message: res.message ?? 'No se pudo subir', permanent: isPermanentRejection(res.httpStatus), ...(res.code ? { code: res.code } : {}) };
}

/** Un DELETE que devuelve 404 ya está hecho: no es un error. */
function mapGone(res: { status: string; message?: string; httpStatus?: number; reason?: string }): SendResult {
  if (res.status === 'error' && res.httpStatus === 404) return { status: 'ok' };
  return mapMutate(res);
}

function mapUpload(up: Exclude<UploadResult, { status: 'ok' }>): SendResult {
  if (up.status === 'offline') return { status: 'offline' };
  if (up.status === 'unauthenticated') return { status: 'auth' };
  return { status: 'error', message: up.message };
}

/**
 * Un 4xx es definitivo, salvo el timeout (408), el «más despacio» (429) y el **corte de versión (426)**, que son del momento
 * y no dicen nada sobre la acción: descartar una cobranza porque la app quedó vieja sería perderla.
 */
export function isPermanentRejection(httpStatus: number | undefined): boolean {
  return httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429 && httpStatus !== 426;
}

/**
 * Lo pendiente, ya deserializado, para pintarlo en la hoja de pendientes. **Nunca tira**: una fila dañada o de un
 * tipo que esta versión no conoce vuelve como `unsupported` y se muestra igual (con su motivo y «Descartar»).
 */
export async function pendingActions(userId: string): Promise<
  { id: number; action: PendingAction; attempts: number; lastError: string | null; createdAt: number }[]
> {
  const rows = await db.pending(userId);
  return rows.map((r) => ({
    id: r.id,
    action: parseAction(r),
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
  }));
}

/** Deserializa una fila. Separado y exportado para probarlo sin base. */
export function parseAction(r: { kind: string; payload: string }): PendingAction {
  let raw: unknown;
  try {
    raw = JSON.parse(r.payload);
  } catch {
    return unsupported(r.kind, 'el dato guardado está dañado y no se puede leer.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return unsupported(r.kind, 'el dato guardado está dañado y no se puede leer.');
  }
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' ? obj.kind : r.kind;
  if (!KNOWN_KINDS.has(kind)) return unsupported(kind, 'este tipo de acción no lo conoce esta versión de la app.');
  const v = typeof obj.v === 'number' ? obj.v : 0; // sin `v` = ítem anterior al versionado
  if (v > QUEUE_VERSION) return unsupported(kind, 'la guardó una versión más nueva de la app. Actualizá la app para enviarla.');
  const { v: _v, ...rest } = obj;
  return { ...rest, kind } as unknown as QueuedAction;
}
