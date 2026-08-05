import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInvitationCode,
  newInvitationCode,
  normalizeInvitationCode,
  sha256hex,
} from './invitation-code';
import { MailService, invitationBody } from '../../common/mail/mail.service';

describe('invitation-code', () => {
  it('genera 10 símbolos del alfabeto sin letras confundibles', () => {
    for (let i = 0; i < 50; i++) {
      const code = newInvitationCode();
      assert.equal(code.length, 10);
      assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/); // sin I, L, O, U
    }
  });

  it('no repite (50 bits de entropía, no un contador)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newInvitationCode()));
    assert.equal(codes.size, 200);
  });

  it('normaliza lo que la persona escribe: guiones, espacios, minúsculas', () => {
    const code = 'K7F29QX3TM';
    for (const raw of ['K7F29-QX3TM', 'k7f29qx3tm', ' K7F29 QX3TM ', 'k7f29-qx3tm']) {
      assert.equal(normalizeInvitationCode(raw), code);
    }
  });

  it('corrige las confusiones que el alfabeto excluye (O→0, I/L→1)', () => {
    assert.equal(normalizeInvitationCode('OI-L0'), '0110');
  });

  it('el hash es SHA-256 hex y nunca el código en claro', () => {
    const hash = sha256hex('K7F29QX3TM');
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.ok(!hash.includes('K7F29'));
  });

  it('el formato que se muestra sigue normalizando al mismo código', () => {
    const code = newInvitationCode();
    assert.equal(normalizeInvitationCode(formatInvitationCode(code)), code);
  });
});

describe('correo de invitación (S2-D3: link + código)', () => {
  it('lleva las dos formas de entrar', () => {
    const { subject, text } = invitationBody({
      businessName: 'Cobranzas Rosa',
      invitedBy: 'Sara Acha',
      code: 'K7F29QX3TM',
    });
    assert.ok(subject.includes('Cobranzas Rosa'));
    assert.ok(text.includes('kobrax://invitacion?c=K7F29QX3TM'));
    assert.ok(text.includes('K7F29-QX3TM')); // el código escrito, que es el que siempre funciona
  });

  it('sin credenciales SMTP loguea en vez de enviar, y no explota', async () => {
    const mail = new MailService({ smtpUser: undefined, smtpPass: undefined } as never);
    await mail.send('quien@kobrax.demo', 'asunto', 'cuerpo');
  });
});
