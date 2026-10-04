import { describe, expect, it } from 'vitest';
import type { MoraPromise } from '../types/mora.types.js';
import { computeRecoveryMetrics, type RecoveryMetricsInput } from './recovery-metrics.js';

const NOW = '2026-10-10T15:00:00Z';
const EPISODE = { startedAt: '2026-10-01', startedAtEstimated: false, balanceAtStart: 1000 };
const base = (over: Partial<RecoveryMetricsInput> = {}): RecoveryMetricsInput => ({ now: NOW, episode: EPISODE, activities: [], payments: [], promises: [], ...over });
const act = (type: string, createdAt: string, result?: string) => ({ type, createdAt, result });
const pay = (amount: number, paymentDate: string, channel?: string) => ({ amount, paymentDate, channel });
const promise = (status: MoraPromise['status'], createdAt: string): MoraPromise => ({ id: status + createdAt, promiseDate: '2026-10-20', status, createdAt });

describe('computeRecoveryMetrics — sin nada hecho todavía', () => {
  const m = computeRecoveryMetrics(base());

  it('🔴 los «días hasta…» son ausentes, no 0: todavía no pasó', () => {
    expect(m.daysToFirstContact).toBeUndefined();
    expect(m.daysToFirstVisit).toBeUndefined();
    expect(m.daysToFirstPayment).toBeUndefined();
  });

  it('las cuentas arrancan en cero y no hay porcentaje de cumplimiento', () => {
    expect(m.activities).toEqual({ total: 0, calls: 0, visits: 0, messages: 0 });
    expect(m.recoveredAmount).toBe(0);
    expect(m.contacts).toBe(0);
    expect(m.promises.complianceRate).toBeUndefined();
  });

  it('el episodio da la ventana y dice si su inicio es estimado', () => {
    expect(m.window).toBe('EPISODE');
    expect(m.since).toBe('2026-10-01');
    expect(computeRecoveryMetrics(base({ episode: { ...EPISODE, startedAtEstimated: true } })).sinceEstimated).toBe(true);
  });
});

describe('computeRecoveryMetrics — gestiones', () => {
  const m = computeRecoveryMetrics(
    base({
      activities: [
        act('CALL', '2026-10-02T14:00:00Z', 'NO_ANSWER'),
        act('CALL', '2026-10-04T14:00:00Z', 'CONTACTED'),
        act('VISIT', '2026-10-06T14:00:00Z', 'NOT_FOUND'),
        act('MESSAGE', '2026-10-07T14:00:00Z', 'NO_ANSWER'),
        act('NOTE', '2026-10-07T15:00:00Z'),
        act('PAYMENT', '2026-10-08T15:00:00Z'),
        act('ASSIGNMENT', '2026-10-02T15:00:00Z'),
      ],
    }),
  );

  it('cuenta llamadas, visitas y mensajes; las notas y lo que escribe el sistema no son gestiones', () => {
    expect(m.activities).toEqual({ total: 4, calls: 2, visits: 1, messages: 1 });
    expect(m.notes).toBe(1);
  });

  it('🔴 contacto = se habló con el deudor: una llamada sin respuesta o una visita en vano no lo son', () => {
    expect(m.contacts).toBe(1);
    expect(m.daysToFirstContact).toBe(3); // 1 oct → 4 oct
  });

  it('la primera visita cuenta aunque no lo haya encontrado: es un intento', () => {
    expect(m.daysToFirstVisit).toBe(5); // 1 oct → 6 oct
  });

  it('una nota con resultado de contacto no cuenta como contacto', () => {
    const n = computeRecoveryMetrics(base({ activities: [act('NOTE', '2026-10-02T10:00:00Z', 'CONTACTED')] }));
    expect(n.contacts).toBe(0);
    expect(n.daysToFirstContact).toBeUndefined();
  });

  it('el mismo día del inicio son 0 días (y eso sí es un dato)', () => {
    expect(computeRecoveryMetrics(base({ activities: [act('CALL', '2026-10-01T10:00:00Z', 'CONTACTED')] })).daysToFirstContact).toBe(0);
  });
});

describe('computeRecoveryMetrics — la ventana es la mora actual', () => {
  it('🔴 lo anterior al inicio de esta mora no es «el primer contacto» de ésta', () => {
    const m = computeRecoveryMetrics(
      base({
        activities: [act('CALL', '2026-07-01T10:00:00Z', 'CONTACTED'), act('CALL', '2026-10-05T10:00:00Z', 'CONTACTED')],
        payments: [pay(300, '2026-06-01T10:00:00Z'), pay(200, '2026-10-03T10:00:00Z')],
        promises: [promise('KEPT', '2026-06-20T10:00:00Z'), promise('ACTIVE', '2026-10-02T10:00:00Z')],
      }),
    );
    expect(m.activities.total).toBe(1);
    expect(m.daysToFirstContact).toBe(4);
    expect(m.recoveredAmount).toBe(200);
    expect(m.recoveredAllTime).toBe(500);
    expect(m.promises.made).toBe(1);
    expect(m.promises.kept).toBe(0);
  });

  it('sin mora abierta se muestra el histórico y no hay «días hasta…» (no hay desde cuándo contar)', () => {
    const m = computeRecoveryMetrics(
      base({
        episode: undefined,
        activities: [act('CALL', '2026-07-01T10:00:00Z', 'CONTACTED')],
        payments: [pay(300, '2026-06-01T10:00:00Z')],
      }),
    );
    expect(m.window).toBe('ALL');
    expect(m.since).toBeUndefined();
    expect(m.activities.total).toBe(1);
    expect(m.recoveredAmount).toBe(300);
    expect(m.daysToFirstContact).toBeUndefined();
    expect(m.daysToFirstPayment).toBeUndefined();
  });
});

describe('computeRecoveryMetrics — plata recuperada', () => {
  it('suma lo cobrado por Kobrax en esta mora y cuenta los pagos', () => {
    const m = computeRecoveryMetrics(base({ payments: [pay(200.5, '2026-10-03T10:00:00Z'), pay(100.25, '2026-10-09T10:00:00Z')] }));
    expect(m.recoveredAmount).toBe(300.75);
    expect(m.paymentsCount).toBe(2);
    expect(m.daysToFirstPayment).toBe(2);
    expect(m.balanceAtStart).toBe(1000);
  });

  it('🔴 lo confirmado por un canal de la entidad no es plata que Kobrax cobró', () => {
    const m = computeRecoveryMetrics(base({ payments: [pay(500, '2026-10-03T10:00:00Z', 'EXTERNAL_CONFIRMED'), pay(100, '2026-10-04T10:00:00Z', 'KOBRAX_COLLECTED')] }));
    expect(m.recoveredAmount).toBe(100);
    expect(m.recoveredAllTime).toBe(100);
    expect(m.daysToFirstPayment).toBe(3);
  });

  it('el primer pago es el más antiguo aunque lleguen desordenados', () => {
    const m = computeRecoveryMetrics(base({ payments: [pay(1, '2026-10-09T10:00:00Z'), pay(1, '2026-10-02T10:00:00Z')] }));
    expect(m.daysToFirstPayment).toBe(1);
  });
});

describe('computeRecoveryMetrics — promesas y la última recuperación', () => {
  it('resume las promesas de esta mora con la regla compartida', () => {
    const m = computeRecoveryMetrics(base({ promises: [promise('KEPT', '2026-10-02T10:00:00Z'), promise('BROKEN', '2026-10-03T10:00:00Z'), promise('OVERDUE', '2026-10-04T10:00:00Z')] }));
    expect(m.promises.complianceRate).toBe(0.5);
    expect(m.promises.unresolved).toBe(1);
  });

  it('pasa tal cual cuánto tardó la última mora recuperada', () => {
    expect(computeRecoveryMetrics(base({ episode: undefined, lastRecoveredDays: 22 })).lastRecoveredDays).toBe(22);
    expect(computeRecoveryMetrics(base()).lastRecoveredDays).toBeUndefined();
  });
});

describe('computeRecoveryMetrics — una mora que ya venía de antes de registrarse', () => {
  it('🔴 avisa cuántos días llevaba cuando Kobrax empezó a registrarla (un importado que ya venía vencido)', () => {
    const m = computeRecoveryMetrics(
      base({
        episode: { startedAt: '2025-09-02', startedAtEstimated: true, trackedSince: '2026-10-02' },
        activities: [act('CALL', '2026-10-03T10:00:00Z', 'CONTACTED')],
      }),
    );
    expect(m.untrackedDays).toBe(395);
    // El número se sigue calculando, pero la pantalla lo acompaña del aviso.
    expect(m.daysToFirstContact).toBe(396);
  });

  it('la diferencia normal de detección (el trabajo diario lo ve al día siguiente) no es un aviso', () => {
    for (const trackedSince of ['2026-10-01', '2026-10-02', '2026-10-04']) {
      expect(computeRecoveryMetrics(base({ episode: { ...EPISODE, trackedSince } })).untrackedDays).toBeUndefined();
    }
    expect(computeRecoveryMetrics(base({ episode: { ...EPISODE, trackedSince: '2026-10-05' } })).untrackedDays).toBe(4);
  });

  it('sin saber desde cuándo se registra, no se afirma nada', () => {
    expect(computeRecoveryMetrics(base()).untrackedDays).toBeUndefined();
    expect(computeRecoveryMetrics(base({ episode: undefined })).untrackedDays).toBeUndefined();
  });
});

describe('computeRecoveryMetrics — días desde que Kobrax gestiona la mora', () => {
  const venia = { startedAt: '2025-09-02', startedAtEstimated: true, trackedSince: '2026-10-02' };

  it('🔴 en una mora que ya venía de antes, cuenta también desde que se registra: es lo que mide al equipo', () => {
    const m = computeRecoveryMetrics(
      base({
        episode: venia,
        activities: [act('CALL', '2026-10-04T10:00:00Z', 'CONTACTED'), act('VISIT', '2026-10-03T10:00:00Z', 'NOT_FOUND')],
        payments: [pay(100, '2026-10-02T10:00:00Z')],
      }),
    );
    expect(m.daysToFirstContact).toBe(397); // desde que empezó la mora
    expect(m.sinceTracking).toEqual({ daysToFirstContact: 2, daysToFirstVisit: 1, daysToFirstPayment: 0 });
  });

  it('lo que todavía no pasó sigue ausente también en esta cuenta', () => {
    const m = computeRecoveryMetrics(base({ episode: venia }));
    expect(m.sinceTracking).toEqual({ daysToFirstContact: undefined, daysToFirstVisit: undefined, daysToFirstPayment: undefined });
  });

  it('si la mora se registró desde el principio no se repite el número: no hay segunda cuenta', () => {
    expect(computeRecoveryMetrics(base({ episode: { ...EPISODE, trackedSince: '2026-10-01' } })).sinceTracking).toBeUndefined();
    expect(computeRecoveryMetrics(base()).sinceTracking).toBeUndefined();
  });
});
