import { addActivity, type NewActivity } from './cases.service';
import { nuevoId } from './ids';
import { queueForLater } from './sync/sync.service';

/**
 * Deja constancia de que se llamó, se escribió por WhatsApp o se fue a la dirección. Sin señal se
 * encola: son las tres acciones más usadas en la calle, y perderlas dejaba el historial del deudor
 * sin rastro de que el cobrador lo intentó — que es justo lo que después se le reclama.
 *
 * No espera ni avisa: es un rastro, no la acción principal. Lo que el cobrador pidió (llamar, abrir
 * el mapa) ya está pasando. (Salió de `cliente/[id].tsx`; la ficha de mora lo usa también.)
 */
export async function registrarRastro(caseId: string, input: NewActivity): Promise<void> {
  // El id se fija ANTES del primer intento y es el mismo en el envío y en la cola: si el server guardó el
  // rastro pero la respuesta se perdió (timeout), el reintento no lo duplica en el historial del deudor.
  const withId = { ...input, id: input.id ?? nuevoId() };
  const res = await addActivity(caseId, withId);
  if (res.status === 'offline') await queueForLater({ kind: 'case.activity', caseId, input: withId });
}
