import type {
  Client,
  ClientAttachment,
  ClientContact,
  ClientLocation,
  ClientRelation,
  Collateral,
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

/** Las filas de la tabla puente → la lista de ids que espera el formulario. */
const creditIds = (rows?: { creditId: string }[]): string[] | undefined => rows?.map((c) => c.creditId);

/** El contacto (persona) devuelve sus propios teléfonos y ubicaciones (mismas tablas, vía relation_id). */
export function serializeRelation(
  r: ClientRelation & { contacts?: ClientContact[]; locations?: ClientLocation[]; credits?: { creditId: string }[] },
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
    creditIds: creditIds(r.credits),
  };
}

/**
 * La garantía no personal.
 *
 * ⚠️ **No lleva máscara.** No es PII de nadie: es un bien —una moto, un terreno— y su descripción es
 * justamente lo que quien va a cobrar necesita leer. El domicilio del deudor sí se enmascara; «Moto
 * Honda roja 2019» no dice quién es nadie.
 */
export function serializeCollateral(g: Collateral & { credits?: { creditId: string }[] }) {
  return {
    id: g.id,
    type: g.type ?? undefined,
    description: g.description,
    estimatedValue: g.estimatedValue != null ? Number(g.estimatedValue) : undefined,
    currency: g.currency ?? undefined,
    photoUrls: g.photoUrls,
    creditIds: creditIds(g.credits),
  };
}

export function serializeAttachment(a: ClientAttachment) {
  /*
   * 🔴 **La URL vuelve.** Estuvo oculta esperando el endpoint firmado de F6, y mientras tanto el
   * legajo se podía llenar y nunca mirar — lo único que un legajo tiene que dejar hacer.
   *
   * No es una URL pública: es `/api/uploads/<hash>.<ext>`, que sirve `UploadsService.streamOf()`
   * **dentro de la carpeta del tenant en sesión** y con el nombre validado contra el hash. Quien no
   * tenga sesión no la abre, y quien tenga la de otra empresa recibe un 404. El endpoint firmado
   * sigue teniendo sentido el día que el archivo salga a un bucket; hasta entonces, esto es lo que
   * hay y alcanza.
   */
  return {
    id: a.id,
    fileType: a.fileType,
    fileUrl: a.fileUrl,
    fileHash: a.fileHash ?? undefined,
    encrypted: a.encrypted,
    createdAt: a.createdAt,
  };
}

/**
 * Lo que la cartera del panel agrega por cliente (F9 · W3). Presente **sólo** con `view=portfolio`.
 * No lleva moneda: una cuenta opera en una sola (`account.currencyCode`), y el panel formatea con esa.
 */
export interface PortfolioTotals {
  /** Suma del saldo de todos sus créditos vivos. */
  totalDebt: number;
  /** La peor mora entre sus créditos — de acá sale el color de la fila. */
  maxDaysPastDue: number;
  creditCount: number;
}

export type PortfolioClient = ReturnType<typeof serializeClient> & PortfolioTotals;

type ClientWithRelations = Client & {
  contacts?: ClientContact[];
  locations?: ClientLocation[];
  relations?: (ClientRelation & { contacts?: ClientContact[]; locations?: ClientLocation[]; credits?: { creditId: string }[] })[];
  collaterals?: (Collateral & { credits?: { creditId: string }[] })[];
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
    /*
     * Los agregados de la cartera, tal como los mantiene el trigger.
     *
     * 🔴 **Van acá para que la ficha y la lista digan el MISMO número.** Sumarlos en la ficha a
     * partir de los créditos que trajo la pantalla daría otra cifra en cuanto alguien tenga más
     * créditos que el `limit` de esa consulta — y serían dos pantallas, a un clic de distancia,
     * contradiciéndose sobre cuánta plata debe una persona.
     */
    totalDebt: Number(client.totalDebt),
    maxDaysPastDue: client.maxDaysPastDue,
    creditCount: client.creditCount,
    metadata: client.metadata,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    contacts: client.contacts?.map((c) => serializeContact(c, opts)),
    locations: client.locations?.map((l) => serializeLocation(l, opts)),
    relations: client.relations?.map((r) => serializeRelation(r, opts)),
    collaterals: client.collaterals?.map((g) => serializeCollateral(g)),
    attachments: client.attachments?.map((a) => serializeAttachment(a)),
  };
}
