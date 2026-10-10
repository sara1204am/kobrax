/**
 * Qué de «Editar cliente» puede esperar señal en la cola, y cómo se traduce.
 *
 * Sólo viaja lo que **se puede repetir sin duplicar**: los datos sueltos del cliente (`PATCH` con valores fijos),
 * los cambios de teléfonos/direcciones que ya existen (`PATCH` con valores fijos) y sus bajas (`DELETE`; un 404
 * al repetir = ya estaba borrado). Las ALTAS de teléfono (celular/WhatsApp) y de dirección (sin fotos) también: la cola
 * las busca antes de crearlas, así que repetirlas no duplica. Los garantes, las garantías y
 * el crédito no: sus `POST` no aceptan id y devuelven ids que los cambios siguientes del mismo guardado usan, así
 * que reintentarlos a ciegas duplicaría. Si el guardado trae algo de eso, no se encola NADA (la pantalla pide
 * señal): subir sólo una parte y perder el resto sin avisar es peor que no guardar.
 */
import type { ClienteOps } from '@kobrax/shared';
import { contactPayload, locationPayload } from '@kobrax/shared';
import { nuevoId } from './ids';
import { LOCAL_ID_PREFIX, type QueuedAction } from './sync/queue';
import type { ClientLocationType, NewClientContact, NewClientLocation } from './agenda.service';

/**
 * Un teléfono nuevo que la cola sabe subir: celular o WhatsApp, con su número. Va por `POST /agenda/clients/:id/contacts`, que
 * no pide `client:write` y que la cola repite sin duplicar (busca antes de crear). Un correo no entra.
 */
export function contactAddAction(clientId: string, c: ContactRowLike): QueuedAction | null {
  if (c.contactType === 'EMAIL') return null;
  const value = c.value.trim();
  if (!value) return null;
  const input: NewClientContact = { contactType: c.hasWhatsApp ? 'WHATSAPP' : 'PHONE', value };
  return { kind: 'client.contact', clientId, op: 'add', localId: `${LOCAL_ID_PREFIX}${nuevoId()}`, input };
}

/** Una dirección nueva que la cola sabe subir: con texto y **sin fotos** (ese endpoint no las lleva). */
export function locationAddAction(clientId: string, l: LocationRowLike): QueuedAction | null {
  const address = l.address.trim();
  if (!address || (l.photoUrls ?? []).length > 0) return null;
  const lat = Number(l.latitude);
  const lng = Number(l.longitude);
  const input: NewClientLocation = {
    locationType: l.locationType as ClientLocationType,
    address,
    ...(l.zone.trim() ? { zone: l.zone.trim() } : {}),
    ...(l.latitude.trim() && l.longitude.trim() && Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : {}),
    ...(l.referenceNotes.trim() ? { referenceNotes: l.referenceNotes.trim() } : {}),
  };
  return { kind: 'client.location', clientId, op: 'add', localId: `${LOCAL_ID_PREFIX}${nuevoId()}`, input };
}

interface ContactRowLike {
  contactType: string;
  value: string;
  hasWhatsApp: boolean;
}
interface LocationRowLike {
  locationType: string;
  address: string;
  zone: string;
  latitude: string;
  longitude: string;
  referenceNotes: string;
  photoUrls?: string[];
}

/** ¿Todo lo que cambió se puede encolar? */
export function queueableOps(ops: ClienteOps, clientId = '_'): boolean {
  const sinCambios = <T extends { add: unknown[]; update: unknown[]; removeIds: string[] }>(r: T) =>
    r.add.length === 0 && r.update.length === 0 && r.removeIds.length === 0;
  return (
    ops.contacts.add.every((c) => contactAddAction(clientId, c) !== null) &&
    ops.locations.add.every((l) => locationAddAction(clientId, l) !== null) &&
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
  // Las altas van al final: lo anterior ya existe en el servidor, y cada alta se busca antes de crearse (no duplica).
  for (const c of ops.contacts.add) {
    const a = contactAddAction(clientId, c);
    if (a) actions.push(a);
  }
  for (const l of ops.locations.add) {
    const a = locationAddAction(clientId, l);
    if (a) actions.push(a);
  }
  return actions;
}
