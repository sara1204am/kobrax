import { nuevoId } from './ids';
import { addMoraActivity } from './mora.service';
import { queueForLater } from './sync/sync.service';

/** Qué hizo el cobrador al tocar el botón: la nota que queda en el historial del crédito. */
const TRACE_NOTE = { call: 'Llamada', whatsapp: 'WhatsApp', navigate: 'Navegación' } as const;
export type TraceKind = keyof typeof TRACE_NOTE;

/**
 * Deja constancia de que se llamó, se escribió por WhatsApp o se fue a la dirección. Sin señal se
 * encola: son las tres acciones más usadas en la calle, y perderlas dejaba el historial del deudor
 * sin rastro de que el cobrador lo intentó — que es justo lo que después se le reclama.
 *
 * Va por crédito (`POST /mora/:creditId/activities`), esté o no en mora: el rastro de una llamada
 * preventiva a un crédito al día es historial igual que el de uno vencido.
 *
 * 🔴 **Es una NOTA, no una llamada.** El validador compartido (`validateRecoveryActivity`) exige un resultado
 * para CALL/MESSAGE/VISIT, y tocar «Llamar» no sabe si contestaron: inventar `CONTACTED` mentiría en el
 * historial. Una nota sólo lleva texto, así que es lo único honesto. El resultado real lo registra el cobrador
 * con «Registrar gestión».
 *
 * No espera ni avisa: es un rastro, no la acción principal. Lo que el cobrador pidió (llamar, abrir
 * el mapa) ya está pasando. (Salió de `cliente/[id].tsx`; la ficha de mora lo usa también.)
 */
export async function registrarRastro(creditId: string, kind: TraceKind): Promise<void> {
  // El id se fija ANTES del primer intento y es el mismo en el envío y en la cola: si el server guardó el
  // rastro pero la respuesta se perdió (timeout), el reintento no lo duplica en el historial del deudor.
  const input = { id: nuevoId(), type: 'NOTE', notes: TRACE_NOTE[kind] };
  const res = await addMoraActivity(creditId, input);
  if (res.status === 'offline') await queueForLater({ kind: 'mora.activity', creditId, input });
}
