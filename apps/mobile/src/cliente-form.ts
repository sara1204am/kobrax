/**
 * Lógica pura del alta de cliente (V1, §5.1) — versión acordeón: identificación + N contactos +
 * N ubicaciones + N relaciones/garantes. Sin red, sin React → testeable sola.
 * Mínimo para guardar: nombre + apellido + un teléfono (el modelo exige apellido para PERSON).
 */
import type { NewClientInput } from './clients.service';

export type ClientTypeValue = 'PERSON' | 'COMPANY';
export type ContactTypeValue = 'PHONE' | 'EMAIL';
export type LocationTypeValue = 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';
export type RelationTypeValue = 'GUARANTOR' | 'FAMILY' | 'COWORKER' | 'NEIGHBOR' | 'OTHER';
export type StatusValue = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

/** El teléfono con WhatsApp se guarda como `ContactType.WHATSAPP` (decisión 2026-07-14). */
export interface ContactRow {
  id: string;
  contactType: ContactTypeValue;
  value: string;
  hasWhatsApp: boolean;
  isPrimary: boolean;
}
export type CoordMode = 'manual' | 'gps' | 'map';
export interface LocationRow {
  id: string;
  locationType: LocationTypeValue;
  address: string;
  zone: string;
  /** Texto (lo tipeado / lo capturado); se parsea a número al armar el payload. */
  latitude: string;
  longitude: string;
  coordMode: CoordMode;
  referenceNotes: string;
  photoUrls: string[];
}
export interface RelationRow {
  id: string;
  relatedName: string;
  relationshipType: RelationTypeValue;
  gender: string;
  phone: string;
  isContactable: boolean;
  notes: string;
}

export interface ClienteForm {
  clientType: ClientTypeValue;
  firstName: string;
  lastName: string;
  nationalId: string;
  gender: string;
  businessName: string;
  riskSegment: string;
  status: StatusValue;
  contacts: ContactRow[];
  locations: LocationRow[];
  relations: RelationRow[];
}

export function emptyContact(id: string, isPrimary = false): ContactRow {
  return { id, contactType: 'PHONE', value: '', hasWhatsApp: true, isPrimary };
}
export function emptyLocation(id: string): LocationRow {
  return { id, locationType: 'HOME', address: '', zone: '', latitude: '', longitude: '', coordMode: 'manual', referenceNotes: '', photoUrls: [] };
}

/** Coordenada tipeada/capturada → número, o undefined si está vacía o no es válida. */
function parseCoord(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
export function emptyRelation(id: string): RelationRow {
  return { id, relatedName: '', relationshipType: 'GUARANTOR', gender: '', phone: '', isContactable: true, notes: '' };
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
    contacts: [emptyContact('c0', true)], // §5.1: un teléfono principal por defecto, WhatsApp marcado
    locations: [],
    relations: [],
  };
}

/** El teléfono principal (o el primero con valor) — lo que exige el mínimo del §5.1. */
function hasPhone(s: ClienteForm): boolean {
  return s.contacts.some((c) => c.contactType === 'PHONE' && c.value.trim().length > 0);
}

/** Mínimo viable (§5.1, ajustado al modelo): nombre + apellido + un teléfono. */
export function canSubmitCliente(s: ClienteForm): boolean {
  return s.firstName.trim().length >= 2 && s.lastName.trim().length >= 1 && hasPhone(s);
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
    // Un teléfono con WhatsApp viaja como tipo WHATSAPP; email como EMAIL; el resto PHONE.
    contacts: s.contacts
      .filter((c) => c.value.trim().length > 0)
      .map((c) => ({
        contactType: c.contactType === 'EMAIL' ? 'EMAIL' : c.hasWhatsApp ? 'WHATSAPP' : 'PHONE',
        value: c.value.trim(),
        isPrimary: c.isPrimary,
      })),
    // Solo ubicaciones con algún dato real (no filas vacías).
    locations: s.locations
      .filter((l) => l.address.trim() || l.zone.trim() || l.latitude.trim() || l.photoUrls.length > 0 || l.referenceNotes.trim())
      .map((l) => ({
        locationType: l.locationType,
        address: l.address.trim() || undefined,
        zone: l.zone.trim() || undefined,
        latitude: parseCoord(l.latitude),
        longitude: parseCoord(l.longitude),
        referenceNotes: l.referenceNotes.trim() || undefined,
        photoUrls: l.photoUrls.length > 0 ? l.photoUrls : undefined,
      })),
    // `relatedName` es obligatorio en el DTO → se descartan las relaciones sin nombre.
    relations: s.relations
      .filter((r) => r.relatedName.trim().length > 0)
      .map((r) => ({
        relatedName: r.relatedName.trim(),
        relationshipType: r.relationshipType,
        gender: r.gender || undefined,
        phone: r.phone.trim() || undefined,
        isContactable: r.isContactable,
        notes: r.notes.trim() || undefined,
      })),
  };
}
