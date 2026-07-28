import type {
  Client,
  ClientAttachment,
  ClientContact,
  ClientLocation,
  ClientRelation,
} from '@prisma/client';
import { maskDocument, maskEmail, maskPhone } from '@kobrax/shared';
import type { CryptoService } from '../../common/crypto/crypto.service';

export interface SerializeOpts {
  crypto: CryptoService;
  /** Si true, devuelve la PII en claro (requiere permiso `*:pii:read` + auditoría). */
  reveal: boolean;
}

/**
 * Nombre visible del cliente: empresa → razón social; persona → nombre + apellido.
 * Vive acá porque la regla es del dominio `clients`; la consumen `cases` y `routes`.
 * ponytail: `clientLabel()` del import (portfolio-import.service.ts) y `displayName()` de agenda
 * hacen lo mismo — converger cuando se toque cada módulo, no vale un refactor suelto.
 */
export function clientDisplayName(c: {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
}): string | undefined {
  if (c.businessName) return c.businessName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || undefined;
}

/** Descifra de forma segura: si el valor no es ciphertext (legado en claro), lo devuelve tal cual. */
export function safeDecrypt(crypto: CryptoService, value: string | null): string | null {
  if (value == null) return null;
  try {
    return crypto.decrypt(value);
  } catch {
    return value; // fallback a plaintext legado (periodo de migración)
  }
}

/** Aplica máscara a un valor de PII salvo que `reveal` esté activo. */
function pii(plain: string | null, reveal: boolean, mask: (v: string) => string): string | null {
  if (plain == null) return null;
  return reveal ? plain : mask(plain);
}

function maskAddress(a: string): string {
  return a.length <= 6 ? '****' : `${a.slice(0, 6)} ****`;
}

export function serializeContact(c: ClientContact, { crypto, reveal }: SerializeOpts) {
  const value = safeDecrypt(crypto, c.value);
  const mask = c.contactType === 'EMAIL' ? maskEmail : maskPhone;
  return {
    id: c.id,
    contactType: c.contactType,
    value: pii(value, reveal, mask),
    isPrimary: c.isPrimary,
    isVerified: c.isVerified,
    notes: c.notes ?? undefined,
  };
}

export function serializeLocation(l: ClientLocation, { crypto, reveal }: SerializeOpts) {
  const address = safeDecrypt(crypto, l.address);
  return {
    id: l.id,
    locationType: l.locationType,
    address: pii(address, reveal, maskAddress),
    zone: l.zone ?? undefined,
    latitude: l.latitude != null ? Number(l.latitude) : undefined,
    longitude: l.longitude != null ? Number(l.longitude) : undefined,
    referenceNotes: l.referenceNotes ?? undefined,
    photoUrls: l.photoUrls,
    riskLevel: l.riskLevel ?? undefined,
  };
}

/** El contacto (persona) devuelve sus propios teléfonos y ubicaciones (mismas tablas, vía relation_id). */
export function serializeRelation(
  r: ClientRelation & { contacts?: ClientContact[]; locations?: ClientLocation[] },
  opts: SerializeOpts,
) {
  return {
    id: r.id,
    relatedName: r.relatedName,
    relationshipType: r.relationshipType,
    gender: r.gender ?? undefined,
    isContactable: r.isContactable,
    notes: r.notes ?? undefined,
    contacts: r.contacts?.map((c) => serializeContact(c, opts)),
    locations: r.locations?.map((l) => serializeLocation(l, opts)),
  };
}

export function serializeAttachment(a: ClientAttachment) {
  // No expone la URL directa: el cliente la pide con un endpoint firmado (F6). Sí el hash.
  return {
    id: a.id,
    fileType: a.fileType,
    fileHash: a.fileHash ?? undefined,
    encrypted: a.encrypted,
    createdAt: a.createdAt,
  };
}

type ClientWithRelations = Client & {
  contacts?: ClientContact[];
  locations?: ClientLocation[];
  relations?: ClientRelation[];
  attachments?: ClientAttachment[];
};

/** Serializa un cliente (con o sin sub-recursos), tokenizando la PII salvo `reveal`. */
export function serializeClient(client: ClientWithRelations, opts: SerializeOpts) {
  const { crypto, reveal } = opts;
  const nationalId = safeDecrypt(crypto, client.nationalId);
  const taxId = safeDecrypt(crypto, client.taxId);
  return {
    id: client.id,
    clientType: client.clientType,
    firstName: client.firstName ?? undefined,
    lastName: client.lastName ?? undefined,
    businessName: client.businessName ?? undefined,
    gender: client.gender ?? undefined,
    nationalId: pii(nationalId, reveal, maskDocument),
    taxId: pii(taxId, reveal, maskDocument),
    status: client.status,
    preferredContactChannel: client.preferredContactChannel ?? undefined,
    riskSegment: client.riskSegment ?? undefined,
    metadata: client.metadata,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    contacts: client.contacts?.map((c) => serializeContact(c, opts)),
    locations: client.locations?.map((l) => serializeLocation(l, opts)),
    relations: client.relations?.map((r) => serializeRelation(r, opts)),
    attachments: client.attachments?.map((a) => serializeAttachment(a)),
  };
}
