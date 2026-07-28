import { PortfolioStatus } from '@kobrax/shared';
import type { CaseListItem } from './cases.service';
import { filterPortfolio, groupPortfolio, matchesSearch, sortPortfolio } from './portfolio';

const ASOF = new Date('2026-07-13T12:00:00Z');

/** CaseListItem mínimo para los tests (los campos ausentes no importan a la lógica de cartera). */
function mk(p: Partial<CaseListItem>): CaseListItem {
  return {
    id: p.id ?? 'case-' + Math.random().toString(36).slice(2),
    creditId: p.creditId ?? 'cr-' + Math.random().toString(36).slice(2),
    clientId: p.clientId ?? 'cl1',
    status: 'ACTIVE' as never,
    priority: 'MEDIUM' as never,
    isOverdue: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...p,
  };
}

describe('groupPortfolio', () => {
  it('agrupa por cliente, agrega la deuda y cuenta los préstamos', () => {
    const cards = groupPortfolio(
      [
        mk({ clientId: 'cl1', creditId: 'a', clientName: 'Ana Ruiz', amount: 500, currency: 'BOB' }),
        mk({ clientId: 'cl1', creditId: 'b', clientName: 'Ana Ruiz', amount: 300, currency: 'BOB' }),
        mk({ clientId: 'cl2', creditId: 'c', clientName: 'Beto Diaz', amount: 100, currency: 'BOB' }),
      ],
      ASOF,
    );
    const ana = cards.find((c) => c.clientId === 'cl1')!;
    expect(ana.totalDebt).toBe(800);
    expect(ana.creditCount).toBe(2);
    expect(cards).toHaveLength(2);
  });

  it('el estado del cliente es el peor-caso entre sus créditos (mora gana sobre al día)', () => {
    const [card] = groupPortfolio(
      [
        mk({ clientId: 'cl1', creditId: 'a', amount: 500, daysPastDue: 0, nextDueDate: '2026-08-01' }),
        mk({ clientId: 'cl1', creditId: 'b', amount: 300, daysPastDue: 9 }),
      ],
      ASOF,
    );
    expect(card!.status).toBe(PortfolioStatus.OVERDUE);
    expect(card!.maxDaysPastDue).toBe(9);
    expect(card!.secondaryLine).toBe('9 días de mora');
  });

  it('sin mora arma la línea "Cuota … · vence …" del crédito más próximo', () => {
    const [card] = groupPortfolio(
      [mk({ clientId: 'cl1', amount: 1000, daysPastDue: 0, installmentAmount: 300, nextDueDate: '2026-07-15' })],
      ASOF,
    );
    expect(card!.status).toBe(PortfolioStatus.DUE_SOON); // vence en 2 días → por vencer (§5.3)
    expect(card!.secondaryLine).toContain('vence 15 jul');
    expect(card!.secondaryLine).toContain('Cuota');
  });

  it('saldo 0 → PAGADO; una promesa vigente → PROMESA', () => {
    const [paid] = groupPortfolio([mk({ clientId: 'cl1', amount: 0 })], ASOF);
    expect(paid!.status).toBe(PortfolioStatus.PAID);
    const [promise] = groupPortfolio(
      [mk({ clientId: 'cl2', amount: 400, daysPastDue: 5, hasActivePromise: true })],
      ASOF,
    );
    expect(promise!.status).toBe(PortfolioStatus.PROMISE); // la promesa tapa la mora (§5.3)
  });

  it('ordena por mora desc, luego por próxima fecha asc', () => {
    const cards = groupPortfolio(
      [
        mk({ clientId: 'sin-mora-tarde', amount: 100, nextDueDate: '2026-09-01' }),
        mk({ clientId: 'mora-alta', amount: 100, daysPastDue: 20 }),
        mk({ clientId: 'sin-mora-pronto', amount: 100, nextDueDate: '2026-07-20' }),
        mk({ clientId: 'mora-baja', amount: 100, daysPastDue: 3 }),
      ],
      ASOF,
    );
    expect(cards.map((c) => c.clientId)).toEqual(['mora-alta', 'mora-baja', 'sin-mora-pronto', 'sin-mora-tarde']);
  });
});

describe('sortPortfolio (S4)', () => {
  const cards = groupPortfolio(
    [
      mk({ clientId: 'zoe', clientName: 'Zoe', amount: 900, nextDueDate: '2026-09-01' }),
      mk({ clientId: 'ana', clientName: 'Ana', amount: 100, daysPastDue: 20 }),
      mk({ clientId: 'beto', clientName: 'Beto', amount: 400, nextDueDate: '2026-07-20' }),
      mk({ clientId: 'caro', clientName: 'Caro', amount: 250, daysPastDue: 3 }),
    ],
    ASOF,
  );

  it('"mora" da EXACTAMENTE el orden que la lista tenía antes de S4 (no-regresión)', () => {
    expect(sortPortfolio(cards, 'mora').map((c) => c.clientId)).toEqual(['ana', 'caro', 'beto', 'zoe']);
    // `groupPortfolio` ya devuelve ordenado por mora: elegir el default no cambia nada.
    expect(sortPortfolio(cards).map((c) => c.clientId)).toEqual(cards.map((c) => c.clientId));
  });

  it('"deuda" ordena por deuda total desc', () => {
    expect(sortPortfolio(cards, 'deuda').map((c) => c.clientId)).toEqual(['zoe', 'beto', 'caro', 'ana']);
  });

  it('"nombre" ordena alfabéticamente', () => {
    expect(sortPortfolio(cards, 'nombre').map((c) => c.clientId)).toEqual(['ana', 'beto', 'caro', 'zoe']);
  });

  it('"vencimiento" ordena por fecha asc y deja los SIN fecha al final', () => {
    // ana y caro están en mora, sin próxima fecha → van al fondo, no al frente.
    const ids = sortPortfolio(cards, 'vencimiento').map((c) => c.clientId);
    expect(ids.slice(0, 2)).toEqual(['beto', 'zoe']);
    expect(ids.slice(2).sort()).toEqual(['ana', 'caro']);
  });

  it('no muta la lista que recibe (los contadores de los chips la comparten)', () => {
    const before = cards.map((c) => c.clientId);
    sortPortfolio(cards, 'nombre');
    expect(cards.map((c) => c.clientId)).toEqual(before);
  });
});

describe('filterPortfolio (chips + búsqueda)', () => {
  const cards = groupPortfolio(
    [
      mk({ clientId: 'cl1', clientName: 'Ana Ruiz', documentMasked: '12345***', amount: 500, daysPastDue: 8 }),
      mk({ clientId: 'cl2', clientName: 'Beto Díaz', amount: 300, nextDueDate: '2026-07-13' }), // vence hoy
      mk({ clientId: 'cl3', clientName: 'Caro', amount: 0 }), // pagado
    ],
    ASOF,
  );

  it('chip "En mora" solo trae los que tienen días de mora', () => {
    expect(filterPortfolio(cards, 'overdue', '', ASOF).map((c) => c.clientId)).toEqual(['cl1']);
  });

  it('chip "Hoy" solo trae los que vencen hoy', () => {
    expect(filterPortfolio(cards, 'today', '', ASOF).map((c) => c.clientId)).toEqual(['cl2']);
  });

  it('chip "Pagados" solo trae saldo 0', () => {
    expect(filterPortfolio(cards, 'paid', '', ASOF).map((c) => c.clientId)).toEqual(['cl3']);
  });

  it('búsqueda por nombre es insensible a acentos y mayúsculas', () => {
    expect(filterPortfolio(cards, 'all', 'diaz', ASOF).map((c) => c.clientId)).toEqual(['cl2']);
  });

  it('búsqueda por documento enmascarado (prefijo visible)', () => {
    expect(filterPortfolio(cards, 'all', '12345', ASOF).map((c) => c.clientId)).toEqual(['cl1']);
  });

  it('búsqueda por zona (S4)', () => {
    const conZona = groupPortfolio(
      [
        mk({ clientId: 'cl1', clientName: 'Ana', amount: 100, zone: 'Zona Sur' }),
        mk({ clientId: 'cl2', clientName: 'Beto', amount: 100, zone: 'Villa Fátima' }),
      ],
      ASOF,
    );
    expect(filterPortfolio(conZona, 'all', 'fatima', ASOF).map((c) => c.clientId)).toEqual(['cl2']);
  });
});

describe('matchesSearch', () => {
  it('query vacío no filtra', () => {
    const [card] = groupPortfolio([mk({ clientName: 'X' })], ASOF);
    expect(matchesSearch(card!, '  ')).toBe(true);
  });
});
