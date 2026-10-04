/**
 * Qué de «Editar cliente» puede esperar señal en la cola, y cómo se traduce.
 *
 * Sólo viaja lo que **se puede repetir sin duplicar**: los datos sueltos del cliente (`PATCH` con valores fijos),
 * los cambios de teléfonos/direcciones que ya existen (`PATCH` con valores fijos) y sus bajas (`DELETE`; un 404
 * al repetir = ya estaba borrado). Las ALTAS de teléfono/dirección de esta pantalla, los garantes, las garantías y
 * el crédito no: sus `POST` no aceptan id y devuelven ids que los cambios siguientes del mismo guardado usan, así
 * que reintentarlos a ciegas duplicaría. Si el guardado trae algo de eso, no se encola NADA (la pantalla pide
 * señal): subir sólo una parte y perder el resto sin avisar es peor que no guardar.
 */
import type { ClienteOps } from './cliente-diff';
import { contactPayload, locationPayload } from './cliente-form';
import type { QueuedAction } from './sync/queue';

/** ¿Todo lo que cambió se puede encolar? */
export function queueableOps(ops: ClienteOps): boolean {
  const sinCambios = <T extends { add: unknown[]; update: unknown[]; removeIds: string[] }>(r: T) =>
    r.add.length === 0 && r.update.length === 0 && r.removeIds.length === 0;
  return (
    ops.contacts.add.length === 0 &&
    ops.locations.add.length === 0 &&
    sinCambios(ops.relations) &&
    sinCambios(ops.collaterals) &&
    sinCambios(ops.relationContacts) &&
    sinCambios(ops.relationLocations)
  );
}

/** Las acciones de cola equivalentes, en el mismo orden que `applyOps` (primero las bajas). Sólo con `queueableOps`. */
export function opsToActions(clientId: string, ops: ClienteOps): QueuedAction[] {
  const actions: QueuedAction[] = [];
  if (ops.client) actions.push({ kind: 'client.update', clientId, patch: ops.client });
  for (const contactId of ops.contacts.removeIds) actions.push({ kind: 'client.contact', clientId, op: 'remove', contactId });
  for (const locationId of ops.locations.removeIds) actions.push({ kind: 'client.location', clientId, op: 'remove', locationId });
  for (const c of ops.contacts.update) {
    actions.push({ kind: 'client.contact', clientId, op: 'update', contactId: c.serverId!, input: contactPayload(c) });
  }
  for (const l of ops.locations.update) {
    actions.push({ kind: 'client.location', clientId, op: 'update', locationId: l.serverId!, input: locationPayload(l) });
  }
  return actions;
}
