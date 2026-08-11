import {
  COUNTRY_OPTIONS,
  diffAccount,
  diffProfile,
  findCountry,
  hasChanges,
  roleOptions,
  validateAccount,
  validateInvite,
  validateProfile,
  validateSignup,
  type AccountForm,
  type InviteForm,
  type ProfileForm,
  type SignupForm,
} from './account-form';

const invite = (over: Partial<InviteForm> = {}): InviteForm => ({
  firstName: 'Rosa',
  lastName: 'Quispe',
  email: 'rosa@ejemplo.com',
  roleId: 'role-collector',
  ...over,
});

const account = (over: Partial<AccountForm> = {}): AccountForm => ({
  businessName: 'Cobranzas Pérez',
  taxId: '123456',
  countryCode: 'BO',
  currencyCode: 'BOB',
  ...over,
});

const profile = (over: Partial<ProfileForm> = {}): ProfileForm => ({
  firstName: 'Ana',
  lastName: 'Gómez',
  phone: '77712345',
  photoUrl: '',
  ...over,
});

const signup = (over: Partial<SignupForm> = {}): SignupForm => ({
  businessName: 'Cobranzas Pérez',
  firstName: 'Sara',
  lastName: 'Pérez',
  email: 'sara@ejemplo.com',
  password: 'Kobrax123!',
  ...over,
});

describe('validateSignup', () => {
  it('acepta un registro completo', () => {
    expect(validateSignup(signup())).toBeNull();
  });

  it('exige negocio, nombre y apellido', () => {
    expect(validateSignup(signup({ businessName: ' ' }))).toMatch(/negocio/);
    expect(validateSignup(signup({ firstName: '' }))).toMatch(/nombre/);
    expect(validateSignup(signup({ lastName: '  ' }))).toMatch(/apellido/);
  });

  it('rechaza correos sin forma de correo', () => {
    for (const email of ['sara', 'sara@', 'sara@ejemplo', 'a b@c.com']) {
      expect(validateSignup(signup({ email }))).toMatch(/[Cc]orreo/);
    }
  });

  // La política es la de shared: acá sólo se comprueba que se está usando, no se re-testea.
  it('rechaza contraseñas que no cumplen la política', () => {
    for (const password of ['kobrax123!', 'Kobraxxx!', 'Kobrax1234', 'Kbx1!']) {
      expect(validateSignup(signup({ password }))).toMatch(/contraseña/);
    }
  });
});

describe('COUNTRY_OPTIONS', () => {
  it('sale de SUPPORTED_CURRENCIES: 6 países, uno por moneda', () => {
    expect(COUNTRY_OPTIONS).toHaveLength(6);
    expect(COUNTRY_OPTIONS.map((c) => c.code).sort()).toEqual(['AR', 'BO', 'CO', 'MX', 'PE', 'US']);
  });

  it('cada país trae su moneda acoplada (S1-D1: no se pueden combinar mal)', () => {
    expect(findCountry('BO')).toMatchObject({ currency: 'BOB' });
    expect(findCountry('MX')).toMatchObject({ currency: 'MXN' });
    expect(findCountry('XX')).toBeUndefined();
  });
});

describe('validateAccount', () => {
  it('acepta lo válido', () => {
    expect(validateAccount(account())).toBeNull();
  });

  it('exige nombre de negocio', () => {
    expect(validateAccount(account({ businessName: ' ' }))).toMatch(/obligatorio/);
  });

  it('rechaza un país fuera de los soportados', () => {
    expect(validateAccount(account({ countryCode: 'BR' }))).toMatch(/país/);
  });

  it('deja el NIT vacío (es opcional)', () => {
    expect(validateAccount(account({ taxId: '' }))).toBeNull();
  });
});

describe('validateProfile', () => {
  it('acepta lo válido y el teléfono vacío', () => {
    expect(validateProfile(profile())).toBeNull();
    expect(validateProfile(profile({ phone: '' }))).toBeNull();
  });

  it('exige nombre y apellido', () => {
    expect(validateProfile(profile({ firstName: '' }))).toMatch(/nombre/i);
    expect(validateProfile(profile({ lastName: '  ' }))).toMatch(/apellido/i);
  });

  it('rechaza un teléfono con letras', () => {
    expect(validateProfile(profile({ phone: 'no-es-un-tel' }))).toMatch(/inválido/i);
  });
});

describe('diff — sólo lo que cambió', () => {
  it('sin cambios devuelve vacío: guardar no dispara ni una llamada', () => {
    const patch = diffAccount(account(), account());
    expect(patch).toEqual({});
    expect(hasChanges(patch)).toBe(false);
  });

  it('manda sólo el campo tocado, nunca el objeto entero (evita el 400)', () => {
    const patch = diffAccount(account(), account({ businessName: 'Nuevo' }));
    expect(patch).toEqual({ businessName: 'Nuevo' });
    expect('planCode' in patch).toBe(false);
    expect('maxUsers' in patch).toBe(false);
  });

  it('país y moneda viajan juntos cuando se cambia el selector', () => {
    const patch = diffAccount(account(), account({ countryCode: 'PE', currencyCode: 'PEN' }));
    expect(patch).toEqual({ countryCode: 'PE', currencyCode: 'PEN' });
  });

  it('recorta los espacios y no reporta un cambio que sólo era espaciado', () => {
    expect(diffAccount(account(), account({ businessName: '  Cobranzas Pérez  ' }))).toEqual({});
    expect(diffProfile(profile(), profile({ firstName: ' Ana ' }))).toEqual({});
  });

  it('vaciar un campo opcional lo QUITA: viaja como null, no como cadena vacía', () => {
    // Cambio de comportamiento deliberado (F9 · W2, code-review). Los campos opcionales de la
    // API son `@IsOptional() @Length(1, n)`: `@IsOptional` saltea null, pero `''` choca contra
    // el `@Length` y rechaza el PATCH entero. Con `''` no había forma de borrar un teléfono.
    expect(diffProfile(profile(), profile({ phone: '' }))).toEqual({ phone: null });
    expect(diffAccount(account(), account({ taxId: '' }))).toEqual({ taxId: null });
  });
});

describe('validateInvite (S2)', () => {
  it('acepta una invitacion completa', () => {
    expect(validateInvite(invite())).toBeNull();
  });

  it('exige nombre y apellido: la lista muestra a la persona, no un correo suelto', () => {
    expect(validateInvite(invite({ firstName: '  ' }))).toMatch(/nombre/i);
    expect(validateInvite(invite({ lastName: '' }))).toMatch(/apellido/i);
  });

  it('rechaza un correo mal escrito antes de quemar un asiento del plan', () => {
    expect(validateInvite(invite({ email: 'rosa@' }))).toMatch(/correo/i);
  });

  it('exige elegir el rol: sin roleId el server responde 400', () => {
    expect(validateInvite(invite({ roleId: '' }))).toMatch(/equipo/i);
  });
});

describe('roleOptions (S2)', () => {
  it('traduce el roleName crudo del server a la etiqueta de shared', () => {
    const [admin, collector] = roleOptions([
      { id: 'r1', name: 'ACCOUNT_ADMIN' },
      { id: 'r2', name: 'COLLECTOR' },
    ]);
    expect(admin).toEqual({ key: 'r1', label: 'Administrador', hint: expect.any(String) });
    expect(collector!.label).toBe('Cobrador');
  });

  it('no rompe con un rol de la web (el server no lo manda, pero no se asume)', () => {
    const [manager] = roleOptions([{ id: 'r3', name: 'MANAGER' }]);
    expect(manager!.label).toBe('Gerente');
    expect(manager!.hint).toBeUndefined();
  });
});
