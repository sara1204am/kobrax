import { CasePriority, CaseStatus, type MoraCreditListItem } from '@kobrax/shared';
import { daysSinceAction, filterMora, matchesMoraChip, moraCardProps, NO_ACTION_DAYS, sortMora, staleLine, toMoraRows, type MoraRow } from './mora';

const ASOF = new Date('2026-10-02T12:00:00Z');

function mk(p: Partial<MoraCreditListItem> & { creditId: string }): MoraRow {
  return toMoraRows([{ clientId: 'cl', currency: 'BOB', daysPastDue: 10, arrearsSource: 'SCHEDULE', hasActivePromise: false, ...p } as MoraCreditListItem])[0];
}

const caso = (priority: CasePriority, lastActionAt?: string) => ({
  id: 'k',
  status: CaseStatus.ACTIVE,
  priority,
  priorityPinned: false,
  isOverdue: false,
  lastActionAt,
});

describe('toMoraRows', () => {
  it('el crédito es la identidad de la fila', () => {
    expect(mk({ creditId: 'cr1' }).id).toBe('cr1');
  });
});

describe('sortMora · prioridad → días → saldo', () => {
  it('crítica antes que alta aunque tenga menos días', () => {
    const rows = [
      mk({ creditId: 'alta', daysPastDue: 90, case: caso(CasePriority.HIGH) }),
      mk({ creditId: 'critica', daysPastDue: 5, case: caso(CasePriority.CRITICAL) }),
    ];
    expect(sortMora(rows).map((r) => r.creditId)).toEqual(['critica', 'alta']);
  });

  it('sin caso va después de cualquier prioridad, y entre iguales manda la mora', () => {
    const rows = [
      mk({ creditId: 'sinCaso', daysPastDue: 400 }),
      mk({ creditId: 'baja', daysPastDue: 3, case: caso(CasePriority.LOW) }),
      mk({ creditId: 'sinCaso2', daysPastDue: 500 }),
    ];
    expect(sortMora(rows).map((r) => r.creditId)).toEqual(['baja', 'sinCaso2', 'sinCaso']);
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

  it('«Críticos» es la prioridad del caso; sin caso no lo es', () => {
    expect(matchesMoraChip(mk({ creditId: 'a', case: caso(CasePriority.CRITICAL) }), 'critical', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'b' }), 'critical', ASOF)).toBe(false);
  });

  it('«Con promesa» sigue la promesa vigente del servidor', () => {
    expect(matchesMoraChip(mk({ creditId: 'a', hasActivePromise: true }), 'promise', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'b' }), 'promise', ASOF)).toBe(false);
  });

  it(`«Sin gestión» incluye al que nunca se gestionó y al que lleva ${NO_ACTION_DAYS}+ días`, () => {
    expect(matchesMoraChip(mk({ creditId: 'nunca' }), 'noAction', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'viejo', case: caso(CasePriority.LOW, hace(NO_ACTION_DAYS)) }), 'noAction', ASOF)).toBe(true);
    expect(matchesMoraChip(mk({ creditId: 'reciente', case: caso(CasePriority.LOW, hace(NO_ACTION_DAYS - 1)) }), 'noAction', ASOF)).toBe(false);
  });

  it('daysSinceAction: días enteros y nunca negativos', () => {
    expect(daysSinceAction(mk({ creditId: 'a', case: caso(CasePriority.LOW, hace(3)) }), ASOF)).toBe(3);
    expect(daysSinceAction(mk({ creditId: 'b', case: caso(CasePriority.LOW, '2026-10-05T00:00:00Z') }), ASOF)).toBe(0);
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
  it('crédito sin caso: lo dice, no inventa prioridad, y muestra lo vencido antes que el saldo', () => {
    const p = moraCardProps(mk({ creditId: 'a', clientName: 'Ana', code: 'CR-9', daysPastDue: 1, balance: 5000, overdueAmount: 300 }), ASOF);
    expect(p.name).toBe('Ana');
    expect(p.caption).toBe('Crédito CR-9 · 1 día de mora');
    expect(p.badge).toEqual({ label: 'Sin caso', tone: 'neutral' });
    expect(p.subtitle).toBe('Sin gestión todavía');
    expect(p.amount).toContain('300');
  });

  it('si el archivo no trajo lo vencido, muestra el saldo; si no hay ninguno, no muestra monto', () => {
    expect(moraCardProps(mk({ creditId: 'a', balance: 800 }), ASOF).amount).toContain('800');
    expect(moraCardProps(mk({ creditId: 'b' }), ASOF).amount).toBeUndefined();
  });

  it('con promesa vigente la subtítula manda sobre la última gestión', () => {
    const p = moraCardProps(mk({ creditId: 'a', hasActivePromise: true, case: caso(CasePriority.CRITICAL, '2026-10-01T12:00:00Z') }), ASOF);
    expect(p.subtitle).toBe('Promesa de pago vigente');
    expect(p.badge).toEqual({ label: 'Crítica', tone: 'danger' });
  });

  it('última gestión en días', () => {
    expect(moraCardProps(mk({ creditId: 'a', case: caso(CasePriority.LOW, '2026-09-29T12:00:00Z') }), ASOF).subtitle).toBe('Última gestión hace 3 días');
    expect(moraCardProps(mk({ creditId: 'b', case: caso(CasePriority.LOW, '2026-10-02T08:00:00Z') }), ASOF).subtitle).toBe('Gestionado hoy');
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
