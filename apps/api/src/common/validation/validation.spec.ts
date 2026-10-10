import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { createValidationPipe } from './validation-pipe';
import { LoginDto } from '../../modules/auth/dto/login.dto';
import { ForgotPasswordDto } from '../../modules/auth/dto/forgot-password.dto';
import { ChangePasswordDto } from '../../modules/auth/dto/change-password.dto';
import { ResetPasswordDto } from '../../modules/auth/dto/reset-password.dto';
import { AcceptInvitationDto } from '../../modules/auth/dto/accept-invitation.dto';
import { CreateAccountDto } from '../../modules/accounts/dto/create-account.dto';

const pipe = createValidationPipe();
const run = (type: new () => object, value: object) =>
  pipe.transform(value, { type: 'body', metatype: type });

async function fieldsOf(type: new () => object, value: object): Promise<Record<string, string[]> | null> {
  try {
    await run(type, value);
    return null;
  } catch (e) {
    assert.ok(e instanceof BadRequestException);
    return (e.getResponse() as { fields: Record<string, string[]> }).fields;
  }
}

describe('login DTO', () => {
  it('acepta credenciales normales', async () => {
    assert.equal(await fieldsOf(LoginDto, { email: 'a@b.co', password: 'x' }), null);
  });
  it('vacíos: un mensaje por campo', async () => {
    const f = await fieldsOf(LoginDto, { email: '', password: '' });
    assert.ok(f?.email?.includes('Ingresa tu correo electrónico'));
    assert.ok(f?.password?.includes('Ingresa tu contraseña'));
  });
  it('correo sin arroba: solo el campo email falla', async () => {
    const f = await fieldsOf(LoginDto, { email: 'managerkobrax.demo', password: 'Kobrax123!' });
    assert.deepEqual(Object.keys(f ?? {}), ['email']);
    assert.deepEqual(f?.email, ['El formato del correo no es válido']);
  });
  it('correo de más de 254 caracteres', async () => {
    const email = `${'a'.repeat(250)}@b.co`;
    const f = await fieldsOf(LoginDto, { email, password: 'x' });
    assert.ok(f?.email?.some((m) => m.includes('254')));
  });
  it('contraseña: tope amplio de 128 (no 72)', async () => {
    assert.equal(await fieldsOf(LoginDto, { email: 'a@b.co', password: 'x'.repeat(128) }), null);
    const f = await fieldsOf(LoginDto, { email: 'a@b.co', password: 'x'.repeat(129) });
    assert.ok(f?.password);
  });
});

describe('contraseña al crearla: máx. 72 bytes', () => {
  const ok72 = 'A1!' + 'a'.repeat(69);
  const tilde = 'A1!' + 'ñ'.repeat(35); // 3 + 70 = 73 bytes, 38 letras
  it('72 bytes pasa y 73 bytes no', async () => {
    assert.equal(Buffer.byteLength(ok72), 72);
    assert.equal(Buffer.byteLength(tilde), 73);
    const base = { email: 'a@b.co', businessName: 'Acme', firstName: 'A', lastName: 'B' };
    assert.equal(await fieldsOf(CreateAccountDto, { ...base, password: ok72 }), null);
    assert.ok((await fieldsOf(CreateAccountDto, { ...base, password: tilde }))?.password);
  });
  it('cambio, restablecimiento e invitación aplican el mismo tope', async () => {
    assert.ok((await fieldsOf(ChangePasswordDto, { currentPassword: 'x', newPassword: tilde }))?.newPassword);
    assert.equal(await fieldsOf(ChangePasswordDto, { currentPassword: 'x'.repeat(100), newPassword: ok72 }), null);
    assert.ok((await fieldsOf(ResetPasswordDto, { token: 't', newPassword: tilde }))?.newPassword);
    assert.ok((await fieldsOf(AcceptInvitationDto, { code: 'ABCD-EFGH', password: tilde }))?.password);
  });
  it('correo largo en registro y recuperación', async () => {
    const email = `${'a'.repeat(250)}@b.co`;
    assert.ok((await fieldsOf(ForgotPasswordDto, { email }))?.email);
    assert.ok((await fieldsOf(CreateAccountDto, { email, password: ok72, businessName: 'Acme', firstName: 'A', lastName: 'B' }))?.email);
  });
});

describe('GlobalExceptionFilter', () => {
  it('devuelve el detalle por campo en error.details', async () => {
    let sent: { status?: number; body?: { error: { code: string; details: { fields: Record<string, string[]> } } } } = {};
    const res = {
      status(s: number) {
        sent.status = s;
        return this;
      },
      json(b: never) {
        sent.body = b;
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    try {
      await run(LoginDto, { email: 'mal', password: '' });
    } catch (e) {
      new GlobalExceptionFilter().catch(e, host as never);
    }
    assert.equal(sent.status, 400);
    assert.equal(sent.body?.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(sent.body?.error.details.fields.email, ['El formato del correo no es válido']);
    assert.deepEqual(sent.body?.error.details.fields.password, ['Ingresa tu contraseña']);
  });
});
