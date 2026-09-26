import { describe, expect, it } from 'vitest';
import { paymentPlanCsv, paymentPlanFileName } from './plan-csv.js';

const ROW = { number: 1, dueDate: '2026-10-31', principal: 766.8, interest: 150, amount: 916.8, principalBalance: 9233.2 };

describe('paymentPlanCsv', () => {
  it('encabezado, BOM y números con punto decimal', () => {
    const csv = paymentPlanCsv([ROW]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Cuota,Fecha,Capital,Interés,Total cuota,Saldo de capital\n1,2026-10-31,766.80,150.00,916.80,9233.20\n');
  });

  it('con seguro y cargos (D18) agrega sus columnas', () => {
    const csv = paymentPlanCsv([{ ...ROW, insurance: 5, charges: 105, amount: 1026.8 }]);
    expect(csv.slice(1).split('\n')[0]).toBe('Cuota,Fecha,Capital,Interés,Seguro,Cargos,Total cuota,Saldo de capital');
    expect(csv.split('\n')[1]).toBe('1,2026-10-31,766.80,150.00,5.00,105.00,1026.80,9233.20');
  });
});

describe('paymentPlanFileName', () => {
  it('sin acentos ni espacios', () => {
    expect(paymentPlanFileName('María José Peña', '2026-10-31')).toBe('plan-de-pagos-maria-jose-pena-2026-10-31.csv');
    expect(paymentPlanFileName(undefined, '2026-10-31')).toBe('plan-de-pagos-2026-10-31.csv');
  });
});
