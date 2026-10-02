import { addActivity, type NewActivity } from './cases.service';
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
  const res = await addActivity(caseId, input);
  if (res.status === 'offline') await queueForLater({ kind: 'case.activity', caseId, input });
}
