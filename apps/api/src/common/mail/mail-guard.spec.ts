import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTestRecipient, mailBlockReason } from './mail-guard';

describe('mail-guard · nunca se envía correo real a direcciones de prueba', () => {
  it('bloquea los dominios que usan las pruebas y los reservados', () => {
    for (const a of [
      'solo-225b59e9@ejemplo.com',
      'banco-sur-02ff9af3@ejemplo.com',
      'x@sub.ejemplo.com',
      'a@example.com',
      'a@EXAMPLE.ORG',
      'root-1@kobrax.test',
      'a@algo.test',
      'a@x.invalid',
      'a@host.localhost',
      'a@maquina.local',
    ]) {
      assert.equal(isTestRecipient(a), true, a);
    }
  });

  it('lo ilegible tampoco se envía', () => {
    for (const a of ['', 'sin-arroba', 'a@', '@']) assert.equal(isTestRecipient(a), true, JSON.stringify(a));
  });

  it('deja pasar direcciones reales', () => {
    for (const a of ['persona@gmail.com', 'ana@banco.com.bo', 'a@kobrax.com', 'a@notejemplo.com', 'a@ejemplo.com.bo']) {
      assert.equal(isTestRecipient(a), false, a);
    }
  });

  it('mailBlockReason: NODE_ENV=test o MAIL_DISABLED bloquean aunque la dirección sea real', () => {
    assert.match(mailBlockReason('persona@gmail.com', { NODE_ENV: 'test' })!, /NODE_ENV=test/);
    assert.match(mailBlockReason('persona@gmail.com', { MAIL_DISABLED: '1' })!, /MAIL_DISABLED/);
    assert.match(mailBlockReason('persona@gmail.com', { MAIL_DISABLED: 'true' })!, /MAIL_DISABLED/);
  });

  it('mailBlockReason: una dirección real en producción pasa; una lista con una de prueba se bloquea entera', () => {
    assert.equal(mailBlockReason('persona@gmail.com', { NODE_ENV: 'production' }), null);
    assert.equal(mailBlockReason('persona@gmail.com', {}), null);
    assert.match(mailBlockReason('persona@gmail.com, x@ejemplo.com', {})!, /destinatario de prueba/);
  });
});
