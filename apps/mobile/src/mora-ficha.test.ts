import { computeRecoveryMetrics, type MoraEpisode, type MoraPromise, type PaymentItem } from '@kobrax/shared';
import {
  activePromiseText,
  canEditNoteText,
  collectedTotal,
  episodeView,
  gestionError,
  lastActionText,
  localToday,
  metricsView,
  moraSinceText,
  nameResolver,
  paidPercent,
  paymentsSummary,
  paymentView,
  psfNotice,
  situationDetail,
  sortNotes,
  sourceBadge,
} from './mora-ficha';
import { activityLine } from './mora';

const ep = (p: Partial<MoraEpisode> = {}): MoraEpisode => ({
  id: 'e1',
  number: 2,
  startedAt: '2026-09-29',
  startedAtEstimated: false,
  source: 'CALCULATED',
  reconstructed: false,
  current: true,
  durationDays: 5,
  ...p,
});

describe('episodeView · historial de mora', () => {
  it('actual: número, badge Actual, rango «en curso», saldo al salir «—»', () => {
    const v = episodeView(ep({ startDaysPastDue: 3, maxDaysPastDue: 9, balanceAtStart: 1000, balanceAtEnd: 800 }), 'BOB');
    expect(v.title).toBe('Mora #2');
    expect(v.badge).toEqual({ label: 'Actual', tone: 'info' });
    expect(v.range).toBe('29/09/2026 → en curso');
    expect(v.items.map((i) => i.label)).toEqual(['Duración', 'Pico de mora', 'Saldo al entrar', 'Saldo al salir', 'Entró con']);
    expect(v.items[0]!.value).toBe('5 días');
    expect(v.items[1]!.value).toBe('9 días');
    expect(v.items[3]!.value).toBe('—'); // todavía no salió
    expect(v.items[4]!.value).toBe('3 días');
    expect(v.source).toBe('Calculada');
  });

  it('inicio estimado lleva «(aprox.)»; lo que nadie midió es «—», nunca 0', () => {
    const v = episodeView(ep({ current: false, endedAt: '2026-10-03', endReason: 'PAID', startedAtEstimated: true, reconstructed: true }), 'BOB');
    expect(v.range).toBe('29/09/2026 (aprox.) → 03/10/2026');
    expect(v.reconstructed).toBe(true);
    expect(v.items[1]!.value).toBe('—');
    expect(v.items[2]!.value).toBe('—');
    expect(v.items[3]!.value).toBe('—');
    expect(v.badge).toEqual({ label: 'Saldó la deuda', tone: 'success' });
  });

  it('«dejó de venir en el reporte» es ámbar, no verde, y avisa que no se sabe si pagó', () => {
    const v = episodeView(ep({ current: false, endedAt: '2026-10-03', endReason: 'SOURCE_ABSENT' }), 'BOB');
    expect(v.badge?.tone).toBe('warning');
    expect(v.hint).toContain('no se sabe si pagó');
  });
});

describe('metricsView · mismas cifras que la web', () => {
  const base = {
    now: '2026-10-04T12:00:00Z',
    episode: { startedAt: '2026-09-24', startedAtEstimated: false, balanceAtStart: 1000 },
    activities: [
      { type: 'CALL', result: 'NO_ANSWER', createdAt: '2026-09-25T10:00:00Z' },
      { type: 'VISIT', result: 'CONTACTED', createdAt: '2026-09-28T10:00:00Z' },
      { type: 'NOTE', createdAt: '2026-09-29T10:00:00Z' },
    ],
    payments: [{ amount: 200, paymentDate: '2026-09-30T10:00:00Z' }],
    promises: [] as MoraPromise[],
  };

  it('arma las tarjetas con los números de computeRecoveryMetrics', () => {
    const m = computeRecoveryMetrics(base);
    const v = metricsView(m, 'BOB');
    const by = (l: string) => v.cards.find((c) => c.label === l)!;
    expect(v.intro).toBe('Desde que empezó esta mora, el 24/09/2026.');
    expect(by('Gestiones').value).toBe('2');
    expect(by('Gestiones').hint).toBe('1 llamada · 1 visita · 0 mensajes');
    expect(by('Llegó a hablar con el deudor').value).toBe('1');
    expect(by('Primera visita').value).toBe('A los 4 días');
    expect(by('Primer pago').value).toBe('A los 6 días');
    expect(by('Primer contacto').value).toBe('A los 4 días');
    expect(by('Recuperado').hint).toContain('1 pago');
    expect(by('Recuperado').hint).toContain('al entrar');
    expect(by('Promesas cumplidas').value).toBe('—');
    expect(by('Promesas cumplidas').hint).toBe('Todavía no hay promesas cerradas');
  });

  it('lo que no pasó se dice; no es «0 días»', () => {
    const m = computeRecoveryMetrics({ ...base, activities: [], payments: [] });
    const v = metricsView(m, 'BOB');
    expect(v.cards.find((c) => c.label === 'Primera visita')!.value).toBe('Todavía sin visita');
    expect(v.cards.find((c) => c.label === 'Primer pago')!.value).toBe('Todavía sin pagos');
    expect(v.cards.find((c) => c.label === 'Primer contacto')!.value).toBe('Todavía sin contacto');
  });

  it('el mismo día es «El mismo día»; sin mora abierta es histórico y «—»', () => {
    const same = metricsView(computeRecoveryMetrics({ ...base, activities: [{ type: 'VISIT', result: 'CONTACTED', createdAt: '2026-09-24T09:00:00Z' }], payments: [] }), 'BOB');
    expect(same.cards.find((c) => c.label === 'Primera visita')!.value).toBe('El mismo día');
    const all = metricsView(computeRecoveryMetrics({ ...base, episode: undefined, activities: [], payments: [] }), 'BOB');
    expect(all.intro).toBe('Histórico del crédito: ahora no está en mora.');
    expect(all.cards.find((c) => c.label === 'Primera visita')!.value).toBe('—');
  });

  it('avisa si el inicio es aproximado y si la mora ya venía de antes de registrarse', () => {
    const m = computeRecoveryMetrics({ ...base, episode: { ...base.episode, startedAtEstimated: true, trackedSince: '2026-10-04' } });
    const v = metricsView(m, 'BOB');
    expect(v.intro).toContain('(inicio aproximado)');
    expect(v.untracked).toContain('ya llevaba 10 días');
  });
});

describe('pagos', () => {
  const pay = (p: Partial<PaymentItem>): PaymentItem => ({
    id: 'p1',
    creditId: 'c',
    amount: 100,
    method: 'TRANSFER',
    paymentDate: '2026-10-03T15:00:00.000Z',
    createdAt: '2026-10-03T15:00:00.000Z',
    ...p,
  });

  it('total cobrado: sólo lo que cobró Kobrax (lo confirmado por la entidad no suma)', () => {
    const list = [pay({ amount: 100 }), pay({ id: 'p2', amount: 50, channel: 'KOBRAX_COLLECTED' }), pay({ id: 'p3', amount: 900, channel: 'EXTERNAL_CONFIRMED' })];
    expect(collectedTotal(list)).toBe(150);
    expect(paymentsSummary(list, 'BOB')).toContain('3 pagos');
  });

  it('medio con su tono, canal de la entidad, comprobante y quién registró', () => {
    const names = nameResolver([{ userId: 'u2', firstName: 'Ana', lastName: 'Paz', email: 'a@x.com' }], 'u1');
    const v = paymentView(pay({ channel: 'EXTERNAL_CONFIRMED', receiptNumber: 7, registeredBy: 'u2' }), 'BOB', names);
    expect(v.method).toBe('Transferencia');
    expect(v.look.tone).toBe('purple');
    expect(v.channel).toBe('Canal de la entidad');
    expect(v.receipt).toBe('Comprobante Nº 7');
    expect(v.by).toBe('Registró Ana Paz');
    expect(v.date).toBe('03/10/2026');
    expect(paymentView(pay({}), 'BOB', names).channel).toBeUndefined();
    expect(paymentView(pay({ method: 'CASH' }), 'BOB', names).look.tone).toBe('green');
  });
});

describe('nameResolver', () => {
  it('Yo / nombre / alguien del equipo (no se inventa)', () => {
    const f = nameResolver([{ userId: 'u2', firstName: 'Ana', lastName: null, email: 'a@x.com' }], 'u1');
    expect(f('u1')).toBe('Yo');
    expect(f('u2')).toBe('Ana');
    expect(f('zz')).toBe('alguien del equipo');
    expect(f(undefined)).toBe('alguien del equipo');
  });
});

describe('notas', () => {
  it('editar/borrar sólo el autor o quien reparte cartera', () => {
    expect(canEditNoteText({ authorId: 'u1' }, 'u1', false)).toBe(true);
    expect(canEditNoteText({ authorId: 'u2' }, 'u1', false)).toBe(false);
    expect(canEditNoteText({ authorId: 'u2' }, 'u1', true)).toBe(true);
    expect(canEditNoteText({ authorId: undefined }, undefined, false)).toBe(false);
  });

  it('lo importante arriba, y lo más reciente primero a igual tipo', () => {
    const n = (id: string, kind: 'INFO' | 'WARNING' | 'IMPORTANT', createdAt: string) => ({ id, kind, createdAt }) as never;
    const out = sortNotes([n('a', 'INFO', '2026-10-01'), n('b', 'IMPORTANT', '2026-09-01'), n('c', 'INFO', '2026-10-03')]);
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('psfNotice · ausente no es pagado', () => {
  it('ausente: el texto exacto, con la fecha dd/mm', () => {
    expect(psfNotice({ externalSource: 'PSF', syncStatus: 'ABSENT', absentSince: '2026-10-03' })).toBe(
      'Ya no aparece en el reporte del 03/10. Puede haberse puesto al día o cancelado; el reporte no lo dice.',
    );
  });

  it('ausente sin fecha usa el corte; sin ninguna, el texto sin fecha; nunca dice «pagado»', () => {
    expect(psfNotice({ externalSource: 'PSF', syncStatus: 'ABSENT', reportedAsOf: '2026-10-02' })).toContain('del 02/10');
    const t = psfNotice({ externalSource: 'PSF', syncStatus: 'ABSENT' })!;
    expect(t).toBe('Ya no aparece en el reporte. Puede haberse puesto al día o cancelado; el reporte no lo dice.');
    expect(t.toLowerCase()).not.toContain('pagado');
  });

  it('dato viejo con la fecha de corte; nada si está vigente o no es externo', () => {
    expect(psfNotice({ externalSource: 'PSF', reportedStale: true, reportedAsOf: '2026-09-20' })).toBe('Dato desactualizado · PSF · al 20/09');
    expect(psfNotice({ externalSource: 'PSF' })).toBeUndefined();
    expect(psfNotice({ syncStatus: 'ABSENT' })).toBeUndefined();
  });

  it('insignia de fuente', () => {
    expect(sourceBadge('PSF')).toBe('PSF');
    expect(sourceBadge(undefined)).toBe('Kobrax');
  });
});

describe('resumen de la ficha', () => {
  it('% pagado sólo con capital y saldo; acotado a 0–100', () => {
    expect(paidPercent(1000, 250)).toBe(75);
    expect(paidPercent(undefined, 250)).toBeUndefined();
    expect(paidPercent(0, 0)).toBeUndefined();
    expect(paidPercent(100, 300)).toBe(0);
  });

  it('situación: categoría · días; castigado pone los días antes; al día sin detalle', () => {
    const cat = { code: 'B', name: 'Media' };
    expect(situationDetail({ situation: 'IN_ARREARS', daysPastDue: 47, category: cat, writtenOff: false })).toBe('Categoría B · 47 días de mora');
    expect(situationDetail({ situation: 'IN_ARREARS', daysPastDue: 240, category: cat, writtenOff: true })).toBe('240 días de mora · Categoría B');
    expect(situationDetail({ situation: 'CURRENT', daysPastDue: 0, writtenOff: false })).toBe('');
  });

  it('última gestión y promesa vigente son datos sueltos', () => {
    const asOf = new Date('2026-10-04T12:00:00Z');
    expect(lastActionText({}, activityLine, asOf)).toBe('Sin gestiones');
    expect(lastActionText({ lastActionAt: '2026-10-01T12:00:00Z', lastActivityType: 'CALL', lastActivityResult: 'NO_ANSWER' }, activityLine, asOf)).toBe(
      'hace 3 días · Llamada · No respondió',
    );
    const p = (status: MoraPromise['status'], promiseDate: string, amount?: number): MoraPromise => ({ id: promiseDate, status, promiseDate, amount, createdAt: '2026-10-01T00:00:00Z' });
    expect(activePromiseText([p('KEPT', '2026-10-02', 5), p('ACTIVE', '2026-10-20', 300), p('ACTIVE', '2026-10-10', 100)], 'BOB')).toMatch(/· 10\/10$/);
    expect(activePromiseText([p('OVERDUE', '2026-10-02', 5)], 'BOB')).toBe('Ninguna');
  });

  it('inicio de la mora: lo declarado o el del episodio abierto (aprox.)', () => {
    expect(moraSinceText({ moraSince: '2026-09-01' }, [])).toBe('01/09/2026');
    expect(moraSinceText({}, [ep({ startedAtEstimated: true })])).toBe('29/09/2026 (aprox.)');
    expect(moraSinceText({}, [])).toBe('—');
  });
});

describe('gestionError · validateRecoveryActivity antes de encolar', () => {
  const promise = (over: Record<string, unknown> = {}) => ({ amount: 100, promiseDate: '2026-10-10', paymentMethodCode: 'CASH', ...over });
  const TODAY = '2026-10-04';

  it('una promesa con fecha pasada no se encola', () => {
    expect(gestionError({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: promise({ promiseDate: '2026-10-03' }) }, TODAY)).toBe('La fecha prometida no puede ser anterior a hoy.');
  });

  it('hoy sí; monto y medio son obligatorios', () => {
    expect(gestionError({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: promise({ promiseDate: TODAY }) }, TODAY)).toBeNull();
    expect(gestionError({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: promise({ amount: 0 }) }, TODAY)).toBe('El monto prometido tiene que ser mayor a cero.');
    expect(gestionError({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: promise({ paymentMethodCode: '' }) }, TODAY)).toContain('medio de pago');
  });

  it('reglas de resultado: el resultado tiene que corresponder al tipo', () => {
    expect(gestionError({ type: 'CALL', result: 'NOT_FOUND' }, TODAY)).toBe('Ese resultado no corresponde a este tipo de gestión.');
    expect(gestionError({ type: 'VISIT', result: 'NOT_FOUND' }, TODAY)).toBeNull();
    expect(gestionError({ type: 'CALL', result: 'CONTACTED', promise: promise() }, TODAY)).toContain('promesa de pago');
  });

  it('el banco se exige sólo si el medio lo pide, y va en la promesa', () => {
    const base = { type: 'CALL', result: 'PROMISE_TO_PAY' } as const;
    expect(gestionError({ ...base, promise: promise({ paymentMethodCode: 'TRANSFER' }) }, TODAY, { bankRequired: true })).toBe('Elegí el banco: este medio de pago lo necesita.');
    expect(gestionError({ ...base, promise: promise({ paymentMethodCode: 'TRANSFER', bankCode: 'BNB' }) }, TODAY, { bankRequired: true })).toBeNull();
    expect(gestionError({ ...base, promise: promise() }, TODAY)).toBeNull();
  });

  it('localToday es el día civil del teléfono, no el UTC', () => {
    expect(localToday(new Date(2026, 9, 4, 23, 30))).toBe('2026-10-04');
  });
});
