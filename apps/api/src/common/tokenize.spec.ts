import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskDocument, maskPhone, maskEmail } from '@kobrax/shared';

describe('tokenize (@kobrax/shared)', () => {
  it('maskDocument deja 5 visibles', () => {
    assert.equal(maskDocument('12345678'), '12345***');
    assert.equal(maskDocument('123'), '***'); // más corto que la ventana
    assert.equal(maskDocument(''), '');
    assert.equal(maskDocument(null), '');
  });

  it('maskPhone deja 3 visibles', () => {
    assert.equal(maskPhone('77712345'), '777****');
    assert.equal(maskPhone('77'), '***');
  });

  it('maskEmail enmascara usuario y dominio conservando el TLD', () => {
    assert.equal(maskEmail('juan@banco.com'), 'ju***@ba***.com');
    assert.equal(maskEmail('ab@x.io'), '***@***.io');
    assert.equal(maskEmail('sin-arroba'), 'si***');
  });
});
