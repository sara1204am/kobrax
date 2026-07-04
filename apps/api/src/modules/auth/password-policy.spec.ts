import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword, isPasswordValid } from '@kobrax/shared';

describe('passwordPolicy (@kobrax/shared)', () => {
  it('acepta una contraseña que cumple toda la política', () => {
    assert.equal(isPasswordValid('Kobrax123!'), true);
  });

  it('rechaza por cada regla incumplida', () => {
    assert.equal(isPasswordValid('short1!'), false); // < 8
    assert.equal(isPasswordValid('kobrax123!'), false); // sin mayúscula
    assert.equal(isPasswordValid('Kobraxxx!'), false); // sin número
    assert.equal(isPasswordValid('Kobrax1234'), false); // sin símbolo
  });

  it('checkPassword detalla qué reglas pasan', () => {
    const checks = checkPassword('Kobrax123!');
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.passed]));
    assert.deepEqual(byId, { length: true, uppercase: true, number: true, symbol: true });
  });
});
