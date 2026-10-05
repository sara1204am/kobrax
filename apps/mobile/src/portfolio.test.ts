import { PortfolioStatus } from '@kobrax/shared';
import { filterPortfolio, groupPortfolio, matchesSearch, sortPortfolio, sourceLineOf, type PortfolioCredit } from './portfolio';

const ASOF = new Date('2026-07-13T12:00:00Z');

/** Fila de crédito mínima para los tests (los campos ausentes no importan a la lógica de cartera). */
function mk(p: Partial<PortfolioCredit>): PortfolioCredit {
  return {
    creditId: p.creditId ?? 'cr-' + Math.random().toString(36).slice(2),
    clientId: p.clientId ?? 'cl1',
    currency: 'BOB',
    daysPastDue: 0,
    ...p,
  };
}

describe('sourceLineOf (D7)', () => {
  it('todo de Kobrax: no hay línea', () => {
    expect(sourceLineOf([{}, {}])).toBeUndefined();
  });

  it('externo: la fuente con el corte más viejo', () => {
    expect(
      sourceLineOf([
        { externalSource: 'PSF', syncStatus: 'PRESENT', reportedAsOf: '2026-10-02' },
        { externalSource: 'PSF', syncStatus: 'PRESENT', reportedAsOf: '2026-09-30' },
        {},
      ]),
    ).toBe('PSF al 30/09');
  });

  it('🔴 la ausencia del reporte manda sobre el corte: no es «al día» ni «pagó» (D4)', () => {
    expect(sourceLineOf([{ externalSource: 'PSF', syncStatus: 'ABSENT', reportedAsOf: '2026-09-28' }])).toBe(
      'PSF · ausente del reporte',
    );
  });

  it('el dato viejo se avisa (D9)', () => {
    expect(sourceLineOf([{ externalSource: 'PSF', syncStatus: 'PRESENT', reportedStale: true }])).toBe(
      'PSF · dato desactualizado',
    );
  });
});

describe('groupPortfolio', () => {
  it('agrupa por cliente, agrega la deuda y cuenta los préstamos', () => {
    const cards = groupPortfolio(
      [
        mk({ clientId: 'cl1', creditId: 'a', clientName: 'Ana Ruiz', balance: 500, currency: 'BOB' }),
        mk({ clientId: 'cl1', creditId: 'b', clientName: 'Ana Ruiz', balance: 300, currency: 'BOB' }),
        mk({ clientId: 'cl2', creditId: 'c', clientName: 'Beto Diaz', balance: 100, currency: 'BOB' }),
      ],
      ASOF,
    );
    const ana = cards.find((c) => c.clientId === 'cl1')!;
    expect(ana.totalDebt).toBe(800);
    expect(ana.creditCount).toBe(2);
    expect(cards).toHaveLength(2);
  });

  it('el estado del cliente es el del peor crédito (mora gana sobre al día)', () => {
    const [card] = groupPortfolio(
      [
        mk({ clientId: 'cl1', creditId: 'a', balance: 500, daysPastDue: 0, nextDueDate: '2026-08-01' }),
        mk({ clientId: 'cl1', creditId: 'b', balance: 300, daysPastDue: 9 }),
      ],
      ASOF,
    );
    expect(card!.status).toBe(PortfolioStatus.OVERDUE);
    expect(card!.maxDaysPastDue).toBe(9);
    expect(card!.secondaryLine).toBe('9 días de mora');
  });

  it('sin mora arma la línea "Cuota … · vence …" del crédito más próximo', () => {
    const [card] = groupPortfolio(
      [mk({ clientId: 'cl1', balance: 1000, daysPastDue: 0, installmentAmount: 300, nextDueDate: '2026-07-15' })],
      ASOF,
    );
    expect(card!.status).toBe(PortfolioStatus.DUE_SOON); // vence en 2 días → por vencer (§5.3)
    expect(card!.secondaryLine).toContain('vence 15 jul');
    expect(card!.secondaryLine).toContain('Cuota');
  });

  it('saldo 0 → PAGADO; una promesa vigente no cambia el estado (D1)', () => {
    const [paid] = groupPortfolio([mk({ clientId: 'cl1', balance: 0 })], ASOF);
    expect(paid!.status).toBe(PortfolioStatus.PAID);
    const [promise] = groupPortfolio(
      [mk({ clientId: 'cl2', balance: 400, daysPastDue: 5 })],
      ASOF,
    );
    expect(promise!.status).toBe(PortfolioStatus.OVERDUE); // la promesa es información, no estado
  });

  it('ordena por mora desc, luego por próxima fecha asc', () => {
    const cards = groupPortfolio(
      [
        mk({ clientId: 'sin-mora-tarde', balance: 100, nextDueDate: '2026-09-01' }),
        mk({ clientId: 'mora-alta', balance: 100, daysPastDue: 20 }),
        mk({ clientId: 'sin-mora-pronto', balance: 100, nextDueDate: '2026-07-20' }),
        mk({ clientId: 'mora-baja', balance: 100, daysPastDue: 3 }),
      ],
      ASOF,
    );
    expect(cards.map((c) => c.clientId)).toEqual(['mora-alta', 'mora-baja', 'sin-mora-pronto', 'sin-mora-tarde']);
  });
});

describe('groupPortfolio · modelo sin caso (F4/08)', () => {
  it('incluye los créditos AL DÍA: el cliente aparece con su deuda aunque no tenga mora', () => {
    const [card] = groupPortfolio([mk({ clientId: 'cl1', balance: 700, situation: 'CURRENT', nextDueDate: '2026-09-01' })], ASOF);
    expect(card!.status).toBe(PortfolioStatus.CURRENT);
    expect(card!.totalDebt).toBe(700);
    expect(card!.maxDaysPastDue).toBe(0);
    expect(card!.writtenOff).toBe(false);
  });

  it('la categoría es la del crédito más atrasado, y un crédito al día no la lleva', () => {
    const [card] = groupPortfolio(
      [
        mk({ clientId: 'cl1', creditId: 'a', balance: 100, daysPastDue: 10, category: { code: 'A', name: 'A' } }),
        mk({ clientId: 'cl1', creditId: 'b', balance: 100, daysPastDue: 70, category: { code: 'C', name: 'C' } }),
        mk({ clientId: 'cl1', creditId: 'c', balance: 100, daysPastDue: 0 }),
      ],
      ASOF,
    );
    expect(card!.category).toBe('C');
    const [alDia] = groupPortfolio([mk({ clientId: 'cl2', balance: 50, daysPastDue: 0, category: { code: 'A', name: 'A' } })], ASOF);
    expect(alDia!.category).toBeUndefined();
  });

  it('castigado es una condición aparte: sólo marca la tarjeta si TODOS sus créditos lo están', () => {
    const [mixto] = groupPortfolio(
      [mk({ clientId: 'cl1', creditId: 'a', balance: 100, daysPastDue: 240, writtenOff: true }), mk({ clientId: 'cl1', creditId: 'b', balance: 50 })],
      ASOF,
    );
    expect(mixto!.writtenOff).toBe(false);
    expect(mixto!.writtenOffCount).toBe(1);
    const [todos] = groupPortfolio([mk({ clientId: 'cl2', balance: 100, daysPastDue: 240, writtenOff: true })], ASOF);
    expect(todos!.writtenOff).toBe(true);
    expect(todos!.maxDaysPastDue).toBe(240); // sigue en mora: el castigo no borra los días
  });

  it('marca como externo al cliente con algún crédito de una fuente (PSF)', () => {
    const cards = groupPortfolio(
      [mk({ clientId: 'cl1', balance: 100, externalSource: 'PSF' }), mk({ clientId: 'cl2', balance: 100 })],
      ASOF,
    );
    expect(cards.find((c) => c.clientId === 'cl1')!.external).toBe(true);
    expect(cards.find((c) => c.clientId === 'cl2')!.external).toBe(false);
  });

  it('cuenta créditos por cliente (filas distintas), no filas repetidas del mismo crédito', () => {
    const [card] = groupPortfolio([mk({ clientId: 'cl1', creditId: 'a' }), mk({ clientId: 'cl1', creditId: 'a' }), mk({ clientId: 'cl1', creditId: 'b' })], ASOF);
    expect(card!.creditCount).toBe(2);
  });
});

describe('sortPortfolio (S4)', () => {
  const cards = groupPortfolio(
    [
      mk({ clientId: 'zoe', clientName: 'Zoe', balance: 900, nextDueDate: '2026-09-01' }),
      mk({ clientId: 'ana', clientName: 'Ana', balance: 100, daysPastDue: 20 }),
      mk({ clientId: 'beto', clientName: 'Beto', balance: 400, nextDueDate: '2026-07-20' }),
      mk({ clientId: 'caro', clientName: 'Caro', balance: 250, daysPastDue: 3 }),
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
      mk({ clientId: 'cl1', clientName: 'Ana Ruiz', documentMasked: '12345***', balance: 500, daysPastDue: 8 }),
      mk({ clientId: 'cl2', clientName: 'Beto Díaz', balance: 300, nextDueDate: '2026-07-13' }), // vence hoy
      mk({ clientId: 'cl3', clientName: 'Caro', balance: 0 }), // pagado
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

  it('chip "Al día" trae al que tiene saldo y no está en mora (sí, aunque no tenga mora nunca)', () => {
    expect(filterPortfolio(cards, 'current', '', ASOF).map((c) => c.clientId)).toEqual(['cl2']);
  });

  it('chip "PSF" solo trae a los que tienen un crédito de fuente externa', () => {
    const conPsf = groupPortfolio(
      [mk({ clientId: 'cl1', balance: 100, externalSource: 'PSF' }), mk({ clientId: 'cl2', balance: 100 })],
      ASOF,
    );
    expect(filterPortfolio(conPsf, 'psf', '', ASOF).map((c) => c.clientId)).toEqual(['cl1']);
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
        mk({ clientId: 'cl1', clientName: 'Ana', balance: 100, zone: 'Zona Sur' }),
        mk({ clientId: 'cl2', clientName: 'Beto', balance: 100, zone: 'Villa Fátima' }),
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
