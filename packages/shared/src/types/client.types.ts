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
  /**
   * A qué créditos del cliente respalda esta persona. **Varios, o ninguno.**
   *
   * Un cliente puede tener dos créditos con garantes distintos, y la misma persona puede garantizar
   * los dos: por eso es una lista y no un `creditId`. Vacío es lo normal en un familiar o un vecino,
   * que están para ubicar al deudor y no para responder por la deuda.
   */
  creditIds?: string[];
}

/**
 * Garantía **no personal**: el bien que respalda el crédito. La personal es el garante.
 *
 * `creditIds` es multiselect por lo mismo que el garante: el mismo vehículo puede respaldar dos
 * créditos, y atado a uno solo habría que cargarlo —y fotografiarlo— dos veces.
 */
export interface NewCollateralInput {
  /** Código del catálogo `COLLATERAL_TYPE` del tenant. Vacío = sin clasificar. */
  type?: string;
  /** Qué es. Texto libre: es lo que le sirve a quien va a buscarla. */
  description: string;
  estimatedValue?: number;
  currency?: string;
  photoUrls?: string[];
  creditIds?: string[];
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
  collaterals?: NewCollateralInput[];
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
  /** Qué clase de crédito es → catálogo `CREDIT_TYPE`. Opcional: el móvil no lo pregunta. */
  typeCode?: string;
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
  /** Los créditos que respalda. Vacío = no responde por ninguno. */
  creditIds?: string[];
}

/**
 * Una entrada de la bitácora del cliente: **todo lo que se hizo con esta persona**, sin importar por
 * cuál de sus créditos pasó.
 *
 * 🔴 **Viaja en códigos, nunca en frases.** El panel es bilingüe y el móvil escribe distinto: acá va
 * la regla —qué pasó, cuándo y con qué dato— y el texto lo arma cada app en su idioma. Es lo mismo
 * que se decidió para los estados de la cartera.
 *
 * Las tres fuentes son tres tablas y en la base **ya están atadas al cliente**: `agenda_items` lo
 * lleva propio, el pago llega por su crédito y la gestión por su caso. Por eso esto es una consulta,
 * no un recorrido crédito por crédito.
 */
export type TimelineKind = 'PAYMENT' | 'AGENDA' | 'ACTIVITY';

export interface ClientTimelineEntry {
  kind: TimelineKind;
  id: string;
  /** ISO. Es la fecha por la que se ordena, y significa lo suyo en cada fuente. */
  at: string;
  /**
   * Qué fue: el medio de pago (`CASH`…), el tipo de agendado (`VISIT`, `CALL`, `PROMISE_TO_PAY`…) o
   * el tipo de gestión (`CaseActivityType`).
   */
  code: string;
  /** Sólo agenda: si se ejecutó, se canceló o se reagendó. Sin esto, «llamada» no dice si atendió. */
  status?: string;
  amount?: number;
  currency?: string;
  /** Lo que escribió quien la registró. Texto libre, tal cual. */
  notes?: string;
  creditId?: string;
  caseId?: string;
  /** Quién. `users.id`: el nombre lo resuelve quien dibuja, que ya tiene el equipo cargado. */
  userId?: string;
}

export interface CollateralDetail {
  id: string;
  type?: string;
  description: string;
  estimatedValue?: number;
  currency?: string;
  photoUrls?: string[];
  creditIds?: string[];
}

/**
 * Un adjunto del legajo.
 *
 * 🔴 **`fileUrl` es la ruta interna (`/api/uploads/<hash>.<ext>`), no una URL pública.** El que la
 * sirve es el mismo endpoint que ya se usaba para la foto de perfil y la evidencia de campo: valida
 * la sesión y sirve **sólo dentro del tenant** (`uploads.service.ts`). Estuvo oculta un tiempo
 * esperando el endpoint firmado de F6, y el resultado fue un legajo que se podía llenar y nunca
 * mirar — que es la única cosa que un legajo tiene que dejar hacer.
 */
export interface ClientAttachmentDetail {
  id: string;
  fileType: string;
  fileUrl?: string;
  fileHash?: string;
  encrypted: boolean;
  createdAt: string;
}

/** Los tipos de adjunto del legajo (`AttachmentType` en la base). La regla, no el rótulo. */
export const ATTACHMENT_TYPES = ['ID_CARD', 'PHOTO', 'CONTRACT', 'OTHER'] as const;

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
  /**
   * Los agregados de su cartera: cuánto debe, su peor mora y cuántos créditos vivos tiene.
   *
   * 🔴 **Es el MISMO número que ordena la lista de cartera** —los mantiene un trigger sobre
   * `credits`—, no una suma hecha en la pantalla. Sumar en el cliente daría otra cifra en cuanto
   * alguien tenga más créditos que el `limit` de la consulta que los trajo.
   */
  totalDebt?: number;
  maxDaysPastDue?: number;
  creditCount?: number;
  contacts?: ClientContactDetail[];
  locations?: ClientLocationDetail[];
  relations?: ClientRelationDetail[];
  collaterals?: CollateralDetail[];
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
  /** Código del catálogo `CREDIT_TYPE` del tenant. El rótulo lo resuelve quien dibuja. */
  typeCode?: string;
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

/**
 * Lo editable después del desembolso — **todo lo que acepta `UpdateCreditDto`, ni uno menos**.
 *
 * 🔴 Lo que NO entra, y por qué: **nº de cuotas, moneda y fecha de desembolso**. Cambiar el número
 * de cuotas sin regenerar el cronograma deja una tabla que no cierra con el préstamo; la moneda
 * reinterpretaría todos los pagos ya registrados. Eso es una reestructura, y es otra operación.
 *
 * El capital y la tasa **sí** entran: la API los acepta desde siempre y la pantalla los dibujaba de
 * sólo lectura diciendo que no — un préstamo mal tipeado no tenía arreglo.
 */
export interface UpdateCreditPatch {
  principalAmount?: number;
  interestRate?: number;
  installmentAmount?: number;
  frequency?: PaymentFrequency;
  nextDueDate?: string;
  notes?: string;
  status?: string;
  /**
   * 🔴 `null` **borra**, `''` no. Son columnas anulables: mandando la cadena vacía el crédito queda
   * con un código de cero caracteres —que la ficha dibuja como un hueco en vez de «sin código»— y
   * cualquier consulta que busque `IS NULL` no lo encuentra. El `@IsOptional()` del DTO deja pasar
   * el `null` y Prisma lo escribe como NULL.
   */
  code?: string | null;
  typeCode?: string | null;
  assignedManagerId?: string;
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
  /** Ids de los créditos que respalda. Vacío es válido: no todo contacto es garante. */
  creditIds: string[];
}

/**
 * La garantía no personal en el formulario.
 *
 * El valor va como **texto** —igual que las coordenadas— porque un `<input>` a medio escribir no es
 * un número: con `number`, borrar el último dígito deja `NaN` y el campo se vacía solo mientras la
 * persona escribe.
 */
export interface CollateralRow extends RowFromServer {
  id: string;
  type: string;
  description: string;
  estimatedValue: string;
  currency: string;
  photoUrls: string[];
  creditIds: string[];
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
  collaterals: CollateralRow[];
}

/**
 * Un crédito del cliente, como lo necesita el formulario para ofrecerlo en el selector.
 *
 * No es `CreditDetail`: para elegir a qué crédito apunta un garante alcanza con distinguirlo de los
 * otros dos que pueda tener —su código, su monto y su moneda—, y traer la ficha entera de cada uno
 * sería pedir el cronograma completo para dibujar una lista de dos ítems.
 */
export interface CreditOption {
  id: string;
  code?: string;
  principalAmount: number;
  outstandingBalance: number;
  currency: string;
  /**
   * Opcional, igual que en `CreditDetail`, del que esto es una proyección. Lo exigía nadie: el
   * selector distingue dos préstamos por su código y su saldo, y pedirlo obligaba a quien ya tiene
   * la ficha completa a inventar un `''` para poder pasarla.
   */
  status?: string;
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
