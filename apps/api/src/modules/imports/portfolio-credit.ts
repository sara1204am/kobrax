import type { Prisma } from '@prisma/client';
import { CreditStatus } from '@prisma/client';
import { CreditOrigin, nextImportMissing, readCreditMetadata, type ImportTrackedField } from '@kobrax/shared';
import type { NormalizedRecord } from './field-catalog';
import type { ImportConfig } from './import-config';

/**
 * Qué escribe una importación en cada crédito (F4/06 · Fase 4). Funciones puras: el servicio sólo
 * las aplica dentro de la transacción.
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

/** Datos de un crédito nuevo para `createMany` (el archivo no trae carnet → cliente sin nationalId). */
export function creditCreateData(
  accountId: string,
  clientId: string,
  b: NormalizedRecord,
  scope: ImportConfig['scope'],
  stamp: ImportStamp,
): Prisma.CreditCreateManyInput {
  return {
    accountId,
    clientId,
    code: b.code ?? undefined,
    // Rellenos de columnas NOT NULL: `importMissing` dice que no significan nada.
    principalAmount: b.principalAmount ?? 0,
    outstandingBalance: b.outstandingBalance ?? 0,
    interestRate: b.interestRate ?? 0,
    currency: mapCurrency(b.currency),
    status: mapStatus(b.status) ?? CreditStatus.ACTIVE, // crédito nuevo: default razonable si el estado no se mapea
    daysPastDue: b.daysPastDue ?? 0,
    branchId: scope.kind === 'branch' ? scope.ref : undefined,
    assignedManagerId: scope.kind === 'official' ? scope.ref : undefined,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    metadata: stripUndefined({
      origin: CreditOrigin.IMPORT,
      coHolder: b.coHolder ?? undefined,
      pastDueAmount: b.pastDueAmount ?? undefined,
      // Antes se leían y se descartaban: la ficha y la agenda del importado quedaban sin cuota ni fecha.
      installmentAmount: b.installmentAmount ?? undefined,
      nextDueDate: b.nextDueDate ?? undefined,
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
export function creditUpdateData(b: NormalizedRecord, prevMeta: Record<string, unknown>, stamp: ImportStamp): Prisma.CreditUpdateInput {
  const prev = readCreditMetadata(prevMeta);
  return {
    principalAmount: b.principalAmount ?? undefined,
    outstandingBalance: b.outstandingBalance ?? undefined,
    daysPastDue: b.daysPastDue ?? undefined,
    // Estado desconocido (no mapeado) → NO tocar el status: evita degradar silenciosamente
    // un DEFAULTED/WRITTEN_OFF a ACTIVE en cada import (la tabla de equivalencias completa = web).
    status: mapStatus(b.status) ?? undefined,
    interestRate: b.interestRate ?? undefined,
    disbursedAt: b.disbursedAt ? new Date(b.disbursedAt) : undefined,
    metadata: stripUndefined({
      ...prevMeta,
      origin: CreditOrigin.IMPORT,
      coHolder: b.coHolder ?? prevMeta.coHolder,
      pastDueAmount: b.pastDueAmount ?? prevMeta.pastDueAmount,
      installmentAmount: b.installmentAmount ?? prevMeta.installmentAmount,
      nextDueDate: b.nextDueDate ?? prevMeta.nextDueDate,
      importMissing: nextImportMissing(prev.importMissing, presentFields(b)),
      importRunId: stamp.runId,
      importedAt: stamp.at,
    }),
  };
}

// VIGENTE → ACTIVE; el resto, mapeo mínimo (la tabla completa de equivalencias es config → web).
// Devuelve null ante una etiqueta desconocida → el caller decide (preservar en update, default en create).
const STATUS_MAP: Record<string, CreditStatus> = {
  VIGENTE: CreditStatus.ACTIVE,
  VENCIDO: CreditStatus.DEFAULTED,
  CASTIGADO: CreditStatus.WRITTEN_OFF,
  CANCELADO: CreditStatus.CANCELLED,
};
export function mapStatus(raw: string | null): CreditStatus | null {
  return STATUS_MAP[(raw ?? '').toUpperCase()] ?? null;
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
