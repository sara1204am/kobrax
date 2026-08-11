/**
 * Lógica pura del alta y la edición de cliente: qué es válido, qué se manda, y cómo se hidrata el
 * formulario desde el server. Sin red y sin React → la usan el móvil y el panel web.
 *
 * Promovido del móvil en F9 · W3 (regla §3.9). Acá viven tres reglas del modelo que cualquiera que
 * escriba este formulario de nuevo vuelve a descubrir a los golpes: **WhatsApp es un `ContactType`
 * aparte** (en pantalla es un switch), **las filas vacías se descartan**, y **`serverId` es lo que
 * hace que editar sepa qué actualizar y qué crear**.
 */
import type {
  ClienteForm,
  ContactRow,
  LocationRow,
  NewClientInput,
  NewContactInput,
  NewLocationInput,
  NewRelationInput,
  RelationRow,
} from '../types/client.types.js';

export function emptyContact(id: string, isPrimary = false): ContactRow {
  return { id, contactType: 'PHONE', value: '', hasWhatsApp: true, isPrimary };
}

export function emptyLocation(id: string): LocationRow {
  return {
    id,
    locationType: 'HOME',
    address: '',
    zone: '',
    latitude: '',
    longitude: '',
    coordMode: 'manual',
    referenceNotes: '',
    photoUrls: [],
  };
}

export function emptyRelation(id: string): RelationRow {
  return { id, relatedName: '', relationshipType: 'GUARANTOR', gender: '', isContactable: true, notes: '', contacts: [], locations: [] };
}

export function initialCliente(): ClienteForm {
  return {
    clientType: 'PERSON',
    firstName: '',
    lastName: '',
    nationalId: '',
    gender: '',
    businessName: '',
    riskSegment: '',
    status: 'ACTIVE',
    contacts: [emptyContact('c0', true)], // un teléfono principal por defecto, WhatsApp marcado
    locations: [],
    relations: [],
  };
}

/**
 * Alta con la ubicación ya marcada — el alta desde el mapa de Rutas entra por acá con el punto que
 * se tocó. Sin punto, es el alta de siempre.
 */
export function clienteEnPunto(point: { latitude: number; longitude: number }): ClienteForm {
  const loc = emptyLocation('l0');
  return {
    ...initialCliente(),
    locations: [{ ...loc, coordMode: 'map', latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) }],
  };
}

/** Coordenada tipeada/capturada → número, o undefined si está vacía o no es válida. */
function parseCoord(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Filas del server → filas del formulario, marcadas con el id que tienen allá. */
type ServerContact = { id: string; contactType: string; value: string | null; isPrimary: boolean };
type ServerLocation = {
  id: string;
  locationType: string;
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
};

function hydrateContacts(rows: ServerContact[]): ContactRow[] {
  return rows.map((c) => ({
    id: c.id,
    serverId: c.id,
    // El server modela WhatsApp como un tipo aparte; el formulario lo muestra como un switch.
    contactType: c.contactType === 'EMAIL' ? 'EMAIL' : 'PHONE',
    value: c.value ?? '',
    hasWhatsApp: c.contactType === 'WHATSAPP',
    isPrimary: c.isPrimary,
  }));
}

function hydrateLocations(rows: ServerLocation[]): LocationRow[] {
  return rows.map((l) => ({
    id: l.id,
    serverId: l.id,
    locationType: l.locationType as LocationRow['locationType'],
    address: l.address ?? '',
    zone: l.zone ?? '',
    latitude: l.latitude != null ? String(l.latitude) : '',
    longitude: l.longitude != null ? String(l.longitude) : '',
    // Con punto cargado se abre en modo mapa: es donde se ve y se corrige.
    coordMode: l.latitude != null ? 'map' : 'manual',
    referenceNotes: l.referenceNotes ?? '',
    photoUrls: l.photoUrls ?? [],
  }));
}

/**
 * Server → formulario. Es la vuelta de `buildClientePayload`: hidrata el MISMO formulario que usa el
 * alta, marcando cada fila con su `serverId` para que al guardar se sepa qué actualizar y qué crear.
 * Las filas sin `serverId` son nuevas.
 *
 * 🔴 Quien lo llame tiene que traer la PII **en claro** (`GET /clients/:id?reveal=true`). Con el
 * valor enmascarado, guardar escribe la máscara encima del dato real.
 */
export function hydrateCliente(d: {
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId: string | null;
  gender?: string;
  riskSegment?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  contacts?: ServerContact[];
  locations?: ServerLocation[];
  relations?: {
    id: string;
    relatedName: string;
    relationshipType: string;
    gender?: string;
    isContactable: boolean;
    notes?: string;
    contacts?: ServerContact[];
    locations?: ServerLocation[];
  }[];
}): ClienteForm {
  return {
    clientType: d.clientType,
    firstName: d.firstName ?? '',
    lastName: d.lastName ?? '',
    nationalId: d.nationalId ?? '',
    gender: d.gender ?? '',
    businessName: d.businessName ?? '',
    riskSegment: d.riskSegment ?? '',
    status: d.status,
    contacts: hydrateContacts(d.contacts ?? []),
    locations: hydrateLocations(d.locations ?? []),
    relations: (d.relations ?? []).map((r) => ({
      id: r.id,
      serverId: r.id,
      relatedName: r.relatedName,
      relationshipType: r.relationshipType as RelationRow['relationshipType'],
      gender: r.gender ?? '',
      isContactable: r.isContactable,
      notes: r.notes ?? '',
      contacts: hydrateContacts(r.contacts ?? []),
      locations: hydrateLocations(r.locations ?? []),
    })),
  };
}

/** El teléfono principal (o el primero con valor) — lo que exige el mínimo. */
function hasPhone(s: ClienteForm): boolean {
  return s.contacts.some((c) => c.contactType === 'PHONE' && c.value.trim().length > 0);
}

/** Mínimo viable, ajustado al modelo: nombre + apellido + un teléfono. */
export function canSubmitCliente(s: ClienteForm): boolean {
  return s.firstName.trim().length >= 2 && s.lastName.trim().length >= 1 && hasPhone(s);
}

/**
 * Una fila de teléfono → su payload. WhatsApp marcado ⇒ tipo WHATSAPP; email ⇒ EMAIL; resto PHONE.
 *
 * Por fila y no sólo por lista porque la **edición** las manda de a una (cada sub-recurso tiene su
 * endpoint): sin esto, la pantalla de editar reescribe esta conversión al lado, y el día que
 * WhatsApp deje de ser un tipo aparte quedan dos lugares que arreglar.
 */
export function contactPayload(c: ContactRow): NewContactInput {
  return {
    contactType: c.contactType === 'EMAIL' ? 'EMAIL' : c.hasWhatsApp ? 'WHATSAPP' : 'PHONE',
    value: c.value.trim(),
    isPrimary: c.isPrimary,
  };
}

/** Una fila de ubicación → su payload. Ídem `contactPayload`. */
export function locationPayload(l: LocationRow): NewLocationInput {
  return {
    locationType: l.locationType,
    address: l.address.trim() || undefined,
    zone: l.zone.trim() || undefined,
    latitude: parseCoord(l.latitude),
    longitude: parseCoord(l.longitude),
    referenceNotes: l.referenceNotes.trim() || undefined,
    photoUrls: l.photoUrls.length > 0 ? l.photoUrls : undefined,
  };
}

/** ¿La fila de ubicación tiene algún dato real? Las vacías no se mandan. */
export function hasLocationData(l: LocationRow): boolean {
  return Boolean(l.address.trim() || l.zone.trim() || l.latitude.trim() || l.photoUrls.length > 0 || l.referenceNotes.trim());
}

/** Teléfonos → payload, descartando los vacíos. */
export function mapContacts(rows: ContactRow[]): NewContactInput[] {
  return rows.filter((c) => c.value.trim().length > 0).map(contactPayload);
}

/** Ubicaciones → payload, descartando las filas sin ningún dato. */
export function mapLocations(rows: LocationRow[]): NewLocationInput[] {
  return rows.filter(hasLocationData).map(locationPayload);
}

/**
 * Un garante → su payload, con sus teléfonos y ubicaciones adentro (el alta de una relación es
 * atómica). Para el `PATCH` de uno ya existente, sus sub-recursos van por su propia vía: se manda
 * este mismo objeto sin `contacts` ni `locations`.
 */
export function relationPayload(r: RelationRow): NewRelationInput {
  return {
    relatedName: r.relatedName.trim(),
    relationshipType: r.relationshipType,
    gender: r.gender || undefined,
    isContactable: r.isContactable,
    notes: r.notes.trim() || undefined,
    contacts: mapContacts(r.contacts),
    locations: mapLocations(r.locations),
  };
}

export function buildClientePayload(s: ClienteForm): NewClientInput {
  return {
    clientType: s.clientType,
    firstName: s.firstName.trim() || undefined,
    lastName: s.lastName.trim() || undefined,
    businessName: s.businessName.trim() || undefined,
    nationalId: s.nationalId.trim() || undefined,
    gender: s.gender || undefined,
    riskSegment: s.riskSegment || undefined,
    status: s.status,
    contacts: mapContacts(s.contacts),
    locations: mapLocations(s.locations),
    // `relatedName` es obligatorio en el DTO → se descartan las relaciones sin nombre. Cada contacto
    // (persona) lleva sus propios teléfonos y ubicaciones con la MISMA estructura que el cliente.
    relations: s.relations.filter((r) => r.relatedName.trim().length > 0).map(relationPayload),
  };
}
