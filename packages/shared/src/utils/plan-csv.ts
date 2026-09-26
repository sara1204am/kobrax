/**
 * El plan de pagos en CSV, para descargarlo desde el alta o la ficha del crédito.
 *
 * Misma convención que los exports de la API (`apps/api/src/modules/exports/csv.ts`): separador
 * coma, números sin formato (punto decimal) y BOM inicial para que Excel en Windows lea bien los
 * acentos. Las columnas de seguro y cargos (D18) van sólo si el plan las trae.
 */
import type { CreditScheduleRow } from './credit-engine.js';

const BOM = String.fromCharCode(0xfeff);

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paymentPlanCsv(rows: CreditScheduleRow[]): string {
  const extras = rows.some((r) => r.insurance !== undefined);
  const header = ['Cuota', 'Fecha', 'Capital', 'Interés', ...(extras ? ['Seguro', 'Cargos'] : []), 'Total cuota', 'Saldo de capital'];
  const lines = rows.map((r) =>
    [
      r.number,
      r.dueDate,
      r.principal.toFixed(2),
      r.interest.toFixed(2),
      ...(extras ? [(r.insurance ?? 0).toFixed(2), (r.charges ?? 0).toFixed(2)] : []),
      r.amount.toFixed(2),
      r.principalBalance.toFixed(2),
    ]
      .map(cell)
      .join(','),
  );
  return `${BOM}${header.map(cell).join(',')}\n${lines.join('\n')}\n`;
}

/** Nombre de archivo: `plan-de-pagos-juan-perez-2026-10-31.csv`. Sin acentos ni espacios. */
export function paymentPlanFileName(clientName: string | undefined, firstDueDate: string): string {
  const slug = (clientName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `plan-de-pagos${slug ? `-${slug}` : ''}-${firstDueDate}.csv`;
}
