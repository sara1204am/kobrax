/**
 * Seed de Kobrax para el modelo SIN caso de cobranza (F4/08 · fase 6).
 *
 * Reemplaza a los tres seeds anteriores (`seed`, `seed-bulk`, `seed-day`) por uno solo y coherente:
 * el crédito es el centro de todo (responsable, mora por episodios, gestiones, promesas, pagos, notas,
 * rutas). Ya no existe el caso: no hay tablas ni columnas `case_*`.
 *
 *   pnpm db:seed             permisos, roles, catálogos y el dataset demo (idempotente)
 *   pnpm db:seed:catalog     SÓLO permisos y roles (producción)
 *   pnpm db:seed:refresh     borra el dataset demo de DEMO y DEMO2 y lo vuelve a sembrar con fechas de HOY
 *   pnpm db:verify:seed      comprueba lo sembrado (prisma/verify/seed-sin-caso.sql)
 *
 * Re-ejecutar NO duplica: si el dataset ya está, no lo toca (usa `--refresh` para renovar las fechas).
 * Todas las fechas son RELATIVAS al día en que corre (zona America/La_Paz), nunca fijas.
 *
 * Qué dataset deja (todo ficticio, anonimizado):
 *   · DEMO: 2 agencias (cada una con su supervisor), 5 cobradores, gerente y administrador; 25 clientes;
 *     17 créditos creados en la app (con cronograma y pagos), 6 importados de PSF, y UN crédito «estrella»
 *     en mora con la ficha completa. DEMO2: un equipo mínimo para las pruebas de aislamiento.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  AccountStatus,
  AccountType,
  AgendaItemStatus,
  AgendaItemType,
  CatalogType,
  ClientType,
  ContactType,
  CreditActivityType,
  CreditAssignmentKind,
  CreditDataOrigin,
  CreditNoteAnchor,
  CreditNoteColor,
  CreditNoteKind,
  CreditStatus,
  EvidenceType,
  ExternalSyncStatus,
  ImportRunItemAction,
  InstallmentStatus,
  LocationType,
  NotificationType,
  PaymentChannel,
  PaymentMethod,
  PlanCode,
  Prisma,
  PrismaClient,
  RelationshipType,
  RouteStatus,
  RouteStopStatus,
  ScheduleTimeMode,
  UserStatus,
  VisitOutcome,
  CollectionPriority,
} from '@prisma/client';
import { DEFAULT_ARREAR_CATEGORIES, ROLE_PERMISSIONS, RoleType, validateAgendaDetails } from '@kobrax/shared';
import bcrypt from 'bcryptjs';
import { blindHash, encryptPII } from './pii';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════════
// Permisos y roles (la fuente de los roles es `ROLE_PERMISSIONS` de @kobrax/shared)
// ═══════════════════════════════════════════════════════════════════════════════

type PermRow = readonly [code: string, module: string, action: string, scope: string];

// Catálogo de permisos: code = `{recurso}:{acción}`. F4/08 · D5: `collection:*` reemplaza a `case:*`.
const PERMISSIONS: PermRow[] = [
  ['collection:read', 'collection', 'READ', 'ACCOUNT'],
  ['collection:write', 'collection', 'UPDATE', 'ACCOUNT'],
  ['collection:export', 'collection', 'EXECUTE', 'ACCOUNT'],
  ['payment:read', 'payments', 'READ', 'ACCOUNT'],
  ['payment:write', 'payments', 'CREATE', 'OWN'],
  ['payment:approve', 'payments', 'APPROVE', 'ACCOUNT'],
  ['route:read', 'routes', 'READ', 'ACCOUNT'],
  ['route:write', 'routes', 'UPDATE', 'BRANCH'],
  ['route:assign', 'routes', 'UPDATE', 'BRANCH'],
  ['route:execute', 'routes', 'EXECUTE', 'OWN'],
  ['agenda:read', 'agenda', 'READ', 'OWN'],
  ['agenda:write', 'agenda', 'CREATE', 'OWN'],
  ['agenda:assign', 'agenda', 'UPDATE', 'BRANCH'],
  ['catalog:read', 'catalogs', 'READ', 'ACCOUNT'],
  ['catalog:write', 'catalogs', 'UPDATE', 'ACCOUNT'],
  ['client:read', 'clients', 'READ', 'ACCOUNT'],
  ['client:write', 'clients', 'UPDATE', 'ACCOUNT'],
  ['client:pii:read', 'clients', 'READ', 'ACCOUNT'],
  ['client:import', 'clients', 'CREATE', 'ACCOUNT'],
  ['client:import:replace', 'clients', 'DELETE', 'ACCOUNT'],
  ['credit:read', 'credits', 'READ', 'ACCOUNT'],
  ['credit:write', 'credits', 'UPDATE', 'ACCOUNT'],
  ['credit:pii:read', 'credits', 'READ', 'ACCOUNT'],
  ['report:read', 'reports', 'READ', 'ACCOUNT'],
  ['report:export', 'reports', 'EXECUTE', 'ACCOUNT'],
  ['account:read', 'accounts', 'READ', 'ACCOUNT'],
  ['account:write', 'accounts', 'UPDATE', 'ACCOUNT'],
  ['user:read', 'users', 'READ', 'ACCOUNT'],
  ['user:write', 'users', 'UPDATE', 'ACCOUNT'],
  ['user:invite', 'users', 'CREATE', 'ACCOUNT'],
  ['role:read', 'roles', 'READ', 'ACCOUNT'],
  ['role:write', 'roles', 'UPDATE', 'ACCOUNT'],
  ['audit:read', 'audit', 'READ', 'ACCOUNT'],
  // Los roles los tenían en `ROLE_PERMISSIONS`, pero el bucle de roles se salta en silencio todo código que
  // no esté en esta lista: sin esto nadie los recibía en el JWT.
  ['assignment:write', 'assignments', 'UPDATE', 'ACCOUNT'],
  ['data:scope:all', 'data', 'READ', 'ACCOUNT'],
  // F4/08 · D8: el alcance del supervisor (su agencia + lo suyo). Espejo de la migración 20261004010000.
  ['data:scope:branch', 'data', 'READ', 'BRANCH'],
];

/** Roles del sistema → nivel. Los permisos NO se listan acá: salen de `ROLE_PERMISSIONS`. */
const ROLES: Record<RoleType, { level: number }> = {
  [RoleType.SUPER_ADMIN]: { level: 100 },
  [RoleType.ACCOUNT_ADMIN]: { level: 90 },
  [RoleType.MANAGER]: { level: 70 },
  [RoleType.SUPERVISOR]: { level: 50 },
  [RoleType.COLLECTOR]: { level: 30 },
  [RoleType.AUDITOR]: { level: 20 },
  [RoleType.VIEWER]: { level: 10 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Fechas: todo es relativo a HOY (día civil de La Paz). Nada fijo.
// ═══════════════════════════════════════════════════════════════════════════════

const DAY_MS = 86_400_000;
const NOW = new Date();
const TODAY_ISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(NOW); // YYYY-MM-DD
const TODAY = new Date(`${TODAY_ISO}T00:00:00.000Z`);
/** Medianoche UTC de hoy + n días (las columnas `date` se guardan así). */
const D = (n: number): Date => new Date(TODAY.getTime() + n * DAY_MS);
const isoOf = (n: number): string => D(n).toISOString().slice(0, 10);
/** `dd/mm` de hoy + n días, para los textos. */
const dm = (n: number): string => `${isoOf(n).slice(8, 10)}/${isoOf(n).slice(5, 7)}`;
/**
 * Instante «hoy + n días a las hh:mm hora de La Paz» (UTC-4, sin horario de verano). Nunca en el futuro: lo que
 * cae después de ahora se corre a un rato antes (algo ya ocurrido no puede tener fecha de mañana).
 */
const at = (n: number, hh = 10, mm = 0): Date => {
  const t = new Date(TODAY.getTime() + n * DAY_MS + (hh + 4) * 3_600_000 + mm * 60_000);
  return t.getTime() > NOW.getTime() ? new Date(NOW.getTime() - (1 + ((hh * 7 + mm) % 50)) * 60_000) : t;
};
/** Un instante FUTURO (vencimientos): hoy + n días a las hh:mm hora de La Paz, sin recortar. */
const future = (n: number, hh = 18, mm = 0): Date => new Date(TODAY.getTime() + n * DAY_MS + (hh + 4) * 3_600_000 + mm * 60_000);

/** «La semana siguiente» = lunes a viernes después de hoy (si hoy es lunes, el lunes de la semana que viene). */
const ISO_DOW = TODAY.getUTCDay() === 0 ? 7 : TODAY.getUTCDay();
const NEXT_MONDAY = 8 - ISO_DOW; // días desde hoy hasta ese lunes (1..7)

const round2 = (n: number): number => Math.round(n * 100) / 100;
const upper = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const md5Uuid = (s: string): string => {
  const h = createHash('md5').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
/** Mismo id determinista que el job «Cobrar cuota» (installment-reminders.service.ts): no se duplica al correr. */
const reminderId = (creditId: string, key: string | number): string => md5Uuid(`${creditId}|${key}`);
const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

// ═══════════════════════════════════════════════════════════════════════════════
// Catálogos de la cuenta (idempotente por el unique (account, catalog, code))
// ═══════════════════════════════════════════════════════════════════════════════

type CatalogSeed = { catalog: CatalogType; code: string; label: string; sortOrder: number; metadata?: object };
const CATALOGS: CatalogSeed[] = [
  { catalog: CatalogType.PAYMENT_METHOD, code: 'CASH', label: 'Efectivo', sortOrder: 1 },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'DEPOSIT', label: 'Depósito', sortOrder: 2, metadata: { requiresBank: true } },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'TRANSFER', label: 'Transferencia', sortOrder: 3, metadata: { requiresBank: true } },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'QR', label: 'QR', sortOrder: 4 },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'CHECK', label: 'Cheque', sortOrder: 5, metadata: { requiresBank: true } },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'MOBILE', label: 'Pago móvil', sortOrder: 6 },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'AGENCY', label: 'Agencia', sortOrder: 7 },
  { catalog: CatalogType.PAYMENT_METHOD, code: 'COLLECTOR', label: 'Cobrador', sortOrder: 8 },
  { catalog: CatalogType.BANK, code: 'BNB', label: 'Banco Nacional de Bolivia', sortOrder: 1 },
  { catalog: CatalogType.BANK, code: 'BCP', label: 'BCP', sortOrder: 2 },
  { catalog: CatalogType.BANK, code: 'BMSC', label: 'Banco Mercantil Santa Cruz', sortOrder: 3 },
  { catalog: CatalogType.BANK, code: 'BISA', label: 'Banco BISA', sortOrder: 4 },
  { catalog: CatalogType.BANK, code: 'UNION', label: 'Banco Unión', sortOrder: 5 },
  { catalog: CatalogType.BANK, code: 'FIE', label: 'Banco FIE', sortOrder: 6 },
  { catalog: CatalogType.BANK, code: 'SOL', label: 'Banco Sol', sortOrder: 7 },
  { catalog: CatalogType.BANK, code: 'ECOFUTURO', label: 'EcoFuturo', sortOrder: 8 },
  { catalog: CatalogType.PRIORITY, code: 'VERY_HIGH', label: 'Muy alta', sortOrder: 1 },
  { catalog: CatalogType.PRIORITY, code: 'HIGH', label: 'Alta', sortOrder: 2 },
  { catalog: CatalogType.PRIORITY, code: 'MEDIUM', label: 'Media', sortOrder: 3 },
  { catalog: CatalogType.PRIORITY, code: 'LOW', label: 'Baja', sortOrder: 4 },
  { catalog: CatalogType.EXPECTED_RESULT, code: 'COLLECT', label: 'Cobrar', sortOrder: 1 },
  { catalog: CatalogType.EXPECTED_RESULT, code: 'REMIND', label: 'Recordar', sortOrder: 2 },
  { catalog: CatalogType.EXPECTED_RESULT, code: 'CONFIRM_VISIT', label: 'Confirmar visita', sortOrder: 3 },
  { catalog: CatalogType.EXPECTED_RESULT, code: 'CONFIRM_PAYMENT', label: 'Confirmar pago', sortOrder: 4 },
  { catalog: CatalogType.EXPECTED_RESULT, code: 'NEGOTIATE', label: 'Negociar', sortOrder: 5 },
  { catalog: CatalogType.PHONE_TYPE, code: 'MOBILE', label: 'Celular', sortOrder: 1 },
  { catalog: CatalogType.PHONE_TYPE, code: 'OFFICE', label: 'Oficina', sortOrder: 2 },
  { catalog: CatalogType.PHONE_TYPE, code: 'HOME', label: 'Casa', sortOrder: 3 },
  { catalog: CatalogType.PHONE_TYPE, code: 'REFERENCE', label: 'Referencia', sortOrder: 4 },
  { catalog: CatalogType.ADDRESS_TYPE, code: 'HOME', label: 'Casa', sortOrder: 1 },
  { catalog: CatalogType.ADDRESS_TYPE, code: 'WORK', label: 'Trabajo', sortOrder: 2 },
  { catalog: CatalogType.ADDRESS_TYPE, code: 'BUSINESS', label: 'Negocio', sortOrder: 3 },
  { catalog: CatalogType.REMINDER_CATEGORY, code: 'PAYMENT', label: 'Pago', sortOrder: 1 },
  { catalog: CatalogType.REMINDER_CATEGORY, code: 'DOCUMENT', label: 'Documento', sortOrder: 2 },
  { catalog: CatalogType.REMINDER_CATEGORY, code: 'FOLLOWUP', label: 'Seguimiento', sortOrder: 3 },
  { catalog: CatalogType.CANCEL_REASON, code: 'CLIENT_UNAVAILABLE', label: 'Cliente no disponible', sortOrder: 1 },
  { catalog: CatalogType.CANCEL_REASON, code: 'WRONG_DATA', label: 'Datos incorrectos', sortOrder: 2 },
  { catalog: CatalogType.RESCHEDULE_REASON, code: 'CLIENT_REQUEST', label: 'A pedido del cliente', sortOrder: 1 },
  { catalog: CatalogType.RESCHEDULE_REASON, code: 'NO_ANSWER', label: 'Sin respuesta', sortOrder: 2 },
  { catalog: CatalogType.CURRENCY, code: 'BOB', label: 'Boliviano', sortOrder: 1 },
  { catalog: CatalogType.CURRENCY, code: 'USD', label: 'Dólar', sortOrder: 2 },
  // Clases de crédito y de garantía: cada empresa las edita, pero el catálogo no arranca vacío.
  { catalog: CatalogType.CREDIT_TYPE, code: 'CONSUMER', label: 'Crédito de consumo', sortOrder: 1 },
  { catalog: CatalogType.CREDIT_TYPE, code: 'PERSONAL', label: 'Préstamo personal', sortOrder: 2 },
  { catalog: CatalogType.CREDIT_TYPE, code: 'MICRO', label: 'Microcrédito', sortOrder: 3 },
  { catalog: CatalogType.CREDIT_TYPE, code: 'HOUSING', label: 'Vivienda', sortOrder: 4 },
  { catalog: CatalogType.COLLATERAL_TYPE, code: 'VEHICLE', label: 'Vehículo', sortOrder: 1 },
  { catalog: CatalogType.COLLATERAL_TYPE, code: 'PROPERTY', label: 'Inmueble', sortOrder: 2 },
  { catalog: CatalogType.COLLATERAL_TYPE, code: 'MACHINERY', label: 'Maquinaria', sortOrder: 3 },
  { catalog: CatalogType.COLLATERAL_TYPE, code: 'APPLIANCE', label: 'Electrodoméstico', sortOrder: 4 },
  { catalog: CatalogType.COLLATERAL_TYPE, code: 'OTHER', label: 'Otro', sortOrder: 5 },
  // Plantillas de WhatsApp (S4): el cuerpo va en `metadata.body` con variables {{cliente}}/{{saldo}}.
  { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'INITIAL', label: 'Cobro inicial', sortOrder: 1, metadata: { body: 'Hola {{cliente}}, le escribimos de Kobrax para recordarle su saldo pendiente de {{saldo}}. Puede coordinar su pago con nosotros.' } },
  { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'REMINDER', label: 'Recordatorio', sortOrder: 2, metadata: { body: 'Hola {{cliente}}, le recordamos que su pago de {{saldo}} vence pronto. Quedamos atentos.' } },
  { catalog: CatalogType.WHATSAPP_TEMPLATE, code: 'LAST_NOTICE', label: 'Último aviso', sortOrder: 3, metadata: { body: 'Hola {{cliente}}, su deuda de {{saldo}} se encuentra vencida. Le pedimos regularizar su pago a la brevedad para evitar cargos adicionales.' } },
  // Gestión especial en campo (S5 · RT-6).
  { catalog: CatalogType.SPECIAL_CATEGORY, code: 'DECEASED', label: 'Fallecimiento', sortOrder: 1 },
  { catalog: CatalogType.SPECIAL_CATEGORY, code: 'SERIOUS_ILLNESS', label: 'Enfermedad grave', sortOrder: 2 },
  { catalog: CatalogType.SPECIAL_CATEGORY, code: 'LONG_TRIP', label: 'Viaje prolongado', sortOrder: 3 },
  { catalog: CatalogType.SPECIAL_CATEGORY, code: 'LEGAL_DISPUTE', label: 'Conflicto legal', sortOrder: 4 },
  { catalog: CatalogType.SPECIAL_CATEGORY, code: 'OTHER', label: 'Otro', sortOrder: 5 },
];

/**
 * Configuración de importación de PSF de la cuenta demo (la forma de los reportes de `docs/flows/psf-diario`).
 * Mismo contenido que `apps/api/test/integration/fixtures/psf-import-config.json` + `staleAfterDays`.
 */
const IMPORT_CONFIG = {
  scope: { ref: null, kind: 'account' },
  fields: {
    code: { from: 'Nº Operación', enabled: true, required: true },
    phone: { from: 'Teléfonos', enabled: true },
    status: { from: 'Estado', enabled: true },
    address: { from: 'Dirección Domicilio', enabled: true },
    addressRef: { from: 'Ref. Domicilio', enabled: true },
    clientName: { from: 'Cliente', enabled: true, required: true },
    termMonths: { from: 'Plazo (M)', enabled: true },
    daysPastDue: { from: 'Días Atraso', enabled: true, calibrated: true },
    nextDueDate: { from: 'Fecha Próx. Pago', enabled: true },
    guarantorName: { from: 'Garante / Ref. Personal', enabled: true },
    pastDueAmount: { from: 'Total a Cobrar (Bs)', enabled: true },
    guarantorPhone: { from: 'Tel. Garante', enabled: true },
    businessAddress: { from: 'Negocio / Dirección', enabled: true },
    principalAmount: { from: 'Monto Crédito (Bs)', enabled: true },
    installmentAmount: { from: 'Cuota (Bs)', enabled: true },
    outstandingBalance: { from: 'Saldo Capital (Bs)', enabled: true },
  },
  source: 'file',
  profile: { kind: 'pdf-rows', headerRow: 1, recordStart: '', tableAnchor: 'Nº Operación' },
  nameOrder: 'full',
  absentRule: 'set-current',
  askOnLogin: true,
  balanceBasis: 'principal',
  carriesAssignee: false,
  staleAfterDays: 2,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Equipo
// ═══════════════════════════════════════════════════════════════════════════════

interface TeamMember {
  key: string;
  email: string;
  first: string;
  last: string;
  role: RoleType;
  branch?: 'CEN' | 'ALT';
  isOwner?: boolean;
  isDefault?: boolean;
  /** Membresía adicional en DEMO2 (los usuarios multi-empresa). */
  alsoDemo2?: RoleType;
  supervisor?: string;
}

const TEAM: TeamMember[] = [
  { key: 'owner', email: 'owner@kobrax.demo', first: 'Owner', last: 'Demo', role: RoleType.ACCOUNT_ADMIN, isOwner: true, isDefault: true },
  { key: 'manager', email: 'manager@kobrax.demo', first: 'Mónica', last: 'Manager', role: RoleType.MANAGER },
  { key: 'multi2', email: 'multi2@kobrax.demo', first: 'Marcos', last: 'Multi', role: RoleType.MANAGER, isDefault: true, alsoDemo2: RoleType.MANAGER },
  // Agencia 1 · Central
  { key: 'sandra', email: 'supervisor@kobrax.demo', first: 'Sandra', last: 'Supervisor', role: RoleType.SUPERVISOR, branch: 'CEN' },
  { key: 'carlos', email: 'collector@kobrax.demo', first: 'Carlos', last: 'Collector', role: RoleType.COLLECTOR, branch: 'CEN', supervisor: 'sandra' },
  { key: 'rosa', email: 'cobrador1@kobrax.demo', first: 'Rosa', last: 'Aliaga', role: RoleType.COLLECTOR, branch: 'CEN', supervisor: 'sandra' },
  { key: 'marco', email: 'cobrador2@kobrax.demo', first: 'Marco', last: 'Villca', role: RoleType.COLLECTOR, branch: 'CEN', supervisor: 'sandra' },
  // Agencia 2 · El Alto (su supervisora es multi@, que además administra DEMO2)
  { key: 'maria', email: 'multi@kobrax.demo', first: 'María', last: 'Multi', role: RoleType.SUPERVISOR, branch: 'ALT', isDefault: true, alsoDemo2: RoleType.ACCOUNT_ADMIN },
  { key: 'julia', email: 'cobrador3@kobrax.demo', first: 'Julia', last: 'Ticona', role: RoleType.COLLECTOR, branch: 'ALT', supervisor: 'maria' },
  { key: 'freddy', email: 'cobrador4@kobrax.demo', first: 'Freddy', last: 'Condori', role: RoleType.COLLECTOR, branch: 'ALT', supervisor: 'maria' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Personas (25 en DEMO). Todo ficticio; teléfonos de la serie 7000xxxx.
// ═══════════════════════════════════════════════════════════════════════════════

/** Barrios de La Paz / El Alto con su punto aproximado; cada persona suma un pequeño desvío. */
const ZONES: Record<string, { lat: number; lng: number }> = {
  Sopocachi: { lat: -16.5113, lng: -68.1262 },
  Miraflores: { lat: -16.5035, lng: -68.118 },
  Calacoto: { lat: -16.5394, lng: -68.083 },
  Obrajes: { lat: -16.5298, lng: -68.106 },
  'San Pedro': { lat: -16.4995, lng: -68.1366 },
  'Villa Fátima': { lat: -16.488, lng: -68.119 },
  Achumani: { lat: -16.5448, lng: -68.0746 },
  'Los Pinos': { lat: -16.5342, lng: -68.0931 },
  'El Alto · Ceja': { lat: -16.5043, lng: -68.1636 },
  'El Alto · Villa Adela': { lat: -16.4977, lng: -68.1845 },
  'El Alto · 16 de Julio': { lat: -16.5098, lng: -68.1721 },
  'El Alto · Ciudad Satélite': { lat: -16.4912, lng: -68.1798 },
  Centro: { lat: -16.4959, lng: -68.1336 },
};

interface PersonSpec {
  key: string;
  doc?: string;
  first: string;
  last: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  zone: keyof typeof ZONES | string;
  address: string;
  phone: string;
  phoneNote?: string;
  /** Segundo teléfono / WhatsApp / correo. */
  phone2?: string;
  whatsapp?: string;
  email?: string;
  ref?: string;
  /** Segunda ubicación (negocio / trabajo). */
  business?: { address: string; zone: string; ref?: string };
  psf?: boolean;
  noCoords?: boolean;
  meta?: Record<string, unknown>;
  linkReviewPending?: boolean;
}

let jitterSeq = 0;
const jitter = (): number => ((jitterSeq++ * 37) % 17) / 3000 - 0.0028;

const PEOPLE: PersonSpec[] = [
  // ── Créditos creados en la app ──
  { key: 'c01', doc: 'DEMO-0001', first: 'Lidia', last: 'Mamani Vargas', risk: 'HIGH', zone: 'Sopocachi', address: 'Calle Fernando Guachalla #1245, edif. Los Andes, piso 2', phone: '70000101', phoneNote: 'Celular', phone2: '22200101', whatsapp: '70000101', email: 'lidia.mamani@ejemplo.test', ref: 'Puerta azul, junto a la farmacia', business: { address: 'Mercado Rodríguez, puesto 14 (abarrotes)', zone: 'Centro', ref: 'Pasillo de las verduras' } },
  { key: 'c02', doc: 'DEMO-0002', first: 'Wilson', last: 'Choque Apaza', risk: 'LOW', zone: 'Miraflores', address: 'Av. Busch #820', phone: '70000102', whatsapp: '70000102' },
  { key: 'c03', doc: 'DEMO-0003', first: 'Elena', last: 'Gutiérrez Rojas', risk: 'LOW', zone: 'San Pedro', address: 'Calle Yanacocha #455', phone: '70000103', phone2: '70000113', business: { address: 'Calle Bueno #210, local 3 (venta de ropa)', zone: 'Centro' } },
  { key: 'c04', doc: 'DEMO-0004', first: 'Hugo', last: 'Nina Colque', risk: 'MEDIUM', zone: 'Obrajes', address: 'Calle 4 de Obrajes #310', phone: '70000104' },
  { key: 'c05', doc: 'DEMO-0005', first: 'Sonia', last: 'Flores Ticona', risk: 'LOW', zone: 'Villa Fátima', address: 'Av. Las Américas #77', phone: '70000105', whatsapp: '70000105' },
  { key: 'c06', doc: 'DEMO-0006', first: 'Mario', last: 'Callisaya Poma', risk: 'MEDIUM', zone: 'El Alto · Villa Adela', address: 'Calle 6 #1203, Villa Adela', phone: '70000106' },
  { key: 'c07', doc: 'DEMO-0007', first: 'Gladys', last: 'Villca Arce', risk: 'LOW', zone: 'El Alto · Ceja', address: 'Av. 6 de Marzo #540', phone: '70000107', email: 'gladys.villca@ejemplo.test' },
  { key: 'c08', doc: 'DEMO-0008', first: 'Freddy', last: 'Tarqui Limachi', risk: 'MEDIUM', zone: 'Calacoto', address: 'Calle 12 de Calacoto #890', phone: '70000108', whatsapp: '70000108' },
  { key: 'c09', doc: 'DEMO-0009', first: 'Norma', last: 'Huanca Cruz', risk: 'MEDIUM', zone: 'Achumani', address: 'Calle 3 de Achumani #145', phone: '70000109' },
  { key: 'c10', doc: 'DEMO-0010', first: 'Édgar', last: 'Alanoca Mendoza', risk: 'MEDIUM', zone: 'El Alto · 16 de Julio', address: 'Feria 16 de Julio, calle 3 #62', phone: '70000110', phone2: '70000120' },
  { key: 'c11', doc: 'DEMO-0011', first: 'Silvia', last: 'Condori Layme', risk: 'HIGH', zone: 'Los Pinos', address: 'Av. Los Pinos #233', phone: '70000111', whatsapp: '70000111' },
  { key: 'c12', doc: 'DEMO-0012', first: 'Rubén', last: 'Apaza Yujra', risk: 'HIGH', zone: 'El Alto · Ciudad Satélite', address: 'Calle 2 #918, Ciudad Satélite', phone: '70000112', business: { address: 'Av. Satélite #55 (taller mecánico)', zone: 'El Alto · Ciudad Satélite' } },
  { key: 'c13', doc: 'DEMO-0013', first: 'Teresa', last: 'Aguilar Choque', risk: 'HIGH', zone: 'San Pedro', address: 'Calle Pedro Salazar #119', phone: '70000113', ref: 'Frente a la iglesia' },
  { key: 'c14', doc: 'DEMO-0014', first: 'Pedro', last: 'Ticona Lima', risk: 'HIGH', zone: 'El Alto · Ceja', address: 'Calle Bolívar #77, Ceja', phone: '70000114' },
  { key: 'c15', doc: 'DEMO-0015', first: 'Carmen', last: 'Laura Nina', risk: 'LOW', zone: 'Sopocachi', address: 'Calle Belisario Salinas #610', phone: '70000115' },
  { key: 'c16', doc: 'DEMO-0016', first: 'Vilma', last: 'Cori Mamani', risk: 'LOW', zone: 'El Alto · Villa Adela', address: 'Calle 9 #330, Villa Adela', phone: '70000116' },
  // ── Créditos importados de PSF (el reporte trae nombre, teléfono y dirección; sin documento) ──
  { key: 'c17', first: 'Wilfredo', last: 'Ramos Tola', risk: 'MEDIUM', zone: 'El Alto · Ciudad Satélite', address: 'Av. Bolivia #1665, Zona Alto Lima', phone: '70000117', psf: true, ref: 'Parada línea 380' },
  { key: 'c18', first: 'Juana', last: 'Salinas Huanca', risk: 'MEDIUM', zone: 'El Alto · 16 de Julio', address: 'Calle Jorge Carrasco #780, Zona Santiago I', phone: '70000118', psf: true, ref: 'Frente a la capilla' },
  { key: 'c19', first: 'Grover', last: 'Paco Quenta', risk: 'HIGH', zone: 'El Alto · Villa Adela', address: 'Calle 14 #402, Villa Adela', phone: '70000119', psf: true, noCoords: true },
  { key: 'c20', first: 'Teresa', last: 'Aguilar Choque', risk: 'MEDIUM', zone: 'El Alto · Ceja', address: 'Av. Juan Pablo II #88', phone: '70000121', psf: true, noCoords: true, linkReviewPending: true },
  { key: 'c21', first: 'Delia', last: 'Pinto Ayala', risk: 'MEDIUM', zone: 'El Alto · Ceja', address: 'Calle Tumusla #251', phone: '70000122', psf: true, noCoords: true },
  { key: 'c22', first: 'Nelson', last: 'Cusi Chambi', risk: 'MEDIUM', zone: 'El Alto · 16 de Julio', address: 'Calle Sucre #120', phone: '70000123', psf: true, noCoords: true },
  // ── Sin crédito (prospectos de cartera) ──
  { key: 'c23', doc: 'DEMO-0023', first: 'Rocío', last: 'Maldonado Vera', risk: 'LOW', zone: 'Sopocachi', address: 'Av. Arce #2150', phone: '70000124' },
  { key: 'c24', doc: 'DEMO-0024', first: 'Luis', last: 'Fernández Soria', risk: 'LOW', zone: 'Calacoto', address: 'Calle 18 de Calacoto #330', phone: '70000125' },
  { key: 'c25', doc: 'DEMO-0025', first: 'Marcos', last: 'Zeballos Nogales', risk: 'MEDIUM', zone: 'Obrajes', address: 'Calle 5 de Obrajes #101', phone: '70000126' },
];

const PEOPLE_DEMO2: PersonSpec[] = [
  { key: 'd01', doc: 'DEMO2-0001', first: 'Alicia', last: 'Vargas Rocha', risk: 'LOW', zone: 'Centro', address: 'Calle Comercio #120', phone: '70001001' },
  { key: 'd02', doc: 'DEMO2-0002', first: 'Bruno', last: 'Salas Medina', risk: 'MEDIUM', zone: 'Miraflores', address: 'Av. Saavedra #455', phone: '70001002', whatsapp: '70001002' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Créditos creados en la app
// ═══════════════════════════════════════════════════════════════════════════════

interface Partial_ {
  day: number;
  amount: number;
  method: PaymentMethod;
  channel?: PaymentChannel;
  bank?: string;
  notes?: string;
}

interface AppCreditSpec {
  key: string;
  code: string;
  client: string;
  owner: string;
  typeCode: string;
  principal: number;
  n: number;
  /** Días entre cuotas: 30 = mensual, 7 = semanal. */
  step: number;
  /** Tasa por periodo (informativa). */
  rate: number;
  paid: number;
  /** Días de mora. 0 = al día. */
  dpd: number;
  /** Al día: en cuántos días vence la primera cuota impaga. */
  nextIn?: number;
  /** Pagos parciales sobre la primera cuota impaga. */
  partials?: Partial_[];
  /** Día (relativo) en que se pagó cada cuota (si no, un poco antes o después del vencimiento). */
  paidOn?: Record<number, number>;
  paidOff?: boolean;
  writtenOff?: { day: number; by: string; reason: string };
  /** Cuota pagada n° → método (si no, rota). */
  methods?: Record<number, PaymentMethod>;
}

const APP_CREDITS: AppCreditSpec[] = [
  // La estrella: en mora, categoría B, 47 días. Cuota 590 (500 capital + 90 interés), 24 cuotas mensuales.
  {
    key: 'star', code: 'CRD-DEMO-0001', client: 'c01', owner: 'carlos', typeCode: 'CONSUMER', principal: 12000, n: 24, step: 30, rate: 0.0225, paid: 8, dpd: 47,
    paidOn: { 1: -286, 2: -255, 3: -225, 4: -170, 5: -166, 6: -135, 7: -52, 8: -51 },
    methods: { 1: PaymentMethod.CASH, 2: PaymentMethod.TRANSFER, 3: PaymentMethod.CASH, 4: PaymentMethod.QR, 5: PaymentMethod.CASH, 6: PaymentMethod.MOBILE_PAYMENT, 7: PaymentMethod.CASH, 8: PaymentMethod.TRANSFER },
    partials: [
      { day: -33, amount: 150, method: PaymentMethod.CASH, notes: 'Cumplió la promesa del día' },
      { day: -12, amount: 100, method: PaymentMethod.QR, channel: PaymentChannel.EXTERNAL_CONFIRMED, notes: 'Pagó por QR del banco; el cobrador lo confirmó' },
    ],
  },
  // Al día (7): el segundo crédito de la estrella y seis más.
  { key: 'c01b', code: 'CRD-DEMO-0002', client: 'c01', owner: 'carlos', typeCode: 'PERSONAL', principal: 3000, n: 6, step: 30, rate: 0.03, paid: 2, dpd: 0, nextIn: 12 },
  { key: 'c02', code: 'CRD-DEMO-0003', client: 'c02', owner: 'carlos', typeCode: 'CONSUMER', principal: 5000, n: 12, step: 30, rate: 0.022, paid: 4, dpd: 0, nextIn: 2 },
  { key: 'c03', code: 'CRD-DEMO-0004', client: 'c03', owner: 'carlos', typeCode: 'MICRO', principal: 1200, n: 10, step: 7, rate: 0.01, paid: 3, dpd: 0, nextIn: 1 },
  { key: 'c04', code: 'CRD-DEMO-0005', client: 'c04', owner: 'rosa', typeCode: 'PERSONAL', principal: 2500, n: 10, step: 30, rate: 0.025, paid: 5, dpd: 0, nextIn: 18 },
  { key: 'c05', code: 'CRD-DEMO-0006', client: 'c05', owner: 'marco', typeCode: 'MICRO', principal: 4000, n: 12, step: 30, rate: 0.02, paid: 6, dpd: 0, nextIn: 9 },
  { key: 'c06', code: 'CRD-DEMO-0007', client: 'c06', owner: 'julia', typeCode: 'CONSUMER', principal: 6500, n: 18, step: 30, rate: 0.021, paid: 7, dpd: 0, nextIn: 21 },
  { key: 'c07', code: 'CRD-DEMO-0008', client: 'c07', owner: 'sandra', typeCode: 'HOUSING', principal: 18000, n: 36, step: 30, rate: 0.015, paid: 10, dpd: 0, nextIn: 14 },
  // Categoría A (1–30)
  { key: 'c08', code: 'CRD-DEMO-0009', client: 'c08', owner: 'carlos', typeCode: 'CONSUMER', principal: 4500, n: 12, step: 30, rate: 0.022, paid: 5, dpd: 12, partials: [{ day: 0, amount: 380, method: PaymentMethod.CASH, notes: 'Cobrado en la ruta de hoy' }] },
  { key: 'c09', code: 'CRD-DEMO-0010', client: 'c09', owner: 'rosa', typeCode: 'PERSONAL', principal: 3500, n: 10, step: 30, rate: 0.024, paid: 3, dpd: 21 },
  { key: 'c10', code: 'CRD-DEMO-0011', client: 'c10', owner: 'freddy', typeCode: 'MICRO', principal: 2200, n: 8, step: 30, rate: 0.026, paid: 2, dpd: 28 },
  // Categoría B (31–60)
  { key: 'c11', code: 'CRD-DEMO-0012', client: 'c11', owner: 'marco', typeCode: 'CONSUMER', principal: 7000, n: 18, step: 30, rate: 0.023, paid: 6, dpd: 38 },
  // Categoría C (61+)
  { key: 'c12', code: 'CRD-DEMO-0013', client: 'c12', owner: 'julia', typeCode: 'MICRO', principal: 9000, n: 24, step: 30, rate: 0.02, paid: 9, dpd: 75 },
  { key: 'c13', code: 'CRD-DEMO-0014', client: 'c13', owner: 'carlos', typeCode: 'CONSUMER', principal: 15000, n: 24, step: 30, rate: 0.021, paid: 8, dpd: 130 },
  // Castigado: 240 días de mora y castigado (la mora sigue corriendo, el castigo es una condición aparte).
  { key: 'c14', code: 'CRD-DEMO-0015', client: 'c14', owner: 'maria', typeCode: 'PERSONAL', principal: 6000, n: 12, step: 30, rate: 0.03, paid: 3, dpd: 240, writtenOff: { day: -20, by: 'maria', reason: 'Incobrable: 240 días de mora y gestiones de campo agotadas' } },
  // Cancelados (historial de la cartera)
  { key: 'c15', code: 'CRD-DEMO-0016', client: 'c15', owner: 'marco', typeCode: 'PERSONAL', principal: 1500, n: 6, step: 30, rate: 0.025, paid: 6, dpd: 0, paidOff: true },
  { key: 'c16', code: 'CRD-DEMO-0017', client: 'c16', owner: 'freddy', typeCode: 'MICRO', principal: 2000, n: 8, step: 30, rate: 0.02, paid: 8, dpd: 0, paidOff: true },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Créditos importados (PSF). Números de operación ficticios con la forma de los reportes.
// ═══════════════════════════════════════════════════════════════════════════════

interface PsfSpec {
  key: string;
  externalId: string;
  client: string;
  owner: string;
  advisor: string;
  principal: number;
  /** Saldo capital reportado en la última corrida. */
  balance: number;
  installment: number;
  termM: number;
  /** Días de atraso reportados HOY (la última corrida). Ausente: los del último reporte que lo trajo. */
  dpd: number;
  status: string;
  /** Cuándo fue el último pago / cuándo vence el próximo, según el reporte (días relativos). */
  lastPay: number;
  nextDue: number;
  /** Corridas (A, B, C = hace 2 días, ayer, hoy; D = el reporte viejo de otro asesor) en que vino. */
  runs: ('A' | 'B' | 'C' | 'D')[];
  guarantor?: { name: string; phone: string };
}

const PSF_CREDITS: PsfSpec[] = [
  { key: 'p1', externalId: '302-441-0187', client: 'c17', owner: 'carlos', advisor: 'CQE', principal: 16000, balance: 12998.25, installment: 627.73, termM: 36, dpd: 4, status: 'Vigente en mora', lastPay: -3, nextDue: 2, runs: ['A', 'B', 'C'], guarantor: { name: 'Efraín Condori Tarqui', phone: '63998295' } },
  { key: 'p2', externalId: '302-441-0192', client: 'c18', owner: 'carlos', advisor: 'CQE', principal: 6000, balance: 3354.78, installment: 317.23, termM: 24, dpd: 35, status: 'Vigente en mora', lastPay: -38, nextDue: -5, runs: ['A', 'B', 'C'], guarantor: { name: 'Norma Alanoca Chura', phone: '68100279' } },
  { key: 'p3', externalId: '302-441-0203', client: 'c19', owner: 'carlos', advisor: 'CQE', principal: 4000, balance: 2177.75, installment: 266.81, termM: 18, dpd: 75, status: 'Ejecución', lastPay: -80, nextDue: -45, runs: ['A', 'B', 'C'] },
  { key: 'p4', externalId: '302-441-0219', client: 'c20', owner: 'rosa', advisor: 'CQE', principal: 3000, balance: 2410.0, installment: 180.5, termM: 18, dpd: 18, status: 'Vigente en mora', lastPay: -20, nextDue: -8, runs: ['B', 'C'] },
  // Ausente del reporte de hoy: antes tenía 52 días de mora; con la regla «al día» su mora quedó en 0.
  { key: 'p5', externalId: '302-441-0224', client: 'c21', owner: 'carlos', advisor: 'CQE', principal: 5200, balance: 4800.0, installment: 290.0, termM: 24, dpd: 0, status: 'Vigente en mora', lastPay: -55, nextDue: -22, runs: ['A', 'B'] },
  // Dato viejo: lo trajo el reporte de otro asesor (MRT) hace 9 días y no volvió.
  { key: 'p6', externalId: '302-557-0031', client: 'c22', owner: 'freddy', advisor: 'MRT', principal: 2500, balance: 1900.0, installment: 150.0, termM: 18, dpd: 27, status: 'Vigente en mora', lastPay: -40, nextDue: 2, runs: ['D'] },
];
/** Fecha de corte de cada corrida (días relativos a hoy). */
const RUN_DAY: Record<'A' | 'B' | 'C' | 'D', number> = { A: -2, B: -1, C: 0, D: -9 };

// ═══════════════════════════════════════════════════════════════════════════════
// Contexto por cuenta y utilidades de inserción
// ═══════════════════════════════════════════════════════════════════════════════

interface PersonRef {
  id: string;
  key: string;
  contactIds: string[];
  whatsappId?: string;
  homeId: string;
  businessId?: string;
  lat: number;
  lng: number;
  name: string;
}

interface CreditRef {
  id: string;
  key: string;
  code: string;
  clientId: string;
  clientKey: string;
  ownerKey: string;
  ownerId: string;
  dpd: number;
  /** Cuotas: id, número, vencimiento (relativo en días) e importe. */
  installments: { id: string; number: number; due: number; amount: number }[];
  balance: number;
  psf: boolean;
}

interface Ctx {
  acc: string;
  /** user key → user id (usuarios de ESTA cuenta). */
  users: Record<string, string>;
  /** user key → branch id. */
  userBranch: Record<string, string>;
  people: Record<string, PersonRef>;
  credits: Record<string, CreditRef>;
  payments: Prisma.PaymentCreateManyInput[];
  episodes: { id: string; creditId: string; startedAt: string; endedAt: string | null }[];
  lastAction: Map<string, Date>;
}

const newCtx = (acc: string, users: Record<string, string>, userBranch: Record<string, string>): Ctx => ({
  acc,
  users,
  userBranch,
  people: {},
  credits: {},
  payments: [],
  episodes: [],
  lastAction: new Map(),
});

/** Cada gestión que se siembra deja su huella para `credits.last_action_at`. */
function touch(ctx: Ctx, creditId: string, when: Date): void {
  const prev = ctx.lastAction.get(creditId);
  if (!prev || prev < when) ctx.lastAction.set(creditId, when);
}

async function createPeople(ctx: Ctx, specs: PersonSpec[]): Promise<void> {
  const clients: Prisma.ClientCreateManyInput[] = [];
  const contacts: Prisma.ClientContactCreateManyInput[] = [];
  const locations: Prisma.ClientLocationCreateManyInput[] = [];
  for (const s of specs) {
    const id = randomUUID();
    const z = ZONES[s.zone] ?? ZONES['Centro']!;
    const lat = round6(z.lat + jitter());
    const lng = round6(z.lng + jitter());
    const ref: PersonRef = { id, key: s.key, contactIds: [], homeId: randomUUID(), lat, lng, name: `${s.first} ${s.last}` };
    clients.push({
      id,
      accountId: ctx.acc,
      clientType: ClientType.PERSON,
      firstName: s.first,
      lastName: s.last,
      ...(s.doc ? { nationalId: encryptPII(s.doc), nationalIdHash: blindHash(s.doc) } : {}),
      riskSegment: s.risk,
      preferredContactChannel: s.whatsapp ? 'WHATSAPP' : 'PHONE',
      linkReviewPending: s.linkReviewPending ?? false,
      metadata: json(s.meta ?? (s.psf ? { origin: 'import', externalSource: 'PSF' } : { origin: 'manual' })),
    });
    const addContact = (type: ContactType, value: string, primary: boolean, notes?: string): string => {
      const cid = randomUUID();
      contacts.push({ id: cid, accountId: ctx.acc, clientId: id, contactType: type, value: encryptPII(value), isPrimary: primary, isVerified: primary, notes });
      return cid;
    };
    ref.contactIds.push(addContact(ContactType.PHONE, s.phone, true, s.phoneNote ?? 'Celular'));
    if (s.phone2) ref.contactIds.push(addContact(ContactType.PHONE, s.phone2, false, 'Referencia'));
    if (s.whatsapp) ref.whatsappId = addContact(ContactType.WHATSAPP, s.whatsapp, false, 'WhatsApp');
    if (s.email) addContact(ContactType.EMAIL, s.email, false, 'Correo');
    locations.push({
      id: ref.homeId,
      accountId: ctx.acc,
      clientId: id,
      locationType: LocationType.HOME,
      address: encryptPII(s.address),
      zone: s.zone,
      ...(s.noCoords ? {} : { latitude: lat, longitude: lng }),
      referenceNotes: s.ref,
    });
    if (s.business) {
      ref.businessId = randomUUID();
      const bz = ZONES[s.business.zone] ?? z;
      locations.push({
        id: ref.businessId,
        accountId: ctx.acc,
        clientId: id,
        locationType: LocationType.WORK,
        address: encryptPII(s.business.address),
        zone: s.business.zone,
        latitude: round6(bz.lat + jitter()),
        longitude: round6(bz.lng + jitter()),
        referenceNotes: s.business.ref,
      });
    }
    ctx.people[s.key] = ref;
  }
  await prisma.client.createMany({ data: clients });
  await prisma.clientContact.createMany({ data: contacts });
  await prisma.clientLocation.createMany({ data: locations });
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const METHOD_ROTATION: PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CASH, PaymentMethod.QR, PaymentMethod.CASH, PaymentMethod.MOBILE_PAYMENT];

/** Un pago en cola: el comprobante se numera al final, en orden cronológico. */
function queuePayment(
  ctx: Ctx,
  p: { creditId: string; installmentId?: string; amount: number; method: PaymentMethod; channel?: PaymentChannel; day: number; hh?: number; by: string; notes?: string; bank?: string; tx?: string },
): void {
  const channel = p.channel ?? (p.method === PaymentMethod.CASH || p.method === PaymentMethod.CARD ? PaymentChannel.KOBRAX_COLLECTED : PaymentChannel.EXTERNAL_CONFIRMED);
  ctx.payments.push({
    id: randomUUID(),
    accountId: ctx.acc,
    creditId: p.creditId,
    installmentId: p.installmentId,
    amount: p.amount,
    method: p.method,
    channel,
    provider: p.bank,
    externalTransactionId: channel === PaymentChannel.EXTERNAL_CONFIRMED ? (p.tx ?? `TX-${p.creditId.slice(0, 8)}-${p.day}`) : undefined,
    paymentDate: at(p.day, p.hh ?? 11, 30),
    registeredBy: p.by,
    notes: p.notes,
  });
}

/** Numera y escribe los pagos de la cuenta (cronológicamente: el comprobante más alto es el más nuevo). */
async function flushPayments(ctx: Ctx): Promise<number> {
  const rows = [...ctx.payments].sort((a, b) => (a.paymentDate as Date).getTime() - (b.paymentDate as Date).getTime());
  rows.forEach((r, i) => ((r as { receiptNumber?: number }).receiptNumber = i + 1));
  if (rows.length > 0) await prisma.payment.createMany({ data: rows });
  return rows.length;
}

/** Crédito de la app: cronograma, cuotas pagadas con su pago, parciales sobre la primera impaga, mora y responsable. */
async function createAppCredits(ctx: Ctx, specs: AppCreditSpec[], branchOf: (ownerKey: string) => string | undefined): Promise<void> {
  const credits: Prisma.CreditCreateManyInput[] = [];
  const installments: Prisma.CreditInstallmentCreateManyInput[] = [];
  const arrears: Prisma.ArrearCreateManyInput[] = [];
  const assignments: Prisma.CreditAssignmentCreateManyInput[] = [];

  for (const s of specs) {
    const person = ctx.people[s.client]!;
    const ownerId = ctx.users[s.owner]!;
    const id = randomUUID();
    const amount = round2((s.principal * (1 + s.rate * s.n * 0.6)) / s.n);
    const principalPart = round2(s.principal / s.n);
    const interestPart = round2(amount - principalPart);
    const firstUnpaid = s.paid + 1;
    // Vencimiento (relativo a hoy) de la primera cuota impaga.
    const anchor = s.paidOff ? -15 + s.step : s.dpd > 0 ? -s.dpd : (s.nextIn ?? 10);
    const dueOf = (j: number): number => anchor + (j - firstUnpaid) * s.step;
    const partialsTotal = (s.partials ?? []).reduce((t, p) => t + p.amount, 0);
    const refInst: CreditRef['installments'] = [];

    let partialLeft = partialsTotal;
    let overdueAmount = 0;
    for (let j = 1; j <= s.n; j++) {
      const due = dueOf(j);
      const instId = randomUUID();
      refInst.push({ id: instId, number: j, due, amount });
      const isPaid = j <= s.paid;
      let status: InstallmentStatus = InstallmentStatus.PENDING;
      let paidAmount = 0;
      let paidAt: Date | null = null;
      if (isPaid) {
        status = InstallmentStatus.PAID;
        paidAmount = amount;
        const payDay = Math.min(s.paidOn?.[j] ?? due - (j % 3), -1);
        paidAt = at(payDay, 11, 30);
        queuePayment(ctx, {
          creditId: id,
          installmentId: instId,
          amount,
          method: s.methods?.[j] ?? METHOD_ROTATION[j % METHOD_ROTATION.length]!,
          day: payDay,
          by: ownerId,
          bank: undefined,
        });
      } else {
        if (j === firstUnpaid && partialLeft > 0) {
          paidAmount = Math.min(partialLeft, amount);
          partialLeft -= paidAmount;
          status = paidAmount >= amount ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL;
        }
        if (due < 0 && status !== InstallmentStatus.PAID) {
          if (status === InstallmentStatus.PENDING) status = InstallmentStatus.OVERDUE;
          overdueAmount += amount - paidAmount;
        }
      }
      installments.push({
        id: instId,
        accountId: ctx.acc,
        creditId: id,
        number: j,
        dueDate: D(due),
        amount,
        principal: principalPart,
        interest: interestPart,
        paidAmount,
        status,
        paidAt,
      });
      // Los parciales se asientan sobre la primera impaga.
      if (j === firstUnpaid) {
        for (const p of s.partials ?? []) {
          queuePayment(ctx, { creditId: id, installmentId: instId, amount: p.amount, method: p.method, channel: p.channel, day: p.day, hh: 9, by: ownerId, notes: p.notes, bank: p.bank });
        }
      }
    }

    const balance = s.paidOff ? 0 : Math.max(0, round2(s.principal - s.paid * principalPart - partialsTotal * (principalPart / amount)));
    const writtenOff = s.writtenOff;
    credits.push({
      id,
      accountId: ctx.acc,
      clientId: person.id,
      branchId: branchOf(s.owner),
      code: s.code,
      typeCode: s.typeCode,
      principalAmount: s.principal,
      outstandingBalance: balance,
      interestRate: s.rate,
      currency: 'BOB',
      installmentsCount: s.n,
      status: s.paidOff ? CreditStatus.PAID : CreditStatus.ACTIVE,
      daysPastDue: s.dpd,
      assignedManagerId: ownerId,
      disbursedAt: D(dueOf(1) - s.step),
      origin: CreditDataOrigin.MANUAL,
      ...(writtenOff ? { writtenOffAt: at(writtenOff.day, 10, 0), writtenOffBy: ctx.users[writtenOff.by], writtenOffReason: writtenOff.reason } : {}),
      metadata: json({
        frequency: s.step === 7 ? 'WEEKLY' : 'MONTHLY',
        origin: 'manual',
        installmentAmount: amount,
        ...(s.paidOff ? {} : { nextDueDate: isoOf(dueOf(firstUnpaid)) }),
      }),
    });
    if (s.dpd > 0) {
      arrears.push({ accountId: ctx.acc, creditId: id, daysOverdue: s.dpd, overdueAmount: round2(overdueAmount), interest: round2(overdueAmount * 0.02), penalty: round2(overdueAmount * 0.01) });
    }
    // El responsable: la fila PRINCIPAL de `credit_assignments` + `assigned_manager_id` (lo que escribe AssignmentService).
    assignments.push({
      accountId: ctx.acc,
      creditId: id,
      userId: ownerId,
      kind: CreditAssignmentKind.PRINCIPAL,
      startsAt: at(-(60 + ((s.n * 7) % 240)), 9, 0),
      grantedBy: ctx.users[ownerSupervisor(s.owner)],
    });
    ctx.credits[s.key] = { id, key: s.key, code: s.code, clientId: person.id, clientKey: s.client, ownerKey: s.owner, ownerId, dpd: s.dpd, installments: refInst, balance, psf: false };
  }
  await prisma.credit.createMany({ data: credits });
  await prisma.creditInstallment.createMany({ data: installments });
  if (arrears.length > 0) await prisma.arrear.createMany({ data: arrears });
  await prisma.creditAssignment.createMany({ data: assignments });
}

/** Quién otorgó la asignación: el supervisor de la agencia del cobrador (o el administrador). */
function ownerSupervisor(ownerKey: string): string {
  const m = TEAM.find((t) => t.key === ownerKey);
  return m?.supervisor ?? (m?.role === RoleType.SUPERVISOR ? ownerKey : 'owner');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agenda, gestiones y notas: ayudas
// ═══════════════════════════════════════════════════════════════════════════════

interface DataSets {
  agenda: Prisma.AgendaItemCreateManyInput[];
  activities: Prisma.CreditActivityCreateManyInput[];
}

/** El episodio de mora del crédito que contiene a ese día (o ninguno: acción preventiva). */
function episodeAt(ctx: Ctx, creditId: string, day: number): string | null {
  const iso = isoOf(day);
  const ep = ctx.episodes
    .filter((e) => e.creditId === creditId && e.startedAt <= iso && (e.endedAt === null || e.endedAt >= iso))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  return ep?.id ?? null;
}

function newDataSets(): DataSets {
  return { agenda: [], activities: [] };
}

const ACTIVITY_OF: Record<AgendaItemType, CreditActivityType> = {
  [AgendaItemType.CALL]: CreditActivityType.CALL,
  [AgendaItemType.VISIT]: CreditActivityType.VISIT,
  [AgendaItemType.WHATSAPP]: CreditActivityType.MESSAGE,
  [AgendaItemType.REMINDER]: CreditActivityType.NOTE,
  [AgendaItemType.PROMISE_TO_PAY]: CreditActivityType.CALL,
};

interface ItemOpts {
  key: string;
  type: AgendaItemType;
  status?: AgendaItemStatus;
  day: number;
  time?: string;
  slot?: 'MORNING' | 'AFTERNOON' | 'NIGHT';
  assignee?: string;
  details?: Record<string, unknown>;
  obs?: string;
  priority?: string;
  expected?: string;
  id?: string;
  reason?: string;
  fromId?: string;
  /** Si está ejecutada: resultado de la gestión. */
  result?: string;
  resultNotes?: string;
  resultId?: string;
  handoff?: { from: string; assignmentId: string };
  createdDay?: number;
}

/** Un agendado sobre un crédito. Si ya está ejecutado, escribe también la gestión que lo ejecutó. */
function addItem(ctx: Ctx, ds: DataSets, o: ItemOpts): string {
  const credit = ctx.credits[o.key]!;
  const person = ctx.people[credit.clientKey]!;
  const assigneeId = o.assignee ? ctx.users[o.assignee]! : credit.ownerId;
  let details: Record<string, unknown> = o.details ?? {};
  if (!o.details) {
    if (o.type === AgendaItemType.CALL) details = { contactId: person.contactIds[0] };
    else if (o.type === AgendaItemType.WHATSAPP) details = { contactId: person.whatsappId ?? person.contactIds[0], message: 'Hola, ¿coordinamos el pago de esta semana?' };
    else if (o.type === AgendaItemType.VISIT) details = { locationId: person.homeId };
    else if (o.type === AgendaItemType.REMINDER) details = { description: 'Cobrar cuota' };
  }
  // El seed escribe `details` directo en la DB, saltándose el DTO: mismo validador que corre el servidor.
  const check = validateAgendaDetails(o.type, details);
  if (!check.ok) throw new Error(`seed: details inválidos para ${o.type} de ${o.key}: ${check.errors.join('; ')}`);
  details = { ...(check.value as unknown as Record<string, unknown>) };
  if (o.handoff) details = { ...details, handoffFromUserId: o.handoff.from, handoffAssignmentId: o.handoff.assignmentId };

  const status = o.status ?? (o.day < 0 ? AgendaItemStatus.EXECUTED : AgendaItemStatus.SCHEDULED);
  let resultActivityId: string | undefined;
  if (status === AgendaItemStatus.EXECUTED) {
    resultActivityId = o.resultId ?? randomUUID();
    // Con `resultId` la gestión ya se escribió aparte (promesa cumplida/incumplida, visita de la ruta): no se duplica.
    if (!o.resultId) {
      const result =
        o.result ??
        (o.type === AgendaItemType.REMINDER ? undefined : o.type === AgendaItemType.VISIT ? 'CONTACTED' : o.type === AgendaItemType.PROMISE_TO_PAY ? 'PROMISE_KEPT' : 'CONTACTED');
      const when = at(o.day, o.time ? Number(o.time.slice(0, 2)) : 10, o.time ? Number(o.time.slice(3, 5)) : 15);
      ds.activities.push({
        id: resultActivityId,
        accountId: ctx.acc,
        creditId: credit.id,
        clientId: credit.clientId,
        episodeId: episodeAt(ctx, credit.id, o.day),
        userId: assigneeId,
        type: ACTIVITY_OF[o.type],
        result,
        notes: o.resultNotes ?? o.obs,
        createdAt: when,
      });
      touch(ctx, credit.id, when);
    }
  }
  const id = o.id ?? randomUUID();
  ds.agenda.push({
    id,
    accountId: ctx.acc,
    clientId: credit.clientId,
    creditId: credit.id,
    assigneeId,
    type: o.type,
    status,
    priorityCode: o.priority,
    expectedResultCode: o.expected,
    scheduledDate: D(o.day),
    timeMode: o.time ? ScheduleTimeMode.FIXED : o.slot ? ScheduleTimeMode.LAPSE : ScheduleTimeMode.FIXED,
    scheduledTime: o.time,
    timeSlot: o.slot,
    observations: o.obs,
    details: json(details),
    resultActivityId,
    reasonCode: o.reason,
    rescheduledFromId: o.fromId,
    createdBy: assigneeId,
    createdAt: at(o.createdDay ?? Math.min(o.day, 0) - 1, 9, 0),
  });
  return id;
}

/** Una gestión suelta en la bitácora del crédito. */
function addActivity(
  ctx: Ctx,
  ds: DataSets,
  a: { key: string; day: number; hh?: number; mm?: number; type: CreditActivityType; result?: string; notes?: string; by: string; id?: string },
): string {
  const credit = ctx.credits[a.key]!;
  const id = a.id ?? randomUUID();
  const when = at(a.day, a.hh ?? 10, a.mm ?? 0);
  ds.activities.push({ id, accountId: ctx.acc, creditId: credit.id, clientId: credit.clientId, episodeId: episodeAt(ctx, credit.id, a.day), userId: ctx.users[a.by], type: a.type, result: a.result, notes: a.notes, createdAt: when });
  touch(ctx, credit.id, when);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO
// ═══════════════════════════════════════════════════════════════════════════════

async function seedDemo(ctx: Ctx, branchIds: Record<'CEN' | 'ALT', string>): Promise<void> {
  const { users: U } = ctx;
  const branchOf = (ownerKey: string): string | undefined => ctx.userBranch[ownerKey];
  const ds = newDataSets();

  // 1 · Personas, créditos de la app, importados.
  await createPeople(ctx, PEOPLE);
  await createAppCredits(ctx, APP_CREDITS, branchOf);
  const runIds: Record<'A' | 'B' | 'C' | 'D', string> = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() };
  await createPsfCredits(ctx, runIds, branchOf);

  // 2 · Episodios de mora: los abre el TRIGGER de `credits`; acá se completan.
  //    · El de la estrella lleva 2 episodios cerrados anteriores (3 en total, 2 cerrados y 1 abierto).
  const star = ctx.credits['star']!;
  await prisma.creditArrearEpisode.createMany({
    data: [
      { accountId: ctx.acc, creditId: star.id, startedAt: D(-196), startedAtEstimated: false, endedAt: D(-170), endReason: 'CURRENT', startDaysPastDue: 1, maxDaysPastDue: 27, balanceAtStart: 10_500, balanceAtEnd: 10_000, source: 'CALCULATED' },
      { accountId: ctx.acc, creditId: star.id, startedAt: D(-106), startedAtEstimated: false, endedAt: D(-52), endReason: 'CURRENT', startDaysPastDue: 1, maxDaysPastDue: 55, balanceAtStart: 8_500, balanceAtEnd: 8_000, source: 'CALCULATED' },
    ],
  });
  // El ausente del reporte: la regla «al día» deja su mora en 0 y marca la ausencia en el mismo UPDATE; el trigger cierra
  // el episodio con motivo SOURCE_ABSENT (D9: no se afirma que pagó).
  const p5 = ctx.credits['p5']!;
  await prisma.credit.update({ where: { id: p5.id }, data: { daysPastDue: 0, syncStatus: ExternalSyncStatus.ABSENT, absentSince: D(RUN_DAY.C) } });
  // El trigger fecha los episodios CALCULADOS con el día UTC del servidor; se alinean con el día civil de La Paz.
  await prisma.$executeRaw`
    UPDATE credit_arrear_episodes
       SET started_at = ${TODAY}::date - start_days_past_due
     WHERE account_id = ${ctx.acc} AND ended_at IS NULL AND source = 'CALCULATED' AND NOT reconstructed AND start_days_past_due IS NOT NULL`;
  // Prioridad del episodio ABIERTO (D3): días de mora → LOW/MEDIUM/HIGH/CRITICAL. La estrella la tiene fijada a mano.
  await prisma.$executeRaw`
    UPDATE credit_arrear_episodes
       SET priority = (CASE WHEN max_days_past_due > 180 THEN 'CRITICAL' WHEN max_days_past_due > 60 THEN 'HIGH'
                            WHEN max_days_past_due > 15 THEN 'MEDIUM' ELSE 'LOW' END)::collection_priority
     WHERE account_id = ${ctx.acc} AND ended_at IS NULL`;
  await prisma.creditArrearEpisode.updateMany({ where: { creditId: star.id, endedAt: null }, data: { priority: CollectionPriority.HIGH, priorityPinnedAt: at(-3, 16, 0) } });
  ctx.episodes = (await prisma.creditArrearEpisode.findMany({ where: { accountId: ctx.acc }, select: { id: true, creditId: true, startedAt: true, endedAt: true } })).map((e) => ({
    id: e.id,
    creditId: e.creditId,
    startedAt: e.startedAt.toISOString().slice(0, 10),
    endedAt: e.endedAt ? e.endedAt.toISOString().slice(0, 10) : null,
  }));

  // 3 · La persona de la estrella: garante, familia, compañero, vecino; garantías.
  await seedStarPerson(ctx, star);

  // 4 · Responsables: ayuda (APOYO) y reemplazo temporal (TEMPORAL) de la estrella + una ayuda más.
  const temporalId = randomUUID();
  await prisma.creditAssignment.createMany({
    data: [
      { accountId: ctx.acc, creditId: star.id, userId: U['rosa']!, kind: CreditAssignmentKind.APOYO, startsAt: at(-20, 9, 30), grantedBy: U['sandra'] },
      { id: temporalId, accountId: ctx.acc, creditId: star.id, userId: U['marco']!, kind: CreditAssignmentKind.TEMPORAL, startsAt: at(-4, 9, 0), expiresAt: future(10, 18, 0), grantedBy: U['sandra'] },
      { accountId: ctx.acc, creditId: ctx.credits['c12']!.id, userId: U['freddy']!, kind: CreditAssignmentKind.APOYO, startsAt: at(-9, 15, 0), grantedBy: U['maria'] },
    ],
  });

  // 5 · Bitácora, promesas y agenda de la estrella.
  const hand = { from: U['carlos']!, assignmentId: temporalId };
  seedStarActivity(ctx, ds, hand);

  // 6 · Agenda del resto de la cartera (historial, hoy, próximos días y SEMANA SIGUIENTE).
  seedAgenda(ctx, ds);

  // 7 · Ruta de hoy del cobrador principal, visitas y sus gestiones.
  await seedRoute(ctx, ds, branchIds);

  // 8 · Notas post-it (la estrella: las 7 secciones) y otras.
  await seedNotes(ctx);

  // 9 · Historial de importaciones, fotos de cada corrida y avisos.
  await seedImportHistory(ctx, runIds);
  await seedNotifications(ctx);

  // 10 · Lo acumulado: gestiones y agenda (con sus enlaces), pagos con comprobante, `last_action_at`.
  await prisma.creditActivity.createMany({ data: ds.activities });
  assertAgenda(ds.agenda);
  await prisma.agendaItem.createMany({ data: ds.agenda });
  const nPay = await flushPayments(ctx);
  for (const [creditId, when] of ctx.lastAction) await prisma.credit.update({ where: { id: creditId }, data: { lastActionAt: when } });

  console.log(`  ✓ DEMO: ${PEOPLE.length} clientes · ${APP_CREDITS.length} créditos de la app + ${PSF_CREDITS.length} importados · ${nPay} pagos · ${ds.activities.length} gestiones · ${ds.agenda.length} agendados`);
}

/** El seed promete UN solo agendado vencido: si alguien agrega otro por descuido, se frena acá y no en la demo. */
function assertAgenda(items: Prisma.AgendaItemCreateManyInput[]): void {
  const overdue = items.filter((i) => i.status === AgendaItemStatus.SCHEDULED && (i.scheduledDate as Date) < TODAY);
  if (overdue.length !== 1) throw new Error(`seed: se esperaba exactamente 1 agendado vencido y hay ${overdue.length}`);
}

// ── Importados (PSF) ────────────────────────────────────────────────────────────

async function createPsfCredits(ctx: Ctx, runIds: Record<'A' | 'B' | 'C' | 'D', string>, branchOf: (ownerKey: string) => string | undefined): Promise<void> {
  // Clientes provisional: sugerencia = el cliente que ya existe con el mismo nombre (D2 · «Revisar vínculo»).
  const credits: Prisma.CreditCreateManyInput[] = [];
  const assignments: Prisma.CreditAssignmentCreateManyInput[] = [];
  const keys: Prisma.ClientExternalKeyCreateManyInput[] = [];
  for (const s of PSF_CREDITS) {
    const person = ctx.people[s.client]!;
    const id = randomUUID();
    const ownerId = ctx.users[s.owner]!;
    const lastRun = s.runs[s.runs.length - 1]!;
    const importedAt = at(RUN_DAY[lastRun], 8, 40);
    const present = !(s.key === 'p5');
    // Mora de la última corrida que lo trajo (el ausente conserva la que tenía antes de faltar).
    credits.push({
      id,
      accountId: ctx.acc,
      clientId: person.id,
      branchId: branchOf(s.owner),
      code: s.externalId,
      principalAmount: s.principal,
      outstandingBalance: s.balance,
      interestRate: 0.02,
      currency: 'BOB',
      installmentsCount: s.termM,
      status: CreditStatus.ACTIVE,
      // p5 entra con mora y se pone al día después (más abajo), para que el trigger le abra y le cierre el episodio.
      daysPastDue: present ? s.dpd : 52,
      assignedManagerId: ownerId,
      origin: CreditDataOrigin.IMPORT,
      externalSource: 'PSF',
      externalId: s.externalId,
      syncStatus: ExternalSyncStatus.PRESENT,
      lastSeenRunId: runIds[lastRun],
      reportedAsOf: D(RUN_DAY[lastRun]),
      disbursedAt: D(-(s.termM > 24 ? 400 : 240)),
      metadata: json({
        origin: 'import',
        pastDueAmount: round2(s.installment + (s.dpd > 30 ? s.installment : 0)),
        installmentAmount: s.installment,
        nextDueDate: isoOf(s.nextDue),
        reportedStatus: s.status,
        reportedTermMonths: s.termM,
        lastPaymentDate: isoOf(s.lastPay),
        ...(s.guarantor ? { reportedGuarantor: s.guarantor } : {}),
        externalAdvisorCode: s.advisor,
        balanceBasis: 'principal',
        importMissing: [],
        importRunId: runIds[lastRun],
        importedAt: importedAt.toISOString(),
      }),
    });
    assignments.push({ accountId: ctx.acc, creditId: id, userId: ownerId, kind: CreditAssignmentKind.PRINCIPAL, startsAt: importedAt, grantedBy: ctx.users['carlos'] });
    ctx.credits[s.key] = { id, key: s.key, code: s.externalId, clientId: person.id, clientKey: s.client, ownerKey: s.owner, ownerId, dpd: s.dpd, installments: [], balance: s.balance, psf: true };
    keys.push({ accountId: ctx.acc, externalSource: 'PSF', keyType: 'NAME', key: upper(`${person.name}`), clientId: person.id, confirmedBy: s.key === 'p4' ? null : ctx.users['carlos'] });
  }
  await prisma.credit.createMany({ data: credits });
  await prisma.creditAssignment.createMany({ data: assignments });
  // La clave de nombre que ya se confirmó, para que la próxima importación no vuelva a pedir la revisión.
  await prisma.clientExternalKey.createMany({ data: keys.filter((k) => k.confirmedBy), skipDuplicates: true });
  // El provisional: marcado, con la persona que ya existía como sugerencia.
  const dup = ctx.people['c13']!;
  await prisma.client.update({
    where: { id: ctx.people['c20']!.id },
    data: { linkReviewPending: true, metadata: json({ origin: 'import', externalSource: 'PSF', externalNameKey: upper(ctx.people['c20']!.name), linkSuggestions: [dup.id], linkReason: 'NAME_MATCH' }) },
  });
  // Pagos: un cobro de Kobrax sobre un importado (los pagos de Kobrax no tocan saldo ni mora del reporte, D3).
  queuePayment(ctx, { creditId: ctx.credits['p2']!.id, amount: 300, method: PaymentMethod.CASH, day: -4, by: ctx.users['carlos']!, notes: 'Cobrado en visita; el saldo lo manda el reporte' });
  queuePayment(ctx, { creditId: ctx.credits['p1']!.id, amount: 400, method: PaymentMethod.TRANSFER, channel: PaymentChannel.EXTERNAL_CONFIRMED, day: -3, by: ctx.users['carlos']!, notes: 'Depósito en la cuenta de la entidad, confirmado por el cobrador' });
}

// ── La persona de la estrella ───────────────────────────────────────────────────

async function seedStarPerson(ctx: Ctx, star: CreditRef): Promise<void> {
  const acc = ctx.acc;
  const clientId = star.clientId;
  const rels: { key: string; name: string; type: RelationshipType; phone: string; whatsapp?: string; locType: LocationType; address: string; zone: string; note: string; notes?: string }[] = [
    { key: 'guarantor', name: 'Ernesto Mamani Cruz', type: RelationshipType.GUARANTOR, phone: '70000201', whatsapp: '70000201', locType: LocationType.GUARANTOR, address: 'Calle Murillo #830', zone: 'Centro', note: 'Garante del crédito', notes: 'Hermano del titular; se hace responsable de la deuda.' },
    { key: 'family', name: 'Rosa Vargas de Mamani', type: RelationshipType.FAMILY, phone: '70000202', locType: LocationType.FAMILY, address: 'Calle Fernando Guachalla #1245, piso 3', zone: 'Sopocachi', note: 'Hermana; vive en el mismo edificio', notes: 'Recibe los recados cuando Lidia no está.' },
    { key: 'coworker', name: 'Gonzalo Paredes Lima', type: RelationshipType.COWORKER, phone: '70000203', locType: LocationType.WORK, address: 'Mercado Rodríguez, puesto 16', zone: 'Centro', note: 'Puesto vecino en el mercado', notes: 'Atiende el puesto contiguo; sabe en qué horario está.' },
    { key: 'neighbor', name: 'Cecilia Ramos Ticona', type: RelationshipType.NEIGHBOR, phone: '70000204', locType: LocationType.OTHER, address: 'Calle Fernando Guachalla #1250', zone: 'Sopocachi', note: 'Vecina de enfrente', notes: 'Tiene la llave del portón y avisa si ve movimiento.' },
  ];
  const relRows: Prisma.ClientRelationCreateManyInput[] = [];
  const contacts: Prisma.ClientContactCreateManyInput[] = [];
  const locations: Prisma.ClientLocationCreateManyInput[] = [];
  const guarantorRelId = randomUUID();
  const base = ZONES['Sopocachi']!;
  rels.forEach((r, i) => {
    const id = r.key === 'guarantor' ? guarantorRelId : randomUUID();
    relRows.push({ id, accountId: acc, clientId, relatedName: r.name, relationshipType: r.type, isContactable: true, notes: r.notes });
    contacts.push({ accountId: acc, clientId, relationId: id, contactType: ContactType.PHONE, value: encryptPII(r.phone), isPrimary: true, isVerified: true, notes: r.note });
    if (r.whatsapp) contacts.push({ accountId: acc, clientId, relationId: id, contactType: ContactType.WHATSAPP, value: encryptPII(r.whatsapp), isPrimary: false, notes: 'WhatsApp' });
    const z = ZONES[r.zone] ?? base;
    locations.push({
      accountId: acc,
      clientId,
      relationId: id,
      locationType: r.locType,
      address: encryptPII(r.address),
      zone: r.zone,
      latitude: round6(z.lat + 0.0012 * (i + 1)),
      longitude: round6(z.lng - 0.001 * (i + 1)),
      referenceNotes: r.note,
    });
  });
  await prisma.clientRelation.createMany({ data: relRows });
  await prisma.clientContact.createMany({ data: contacts });
  await prisma.clientLocation.createMany({ data: locations });
  await prisma.creditGuarantor.create({ data: { accountId: acc, relationId: guarantorRelId, creditId: star.id } });

  // Garantes de otros dos créditos y garantías (la estrella lleva dos bienes).
  const g2 = randomUUID();
  const g3 = randomUUID();
  await prisma.clientRelation.createMany({
    data: [
      { id: g2, accountId: acc, clientId: ctx.people['c12']!.id, relatedName: 'Jaime Apaza Torrez', relationshipType: RelationshipType.GUARANTOR, notes: 'Padre del titular' },
      { id: g3, accountId: acc, clientId: ctx.people['c08']!.id, relatedName: 'Patricia Limachi Rojas', relationshipType: RelationshipType.GUARANTOR, notes: 'Esposa del titular' },
    ],
  });
  await prisma.clientContact.createMany({
    data: [
      { accountId: acc, clientId: ctx.people['c12']!.id, relationId: g2, contactType: ContactType.PHONE, value: encryptPII('70000211'), isPrimary: true },
      { accountId: acc, clientId: ctx.people['c08']!.id, relationId: g3, contactType: ContactType.PHONE, value: encryptPII('70000212'), isPrimary: true },
    ],
  });
  await prisma.creditGuarantor.createMany({
    data: [
      { accountId: acc, relationId: g2, creditId: ctx.credits['c12']!.id },
      { accountId: acc, relationId: g3, creditId: ctx.credits['c08']!.id },
    ],
  });
  const collaterals: { id: string; clientId: string; creditId: string; type: string; description: string; value: number; currency: string }[] = [
    { id: randomUUID(), clientId, creditId: star.id, type: 'VEHICLE', description: 'Minibús Toyota Hiace 2012, placa ficticia 0000-ABC', value: 52000, currency: 'BOB' },
    { id: randomUUID(), clientId, creditId: star.id, type: 'APPLIANCE', description: 'Refrigeradora industrial de 2 puertas (puesto del mercado)', value: 6500, currency: 'BOB' },
    { id: randomUUID(), clientId: ctx.people['c13']!.id, creditId: ctx.credits['c13']!.id, type: 'PROPERTY', description: 'Terreno de 200 m² en Zona Norte, sin construir', value: 41000, currency: 'USD' },
  ];
  await prisma.collateral.createMany({ data: collaterals.map((c) => ({ id: c.id, accountId: acc, clientId: c.clientId, type: c.type, description: c.description, estimatedValue: c.value, currency: c.currency })) });
  await prisma.collateralCredit.createMany({ data: collaterals.map((c) => ({ accountId: acc, collateralId: c.id, creditId: c.creditId })) });
}

// ── Bitácora, promesas y agenda de la estrella ───────────────────────────────────

function seedStarActivity(ctx: Ctx, ds: DataSets, hand: { from: string; assignmentId: string }): void {
  const T = CreditActivityType;
  const A = (day: number, hh: number, type: CreditActivityType, by: string, result?: string, notes?: string, id?: string, mm = 0): string =>
    addActivity(ctx, ds, { key: 'star', day, hh, mm, type, result, notes, by, id });

  // Episodio anterior (cerrado el día -52): lo ve el historial de mora.
  A(-60, 9, T.ASSIGNMENT, 'sandra', undefined, 'Crédito asignado a Carlos Collector (responsable principal).');
  A(-59, 10, T.NOTE, 'carlos', undefined, 'La cliente avisa que viaja por trabajo; regresa en una semana.');
  A(-58, 11, T.CALL, 'carlos', 'NO_ANSWER', 'Llamada al celular, no contesta.');
  A(-57, 16, T.CALL, 'carlos', 'CONTACTED', 'Dice que pagará al cobrar su sueldo a fin de semana.');
  A(-55, 10, T.VISIT, 'carlos', 'NOT_FOUND', 'Visita al domicilio: no estaba; la vecina dice que trabaja en el mercado.', undefined, 30);
  A(-54, 15, T.MESSAGE, 'carlos', 'CONTACTED', 'Mensaje por WhatsApp con el monto de las dos cuotas atrasadas; lo leyó.');
  A(-52, 12, T.NOTE, 'carlos', undefined, 'Regularizó: pagó las dos cuotas atrasadas. Se cierra la mora.');
  // Mora actual (abierta hace 47 días).
  A(-45, 10, T.CALL, 'carlos', 'NO_ANSWER', 'Primer llamado de la nueva mora. Sin respuesta.');
  A(-44, 17, T.CALL, 'carlos', 'WRONG_NUMBER', 'Segundo teléfono: contestó otra persona, número equivocado.');
  A(-42, 9, T.MESSAGE, 'carlos', 'NO_ANSWER', 'WhatsApp enviado, un solo check.');
  A(-40, 11, T.VISIT, 'carlos', 'PROMISE_TO_PAY', 'La encontré en el puesto; promete pagar Bs 150 el viernes.', undefined, 20);
  const kept = A(-33, 15, T.CALL, 'carlos', 'PROMISE_KEPT', 'Confirmó que dejó los Bs 150 prometidos.');
  A(-31, 10, T.NOTE, 'carlos', undefined, 'Recibió el pago parcial; falta el resto de la cuota vencida.');
  A(-28, 16, T.CALL, 'carlos', 'PROMISE_TO_PAY', 'Promete Bs 300 para el día 21 hacia atrás.', undefined, 10);
  A(-25, 14, T.MESSAGE, 'carlos', 'CONTACTED', 'Pidió por WhatsApp su estado de cuenta; se lo envié.');
  A(-24, 10, T.CALL, 'carlos', 'PROMISE_TO_PAY', 'Nueva promesa: Bs 200 para dentro de nueve días.', undefined, 40);
  const broken = A(-21, 12, T.CALL, 'carlos', 'PROMISE_BROKEN', 'No pagó lo prometido; dice que se le complicó la semana.');
  A(-18, 11, T.VISIT, 'carlos', 'PROMISE_TO_PAY', 'Visita: pide una semana más; promete Bs 400.', undefined, 25);
  A(-16, 9, T.NOTE, 'carlos', undefined, 'Cancelo la promesa de Bs 200: la cliente no estaba disponible para confirmarla.');
  A(-14, 17, T.VISIT, 'carlos', 'REFUSAL', 'Se negó a atender en la puerta; pidió que no vayamos a su casa.', undefined, 5);
  A(-12, 10, T.NOTE, 'rosa', undefined, 'Pago de Bs 100 por QR; la entidad lo confirmó. (Ayuda: Rosa Aliaga)');
  A(-11, 15, T.CALL, 'carlos', 'CONTACTED', 'Pidió mover la promesa de Bs 400 para dentro de unos días.');
  A(-9, 10, T.CALL, 'carlos', 'PROMISE_TO_PAY', 'Promesa de Bs 350 para ayer; la tomo por teléfono.', undefined, 50);
  A(-5, 16, T.MESSAGE, 'rosa', 'NO_ANSWER', 'Recordatorio por WhatsApp (ayuda). No respondió.');
  A(-4, 9, T.ASSIGNMENT, 'sandra', undefined, `Reemplazo temporal: Marco Villca cubre el crédito hasta el ${dm(10)}.`, undefined, 5);
  A(-2, 11, T.CALL, 'marco', 'NO_ANSWER', 'Llamada del reemplazo: no contesta.');
  A(-1, 15, T.VISIT, 'marco', 'NOT_FOUND', 'Visita del reemplazo: no estaba, dejé aviso con la hermana.', undefined, 30);

  // Promesas (agenda PROMISE_TO_PAY) en TODOS los estados. El estado se deriva del agendado, la fecha y el resultado
  // de la gestión que la ejecutó (`serializePromises`): KEPT/BROKEN salen del `result` de esa gestión.
  const promise = (o: Omit<ItemOpts, 'key' | 'type'>): string => addItem(ctx, ds, { key: 'star', type: AgendaItemType.PROMISE_TO_PAY, ...o });
  const pd = (amount: number, day: number, method = 'CASH', bank?: string) => ({ amount, promiseDate: isoOf(day), paymentMethodCode: method, ...(bank ? { bankCode: bank } : {}) });
  promise({ day: -33, details: pd(150, -33), status: AgendaItemStatus.EXECUTED, resultId: kept, result: 'PROMISE_KEPT', createdDay: -40, obs: 'Promete el viernes', assignee: 'carlos' });
  promise({ day: -21, details: pd(300, -21, 'TRANSFER', 'BNB'), status: AgendaItemStatus.EXECUTED, resultId: broken, result: 'PROMISE_BROKEN', createdDay: -28, assignee: 'carlos' });
  promise({ day: -15, details: pd(200, -15), status: AgendaItemStatus.CANCELLED, reason: 'CLIENT_UNAVAILABLE', createdDay: -24, obs: 'La cliente no estaba disponible', assignee: 'carlos' });
  const reschedOriginal = promise({ day: -10, details: pd(400, -10, 'QR'), status: AgendaItemStatus.RESCHEDULED, reason: 'CLIENT_REQUEST', createdDay: -18, assignee: 'carlos' });
  // Activa, en el futuro: es la que nació del reagendado y, como lo agendado pendiente de la estrella, pasó al reemplazo.
  promise({ day: 3, details: pd(400, 3, 'QR'), fromId: reschedOriginal, createdDay: -11, obs: 'Reagendada a pedido de la cliente', handoff: hand, assignee: 'marco', priority: 'HIGH', expected: 'CONFIRM_PAYMENT' });
  // Su recordatorio de 24 h (lo crea `createPromiseItem` con la promesa); el reemplazo lo recibió con ella.
  addItem(ctx, ds, { key: 'star', type: AgendaItemType.REMINDER, day: 2, slot: 'MORNING', details: { description: 'Recordar la promesa de pago de mañana' }, handoff: hand, assignee: 'marco', createdDay: -11 });
  // LA única promesa vencida de toda la cuenta: SCHEDULED con fecha de ayer, a cargo del cobrador principal.
  promise({ day: -1, details: pd(350, -1), status: AgendaItemStatus.SCHEDULED, createdDay: -9, obs: 'Prometió pagar ayer; nadie registró el resultado', assignee: 'carlos', priority: 'VERY_HIGH', expected: 'CONFIRM_PAYMENT' });
  // Una visita de la semana siguiente (jueves): también quedó con el reemplazo.
  addItem(ctx, ds, { key: 'star', type: AgendaItemType.VISIT, day: NEXT_MONDAY + 3, time: '10:00', handoff: hand, assignee: 'marco', priority: 'HIGH', expected: 'CONFIRM_VISIT', obs: 'Reintentar: dejó aviso con la hermana' });
}

// ── Agenda del resto de la cartera ───────────────────────────────────────────────

function seedAgenda(ctx: Ctx, ds: DataSets): void {
  const item = (o: ItemOpts): string => addItem(ctx, ds, o);
  const T = AgendaItemType;
  const S = AgendaItemStatus;
  const nm = NEXT_MONDAY;

  // ── Historial (pasado): ejecutados, cancelados y reagendados ──
  item({ key: 'c08', type: T.CALL, day: -13, time: '10:15', result: 'CONTACTED', resultNotes: 'Contestó, pidió que pasemos por la cuota.' });
  item({ key: 'c13', type: T.VISIT, day: -9, time: '14:00', result: 'NOT_FOUND', resultNotes: 'Nadie en el domicilio.' });
  item({ key: 'c11', type: T.WHATSAPP, day: -8, time: '09:30', result: 'NO_ANSWER', resultNotes: 'Mensaje entregado, sin respuesta.' });
  item({ key: 'c12', type: T.CALL, day: -7, time: '11:00', status: S.CANCELLED, reason: 'CLIENT_UNAVAILABLE', obs: 'Teléfono apagado todo el día' });
  item({ key: 'c09', type: T.PROMISE_TO_PAY, day: -6, details: { amount: 300, promiseDate: isoOf(-6), paymentMethodCode: 'CASH' }, result: 'PROMISE_KEPT', resultNotes: 'Cumplió: pagó Bs 300 en efectivo.', createdDay: -12 });
  const resched = item({ key: 'c10', type: T.CALL, day: -5, time: '15:00', status: S.RESCHEDULED, reason: 'NO_ANSWER' });
  item({ key: 'c10', type: T.CALL, day: 1, time: '15:30', fromId: resched, obs: 'Reagendada: no contestó', priority: 'MEDIUM', expected: 'COLLECT' });
  item({ key: 'c02', type: T.REMINDER, day: -4, details: { description: 'Cobrar cuota' }, resultNotes: 'Se recordó la cuota; pagó el día siguiente.' });
  item({ key: 'c04', type: T.VISIT, day: -3, time: '16:00', result: 'CONTACTED', resultNotes: 'Visita preventiva: todo en orden.' });
  item({ key: 'c12', type: T.PROMISE_TO_PAY, day: -2, details: { amount: 250, promiseDate: isoOf(-2), paymentMethodCode: 'TRANSFER', bankCode: 'FIE' }, result: 'PROMISE_BROKEN', resultNotes: 'No depositó.', createdDay: -9 });
  item({ key: 'p2', type: T.CALL, day: -2, time: '10:30', result: 'CONTACTED', resultNotes: 'Pidió esperar a fin de mes.' });
  item({ key: 'c03', type: T.WHATSAPP, day: -1, time: '08:45', result: 'CONTACTED', resultNotes: 'Confirmó que paga mañana.' });

  // ── Hoy ──
  item({ key: 'c01b', type: T.WHATSAPP, day: 0, time: '08:15', status: S.EXECUTED, result: 'CONTACTED', resultNotes: 'Recordatorio de cuota enviado.', expected: 'REMIND' });
  item({ key: 'c03', type: T.CALL, day: 0, time: '09:30', priority: 'HIGH', expected: 'COLLECT', obs: 'Recordar la cuota semanal' });
  item({ key: 'c09', type: T.CALL, day: 0, time: '10:00', assignee: 'rosa', priority: 'HIGH', expected: 'COLLECT' });
  item({ key: 'c06', type: T.VISIT, day: 0, time: '09:00', assignee: 'julia', priority: 'MEDIUM', expected: 'CONFIRM_VISIT' });
  item({ key: 'c07', type: T.REMINDER, day: 0, time: '12:00', assignee: 'sandra', details: { description: 'Revisar la garantía del crédito de vivienda' } });
  // Las visitas de la ruta de hoy las agrega `seedRoute` (con su parada y su gestión).

  // ── Recordatorios «Cobrar cuota» (D11), con el id determinista del job de agenda ──
  for (const [key, number] of [['c02', 5], ['c03', 4]] as const) {
    const c = ctx.credits[key]!;
    const inst = c.installments.find((i) => i.number === number)!;
    item({ key, type: T.REMINDER, day: inst.due, id: reminderId(c.id, number), details: { description: 'Cobrar cuota' }, expected: 'COLLECT', createdDay: 0 });
  }
  // Importado sin cronograma: la fecha de «próximo pago» del reporte (sólo si el reporte no está viejo).
  const p1 = ctx.credits['p1']!;
  item({ key: 'p1', type: T.REMINDER, day: 2, id: reminderId(p1.id, isoOf(2)), details: { description: 'Cobrar cuota' }, expected: 'COLLECT', createdDay: 0, obs: 'Próximo pago según el reporte' });

  // ── Semana siguiente (lunes a viernes después de hoy): 5 tipos, 5 días, 4 personas ──
  item({ key: 'c08', type: T.CALL, day: nm, time: '09:00', priority: 'HIGH', expected: 'COLLECT', obs: 'Confirmar el saldo de la cuota' });
  item({ key: 'c09', type: T.REMINDER, day: nm, slot: 'MORNING', assignee: 'rosa', details: { description: 'Llevar el recibo de la última cuota' } });
  item({ key: 'c13', type: T.VISIT, day: nm + 1, time: '10:30', priority: 'VERY_HIGH', expected: 'NEGOTIATE', obs: 'Hablar de reestructurar la deuda' });
  item({ key: 'c11', type: T.WHATSAPP, day: nm + 1, time: '15:00', assignee: 'marco', priority: 'MEDIUM', expected: 'REMIND' });
  item({ key: 'c09', type: T.PROMISE_TO_PAY, day: nm + 2, details: { amount: 300, promiseDate: isoOf(nm + 2), paymentMethodCode: 'CASH' }, assignee: 'rosa', expected: 'CONFIRM_PAYMENT' });
  item({ key: 'c12', type: T.CALL, day: nm + 3, time: '11:00', assignee: 'julia', priority: 'HIGH', expected: 'COLLECT' });
  item({ key: 'c03', type: T.REMINDER, day: nm + 4, details: { description: 'Cobrar cuota' }, slot: 'AFTERNOON' });
  item({ key: 'p2', type: T.WHATSAPP, day: nm + 4, time: '09:30', priority: 'MEDIUM', expected: 'REMIND' });

  // ── Más adelante ──
  item({ key: 'c10', type: T.VISIT, day: nm + 8, time: '10:00', assignee: 'freddy', priority: 'MEDIUM', expected: 'CONFIRM_VISIT' });
  item({ key: 'c05', type: T.CALL, day: nm + 9, time: '16:00', assignee: 'marco', expected: 'REMIND' });
  item({ key: 'p3', type: T.VISIT, day: nm + 10, time: '09:00', priority: 'HIGH', expected: 'NEGOTIATE' });
}

// ── Ruta de hoy, visitas y gestiones ─────────────────────────────────────────────

async function seedRoute(ctx: Ctx, ds: DataSets, branchIds: Record<'CEN' | 'ALT', string>): Promise<void> {
  const carlos = ctx.users['carlos']!;
  const stopsSpec: { key: string; visited: boolean; outcome?: VisitOutcome; notes?: string; paid?: number }[] = [
    { key: 'c08', visited: true, outcome: VisitOutcome.PAID, notes: 'Pagó Bs 380 en efectivo y entregó el comprobante.', paid: 380 },
    { key: 'c13', visited: true, outcome: VisitOutcome.NOT_FOUND, notes: 'Nadie en el domicilio; la vecina dice que regresa a las 18:00.' },
    { key: 'p2', visited: false },
    { key: 'c02', visited: false },
  ];
  const route = await prisma.routePlan.create({
    data: {
      accountId: ctx.acc,
      branchId: branchIds.CEN,
      collectorId: carlos,
      plannedDate: TODAY,
      status: RouteStatus.IN_PROGRESS,
      totalCases: stopsSpec.length,
      totalDistanceKm: 12.4,
      estimatedMinutes: 210,
      stops: {
        create: stopsSpec.map((s, i) => ({
          accountId: ctx.acc,
          clientId: ctx.credits[s.key]!.clientId,
          creditId: ctx.credits[s.key]!.id,
          sequenceOrder: i + 1,
          status: s.visited ? RouteStopStatus.VISITED : RouteStopStatus.PENDING,
          visitedAt: s.visited ? at(0, 9 + i, 20) : null,
        })),
      },
    },
    include: { stops: { orderBy: { sequenceOrder: 'asc' } } },
  });

  // Una foto que EXISTE en disco: `uploads` la sirve desde `uploads/<accountId>/<sha>.jpg` y valida el nombre contra un sha256.
  const hash = createHash('sha256').update(TINY_JPEG).digest('hex');
  try {
    const dir = resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), '../../apps/api/uploads'), ctx.acc);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${hash}.jpg`), TINY_JPEG);
  } catch (e) {
    console.warn(`  ⚠ no se pudo escribir la foto de ejemplo (la evidencia se verá como imagen rota): ${(e as Error).message}`);
  }

  for (const [i, s] of stopsSpec.entries()) {
    const credit = ctx.credits[s.key]!;
    const person = ctx.people[credit.clientKey]!;
    const stop = route.stops[i]!;
    const time = `${String(9 + i).padStart(2, '0')}:${i === 0 ? '00' : '30'}`;
    if (s.visited) {
      const when = at(0, 9 + i, 20);
      const visitId = randomUUID();
      const activityId = randomUUID();
      await prisma.fieldVisit.create({
        data: {
          id: visitId,
          accountId: ctx.acc,
          creditId: credit.id,
          routeStopId: stop.id,
          collectorId: carlos,
          latitude: person.lat + 0.0003,
          longitude: person.lng - 0.0002,
          accuracy: 9.5,
          outcome: s.outcome!,
          notes: s.notes,
          details: s.outcome === VisitOutcome.NOT_FOUND ? json({ gpsFallback: true }) : json({}),
          capturedAt: when,
          ...(s.outcome === VisitOutcome.PAID
            ? {
                evidences: {
                  create: { accountId: ctx.acc, type: EvidenceType.PHOTO, fileUrl: `/api/uploads/${hash}.jpg`, fileHash: hash, latitude: person.lat + 0.0003, longitude: person.lng - 0.0002, capturedAt: when },
                },
              }
            : {}),
        },
      });
      ds.activities.push({ id: activityId, accountId: ctx.acc, creditId: credit.id, clientId: credit.clientId, episodeId: episodeAt(ctx, credit.id, 0), userId: carlos, type: CreditActivityType.VISIT, result: s.outcome === VisitOutcome.PAID ? 'CONTACTED' : 'NOT_FOUND', notes: s.notes, createdAt: when });
      touch(ctx, credit.id, when);
      addItem(ctx, ds, { key: s.key, type: AgendaItemType.VISIT, day: 0, time, status: AgendaItemStatus.EXECUTED, resultId: activityId, result: s.outcome === VisitOutcome.PAID ? 'CONTACTED' : 'NOT_FOUND', resultNotes: s.notes, priority: 'HIGH' });
    } else {
      addItem(ctx, ds, { key: s.key, type: AgendaItemType.VISIT, day: 0, time: i === 2 ? '14:00' : '15:30', priority: i === 2 ? 'HIGH' : 'LOW', expected: i === 2 ? 'COLLECT' : 'CONFIRM_VISIT', obs: i === 3 ? 'Visita preventiva: sigue al día' : undefined });
    }
  }

  // Visitas históricas de la estrella (con crédito, sin parada: se hicieron antes de armar la ruta de hoy).
  const star = ctx.credits['star']!;
  const sp = ctx.people['c01']!;
  const old: { day: number; hh: number; mm: number; by: string; outcome: VisitOutcome; notes: string; photo?: boolean }[] = [
    { day: -55, hh: 10, mm: 30, by: 'carlos', outcome: VisitOutcome.NOT_FOUND, notes: 'Visita al domicilio: no estaba.' },
    { day: -40, hh: 11, mm: 20, by: 'carlos', outcome: VisitOutcome.PROMISE_TO_PAY, notes: 'Promete Bs 150 el viernes.', photo: true },
    { day: -14, hh: 17, mm: 5, by: 'carlos', outcome: VisitOutcome.REFUSAL, notes: 'Se negó a atender.' },
    { day: -1, hh: 15, mm: 30, by: 'marco', outcome: VisitOutcome.NOT_FOUND, notes: 'Visita del reemplazo: no estaba.' },
  ];
  for (const v of old) {
    const when = at(v.day, v.hh, v.mm);
    await prisma.fieldVisit.create({
      data: {
        accountId: ctx.acc,
        creditId: star.id,
        collectorId: ctx.users[v.by]!,
        latitude: sp.lat + 0.0002,
        longitude: sp.lng + 0.0001,
        accuracy: 12,
        outcome: v.outcome,
        notes: v.notes,
        details: json({}),
        capturedAt: when,
        ...(v.photo ? { evidences: { create: { accountId: ctx.acc, type: EvidenceType.PHOTO, fileUrl: `/api/uploads/${hash}.jpg`, fileHash: hash, latitude: sp.lat, longitude: sp.lng, capturedAt: when } } } : {}),
      },
    });
  }

  // El pago cobrado en la ruta de hoy ya está en `partials` de c08 (CRD-DEMO-0009); acá sólo el aviso.
  void route;
}

/** Un JPEG mínimo válido: alcanza para comprobar que la foto se sirve y se autentica. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

// ── Notas post-it ────────────────────────────────────────────────────────────────

async function seedNotes(ctx: Ctx): Promise<void> {
  const star = ctx.credits['star']!;
  const N = (
    anchor: CreditNoteAnchor,
    kind: CreditNoteKind,
    color: CreditNoteColor,
    body: string,
    by: string,
    day: number,
    pos: [number, number, number, number, number],
  ): Prisma.CreditNoteCreateManyInput => ({
    accountId: ctx.acc,
    creditId: star.id,
    clientId: star.clientId,
    authorId: ctx.users[by],
    kind,
    color,
    anchor,
    body,
    posX: pos[0],
    posY: pos[1],
    width: pos[2],
    height: pos[3],
    zIndex: pos[4],
    createdAt: at(day, 10, 0),
  });
  const A = CreditNoteAnchor;
  const K = CreditNoteKind;
  const C = CreditNoteColor;
  const rows: Prisma.CreditNoteCreateManyInput[] = [
    N(A.PAGE, K.IMPORTANT, C.YELLOW, 'Cliente colaboradora pero con ingresos irregulares. Llamar después de las 18:00.', 'carlos', -30, [40, 40, 240, 160, 3]),
    N(A.PAGE, K.WARNING, C.ORANGE, `Reemplazo temporal de Marco Villca hasta el ${dm(10)}. Consultar con él antes de visitar.`, 'sandra', -4, [320, 80, 240, 160, 2]),
    N(A.TIMELINE, K.INFO, C.BLUE, 'Prefiere WhatsApp antes que llamadas: contesta en la tarde.', 'carlos', -35, [24, 24, 220, 140, 1]),
    N(A.PROMISES, K.WARNING, C.ORANGE, 'Dos promesas incumplidas este mes: pedir fecha y monto concretos.', 'sandra', -15, [20, 30, 230, 150, 1]),
    N(A.NOTES, K.INFO, C.GREEN, 'El garante confirmó que se hace responsable si no paga.', 'carlos', -38, [24, 24, 220, 140, 1]),
    N(A.PAYMENTS, K.WARNING, C.PINK, 'Pagos parciales: aplicarlos primero a la cuota vencida.', 'rosa', -12, [18, 26, 230, 140, 1]),
    N(A.HISTORY, K.INFO, C.PURPLE, 'En la mora anterior regularizó a los 14 días de la visita.', 'carlos', -50, [24, 24, 220, 130, 1]),
    N(A.PERSON, K.IMPORTANT, C.PINK, 'Vive con su hermana: la puerta azul del segundo piso. El portón lo abre la vecina.', 'marco', -3, [20, 30, 250, 150, 1]),
    N(A.PERSON, K.INFO, C.YELLOW, 'El puesto del mercado abre de 7:00 a 14:00; los domingos no atiende.', 'carlos', -28, [290, 40, 220, 130, 2]),
  ];
  const other = (key: string, anchor: CreditNoteAnchor, kind: CreditNoteKind, color: CreditNoteColor, body: string, by: string, day: number): Prisma.CreditNoteCreateManyInput => {
    const c = ctx.credits[key]!;
    return { accountId: ctx.acc, creditId: c.id, clientId: c.clientId, authorId: ctx.users[by], kind, color, anchor, body, createdAt: at(day, 10, 0) };
  };
  rows.push(
    other('c13', A.PAGE, K.WARNING, C.ORANGE, 'Posible cambio de domicilio: confirmar con la vecina antes de visitar.', 'carlos', -10),
    other('c08', A.PAGE, K.INFO, C.YELLOW, 'Paga mejor cuando se le visita el día de cobro de su sueldo.', 'carlos', -6),
    other('c12', A.PROMISES, K.IMPORTANT, C.PINK, 'Incumplió la última promesa: escalar al supervisor si vuelve a fallar.', 'julia', -2),
  );
  await prisma.creditNote.createMany({ data: rows });
}

// ── Historial de importaciones (PSF) ─────────────────────────────────────────────

async function seedImportHistory(ctx: Ctx, runIds: Record<'A' | 'B' | 'C' | 'D', string>): Promise<void> {
  const carlos = ctx.users['carlos']!;
  const sandra = ctx.users['sandra']!;
  // Vínculo del asesor CQE al cobrador (el código MRT queda sin vincular a propósito: aparece en «sin vincular»).
  await prisma.externalAdvisorLink.upsert({
    where: { accountId_externalSource_advisorCode: { accountId: ctx.acc, externalSource: 'PSF', advisorCode: 'CQE' } },
    update: { userId: carlos, deletedAt: null },
    create: { accountId: ctx.acc, externalSource: 'PSF', advisorCode: 'CQE', userId: carlos },
  });

  type RunDef = { id: string; letter: 'A' | 'B' | 'C' | 'D'; advisor: string; by: string };
  const runs: RunDef[] = [
    { id: runIds.A, letter: 'A', advisor: 'CQE', by: carlos },
    { id: runIds.B, letter: 'B', advisor: 'CQE', by: carlos },
    { id: runIds.C, letter: 'C', advisor: 'CQE', by: carlos },
    { id: runIds.D, letter: 'D', advisor: 'MRT', by: sandra },
  ];
  const items: Prisma.ClientImportRunItemCreateManyInput[] = [];
  const snapshots: Prisma.CreditExternalSnapshotCreateManyInput[] = [];
  const counts: Record<string, { created: number; updated: number; setCurrent: number; absent: number; reappeared: number; invalid: number; review: number }> = {};

  // Valores reportados por corrida: la mora crece de a un día entre corridas consecutivas.
  const valuesIn = (s: PsfSpec, letter: 'A' | 'B' | 'C' | 'D'): { balance: number; dpd: number } => {
    const last = s.runs[s.runs.length - 1]!;
    const lastDpd = s.key === 'p5' ? 52 : s.dpd; // el ausente: lo último que reportó
    const delta = RUN_DAY[letter] - RUN_DAY[last];
    return { balance: s.balance, dpd: Math.max(0, lastDpd + delta) };
  };

  for (const r of runs) {
    const c = (counts[r.letter] = { created: 0, updated: 0, setCurrent: 0, absent: 0, reappeared: 0, invalid: 0, review: 0 });
    const rowsOfRun = PSF_CREDITS.filter((s) => s.advisor === r.advisor && s.runs.includes(r.letter));
    rowsOfRun.forEach((s, idx) => {
      const credit = ctx.credits[s.key]!;
      const person = ctx.people[s.client]!;
      const first = s.runs[0] === r.letter;
      const v = valuesIn(s, r.letter);
      const prev = r.letter === 'B' ? valuesIn(s, 'A') : r.letter === 'C' ? valuesIn(s, 'B') : null;
      const clientName = `${person.name}`;
      items.push({
        accountId: ctx.acc,
        runId: r.id,
        action: first ? ImportRunItemAction.CREATED : ImportRunItemAction.UPDATED,
        creditId: credit.id,
        clientId: person.id,
        externalId: s.externalId,
        clientName,
        rowNumber: idx + 1,
        ...(first
          ? { after: json({ outstandingBalance: v.balance, daysPastDue: v.dpd, status: 'ACTIVE', reportedStatus: s.status, assigneeId: credit.ownerId, newClient: true, ...(s.key === 'p4' ? { linkReview: true } : {}) }) }
          : { before: json({ outstandingBalance: prev!.balance, daysPastDue: prev!.dpd, status: 'ACTIVE' }), after: json({ outstandingBalance: v.balance, daysPastDue: v.dpd, status: 'ACTIVE' }) }),
        createdAt: at(RUN_DAY[r.letter], 8, 40),
      });
      snapshots.push({
        accountId: ctx.acc,
        creditId: credit.id,
        runId: r.id,
        externalSource: 'PSF',
        externalId: s.externalId,
        syncStatus: ExternalSyncStatus.PRESENT,
        reportedAsOf: D(RUN_DAY[r.letter]),
        reportedBalance: v.balance,
        reportedDaysPastDue: v.dpd,
        reportedStatus: s.status,
        raw: json({ code: s.externalId, status: s.status, outstandingBalance: v.balance, daysPastDue: v.dpd, installmentAmount: s.installment }),
        createdAt: at(RUN_DAY[r.letter], 8, 40),
      });
      if (first) c.created++;
      else c.updated++;
      if (first && s.key === 'p4') c.review++;
    });
    if (r.letter === 'A') {
      // Una fila del archivo sin número de operación: no se importó.
      items.push({ accountId: ctx.acc, runId: r.id, action: ImportRunItemAction.REJECTED, rowNumber: 5, clientName: 'SIN NOMBRE', reason: 'MISSING_CODE', createdAt: at(RUN_DAY.A, 8, 40) });
      c.invalid++;
    }
    if (r.letter === 'C') {
      // La operación 302-441-0224 dejó de venir en el reporte de hoy: primera ausencia. Con la regla «al día», su mora quedó en 0
      // (SET_CURRENT); la ausencia no dice si pagó o se puso al día.
      const s = PSF_CREDITS.find((p) => p.key === 'p5')!;
      const credit = ctx.credits['p5']!;
      const person = ctx.people[s.client]!;
      items.push(
        { accountId: ctx.acc, runId: r.id, action: ImportRunItemAction.SET_CURRENT, creditId: credit.id, clientId: person.id, externalId: s.externalId, clientName: person.name, before: json({ daysPastDue: 52 }), after: json({ daysPastDue: 0 }), createdAt: at(0, 8, 40) },
        { accountId: ctx.acc, runId: r.id, action: ImportRunItemAction.ABSENT, creditId: credit.id, clientId: person.id, externalId: s.externalId, clientName: person.name, before: json({ outstandingBalance: s.balance, daysPastDue: 52, status: 'ACTIVE' }), createdAt: at(0, 8, 40) },
      );
      snapshots.push({ accountId: ctx.acc, creditId: credit.id, runId: r.id, externalSource: 'PSF', externalId: s.externalId, syncStatus: ExternalSyncStatus.ABSENT, reportedAsOf: D(RUN_DAY.C), raw: json({}), createdAt: at(0, 8, 40) });
      c.absent++;
      c.setCurrent++;
    }
  }

  await prisma.clientImportRun.createMany({
    data: runs.map((r) => {
      const c = counts[r.letter]!;
      const day = RUN_DAY[r.letter];
      return {
        id: r.id,
        accountId: ctx.acc,
        source: 'portfolio',
        fileHash: createHash('sha256').update(`seed-psf-${r.advisor}-${isoOf(day)}`).digest('hex'),
        mode: 'RECONCILE',
        status: 'DONE',
        template: 'pdf-rows',
        scope: 'account',
        externalSource: 'PSF',
        reportAsOf: D(day),
        advisorCode: r.advisor,
        creditsCreated: c.created,
        creditsUpdated: c.updated,
        creditsSetCurrent: c.setCurrent,
        creditsAbsent: c.absent,
        creditsReappeared: c.reappeared,
        rowsIgnored: 2,
        needsReview: c.review,
        errors: c.invalid,
        createdBy: r.by,
        fileName: `Reporte_Mora_${isoOf(day).replace(/-/g, '')}_${r.advisor}.pdf`,
        itemsComplete: true,
        createdAt: at(day, 8, 40),
      };
    }),
  });
  await prisma.clientImportRunItem.createMany({ data: items });
  await prisma.creditExternalSnapshot.createMany({ data: snapshots });
}

// ── Avisos ───────────────────────────────────────────────────────────────────────

async function seedNotifications(ctx: Ctx): Promise<void> {
  const star = ctx.credits['star']!;
  const c08 = ctx.credits['c08']!;
  const n = (user: string, type: NotificationType, title: string, body: string, creditKey: string, day: number, hh: number, read: boolean): Prisma.NotificationCreateManyInput => {
    const c = ctx.credits[creditKey]!;
    return { accountId: ctx.acc, userId: ctx.users[user]!, type, title, body, clientId: c.clientId, creditId: c.id, readAt: read ? at(day, hh + 1, 0) : null, createdAt: at(day, hh, 0) };
  };
  void star;
  void c08;
  await prisma.notification.createMany({
    data: [
      n('carlos', NotificationType.PROMISE_DUE, 'Promesa de pago vencida', 'Lidia Mamani prometió pagar Bs 350 ayer y no se registró el resultado.', 'star', 0, 8, false),
      n('carlos', NotificationType.PAYMENT_REGISTERED, 'Pago registrado', 'Freddy Tarqui pagó Bs 380 en efectivo.', 'c08', 0, 9, false),
      n('carlos', NotificationType.SYSTEM, 'Reemplazo temporal', `Marco Villca cubre el crédito de Lidia Mamani hasta el ${dm(10)}.`, 'star', -4, 9, true),
      n('marco', NotificationType.SYSTEM, 'Te asignaron un reemplazo', `Cubrís el crédito de Lidia Mamani hasta el ${dm(10)}; recibiste su agenda pendiente.`, 'star', -4, 9, false),
      n('rosa', NotificationType.SYSTEM, 'Te asignaron como ayuda', 'Sos de apoyo en el crédito de Lidia Mamani.', 'star', -20, 9, true),
      n('sandra', NotificationType.SYSTEM, 'Promesa incumplida', 'Rubén Apaza incumplió su promesa de pago.', 'c12', -2, 12, false),
    ],
  });
  await prisma.notification.create({
    data: { accountId: ctx.acc, userId: ctx.users['carlos']!, type: NotificationType.ROUTE_ASSIGNED, title: 'Ruta de hoy', body: 'Tenés 4 paradas en tu ruta de hoy.', readAt: at(0, 8, 30), createdAt: at(0, 7, 30) },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO2 (pequeña: sólo para las pruebas de aislamiento entre cuentas)
// ═══════════════════════════════════════════════════════════════════════════════

async function seedDemo2(ctx: Ctx): Promise<void> {
  const norte = ctx.users['norte']!;
  await createPeople(ctx, PEOPLE_DEMO2);
  const specs: AppCreditSpec[] = [
    { key: 'd01', code: 'CRD-DEMO2-0001', client: 'd01', owner: 'norte', typeCode: 'PERSONAL', principal: 2400, n: 8, step: 30, rate: 0.025, paid: 3, dpd: 0, nextIn: 6 },
    { key: 'd02', code: 'CRD-DEMO2-0002', client: 'd02', owner: 'norte', typeCode: 'MICRO', principal: 3000, n: 10, step: 30, rate: 0.025, paid: 2, dpd: 20 },
  ];
  await createAppCredits(ctx, specs, (o) => ctx.userBranch[o]);
  await prisma.$executeRaw`
    UPDATE credit_arrear_episodes SET started_at = ${TODAY}::date - start_days_past_due, priority = 'MEDIUM'::collection_priority
     WHERE account_id = ${ctx.acc} AND ended_at IS NULL AND source = 'CALCULATED'`;
  ctx.episodes = (await prisma.creditArrearEpisode.findMany({ where: { accountId: ctx.acc }, select: { id: true, creditId: true, startedAt: true, endedAt: true } })).map((e) => ({
    id: e.id,
    creditId: e.creditId,
    startedAt: e.startedAt.toISOString().slice(0, 10),
    endedAt: e.endedAt ? e.endedAt.toISOString().slice(0, 10) : null,
  }));
  const ds = newDataSets();
  addItem(ctx, ds, { key: 'd02', type: AgendaItemType.CALL, day: 1, time: '10:00', priority: 'HIGH', expected: 'COLLECT' });
  addItem(ctx, ds, { key: 'd01', type: AgendaItemType.REMINDER, day: 5, details: { description: 'Cobrar cuota' } });
  addActivity(ctx, ds, { key: 'd02', day: -3, type: CreditActivityType.CALL, result: 'NO_ANSWER', notes: 'No contestó.', by: 'norte' });
  await prisma.creditActivity.createMany({ data: ds.activities });
  await prisma.agendaItem.createMany({ data: ds.agenda });
  const nPay = await flushPayments(ctx);
  for (const [creditId, when] of ctx.lastAction) await prisma.credit.update({ where: { id: creditId }, data: { lastActionAt: when } });
  void norte;
  console.log(`  ✓ DEMO2: ${PEOPLE_DEMO2.length} clientes · ${specs.length} créditos · ${nPay} pagos (tamaño mínimo, para aislamiento)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Borrado del dataset demo (para `--refresh`): sólo lo operativo de DEMO y DEMO2
// ═══════════════════════════════════════════════════════════════════════════════

async function wipeDataset(accountIds: string[]): Promise<void> {
  const exists = async (t: string): Promise<boolean> => ((await prisma.$queryRawUnsafe<{ r: string | null }[]>(`SELECT to_regclass('public.${t}')::text AS r`))[0]?.r ?? null) !== null;
  // Hijos primero.
  const tables = [
    'field_evidences', 'field_visits', 'route_stops', 'route_plans', 'notifications', 'agenda_items', 'credit_activities', 'credit_notes',
    'payment_requests', 'payments', 'credit_guarantors', 'collateral_credits', 'collaterals',
    'credit_installments', 'arrears', 'credit_external_snapshots', 'credit_arrear_episodes', 'credit_assignments',
    'client_import_run_items', 'client_import_runs', 'client_external_keys', 'client_contacts', 'client_locations', 'client_relations',
    'client_attachments', 'credits', 'clients',
  ];
  for (const t of tables) {
    if (!(await exists(t))) continue;
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE account_id = ANY($1::text[])`, accountIds);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('🌱 Seeding Kobrax...');

  // 1) Permisos
  for (const [code, module, action, scope] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { module, action: action as never, scope: scope as never },
      create: { code, name: code, module, action: action as never, scope: scope as never },
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permisos`);

  // 2) Roles + role_permissions
  for (const [name, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({ where: { name }, update: { level: def.level, isSystem: true }, create: { name, level: def.level, isSystem: true } });
    const codes = ROLE_PERMISSIONS[name as RoleType] as string[];
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    // 🔴 Un permiso del rol que no está en el catálogo se perdía sin aviso. Ahora frena el seed y dice cuál.
    const missing = codes.filter((c) => !perms.some((p) => p.code === c));
    if (missing.length > 0) throw new Error(`Permisos de ${name} sin catálogo en seed.ts: ${missing.join(', ')}`);
    for (const perm of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    // F4/08 · D8: el alcance de datos se SINCRONIZA (no sólo se agrega): un rol que ya no lo lleva lo pierde.
    const staleScopes = ['data:scope:all', 'data:scope:branch'].filter((c) => !codes.includes(c));
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { code: { in: staleScopes } } } });
  }
  console.log(`  ✓ ${Object.keys(ROLES).length} roles`);

  // Corte para PRODUCCIÓN: `pnpm db:seed:catalog` carga sólo permisos y roles. Sin el catálogo el registro público
  // falla con ROLE_CATALOG_MISSING; con el seed completo entrarían datos de prueba a la base real. Es un corte en
  // ESTE archivo (y no un seed aparte) porque la lista de permisos vive acá. Se lee de argv y no de una variable de
  // entorno para no depender de cross-env: `VAR=1 comando` no existe en PowerShell.
  if (process.argv.includes('--catalog')) {
    console.log('  ⏹ --catalog → sin datos de demostración');
    return;
  }

  // 3) Cuentas: DEMO (la grande) y DEMO2 (aislamiento). Plan PROFESSIONAL: tienen equipo.
  const accountData = { accountType: AccountType.INDEPENDENT, status: AccountStatus.ACTIVE, planCode: PlanCode.PROFESSIONAL, countryCode: 'BO', currencyCode: 'BOB', timezone: 'America/La_Paz' };
  const demo = await prisma.account.upsert({ where: { code: 'DEMO' }, update: {}, create: { code: 'DEMO', businessName: 'Kobrax Demo', ...accountData } });
  const demo2 = await prisma.account.upsert({ where: { code: 'DEMO2' }, update: { status: AccountStatus.ACTIVE }, create: { code: 'DEMO2', businessName: 'Kobrax Demo Norte', ...accountData } });
  // Configuración de importación de PSF (mantiene lo demás que tenga la cuenta).
  await prisma.account.update({ where: { id: demo.id }, data: { configuration: json({ ...((demo.configuration as object) ?? {}), importConfig: IMPORT_CONFIG }) } });

  // Categorías de mora iniciales A 1–30, B 31–60, C 61+ (D1-b) para CADA cuenta. No pisa lo que alguien editó.
  for (const accountId of [demo.id, demo2.id]) {
    await prisma.arrearCategory.createMany({ data: DEFAULT_ARREAR_CATEGORIES.map((c) => ({ ...c, accountId })), skipDuplicates: true });
    await prisma.catalogItem.createMany({
      data: CATALOGS.map((c) => ({ accountId, catalog: c.catalog, code: c.code, label: c.label, sortOrder: c.sortOrder, metadata: json(c.metadata ?? {}) })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ cuentas DEMO y DEMO2 · categorías de mora A/B/C · ${CATALOGS.length} catálogos por cuenta`);

  // 4) Agencias, usuarios y membresías (con la agencia de supervisores y cobradores: `user_accounts.branch_id`).
  const ensureBranch = async (accountId: string, code: string, name: string, city: string) =>
    (await prisma.branch.findFirst({ where: { accountId, code, deletedAt: null } })) ?? prisma.branch.create({ data: { accountId, code, name, city } });
  const cen = await ensureBranch(demo.id, 'CEN', 'Agencia Central', 'La Paz');
  const alt = await ensureBranch(demo.id, 'ALT', 'Agencia El Alto', 'El Alto');
  const nor = await ensureBranch(demo2.id, 'NOR', 'Agencia Norte', 'La Paz');
  const branchIds = { CEN: cen.id, ALT: alt.id };

  const passwordHash = await bcrypt.hash('Kobrax123!', 12);
  const roleIds = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  const ensureUser = async (email: string, first: string, last: string): Promise<string> => {
    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, status: UserStatus.ACTIVE, requiresPasswordChange: false, profile: { create: { firstName: first, lastName: last } } },
    });
    return u.id;
  };
  const member = async (userId: string, accountId: string, role: RoleType, o: { branchId?: string; isOwner?: boolean; isDefault?: boolean }) => {
    const roleId = roleIds[role]!;
    await prisma.userAccount.upsert({
      where: { userId_accountId: { userId, accountId } },
      update: { roleId, branchId: o.branchId ?? null },
      create: { userId, accountId, roleId, branchId: o.branchId, isOwner: !!o.isOwner, isDefault: !!o.isDefault },
    });
  };
  const users: Record<string, string> = {};
  const userBranch: Record<string, string> = {};
  for (const t of TEAM) {
    users[t.key] = await ensureUser(t.email, t.first, t.last);
    const branchId = t.branch ? branchIds[t.branch] : undefined;
    if (branchId) userBranch[t.key] = branchId;
    await member(users[t.key]!, demo.id, t.role, { branchId, isOwner: t.isOwner, isDefault: t.isDefault });
    if (t.alsoDemo2) await member(users[t.key]!, demo2.id, t.alsoDemo2, {});
  }
  // El supervisor de cada cobrador (perfil) y el gerente de cada agencia.
  for (const t of TEAM) {
    if (t.supervisor) await prisma.profile.updateMany({ where: { userId: users[t.key]! }, data: { supervisorUserId: users[t.supervisor]! } });
  }
  await prisma.branch.update({ where: { id: cen.id }, data: { managerUserId: users['sandra'] } });
  await prisma.branch.update({ where: { id: alt.id }, data: { managerUserId: users['maria'] } });
  // DEMO2: un cobrador de su agencia.
  users['norte'] = await ensureUser('cobrador.norte@kobrax.demo', 'Nora', 'Norte');
  await member(users['norte']!, demo2.id, RoleType.COLLECTOR, { branchId: nor.id });
  console.log(`  ✓ ${TEAM.length + 1} usuarios · 2 agencias en DEMO (supervisores y cobradores con agencia) · pass: Kobrax123!`);

  // 5) Dataset demo. Si ya está sembrado no se toca (las fechas son de cuando se sembró): `--refresh` lo renueva.
  const refresh = process.argv.includes('--refresh');
  if (refresh) {
    await wipeDataset([demo.id, demo2.id]);
    console.log('  ⌫ dataset demo anterior borrado (--refresh)');
  } else if (await prisma.credit.findFirst({ where: { accountId: demo.id, code: 'CRD-DEMO-0001' }, select: { id: true } })) {
    console.log('  ↺ el dataset demo ya está sembrado; no se toca. Para renovar las fechas: `pnpm db:seed:refresh`.');
    console.log('✅ Seed completo.');
    return;
  }

  await seedDemo(newCtx(demo.id, users, userBranch), branchIds);
  const users2 = { norte: users['norte']!, maria: users['maria']!, multi2: users['multi2']! };
  await seedDemo2(newCtx(demo2.id, users2, { norte: nor.id }));

  console.log('✅ Seed completo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
