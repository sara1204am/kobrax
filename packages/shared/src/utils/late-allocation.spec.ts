import { describe, expect, it } from 'vitest';
import { allocateWithLateInterest, lateStateAt, principalEventsByInstallment, type LateAllocationInput } from './late-allocation.js';

// Cuota de 100 = 80 capital + 20 interés, vence 2026-01-10; tasa 36,5 % Actual/365 ⇒ 0,1 %/día sobre el capital (0,08/día).
const rows = [
  { number: 1, dueDate: '2026-01-10', amount: 100, principal: 80, interest: 20 },
  { number: 2, dueDate: '2026-02-10', amount: 100, principal: 80, interest: 20 },
];
const policy = { annualRate: 36.5, dayCount: 365 as const, graceDays: 0 };
const base = (over: Partial<LateAllocationInput> = {}): LateAllocationInput => ({ rows, policy, scheduledPaid: {}, principalEvents: {}, lateCollected: {}, lateWaived: {}, ...over });

describe('imputación con mora (F17 F3-c)', () => {
  it('sin atraso no hay mora: se aplica sólo a lo programado, como siempre', () => {
    const r = allocateWithLateInterest({ ...base(), amount: 100, date: '2026-01-10' });
    expect(r.allocations).toEqual([{ installmentNumber: 1, component: 'SCHEDULED', amount: 100 }]);
    expect(r.lateApplied).toBe(0);
  });

  it('con 10 días de atraso: primero la mora, luego la cuota (orden D1)', () => {
    // 80 × 0,1 % × 10 = 0,80
    const r = allocateWithLateInterest({ ...base(), amount: 50, date: '2026-01-20' });
    expect(r.allocations).toEqual([
      { installmentNumber: 1, component: 'LATE_INTEREST', amount: 0.8 },
      { installmentNumber: 1, component: 'SCHEDULED', amount: 49.2 },
    ]);
  });

  it('lo que sobra de una cuota pasa a la siguiente, y la mora de la más antigua se paga antes', () => {
    const r = allocateWithLateInterest({ ...base(), amount: 101, date: '2026-01-20' });
    expect(r.allocations.map((a) => `${a.installmentNumber}:${a.component}:${a.amount}`)).toEqual(['1:LATE_INTEREST:0.8', '1:SCHEDULED:100', '2:SCHEDULED:0.2']);
  });

  it('un pago parcial a la mora no toca el capital: la base sigue igual', () => {
    const r = allocateWithLateInterest({ ...base(), amount: 0.5, date: '2026-01-20' });
    expect(r.allocations).toEqual([{ installmentNumber: 1, component: 'LATE_INTEREST', amount: 0.5 }]);
    expect(r.latePendingAfter).toBe(0.3);
  });

  it('la mora ya cobrada y la exonerada se descuentan', () => {
    const s = lateStateAt(base({ lateCollected: { 1: 0.3 }, lateWaived: { 1: 0.2 } }), '2026-01-20');
    expect(s[0]!.pending).toBe(0.3);
    expect(s[0]!.accrued).toBe(0.8);
  });

  it('el interés corriente se cubre antes que el capital: un pago de 20 NO reduce la base del devengo', () => {
    expect(principalEventsByInstallment({ rows, applications: [{ installmentNumber: 1, amount: 20, date: '2026-01-15' }] })[1]).toBeUndefined();
    const events = principalEventsByInstallment({ rows, applications: [{ installmentNumber: 1, amount: 50, date: '2026-01-15' }] });
    expect(events[1]).toEqual([{ date: '2026-01-15', principal: 30 }]);
  });

  it('un pago que tocó el capital cierra el tramo: la mora posterior corre sobre lo que queda', () => {
    // día 10→15: 80 × 0,1 % × 5 = 0,40; pagó 50 (30 de capital) → base 50; día 15→20: 50 × 0,1 % × 5 = 0,25 ⇒ 0,65
    const events = principalEventsByInstallment({ rows, applications: [{ installmentNumber: 1, amount: 50, date: '2026-01-15' }] });
    const s = lateStateAt(base({ scheduledPaid: { 1: 50 }, principalEvents: events }), '2026-01-20');
    expect(s[0]!.accrued).toBe(0.65);
  });

  it('una cuota pagada igual conserva su mora devengada hasta cobrarla', () => {
    const events = principalEventsByInstallment({ rows, applications: [{ installmentNumber: 1, amount: 100, date: '2026-01-20' }] });
    const s = lateStateAt(base({ scheduledPaid: { 1: 100 }, principalEvents: events }), '2026-03-01');
    expect(s[0]!.scheduledPending).toBe(0);
    expect(s[0]!.pending).toBe(0.8);
  });

  it('una cuota sin partición capital/interés no devenga', () => {
    const s = lateStateAt(base({ rows: [{ number: 1, dueDate: '2026-01-10', amount: 100 }] }), '2026-03-01');
    expect(s[0]!.accrued).toBe(0);
  });

  it('🔴 conservación: lo aplicado + lo que no cupo = el pago, al centavo (700 casos)', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 700; i++) {
      const amount = Math.round(rnd() * 25000) / 100;
      const day = 10 + Math.floor(rnd() * 80);
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      const r = allocateWithLateInterest({ ...base({ policy: { ...policy, annualRate: Math.round(rnd() * 9000) / 100, graceDays: Math.floor(rnd() * 5) } }), amount, date });
      const sum = r.allocations.reduce((s, a) => s + Math.round(a.amount * 100), 0);
      expect(sum + Math.round(r.unapplied * 100)).toBe(Math.round(amount * 100));
      expect(r.allocations.every((a) => a.amount > 0)).toBe(true);
      expect(Math.round((r.lateApplied + r.scheduledApplied) * 100)).toBe(sum);
    }
  });
});
