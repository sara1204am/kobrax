/**
 * Cliente y crédito: lo que se manda a la API y lo que el formulario tiene en pantalla.
 *
 * Promovido del móvil en F9 · W3 (regla §3.9 del BUILD-PLAN): el panel web da de alta y edita
 * los **mismos** clientes contra los **mismos** endpoints. Los valores son los enums de la API
 * (Prisma) escritos como uniones, no como enums propios: son el contrato del DTO.
 */
import type { CreditOrigin, InterestBase, PaymentFrequency } from '../enums/credit.enum.js';

// ── Payload de la API ────────────────────────────────────────────────────────
export interface NewContactInput {
  contactType: 'PHONE' | 'WHATSAPP' | 'EMAIL';
  value: string;
  isPrimary?: boolean;
}

export interface NewLocationInput {
  locationType?: 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';
  address?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
}

export interface NewRelationInput {
  relatedName: string;
  relationshipType: 'GUARANTOR' | 'FAMILY' | 'COWORKER' | 'NEIGHBOR' | 'OTHER';
  gender?: string;
  isContactable?: boolean;
  notes?: string;
  /** El contacto (persona) tiene sus propios teléfonos y ubicaciones (1..N). */
  contacts?: NewContactInput[];
  locations?: NewLocationInput[];
}

/** Alta atómica: cliente + contactos + ubicaciones + relaciones en una transacción. */
export interface NewClientInput {
  /**
   * Id propuesto por quien da de alta. Hace el alta **idempotente** —reintentarla desde la cola
   * offline no crea un segundo cliente— y permite colgar un préstamo de un cliente que todavía no
   * subió. El server lo respeta; si no viene, genera el suyo. **La web no lo manda**: no tiene cola.
   */
  id?: string;
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId?: string;
  gender?: string;
  riskSegment?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  preferredContactChannel?: string;
  contacts?: NewContactInput[];
  locations?: NewLocationInput[];
  relations?: NewRelationInput[];
}

/** Payload del alta de préstamo. La cuota viaja **congelada** (Modo A directa, Modo B calculada). */
export interface NewCreditInput {
  /** Ídem `NewClientInput.id`: alta idempotente desde la cola offline. */
  id?: string;
  clientId: string;
  principalAmount: number;
  installmentAmount: number;
  frequency: PaymentFrequency;
  /** ISO date (YYYY-MM-DD). */
  nextDueDate: string;
  /** Vacío = préstamo abierto. */
  installmentsCount?: number;
  /** Informativo: no recalcula la cuota. */
  interestRate?: number;
  /** "Ya está en curso": digitalizar cartera vieja. */
  outstandingBalance?: number;
  daysPastDue?: number;
  notes?: string;
  origin?: CreditOrigin;
  /** Abre el caso de cobranza en la misma transacción. Sin caso, el crédito no le llega a nadie. */
  openCase?: boolean;
  /**
   * A quién se le asigna. En el teléfono coinciden con quien lo crea; **en la oficina no**: la
   * supervisora carga el préstamo y se lo reparte a un cobrador (F9 · W3 §5.3).
   */
  assignedManagerId?: string;
}

// ── Lo que devuelve la API ───────────────────────────────────────────────────
export interface ClientContactDetail {
  id: string;
  contactType: 'PHONE' | 'WHATSAPP' | 'EMAIL';
  /** Enmascarado salvo `reveal`. `null` = el registro no tiene valor. */
  value: string | null;
  isPrimary: boolean;
  isVerified?: boolean;
  notes?: string;
}

export interface ClientLocationDetail {
  id: string;
  locationType: 'HOME' | 'WORK' | 'GUARANTOR' | 'FAMILY' | 'OTHER';
  /** Enmascarada salvo `reveal`. */
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
  riskLevel?: string;
}

export interface ClientRelationDetail {
  id: string;
  relatedName: string;
  relationshipType: 'GUARANTOR' | 'FAMILY' | 'COWORKER' | 'NEIGHBOR' | 'OTHER';
  gender?: string;
  isContactable: boolean;
  notes?: string;
  contacts?: ClientContactDetail[];
  locations?: ClientLocationDetail[];
}

/**
 * El adjunto **no trae su URL**: el serializer de la API la oculta a propósito hasta que exista el
 * endpoint firmado (F6). Se puede listar y borrar; no abrir.
 */
export interface ClientAttachmentDetail {
  id: string;
  fileType: string;
  fileHash?: string;
  encrypted: boolean;
  createdAt: string;
}

/**
 * Detalle del cliente (`GET /clients/:id`).
 *
 * 🔴 Con `?reveal=true` los teléfonos, direcciones y documentos vienen **en claro** y el server lo
 * audita. **El formulario de edición tiene que cargarse así**: con el valor enmascarado, guardar
 * escribe la máscara encima del dato real. Ya pasó una vez.
 */
export interface ClientDetail {
  id: string;
  clientType: ClientTypeValue;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  gender?: string;
  nationalId: string | null;
  taxId?: string | null;
  status: StatusValue;
  riskSegment?: string;
  preferredContactChannel?: string;
  createdAt?: string;
  updatedAt?: string;
  contacts?: ClientContactDetail[];
  locations?: ClientLocationDetail[];
  relations?: ClientRelationDetail[];
  attachments?: ClientAttachmentDetail[];
}

export interface CreditInstallmentDetail {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  principal: number;
  interest: number;
  paidAmount: number;
  status: string;
  paidAt?: string;
}

/**
 * Detalle del crédito (`GET /credits/:id`).
 *
 * ⚠️ **`hasSchedule` e `installments` sólo son de fiar en la ficha.** El listado
 * (`GET /credits?clientId=`) no incluye las cuotas, así que ahí `hasSchedule` viene `false`
 * siempre — no porque el crédito no tenga cronograma, sino porque no se las pidieron.
 *
 * `locked` es el candado del dato importado: si el crédito vino de un archivo o de otro core, sus
 * campos financieros **no se editan** y la API rechaza el `PATCH` con `CREDIT_LOCKED`.
 */
export interface CreditDetail {
  id: string;
  code?: string;
  clientId?: string;
  principalAmount: number;
  interestRate: number;
  currency: string;
  outstandingBalance: number;
  installmentsCount?: number;
  installmentAmount?: number;
  frequency?: PaymentFrequency;
  nextDueDate?: string;
  origin?: CreditOrigin;
  locked?: boolean;
  notes?: string;
  status?: string;
  daysPastDue?: number;
  hasSchedule?: boolean;
  disbursedAt?: string;
  assignedManagerId?: string;
  installments?: CreditInstallmentDetail[];
}

/** Lo único editable después del desembolso. El monto y las cuotas no: eso es una reestructura. */
export interface UpdateCreditPatch {
  principalAmount?: number;
  interestRate?: number;
  installmentAmount?: number;
  frequency?: PaymentFrequency;
  nextDueDate?: string;
  notes?: string;
}

// ── Formulario en pantalla ───────────────────────────────────────────────────
export type ClientTypeValue = NewClientInput['clientType'];
export type ContactTypeValue = 'PHONE' | 'EMAIL';
export type LocationTypeValue = NonNullable<NewLocationInput['locationType']>;
export type RelationTypeValue = NewRelationInput['relationshipType'];
export type StatusValue = NonNullable<NewClientInput['status']>;

/**
 * `serverId` = la fila ya existe en el server (viene de `hydrateCliente`). Sin él, es nueva y se
 * crea. Es lo que le permite a la edición saber qué actualizar, qué crear y qué borrar.
 */
export interface RowFromServer {
  serverId?: string;
}

/** El teléfono con WhatsApp se guarda como `ContactType.WHATSAPP` (decisión 2026-07-14). */
export interface ContactRow extends RowFromServer {
  id: string;
  contactType: ContactTypeValue;
  value: string;
  hasWhatsApp: boolean;
  isPrimary: boolean;
}

export type CoordMode = 'manual' | 'gps' | 'map';

export interface LocationRow extends RowFromServer {
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

export interface RelationRow extends RowFromServer {
  id: string;
  relatedName: string;
  relationshipType: RelationTypeValue;
  gender: string;
  isContactable: boolean;
  notes: string;
  /** Sus propios teléfonos y ubicaciones, con la MISMA estructura que el cliente. */
  contacts: ContactRow[];
  locations: LocationRow[];
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

/** Modo del alta de préstamo: A = cuota tipeada · B = cuota calculada desde el interés. */
export type LoanMode = 'A' | 'B';

export interface PrestamoForm {
  mode: LoanMode;
  principal: string;
  /** Modo A: tipeada · Modo B: calculada, editable para redondeo. */
  installment: string;
  /** Modo B: el usuario la corrigió a mano → no la pisa el cálculo. */
  installmentEdited: boolean;
  interestPercent: string;
  base: InterestBase;
  /** Opcional en A (vacío = préstamo abierto). */
  installmentsCount: string;
  frequency: PaymentFrequency;
  /** ISO date (YYYY-MM-DD). */
  nextDueDate: string;
  /** "Ya está en curso". */
  inProgress: boolean;
  outstandingBalance: string;
  daysPastDue: string;
  notes: string;
}
