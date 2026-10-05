import type { Prisma } from '@prisma/client';
import { CreditDataOrigin, CreditStatus, ExternalSyncStatus } from '@prisma/client';
import { CreditOrigin, nextImportMissing, readCreditMetadata, type ImportTrackedField } from '@kobrax/shared';
import type { NormalizedRecord } from './field-catalog';
import type { ImportConfig } from './import-config';

/**
 * Qué escribe una importación en cada crédito (F4/06 · Fase 4, PSF · fase 5). Funciones puras: el
 * servicio sólo las aplica dentro de la transacción.
 *
 * 🔴 **Desconocido no es cero (D9).** Si el archivo no trae un dato:
 *  · al crear, las columnas `NOT NULL` reciben un 0 de relleno y el campo queda en
 *    `metadata.importMissing`, que es lo que la ficha consulta antes de dibujarlo;
 *  · al actualizar, la columna **no se toca**: un archivo con otro formato no borra lo que ya se sabía.
 */

/** La corrida que escribe: queda en cada crédito para saber de qué archivo vino su último dato. */
export interface ImportStamp {
  runId: string;
  /** ISO. */
  at: string;
}

/**
 * La única fuente de archivos hoy (D1). Cuando haya otra, sale de la configuración del tenant; mientras
 * tanto es una constante y no un campo que alguien pueda cambiar a mitad de camino y duplicar la cartera.
 */
export const FILE_SOURCE = 'PSF';

/** Qué datos financieros trae esta fila. Nº de cuotas y frecuencia no los trae ningún formato. */
export function presentFields(b: NormalizedRecord): Partial<Record<ImportTrackedField, boolean>> {
  return {
    principalAmount: b.principalAmount !== null,
    outstandingBalance: b.outstandingBalance !== null,
    interestRate: b.interestRate !== null,
    installmentAmount: b.installmentAmount !== null,
    nextDueDate: b.nextDueDate !== null,
    disbursedAt: b.disbursedAt !== null,
    daysPastDue: b.daysPastDue !== null,
  };
}

/**
 * Lo que la corrida sabe además de la fila: el id que va a tener el crédito (los snapshots lo
 * necesitan antes del insert), la fecha de corte del reporte (D9), el asesor (D8), qué representa
 * el saldo en este formato (D6) y cómo se leen sus estados.
 */
export interface RowContext {
  id?: string;
  reportAsOf?: Date | null;
  advisorCode?: string;
  balanceBasis?: 'principal' | 'total';
  statusMap?: Record<string, CreditStatus>;
  /** Sólo al actualizar: el estado que tiene hoy. */
  prevStatus?: CreditStatus;
  /** Sólo al actualizar: desde cuándo está castigado, si lo está (D1-a). El castigo ya marcado no se pisa. */
  prevWrittenOffAt?: Date | null;
  /**
   * Sólo al crear: a quién queda asignado. Lo decide `planAssignments` (quien importa, lo elegido o la
   * sugerencia del asesor) y la fila permanente la escribe `AssignmentService`: la columna nace igual.
   */
  assignedManagerId?: string;
}

/** Lo reportado que no tiene columna: viaja en `metadata` con el resto de lo que trajo el archivo. */
function reportedMeta(b: NormalizedRecord, prevMeta: Record<string, unknown>, ctx: RowContext): Record<string, unknown> {
  const guarantor = b.guarantorName || b.guarantorPhone ? { name: b.guarantorName ?? undefined, phone: b.guarantorPhone ?? undefined } : undefined;
  return {
    reportedStatus: b.status ?? prevMeta.reportedStatus,
    reportedTermMonths: b.termMonths ?? prevMeta.reportedTermMonths,
    lastPaymentDate: b.lastPaymentDate ?? prevMeta.lastPaymentDate,
    reportedGuarantor: guarantor ?? prevMeta.reportedGuarantor,
    externalAdvisorCode: ctx.advisorCode ?? prevMeta.externalAdvisorCode,
    // D6: sólo si el formato lo declara. Sin declarar, el saldo reportado queda sin base: no se inventa.
    balanceBasis: ctx.balanceBasis ?? prevMeta.balanceBasis,
  };
}

/** Datos de un crédito nuevo para `createMany`. */
export function creditCreateData(
  accountId: string,
  clientId: string,
  b: NormalizedRecord,
  scope: ImportConfig['scope'],
  stamp: ImportStamp,
  ctx: RowContext = {},
): Prisma.CreditCreateManyInput {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    accountId,
    clientId,
    code: b.code ?? undefined,
    // Identidad de la operación (D1): el nº de operación del reporte. `code` queda como rótulo.
    origin: CreditDataOrigin.IMPORT,
    externalSource: FILE_SOURCE,
    externalId: b.code ?? undefined,
    syncStatus: ExternalSyncStatus.PRESENT,
    lastSeenRunId: stamp.runId,
    reportedAsOf: ctx.reportAsOf ?? undefined,
    // Rellenos de columnas NOT NULL: `importMissing` dice que no significan nada.
    principalAmount: b.principalAmount ?? 0,
    outstandingBalance: b.outstandingBalance ?? 0,
    interestRate: b.interestRate ?? 0,
    currency: mapCurrency(b.currency),
    status: storedStatus(b.status, ctx.statusMap) ?? CreditStatus.ACTIVE, // crédito nuevo: default razonable si el estado no se mapea
    // D1-a: «castigado» es una condición aparte; la mora sigue corriendo y el job lo procesa igual.
    ...(isWrittenOffLabel(b.status, ctx.statusMap) ? writtenOffFields(stamp) : {}),
    daysPastDue: b.daysPastDue ?? 0,
    branchId: scope.kind === 'branch' ? scope.ref : undefined,
    assignedManagerId: ctx.assignedManagerId,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    metadata: stripUndefined({
      origin: CreditOrigin.IMPORT,
      coHolder: b.coHolder ?? undefined,
      pastDueAmount: b.pastDueAmount ?? undefined,
      // Antes se leían y se descartaban: la ficha y la agenda del importado quedaban sin cuota ni fecha.
      installmentAmount: b.installmentAmount ?? undefined,
      nextDueDate: b.nextDueDate ?? undefined,
      ...reportedMeta(b, {}, ctx),
      importMissing: nextImportMissing(undefined, presentFields(b)),
      importRunId: stamp.runId,
      importedAt: stamp.at,
    }),
  };
}

/**
 * Datos para actualizar un crédito ya importado. Sólo se escribe lo que la fila trae: `null` = el
 * parser no encontró la columna, y escribirla siempre haría que un archivo con otro layout ponga la
 * cartera entera en cero (§2.1 del plan).
 */
export function creditUpdateData(
  b: NormalizedRecord,
  prevMeta: Record<string, unknown>,
  stamp: ImportStamp,
  ctx: RowContext = {},
): Prisma.CreditUpdateInput {
  const prev = readCreditMetadata(prevMeta);
  return {
    principalAmount: b.principalAmount ?? undefined,
    outstandingBalance: b.outstandingBalance ?? undefined,
    daysPastDue: b.daysPastDue ?? undefined,
    status: updatedStatus(b.status, ctx),
    // Sólo si todavía no estaba castigado: la fecha y el motivo del primero no se pisan.
    ...(isWrittenOffLabel(b.status, ctx.statusMap) && !ctx.prevWrittenOffAt ? writtenOffFields(stamp) : {}),
    interestRate: b.interestRate ?? undefined,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    // Vino en este reporte: presente, y si estaba ausente, deja de estarlo (reaparición, D4).
    syncStatus: ExternalSyncStatus.PRESENT,
    absentSince: null,
    lastSeenRunId: stamp.runId,
    reportedAsOf: ctx.reportAsOf ?? undefined,
    metadata: stripUndefined({
      ...prevMeta,
      origin: CreditOrigin.IMPORT,
      coHolder: b.coHolder ?? prevMeta.coHolder,
      pastDueAmount: b.pastDueAmount ?? prevMeta.pastDueAmount,
      installmentAmount: b.installmentAmount ?? prevMeta.installmentAmount,
      nextDueDate: b.nextDueDate ?? prevMeta.nextDueDate,
      ...reportedMeta(b, prevMeta, ctx),
      importMissing: nextImportMissing(prev.importMissing, presentFields(b)),
      importRunId: stamp.runId,
      importedAt: stamp.at,
    }),
  };
}

/**
 * El estado al actualizar. Etiqueta que se entiende → ese estado. Etiqueta desconocida → no se toca,
 * para no degradar en silencio un estado que la fuente sí dijo antes — **salvo que el crédito esté
 * cerrado**: si la fuente lo vuelve a traer en su reporte de mora, para ella está vivo (B-4 de la
 * revisión: la ausencia no reabre nada; la presencia sí).
 */
function updatedStatus(label: string | null, ctx: RowContext): CreditStatus | undefined {
  const mapped = storedStatus(label, ctx.statusMap);
  if (mapped) return mapped;
  if (ctx.prevStatus && ctx.prevStatus !== CreditStatus.ACTIVE) return CreditStatus.ACTIVE;
  return undefined;
}

/**
 * Lo que la fuente reportó de esta operación en esta corrida (§12). `null` en un dato = el reporte no
 * lo trajo; la fila `ABSENT` no trae ninguno.
 */
export function snapshotData(
  accountId: string,
  creditId: string,
  externalId: string,
  runId: string,
  reportAsOf: Date | null,
  b: NormalizedRecord | null,
): Prisma.CreditExternalSnapshotCreateManyInput {
  return {
    accountId,
    creditId,
    runId,
    externalSource: FILE_SOURCE,
    externalId,
    syncStatus: b ? ExternalSyncStatus.PRESENT : ExternalSyncStatus.ABSENT,
    reportedAsOf: reportAsOf ?? undefined,
    reportedBalance: b?.outstandingBalance ?? undefined,
    reportedDaysPastDue: b?.daysPastDue ?? undefined,
    reportedStatus: b?.status ?? undefined,
    raw: b ? stripUndefined(b as unknown as Record<string, unknown>) : {},
  };
}

// VIGENTE → ACTIVE; el resto, mapeo mínimo. Cada tenant puede sumar o corregir etiquetas en su
// configuración (`statusMap`), que manda sobre esta tabla. Devuelve null ante una etiqueta
// desconocida → el caller decide (preservar en update, default en create).
/** Lo que dice el mapa de estados: un estado real o la marca «castigado» (que NO es un estado de `credits`). */
export type MappedStatus = CreditStatus | 'WRITTEN_OFF';

const STATUS_MAP: Record<string, MappedStatus> = {
  VIGENTE: CreditStatus.ACTIVE,
  VENCIDO: CreditStatus.DEFAULTED,
  // D1-a: en el mapa, `WRITTEN_OFF` quiere decir «la condición de castigo» (`written_off_at`), no un estado
  // que se guarde: `storedStatus` lo traduce a ACTIVE e `isWrittenOffLabel` marca el castigo.
  CASTIGADO: 'WRITTEN_OFF',
  CANCELADO: CreditStatus.CANCELLED,
};

/** Mayúsculas y sin tildes: "Ejecución" y "EJECUCION" son la misma etiqueta. */
export function statusKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function mapStatus(raw: string | null, overrides?: Record<string, MappedStatus>): MappedStatus | null {
  if (!raw) return null;
  const key = statusKey(raw);
  return overrides?.[key] ?? STATUS_MAP[key] ?? null;
}

/** El estado que se guarda: `WRITTEN_OFF` ya no se escribe nunca (D1-a); el castigo va en `written_off_at`. */
export function storedStatus(raw: string | null, overrides?: Record<string, MappedStatus>): CreditStatus | null {
  const mapped = mapStatus(raw, overrides);
  return mapped === 'WRITTEN_OFF' ? CreditStatus.ACTIVE : mapped;
}

/** ¿La etiqueta del reporte dice «castigado»? */
export function isWrittenOffLabel(raw: string | null, overrides?: Record<string, MappedStatus>): boolean {
  return mapStatus(raw, overrides) === 'WRITTEN_OFF';
}

/** Las columnas del castigo que escribe el importador (lo hace el sistema: sin `written_off_by`). */
function writtenOffFields(stamp: ImportStamp) {
  return { writtenOffAt: new Date(stamp.at), writtenOffBy: null, writtenOffReason: 'Reportado como castigado en la importación' };
}

export function mapCurrency(raw: string | null): string {
  if (!raw) return 'BOB';
  const u = raw.toUpperCase();
  if (u.startsWith('BOLIV')) return 'BOB';
  if (u.startsWith('DOLAR') || u.startsWith('DÓLAR')) return 'USD';
  return raw;
}

/** Prisma rechaza `undefined` dentro de un JSON. */
function stripUndefined(o: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Prisma.InputJsonObject;
}
