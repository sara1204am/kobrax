import { describe, it, expect } from 'vitest';
import { billingOf, EMPTY_BILLING, mergeBilling } from './account-billing.js';

describe('billingOf', () => {
  it('una cuenta sin datos de facturación los trae todos en null', () => {
    expect(billingOf({})).toEqual(EMPTY_BILLING);
    expect(billingOf(null)).toEqual(EMPTY_BILLING);
    expect(billingOf({ preferences: {} })).toEqual(EMPTY_BILLING);
  });

  it('lee lo guardado, recorta los espacios y trata lo vacío o mal tipado como no cargado', () => {
    expect(billingOf({ billing: { legalName: ' Pérez SRL ', taxId: '123', address: '', email: 5 } })).toEqual({
      legalName: 'Pérez SRL',
      taxId: '123',
      address: null,
      email: null,
    });
  });

  it('no comparte el objeto de fábrica', () => {
    const a = billingOf({});
    a.legalName = 'x';
    expect(EMPTY_BILLING.legalName).toBeNull();
  });
});

describe('mergeBilling', () => {
  const current = { legalName: 'Pérez SRL', taxId: '123', address: null, email: 'a@b.co' };

  it('pisa sólo lo que trae el parche', () => {
    expect(mergeBilling(current, { address: 'Calle 1' })).toEqual({ ...current, address: 'Calle 1' });
  });

  it('null y la cadena vacía quitan el dato', () => {
    expect(mergeBilling(current, { email: null, taxId: '  ' })).toEqual({ ...current, email: null, taxId: null });
  });

  it('un parche vacío no cambia nada', () => {
    expect(mergeBilling(current, {})).toEqual(current);
  });
});
