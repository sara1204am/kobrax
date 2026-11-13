import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isReservedRole, strictlyBelow, tierOf } from './tier';

describe('tier (F14 · F2, D-1)', () => {
  it('tierOf sale del nivel del rol (única fuente hasta F5)', () => {
    assert.equal(tierOf({ name: 'COLLECTOR', level: 30 }), 30);
    assert.ok(tierOf({ name: 'MANAGER', level: 70 }) > tierOf({ name: 'SUPERVISOR', level: 50 }));
  });

  it('SUPER_ADMIN y ACCOUNT_ADMIN son reservados; el resto no', () => {
    assert.equal(isReservedRole({ name: 'SUPER_ADMIN', level: 100 }), true);
    assert.equal(isReservedRole({ name: 'ACCOUNT_ADMIN', level: 90 }), true);
    assert.equal(isReservedRole({ name: 'MANAGER', level: 70 }), false);
  });

  it('strictlyBelow: la misma oficina no cuenta, una hija sí', () => {
    assert.equal(strictlyBelow('/r/a/', ['/r/a/']), false);
    assert.equal(strictlyBelow('/r/a/b/', ['/r/a/']), true);
    assert.equal(strictlyBelow('/r/z/', ['/r/a/']), false);
    assert.equal(strictlyBelow('/r/a/b/', []), false);
  });
});
