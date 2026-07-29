import {
  COUNTRY_OPTIONS,
  diffAccount,
  diffProfile,
  findCountry,
  hasChanges,
  validateAccount,
  validateProfile,
  type AccountForm,
  type ProfileForm,
} from './account-form';

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

  it('permite vaciar un campo opcional', () => {
    expect(diffProfile(profile(), profile({ phone: '' }))).toEqual({ phone: '' });
  });
});
