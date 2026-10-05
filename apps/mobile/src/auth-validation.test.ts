import { fieldErrorsFromDetails, validateEmail, validateLogin } from './auth-validation';

describe('validateLogin (M-LOG-18)', () => {
  it('correo vacío y contraseña vacía piden cada campo', () => {
    expect(validateLogin('  ', '')).toEqual({
      email: 'Ingresa tu correo electrónico',
      password: 'Ingresa tu contraseña',
    });
  });
  it('correo sin arroba: solo marca el correo', () => {
    expect(validateLogin('collectorkobrax.demo', 'Kobrax123!')).toEqual({
      email: 'El formato del correo no es válido',
    });
  });
  it.each(['a@b', 'a@@b.com', 'a b@c.com', '@kobrax.demo', 'a@.com'])('rechaza %s', (e) => {
    expect(validateEmail(e)).toBe('El formato del correo no es válido');
  });
  it('acepta un correo válido (con espacios alrededor)', () => {
    expect(validateLogin(' collector@kobrax.demo ', 'x')).toEqual({});
  });
});

describe('fieldErrorsFromDetails', () => {
  it('toma el primer mensaje de cada campo', () => {
    expect(
      fieldErrorsFromDetails({ fields: { email: ['El formato del correo no es válido', 'otro'], password: ['Ingresa tu contraseña'] } }),
    ).toEqual({ email: 'El formato del correo no es válido', password: 'Ingresa tu contraseña' });
  });
  it.each([undefined, null, 'x', ['a'], {}, { fields: 3 }, { fields: { email: [] } }])('tolera %j', (d) => {
    expect(fieldErrorsFromDetails(d)).toEqual({});
  });
});
