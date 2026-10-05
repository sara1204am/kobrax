/**
 * Lo que el cobrador registra desde la ficha de mora: gestión con resultado y promesa, y nota.
 *
 * **Intenta con señal; sin ella lo guarda en el teléfono y sube solo.** Las dos llevan un `id` puesto acá
 * (`nuevoId()`) que viaja igual en el intento y en la cola: si el intento llegó al servidor pero la respuesta
 * se perdió, el reintento de la cola devuelve lo ya guardado en vez de crear una segunda gestión (con su
 * promesa) o una segunda nota. Por eso nunca se encola sin id.
 */
import type { NewCreditNote, RecoveryActivityInput, UpdateCreditNote } from '@kobrax/shared';
import type { Outcome } from './gestion-sheet';
import { nuevoId } from './ids';
import { addMoraActivity, addMoraNote, deleteMoraNote, updateMoraNote } from './mora.service';
import { queueForLater } from './sync/sync.service';

/**
 * Los resultados que ofrece la hoja de gestión en mora. **Cada par tipo/resultado tiene que estar permitido
 * por `RECOVERY_RESULTS_BY_TYPE`** (shared): el servidor rechaza el resto, y una prueba lo vigila.
 */
export const MORA_OUTCOMES: Outcome[] = [
  { key: 'call_contact', label: 'Contestó', type: 'CALL', result: 'CONTACTED' },
  { key: 'call_none', label: 'No contesta', type: 'CALL', result: 'NO_ANSWER' },
  { key: 'call_wrong', label: 'Número equivocado', type: 'CALL', result: 'WRONG_NUMBER' },
  { key: 'visit_contact', label: 'Visita: lo encontré', type: 'VISIT', result: 'CONTACTED' },
  { key: 'visit_nf', label: 'Visita: no estaba', type: 'VISIT', result: 'NOT_FOUND' },
  { key: 'visit_addr', label: 'Dirección equivocada', type: 'VISIT', result: 'WRONG_ADDRESS' },
  { key: 'refusal', label: 'Se negó a pagar', type: 'CALL', result: 'REFUSAL' },
  { key: 'promise', label: 'Promesa de pago', type: 'CALL', result: 'PROMISE_TO_PAY', promise: true },
];

const NO_GUARDADO = 'Sin conexión y no se pudo guardar en el teléfono. Reintentá.';

/** `null` = listo (enviado o guardado para subir); un texto = lo que hay que decirle al cobrador. */
export async function submitMoraActivity(creditId: string, input: RecoveryActivityInput): Promise<string | null> {
  const withId = { ...input, id: input.id ?? nuevoId() };
  const res = await addMoraActivity(creditId, withId);
  if (res.status === 'ok') return null;
  if (res.status === 'offline') return (await queueForLater({ kind: 'mora.activity', creditId, input: withId })) ? null : NO_GUARDADO;
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message;
}

export async function submitMoraNote(creditId: string, input: NewCreditNote): Promise<string | null> {
  const withId = { ...input, id: input.id ?? nuevoId() };
  const res = await addMoraNote(creditId, withId);
  if (res.status === 'ok') return null;
  if (res.status === 'offline') return (await queueForLater({ kind: 'credit.note', creditId, input: withId })) ? null : NO_GUARDADO;
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message;
}

const SIN_SENAL_NOTA = 'Corregir o borrar una nota necesita conexión: el servidor decide si podés hacerlo. Probá de nuevo con señal.';

/**
 * Corregir el texto, el tipo o el color de una nota. **Sólo en línea** (decisión): el texto y el borrado son de quien
 * la escribió o de quien reparte cartera y lo decide el servidor; encolarlo dejaría al cobrador creyendo que quedó
 * cuando después se rechaza. Sin señal se dice con claridad. `null` = listo.
 */
export async function submitNoteEdit(creditId: string, noteId: string, patch: UpdateCreditNote): Promise<string | null> {
  const res = await updateMoraNote(creditId, noteId, patch);
  if (res.status === 'ok') return null;
  if (res.status === 'offline') return SIN_SENAL_NOTA;
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message;
}

/** Borrar una nota. Sólo en línea, por lo mismo (y porque repetir un borrado ya hecho da 404). `null` = listo. */
export async function submitNoteDelete(creditId: string, noteId: string): Promise<string | null> {
  const res = await deleteMoraNote(creditId, noteId);
  if (res.status === 'ok') return null;
  if (res.status === 'offline') return SIN_SENAL_NOTA;
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message;
}
