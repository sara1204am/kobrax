import { describe, it, expect } from 'vitest';
import { validateLogin } from './login-validation';

describe('validateLogin', () => {
  it('campos vacíos: un error por campo', () => {
    expect(validateLogin('', '')).toEqual({ email: 'emailRequired', password: 'passwordRequired' });
    expect(validateLogin('   ', 'x')).toEqual({ email: 'emailRequired' });
  });
  it('correo sin arroba: solo falla el correo', () => {
    expect(validateLogin('managerkobrax.demo', 'Kobrax123!')).toEqual({ email: 'emailInvalid' });
    expect(validateLogin('a@b', 'x')).toEqual({ email: 'emailInvalid' });
  });
  it('correo válido y contraseña presente: sin errores', () => {
    expect(validateLogin('nombre@empresa.com', 'x')).toEqual({});
  });
  it('largos máximos: correo 254, contraseña 128', () => {
    const ok = `${'a'.repeat(243)}@empresa.co`; // 254
    expect(ok.length).toBe(254);
    expect(validateLogin(ok, 'x')).toEqual({});
    expect(validateLogin(`a${ok}`, 'x')).toEqual({ email: 'emailTooLong' });
    expect(validateLogin('a@b.co', 'x'.repeat(128))).toEqual({});
    expect(validateLogin('a@b.co', 'x'.repeat(129))).toEqual({ password: 'passwordTooLong' });
  });
});
