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
import type { ClienteForm, CollateralRow, ContactRow, LocationRow, RelationRow } from '../types/client.types.js';
import { hasCollateralData, hasLocationData } from './client-form.js';

export interface RowOps<T> {
  add: T[];
  update: T[];
  /** Ids del server de las filas que ya no están en el formulario. */
  removeIds: string[];
}

export interface ClienteOps {
  /** Campos del cliente que cambiaron. Ausente si no cambió ninguno. */
  client?: Partial<
    Pick<ClienteForm, 'clientType' | 'firstName' | 'lastName' | 'businessName' | 'nationalId' | 'gender' | 'riskSegment' | 'status'>
  >;
  contacts: RowOps<ContactRow>;
  locations: RowOps<LocationRow>;
  relations: RowOps<RelationRow>;
  /** Las garantías no personales. Sin sub-recursos: son una fila y sus fotos. */
  collaterals: RowOps<CollateralRow>;
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
    some(ops.collaterals) ||
    some(ops.relationContacts) ||
    some(ops.relationLocations)
  );
}

/**
 * Filas nuevas / cambiadas / borradas, comparando por `serverId`.
 *
 * `tieneDatos` descarta las filas **nuevas y vacías**: agregar un teléfono y no escribirlo es
 * arrepentirse, no cargar un teléfono en blanco. Sin esto, el alta las filtra (`mapContacts`) pero
 * la edición las mandaba igual — y el server, que no exige contenido en el `POST` de una ubicación,
 * creaba una dirección sin dirección.
 */
function diffRows<T extends { serverId?: string }>(
  before: T[],
  after: T[],
  same: (a: T, b: T) => boolean,
  tieneDatos: (row: T) => boolean = () => true,
): RowOps<T> {
  const byId = new Map(before.filter((r) => r.serverId).map((r) => [r.serverId!, r]));
  const add = after.filter((r) => !r.serverId && tieneDatos(r));
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

/** Una fila nueva sin nada escrito no es un alta. Espejo de lo que filtra `buildClientePayload`. */
const hasContactData = (c: ContactRow) => c.value.trim().length > 0;
const hasRelationData = (r: RelationRow) => r.relatedName.trim().length > 0;

/**
 * Dos listas de créditos con lo mismo adentro, sin importar el orden.
 *
 * 🔴 **Ordenado y no `join()` a secas.** El server devuelve los vínculos en el orden que quiere, y
 * la pantalla en el que se fueron tildando: comparar sin ordenar hacía que **abrir el formulario y
 * guardar sin tocar nada** contara como un cambio y mandara un PATCH por cada garante.
 */
const sameIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const sameRelation = (a: RelationRow, b: RelationRow) =>
  a.relatedName.trim() === b.relatedName.trim() &&
  a.relationshipType === b.relationshipType &&
  a.gender === b.gender &&
  a.isContactable === b.isContactable &&
  a.notes.trim() === b.notes.trim() &&
  sameIds(a.creditIds, b.creditIds);

const sameCollateral = (a: CollateralRow, b: CollateralRow) =>
  a.type === b.type &&
  a.description.trim() === b.description.trim() &&
  a.estimatedValue.trim() === b.estimatedValue.trim() &&
  a.currency === b.currency &&
  a.photoUrls.join('|') === b.photoUrls.join('|') &&
  sameIds(a.creditIds, b.creditIds);

/**
 * Campos del cliente que cambiaron.
 *
 * 🔴 **El documento SÍ entra.** Estaba excluido —«no se edita una vez cargado»— pero el formulario
 * lo dibujaba igual, editable: se corregía un CI mal tipeado, se guardaba, y no pasaba nada. Peor,
 * si era el único cambio el botón de guardar ni se encendía. El servidor lo soporta entero
 * (`ClientsService.update` re-cifra, re-calcula el blind index y rebota el duplicado), y un CI mal
 * cargado es el dato por el que el cobrador busca a la persona: tiene que poder arreglarse.
 *
 * ⚠️ Quien llame a este diff **tiene que haber hidratado con la PII en claro** (`?reveal=true`). Con
 * la máscara, esto ahora manda `1234***` como documento. Las dos pantallas que lo usan revelan antes
 * de abrir los campos, y hay una prueba en cada una que lo sostiene.
 */
function diffClient(before: ClienteForm, after: ClienteForm): ClienteOps['client'] {
  const patch: ClienteOps['client'] = {};
  if (after.clientType !== before.clientType) patch.clientType = after.clientType;
  if (after.firstName.trim() !== before.firstName.trim()) patch.firstName = after.firstName.trim();
  if (after.lastName.trim() !== before.lastName.trim()) patch.lastName = after.lastName.trim();
  if (after.businessName.trim() !== before.businessName.trim()) patch.businessName = after.businessName.trim();
  if (after.nationalId.trim() !== before.nationalId.trim()) patch.nationalId = after.nationalId.trim();
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
    const c = diffRows(prev?.contacts ?? [], rel.contacts, sameContact, hasContactData);
    const l = diffRows(prev?.locations ?? [], rel.locations, sameLocation, hasLocationData);
    relContacts.add.push(...c.add.map((r) => ({ ...r, relationId: rel.serverId! })));
    relContacts.update.push(...c.update.map((r) => ({ ...r, relationId: rel.serverId! })));
    relContacts.removeIds.push(...c.removeIds);
    relLocations.add.push(...l.add.map((r) => ({ ...r, relationId: rel.serverId! })));
    relLocations.update.push(...l.update.map((r) => ({ ...r, relationId: rel.serverId! })));
    relLocations.removeIds.push(...l.removeIds);
  }

  return {
    client: diffClient(before, after),
    contacts: diffRows(before.contacts, after.contacts, sameContact, hasContactData),
    locations: diffRows(before.locations, after.locations, sameLocation, hasLocationData),
    relations: diffRows(before.relations, after.relations, sameRelation, hasRelationData),
    collaterals: diffRows(before.collaterals, after.collaterals, sameCollateral, hasCollateralData),
    relationContacts: relContacts,
    relationLocations: relLocations,
  };
}
