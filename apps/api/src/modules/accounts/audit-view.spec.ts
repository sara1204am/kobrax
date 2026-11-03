import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges, viaOf } from './audit-view';

describe('describeChanges', () => {
  it('lista sólo los campos que cambiaron, de → a', () => {
    const c = describeChanges({ businessName: 'A', city: 'La Paz' }, { businessName: 'B', city: 'La Paz' });
    assert.deepEqual(c, [{ field: 'businessName', from: 'A', to: 'B' }]);
  });

  it('descarta el ruido: ids, fechas de control y la marca de consola', () => {
    const c = describeChanges(
      { id: '1', updatedAt: 'x', name: 'A' },
      { id: '1', updatedAt: 'y', name: 'B', via: 'plan:set' },
    );
    assert.deepEqual(c.map((x) => x.field), ['name']);
  });

  it('aplana objetos anidados y compara hoja por hoja', () => {
    const c = describeChanges(
      { configuration: { importConfig: { staleAfterDays: 30 }, preferences: { workEnd: '18:00', weekStart: 'MON' } } },
      { configuration: { importConfig: { staleAfterDays: 30 }, preferences: { workEnd: '17:00', weekStart: 'MON' } } },
    );
    assert.deepEqual(c, [{ field: 'configuration.preferences.workEnd', from: '18:00', to: '17:00' }]);
  });

  it('🔴 jamás muestra el valor de un secreto: sólo que cambió', () => {
    const c = describeChanges(
      { passwordHash: 'abc', apiToken: 't1', secretKey: 's1', name: 'x' },
      { passwordHash: 'def', apiToken: 't2', secretKey: 's2', name: 'x' },
    );
    assert.equal(c.length, 3);
    for (const x of c) {
      assert.equal(x.from, '••••', x.field);
      assert.equal(x.to, '••••', x.field);
    }
  });

  it('un campo que aparece o desaparece sale con null de un lado', () => {
    const c = describeChanges({ a: 'x' }, { b: 'y' });
    assert.deepEqual(c, [
      { field: 'a', from: 'x', to: null },
      { field: 'b', from: null, to: 'y' },
    ]);
  });

  it('recorta los valores largos y limita la cantidad de campos', () => {
    const largo = describeChanges({ a: 'x' }, { a: 'y'.repeat(500) });
    assert.ok((largo[0]!.to ?? '').length <= 120);
    const muchos = describeChanges(
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 0])),
      Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 1])),
    );
    assert.equal(muchos.length, 12);
  });

  it('sin before o sin after (alta o baja) no hay diff que mostrar; con basura, tampoco', () => {
    assert.deepEqual(describeChanges(null, { a: 1 }), []);
    assert.deepEqual(describeChanges({ a: 1 }, null), []);
    assert.deepEqual(describeChanges('x', 'y'), []);
  });

  it('igual contenido en distinto orden de claves no cuenta como cambio', () => {
    assert.deepEqual(describeChanges({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }), []);
  });
});

describe('viaOf', () => {
  it('lee la marca de consola de un cambio hecho por Kobrax', () => {
    assert.equal(viaOf({ planCode: 'FREE', via: 'plan:set' }), 'plan:set');
  });
  it('null si lo hizo una persona o si el valor no es texto', () => {
    assert.equal(viaOf({ planCode: 'FREE' }), null);
    assert.equal(viaOf({ via: 5 }), null);
    assert.equal(viaOf(null), null);
  });
});
