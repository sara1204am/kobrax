import { describe, expect, it } from 'vitest';
import type { MoraPromise } from '../types/mora.types.js';
import { summarizePromises } from './promises.js';

const p = (status: MoraPromise['status']): MoraPromise => ({ id: status + Math.random(), promiseDate: '2026-10-01', status, createdAt: '2026-09-20T00:00:00Z' });

describe('summarizePromises', () => {
  it('sin promesas no hay nada que resumir ni porcentaje', () => {
    expect(summarizePromises([])).toEqual({ made: 0, active: 0, unresolved: 0, kept: 0, broken: 0, complianceRate: undefined });
  });

  it('cumplimiento = cumplidas / (cumplidas + incumplidas)', () => {
    const s = summarizePromises([p('KEPT'), p('KEPT'), p('KEPT'), p('BROKEN')]);
    expect(s.kept).toBe(3);
    expect(s.broken).toBe(1);
    expect(s.complianceRate).toBe(0.75);
  });

  it('🔴 una promesa vencida sin cerrar NO es incumplida: no entra en el porcentaje', () => {
    const s = summarizePromises([p('KEPT'), p('OVERDUE'), p('OVERDUE')]);
    expect(s.unresolved).toBe(2);
    expect(s.broken).toBe(0);
    expect(s.complianceRate).toBe(1);
  });

  it('sin ningún desenlace no hay porcentaje: undefined, no 0 %', () => {
    expect(summarizePromises([p('ACTIVE'), p('OVERDUE')]).complianceRate).toBeUndefined();
  });

  it('una promesa movida de fecha no se cuenta dos veces (la nueva es otra promesa)', () => {
    const s = summarizePromises([p('RESCHEDULED'), p('ACTIVE')]);
    expect(s.made).toBe(1);
    expect(s.active).toBe(1);
  });

  it('las canceladas no afectan el cumplimiento', () => {
    expect(summarizePromises([p('CANCELLED'), p('KEPT')]).complianceRate).toBe(1);
  });
});
