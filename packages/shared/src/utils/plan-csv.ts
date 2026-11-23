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

/**
 * Lo que queda por cobrar después de cada cuota, sobre el total del plan. Es el «saldo» de un crédito acordado, que no
 * tiene capital ni interés pactados: sólo un monto y cuántas veces se paga.
 */
export function remainingAfter(rows: CreditScheduleRow[]): number[] {
  let left = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100);
  return rows.map((r) => {
    left -= Math.round(r.amount * 100);
    return left / 100;
  });
}

/**
 * `informal` (crédito de monto o cuota acordados): sólo cuota, fecha, monto y saldo por cobrar. El reparto capital/interés
 * del motor existe por dentro, pero nadie lo pactó y mostrarlo confunde.
 */
export function paymentPlanCsv(rows: CreditScheduleRow[], opts: { informal?: boolean } = {}): string {
  if (opts.informal) {
    const left = remainingAfter(rows);
    const lines = rows.map((r, i) => [r.number, r.dueDate, r.amount.toFixed(2), left[i]!.toFixed(2)].map(cell).join(','));
    return `${BOM}${['Cuota', 'Fecha', 'Monto de la cuota', 'Saldo por cobrar'].map(cell).join(',')}\n${lines.join('\n')}\n`;
  }
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
