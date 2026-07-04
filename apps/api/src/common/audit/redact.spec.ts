import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactPII, REDACTED } from './redact';

describe('redactPII', () => {
  it('redacta claves sensibles (incl. snake_case y camelCase)', () => {
    const out = redactPII({
      firstName: 'Ana',
      national_id: 'CI-12345',
      nationalId: 'CI-12345',
      passwordHash: 'abc',
      phone: '77712345',
      status: 'ACTIVE',
    }) as Record<string, unknown>;

    assert.equal(out.firstName, 'Ana'); // no sensible → intacto
    assert.equal(out.status, 'ACTIVE');
    assert.equal(out.national_id, REDACTED);
    assert.equal(out.nationalId, REDACTED);
    assert.equal(out.passwordHash, REDACTED);
    assert.equal(out.phone, REDACTED);
  });

  it('recorre objetos anidados y arrays', () => {
    const out = redactPII({
      client: { name: 'X', taxId: 'NIT-9' },
      contacts: [{ contactType: 'PHONE', value: '777' }],
    }) as { client: Record<string, unknown>; contacts: Record<string, unknown>[] };

    assert.equal(out.client.name, 'X');
    assert.equal(out.client.taxId, REDACTED);
    assert.equal(out.contacts[0]!.contactType, 'PHONE');
    assert.equal(out.contacts[0]!.value, REDACTED); // contact.value es PII
  });

  it('admite claves extra por entidad y no muta la entrada', () => {
    const input = { secretField: 'x', keep: 1 };
    const out = redactPII(input, ['secretField']) as Record<string, unknown>;
    assert.equal(out.secretField, REDACTED);
    assert.equal(out.keep, 1);
    assert.equal(input.secretField, 'x'); // original intacto
  });

  it('devuelve primitivos sin cambios', () => {
    assert.equal(redactPII('hola'), 'hola');
    assert.equal(redactPII(42), 42);
    assert.equal(redactPII(null), null);
  });
});
