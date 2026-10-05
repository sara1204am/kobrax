import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MoraCreditListItem } from '@kobrax/shared';
import { csvHeader, csvRows, csvSafeText } from '../exports/csv';
import { buildMoraPdf, describeFilters, inRequestContext, describeSort, moraCsvRow, MORA_CSV_COLUMNS, moraCutoff, moraTotals } from './mora-export';

function credit(over: Partial<MoraCreditListItem> = {}): MoraCreditListItem {
  return {
    creditId: 'cr1',
    code: '302-222-9734',
    clientId: 'cl1',
    clientName: 'Fernando Blanco Choque',
    currency: 'BOB',
    balance: 7011.42,
    daysPastDue: 393,
    arrearsSource: 'CALCULATED',
    situation: 'IN_ARREARS',
    writtenOff: false,
    priorityPinned: false,
    hasActivePromise: false,
    ...over,
  };
}

describe('moraCsvRow — ausente queda en blanco, nunca 0', () => {
  it('un importado sin cuota, vencido ni último pago exporta celdas vacías', () => {
    const row = moraCsvRow(credit({ arrearsSource: 'IMPORTED', externalSource: 'PSF' }), new Map());
    assert.equal(row['Cuota'], '');
    assert.equal(row['Monto vencido'], '');
    assert.equal(row['Último pago'], '');
    assert.equal(row['Monto original'], '');
    assert.equal(row['Fuente'], 'PSF');
  });

  it('un saldo conocido sale como número y las fechas en ISO', () => {
    const row = moraCsvRow(credit({ nextDueDate: '2026-11-02', overdueAmount: 5586.12, overdueSource: 'REPORTED', lastPaymentAt: '2026-07-10' }), new Map());
    assert.equal(row['Saldo'], 7011.42);
    assert.equal(row['Próxima fecha'], '2026-11-02');
    assert.equal(row['Monto vencido'], 5586.12);
    assert.equal(row['Origen del monto vencido'], 'Reportado por el archivo');
  });

  it('el responsable sale con nombre, no con id; sin responsable ni episodio sale vacío', () => {
    const names = new Map([['u1', 'Carlos Mamani']]);
    const completo = moraCsvRow(
      credit({ responsibleId: 'u1', priority: 'CRITICAL', category: { code: 'C', name: 'Categoría C' }, lastActionAt: '2026-09-30T14:00:00.000Z' }),
      names,
    );
    assert.equal(completo['Responsable'], 'Carlos Mamani');
    assert.equal(completo['Prioridad'], 'Crítica');
    assert.equal(completo['Categoría'], 'C');
    assert.equal(completo['Situación'], 'En mora');
    assert.equal(completo['Castigado'], 'No');
    assert.equal(completo['Última gestión'], '2026-09-30');
    const vacio = moraCsvRow(credit({ situation: 'CURRENT', daysPastDue: 0 }), names);
    assert.equal(vacio['Responsable'], '');
    assert.equal(vacio['Prioridad'], '');
    assert.equal(vacio['Categoría'], '');
    assert.equal(vacio['Situación'], 'Al día');
  });

  it('castigado sale como «Sí» aunque siga en mora', () => {
    assert.equal(moraCsvRow(credit({ writtenOff: true }), new Map())['Castigado'], 'Sí');
  });

  it('F4/08: sin columnas de caso ni de SLA; «Cobrador» pasó a «Responsable»', () => {
    const cols = MORA_CSV_COLUMNS.join('|');
    assert.doesNotMatch(cols, /Plazo|Estado de gestión|Cobrador/);
    for (const c of ['Responsable', 'Categoría', 'Situación', 'Castigado', 'Prioridad']) assert.ok((MORA_CSV_COLUMNS as readonly string[]).includes(c), c);
  });

  it('🔴 no lleva teléfonos, direcciones ni documento', () => {
    const cols = MORA_CSV_COLUMNS.join('|').toLowerCase();
    assert.doesNotMatch(cols, /tel[eé]fono|direcci[oó]n|documento|carnet|celular/);
  });

  it('un nombre que empieza con = o @ no se ejecuta como fórmula en Excel', () => {
    const row = moraCsvRow(credit({ clientName: '=HYPERLINK("http://x")', reportedStatus: '@cmd' }), new Map());
    assert.equal(row['Deudor'], `'=HYPERLINK("http://x")`);
    assert.equal(row['Estado en origen'], "'@cmd");
    assert.equal(csvSafeText('Pérez'), 'Pérez');
  });

  it('cada columna declarada tiene su valor en la fila', () => {
    const row = moraCsvRow(credit(), new Map());
    for (const col of MORA_CSV_COLUMNS) assert.ok(col in row, `falta ${col}`);
  });
});

describe('CSV por tramos', () => {
  it('la cabecera lleva BOM (Excel en Windows) y las filas se escapan', () => {
    const cols = ['A', 'B'];
    const head = csvHeader(cols);
    assert.equal(head.charCodeAt(0), 0xfeff);
    assert.equal(head.slice(1), 'A,B\n');
    assert.equal(csvRows([{ A: 'a,b', B: 'dice "hola"' }, { A: 1, B: '' }], cols), '"a,b","dice ""hola"""\n1,\n');
  });

  it('cabecera + tramos = un CSV completo', () => {
    const cols = [...MORA_CSV_COLUMNS];
    const csv = csvHeader(cols) + csvRows([moraCsvRow(credit(), new Map())], cols) + csvRows([moraCsvRow(credit({ code: 'C-2' }), new Map())], cols);
    const lines = csv.slice(1).trim().split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[1]!.startsWith('302-222-9734,Fernando Blanco Choque,BOB,7011.42'));
  });
});

describe('describeFilters — los filtros en palabras', () => {
  it('sin filtros no dice nada', () => assert.deepEqual(describeFilters({}), []));

  it('el ejemplo del pedido: oficina, responsable, mora, prioridad, categoría y castigo', () => {
    const f = describeFilters(
      { branchId: 'b', assigneeId: 'u', dpdMin: 90, priority: 'CRITICAL', category: 'B,C', writtenOff: 'false' },
      { branch: 'Centro', assignee: 'Carlos Mamani' },
    );
    assert.deepEqual(f, ['Días de mora: 90 o más', 'Prioridad: Crítica', 'Categoría de mora: B, C', 'Sin los castigados', 'Responsable: Carlos Mamani', 'Oficina: Centro']);
  });

  it('un valor de enum inventado no aparece', () => {
    assert.deepEqual(describeFilters({ priority: 'INVENTADA' }), []);
  });

  it('el orden dice la dirección', () => {
    assert.equal(describeSort(), 'días de mora (mayor a menor)');
    assert.equal(describeSort('balance', 'asc'), 'saldo (menor a mayor)');
    assert.equal(describeSort('hasOwnProperty'), 'días de mora (mayor a menor)');
    assert.equal(describeSort('slaDueAt'), 'días de mora (mayor a menor)'); // clave que ya no existe
  });
});

describe('moraTotals — fuentes y monedas no se mezclan (D7)', () => {
  it('separa Kobrax de PSF y una moneda de otra', () => {
    const t = moraTotals([
      credit({ balance: 100 }),
      credit({ balance: 50, overdueAmount: 10 }),
      credit({ externalSource: 'PSF', balance: 1000, overdueAmount: 400 }),
      credit({ currency: 'USD', balance: 5 }),
    ]);
    assert.deepEqual(t.map((x) => `${x.source}/${x.currency}`), ['KOBRAX/BOB', 'KOBRAX/USD', 'PSF/BOB']);
    const kobrax = t[0]!;
    assert.equal(kobrax.count, 2);
    assert.equal(kobrax.balance, 150);
    // El vencido suma sólo a quien lo tiene, y se dice cuántos son.
    assert.equal(kobrax.overdue, 10);
    assert.equal(kobrax.overdueKnown, 1);
  });

  it('un saldo desconocido no suma 0 inventado: simplemente no aporta', () => {
    const t = moraTotals([credit({ balance: undefined }), credit({ balance: 10 })]);
    assert.equal(t[0]!.balance, 10);
    assert.equal(t[0]!.count, 2);
  });
});

describe('moraCutoff', () => {
  it('es el corte más reciente de los externos; sin externos no hay', () => {
    assert.equal(moraCutoff([credit({ reportedAsOf: '2026-09-29' }), credit({ reportedAsOf: '2026-09-30' }), credit()]), '2026-09-30');
    assert.equal(moraCutoff([credit()]), undefined);
  });
});

describe('buildMoraPdf — un reporte de verdad', () => {
  const ctx = { accountName: 'Cooperativa Demo', currency: 'BOB', generatedBy: 'Ana Quispe', ownOnly: false, filters: ['Días de mora: 90 o más'], sort: 'días de mora (mayor a menor)', names: new Map<string, string>(), now: new Date('2026-10-01T15:00:00Z') };

  it('genera un PDF válido', async () => {
    const pdf = await buildMoraPdf([credit()], ctx);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.length > 1500);
  });

  it('con muchas filas pagina (varias hojas) y sigue siendo válido', async () => {
    const many = Array.from({ length: 400 }, (_, i) => credit({ creditId: `c${i}`, code: `C-${i}`, daysPastDue: 1 + (i % 200) }));
    const pdf = await buildMoraPdf(many, ctx);
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    assert.ok(pages >= 5, `esperaba varias hojas, hubo ${pages}`);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  it('una lista vacía también sale: dice que no hay créditos', async () => {
    const pdf = await buildMoraPdf([], ctx);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  });
});

describe('inRequestContext — el stream del CSV conserva el tenant', () => {
  const als = new AsyncLocalStorage<{ tenant: string }>();

  async function* lee(): AsyncGenerator<string> {
    // Lo que hace `MoraService.batches`: leer el tenant del contexto en cada paso.
    yield als.getStore()?.tenant ?? 'SIN-CONTEXTO';
    await new Promise((r) => setTimeout(r, 1));
    yield als.getStore()?.tenant ?? 'SIN-CONTEXTO';
  }

  async function consumir(it: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const v of it) out.push(v);
    return out;
  }

  it('🔴 sin atar el contexto, consumido fuera de la petición, el tenant se pierde (el bug real)', async () => {
    const iterable = als.run({ tenant: 'acc' }, () => lee());
    // Nest consume el stream después de que el handler terminó: ya no hay contexto.
    assert.deepEqual(await consumir(iterable), ['SIN-CONTEXTO', 'SIN-CONTEXTO']);
  });

  it('atado a la petición, cada paso ve el tenant aunque se consuma después y afuera', async () => {
    const iterable = als.run({ tenant: 'acc' }, () => inRequestContext(lee()));
    assert.deepEqual(await consumir(iterable), ['acc', 'acc']);
  });

  it('cortar el stream a la mitad cierra el generador de origen', async () => {
    let cerrado = false;
    async function* origen(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
      } finally {
        cerrado = true;
      }
    }
    for await (const v of inRequestContext(origen())) {
      assert.equal(v, 1);
      break;
    }
    assert.equal(cerrado, true);
  });
});
