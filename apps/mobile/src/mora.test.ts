import { MORA_PROMISE_STATUSES, type CollectionPriority, type MoraCreditListItem } from '@kobrax/shared';
import { activityLine, daysSinceAction, filterMora, matchesMoraChip, moraCardProps, PROMISE_STATUS_META, sortMora, staleLine, toMoraRows, type MoraRow } from './mora';

const ASOF = new Date('2026-10-02T12:00:00Z');

function mk(p: Partial<MoraCreditListItem> & { creditId: string }): MoraRow {
  return toMoraRows([
    { clientId: 'cl', currency: 'BOB', daysPastDue: 10, arrearsSource: 'SCHEDULE', hasActivePromise: false, situation: 'IN_ARREARS', writtenOff: false, priorityPinned: false, ...p } as MoraCreditListItem,
  ])[0];
}

/** Los campos del episodio abierto que la fila trae (prioridad y última gestión). */
const caso = (priority: CollectionPriority, lastActionAt?: string) => ({ priority, lastActionAt });

describe('toMoraRows', () => {
  it('el crédito es la identidad de la fila', () => {
    expect(mk({ creditId: 'cr1' }).id).toBe('cr1');
  });
});

describe('sortMora · prioridad → días → saldo', () => {
  it('crítica antes que alta aunque tenga menos días', () => {
    const rows = [
      mk({ creditId: 'alta', daysPastDue: 90, ...caso('HIGH') }),
      mk({ creditId: 'critica', daysPastDue: 5, ...caso('CRITICAL') }),
    ];
    expect(sortMora(rows).map((r) => r.creditId)).toEqual(['critica', 'alta']);
  });

  it('sin prioridad va después de cualquier prioridad, y entre iguales manda la mora', () => {
    const rows = [
      mk({ creditId: 'sinPrio', daysPastDue: 400 }),
      mk({ creditId: 'baja', daysPastDue: 3, ...caso('LOW') }),
      mk({ creditId: 'sinPrio2', daysPastDue: 500 }),
    ];
    expect(sortMora(rows).map((r) => r.creditId)).toEqual(['baja', 'sinPrio2', 'sinPrio']);
  });

  it('con todo igual, el de más saldo primero', () => {
    const rows = [mk({ creditId: 'a', balance: 100 }), mk({ creditId: 'b', balance: 900 })];
    expect(sortMora(rows).map((r) => r.creditId)).toEqual(['b', 'a']);
  });

  it('no muta la lista que recibe', () => {
    const rows = [mk({ creditId: 'a' }), mk({ creditId: 'b', daysPastDue: 99 })];
    sortMora(rows);
    expect(rows.map((r) => r.creditId)).toEqual(['a', 'b']);
  });
});

describe('chips', () => {
  const hace = (d: number) => new Date(ASOF.getTime() - d * 86_400_000).toISOString();

  it('«Críticos» es la prioridad del episodio; sin prioridad no lo es', () => {
    expect(matchesMoraChip(mk({ creditId: 'a', ...caso('CRITICAL') }), 'critical', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'b' }), 'critical', ASOF)).toBe(false);
  });

  it('«Con promesa» sigue la promesa vigente del servidor', () => {
    expect(matchesMoraChip(mk({ creditId: 'a', hasActivePromise: true }), 'promise', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'b' }), 'promise', ASOF)).toBe(false);
  });

  it('daysSinceAction: días enteros y nunca negativos', () => {
    expect(daysSinceAction(mk({ creditId: 'a', ...caso('LOW', hace(3)) }), ASOF)).toBe(3);
    expect(daysSinceAction(mk({ creditId: 'b', ...caso('LOW', '2026-10-05T00:00:00Z') }), ASOF)).toBe(0);
    expect(daysSinceAction(mk({ creditId: 'c' }), ASOF)).toBeUndefined();
  });
});

describe('filterMora', () => {
  const rows = [
    mk({ creditId: 'a', clientName: 'María Pérez', code: 'CR-001' }),
    mk({ creditId: 'b', clientName: 'Juan Díaz', code: 'CR-002', daysPastDue: 50 }),
  ];

  it('busca por nombre sin acentos ni mayúsculas', () => {
    expect(filterMora(rows, 'all', 'maria', ASOF).map((r) => r.creditId)).toEqual(['a']);
  });

  it('busca por nº de crédito', () => {
    expect(filterMora(rows, 'all', 'cr-002', ASOF).map((r) => r.creditId)).toEqual(['b']);
  });

  it('devuelve ordenado', () => {
    expect(filterMora(rows, 'all', '', ASOF).map((r) => r.creditId)).toEqual(['b', 'a']);
  });
});

describe('moraCardProps', () => {
  it('crédito sin prioridad: dice «En mora», no inventa una, y muestra lo vencido antes que el saldo', () => {
    const p = moraCardProps(mk({ creditId: 'a', clientName: 'Ana', code: 'CR-9', daysPastDue: 1, balance: 5000, overdueAmount: 300 }), ASOF);
    expect(p.name).toBe('Ana');
    expect(p.caption).toBe('Crédito CR-9 · 1 día de mora');
    expect(p.badge).toEqual({ label: 'En mora', tone: 'danger' });
    expect(p.subtitle).toBe('');
    expect(p.tag).toBeUndefined();
    expect(p.amount).toContain('300');
  });

  it('si el archivo no trajo lo vencido, muestra el saldo; si no hay ninguno, no muestra monto', () => {
    expect(moraCardProps(mk({ creditId: 'a', balance: 800 }), ASOF).amount).toContain('800');
    expect(moraCardProps(mk({ creditId: 'b' }), ASOF).amount).toBeUndefined();
  });

  it('la última gestión y la promesa vigente son datos sueltos, no estados', () => {
    const p = moraCardProps(mk({ creditId: 'a', hasActivePromise: true, ...caso('CRITICAL', '2026-10-01T12:00:00Z') }), ASOF);
    expect(p.subtitle).toBe('Última gestión: hace 1 día · Promesa vigente');
    expect(p.badge).toEqual({ label: 'Crítica', tone: 'danger' });
  });

  it('última gestión en días', () => {
    expect(moraCardProps(mk({ creditId: 'a', ...caso('LOW', '2026-09-29T12:00:00Z') }), ASOF).subtitle).toBe('Última gestión: hace 3 días');
    expect(moraCardProps(mk({ creditId: 'b', ...caso('LOW', '2026-10-02T08:00:00Z') }), ASOF).subtitle).toBe('Última gestión: hoy');
  });
});

describe('moraCardProps · castigo y categoría', () => {
  it('castigado gana sobre la prioridad y es una condición aparte de la mora', () => {
    const p = moraCardProps(mk({ creditId: 'a', daysPastDue: 240, writtenOff: true, ...caso('CRITICAL') }), ASOF);
    expect(p.badge).toEqual({ label: 'Castigado', tone: 'neutral' });
    expect(p.caption).toContain('240 días de mora');
  });

  it('la categoría de mora sale como etiqueta aparte', () => {
    const p = moraCardProps(mk({ creditId: 'a', category: { code: 'B', name: 'Categoría B' } }), ASOF);
    expect(p.tag).toBe('Cat. B');
  });
});

describe('staleLine', () => {
  it('sin marca de respaldo no hay aviso (el dato es del servidor)', () => {
    expect(staleLine(undefined)).toBeUndefined();
    expect(staleLine(null)).toBeUndefined();
  });

  it('con marca, dice de qué hora son los datos', () => {
    expect(staleLine(new Date(2026, 9, 2, 8, 5).getTime())).toBe('Sin señal · datos de las 08:05');
  });
});

describe('activityLine', () => {
  it('tipo y resultado en español', () => {
    expect(activityLine({ type: 'CALL', result: 'NO_ANSWER' })).toBe('Llamada · No contesta');
    expect(activityLine({ type: 'VISIT', result: 'NOT_FOUND' })).toBe('Visita · No estaba');
  });

  it('sin resultado, sólo el tipo', () => {
    expect(activityLine({ type: 'NOTE' })).toBe('Nota');
  });

  it('lo desconocido se muestra tal cual en vez de esconderse', () => {
    expect(activityLine({ type: 'ALGO_NUEVO', result: 'RARO' })).toBe('ALGO_NUEVO · RARO');
  });
});

describe('PROMISE_STATUS_META', () => {
  it('cubre todos los estados que manda el servidor', () => {
    for (const s of MORA_PROMISE_STATUSES) expect(PROMISE_STATUS_META[s].label).toBeTruthy();
  });
});
