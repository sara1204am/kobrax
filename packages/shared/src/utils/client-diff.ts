/**
 * Qué hacer para que el server quede como el formulario.
 *
 * Guardar una edición no es mandar el formulario entero: los teléfonos, ubicaciones y garantes son
 * recursos aparte, cada uno con su endpoint. Acá se compara lo que se cargó (`before`, hidratado del
 * server) contra lo que quedó en pantalla (`after`) y se devuelve **sólo la diferencia**.
 *
 * Promovido del móvil en F9 · W3 (regla §3.9). Puro y sin red: se testea solo, y guardar sin tocar
 * nada no dispara ni una llamada. Hermano de `diffAccount` (`patch.ts`), que W2 promovió: allá son
 * campos escalares, acá son filas con altas y bajas.
 */
import type { ClienteForm, ContactRow, LocationRow, RelationRow } from '../types/client.types.js';

export interface RowOps<T> {
  add: T[];
  update: T[];
  /** Ids del server de las filas que ya no están en el formulario. */
  removeIds: string[];
}

export interface ClienteOps {
  /** Campos del cliente que cambiaron. Ausente si no cambió ninguno. */
  client?: Partial<Pick<ClienteForm, 'clientType' | 'firstName' | 'lastName' | 'businessName' | 'gender' | 'riskSegment' | 'status'>>;
  contacts: RowOps<ContactRow>;
  locations: RowOps<LocationRow>;
  relations: RowOps<RelationRow>;
  /** Teléfonos y ubicaciones de garantes que YA existían (los del garante nuevo van en su alta). */
  relationContacts: RowOps<ContactRow & { relationId: string }>;
  relationLocations: RowOps<LocationRow & { relationId: string }>;
}

/**
 * ¿Hay algo que mandar? Si no, guardar no llama a la red.
 *
 * Se llama distinto que el `hasChanges` de `patch.ts` **a propósito**: aquel mira si un objeto de
 * campos quedó vacío; éste recorre seis listas de altas, cambios y bajas. Comparten el barril de
 * `utils`, así que un nombre repetido no compilaría — y confundirlos sería peor.
 */
export function hasClientChanges(ops: ClienteOps): boolean {
  const some = <T>(r: RowOps<T>) => r.add.length > 0 || r.update.length > 0 || r.removeIds.length > 0;
  return (
    !!ops.client ||
    some(ops.contacts) ||
    some(ops.locations) ||
    some(ops.relations) ||
    some(ops.relationContacts) ||
    some(ops.relationLocations)
  );
}

/** Filas nuevas / cambiadas / borradas, comparando por `serverId`. */
function diffRows<T extends { serverId?: string }>(before: T[], after: T[], same: (a: T, b: T) => boolean): RowOps<T> {
  const byId = new Map(before.filter((r) => r.serverId).map((r) => [r.serverId!, r]));
  const add = after.filter((r) => !r.serverId);
  const update = after.filter((r) => {
    const prev = r.serverId ? byId.get(r.serverId) : undefined;
    return prev != null && !same(prev, r);
  });
  const keep = new Set(after.map((r) => r.serverId).filter(Boolean));
  const removeIds = [...byId.keys()].filter((id) => !keep.has(id));
  return { add, update, removeIds };
}

const sameContact = (a: ContactRow, b: ContactRow) =>
  a.contactType === b.contactType && a.value.trim() === b.value.trim() && a.hasWhatsApp === b.hasWhatsApp && a.isPrimary === b.isPrimary;

const sameLocation = (a: LocationRow, b: LocationRow) =>
  a.locationType === b.locationType &&
  a.address.trim() === b.address.trim() &&
  a.zone.trim() === b.zone.trim() &&
  a.latitude.trim() === b.latitude.trim() &&
  a.longitude.trim() === b.longitude.trim() &&
  a.referenceNotes.trim() === b.referenceNotes.trim() &&
  a.photoUrls.join('|') === b.photoUrls.join('|');

const sameRelation = (a: RelationRow, b: RelationRow) =>
  a.relatedName.trim() === b.relatedName.trim() &&
  a.relationshipType === b.relationshipType &&
  a.gender === b.gender &&
  a.isContactable === b.isContactable &&
  a.notes.trim() === b.notes.trim();

/** Campos del cliente que cambiaron (sin el documento: no se edita una vez cargado). */
function diffClient(before: ClienteForm, after: ClienteForm): ClienteOps['client'] {
  const patch: ClienteOps['client'] = {};
  if (after.clientType !== before.clientType) patch.clientType = after.clientType;
  if (after.firstName.trim() !== before.firstName.trim()) patch.firstName = after.firstName.trim();
  if (after.lastName.trim() !== before.lastName.trim()) patch.lastName = after.lastName.trim();
  if (after.businessName.trim() !== before.businessName.trim()) patch.businessName = after.businessName.trim();
  if (after.gender !== before.gender) patch.gender = after.gender;
  if (after.riskSegment !== before.riskSegment) patch.riskSegment = after.riskSegment;
  if (after.status !== before.status) patch.status = after.status;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function diffCliente(before: ClienteForm, after: ClienteForm): ClienteOps {
  // Los sub-recursos de un garante NUEVO viajan dentro de su alta; los de uno que ya existía van por
  // su propio endpoint, con `relationId`.
  const existentes = after.relations.filter((r) => r.serverId);
  const previas = new Map(before.relations.filter((r) => r.serverId).map((r) => [r.serverId!, r]));

  const relContacts: RowOps<ContactRow & { relationId: string }> = { add: [], update: [], removeIds: [] };
  const relLocations: RowOps<LocationRow & { relationId: string }> = { add: [], update: [], removeIds: [] };
  for (const rel of existentes) {
    const prev = previas.get(rel.serverId!);
    const c = diffRows(prev?.contacts ?? [], rel.contacts, sameContact);
    const l = diffRows(prev?.locations ?? [], rel.locations, sameLocation);
    relContacts.add.push(...c.add.map((r) => ({ ...r, relationId: rel.serverId! })));
    relContacts.update.push(...c.update.map((r) => ({ ...r, relationId: rel.serverId! })));
    relContacts.removeIds.push(...c.removeIds);
    relLocations.add.push(...l.add.map((r) => ({ ...r, relationId: rel.serverId! })));
    relLocations.update.push(...l.update.map((r) => ({ ...r, relationId: rel.serverId! })));
    relLocations.removeIds.push(...l.removeIds);
  }

  return {
    client: diffClient(before, after),
    contacts: diffRows(before.contacts, after.contacts, sameContact),
    locations: diffRows(before.locations, after.locations, sameLocation),
    relations: diffRows(before.relations, after.relations, sameRelation),
    relationContacts: relContacts,
    relationLocations: relLocations,
  };
}
