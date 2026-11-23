import { describe, expect, it } from 'vitest';
import { emptyCollateral, emptyContact, emptyLocation, initialCliente } from '@kobrax/shared';
import { missingClientFields } from './client-missing';

const phone = (value: string) => ({ ...emptyContact('c1'), contactType: 'PHONE' as const, value });

describe('missingClientFields (alta del panel)', () => {
  it('un formulario vacío pide documento, nombre, apellido y teléfono', () => {
    expect(missingClientFields(initialCliente())).toEqual(['document', 'firstName', 'lastName', 'phone']);
  });
  it('con todo completo no falta nada', () => {
    const f = { ...initialCliente(), nationalId: '123', firstName: 'Ana', lastName: 'Paz', contacts: [phone('70000000')] };
    expect(missingClientFields(f)).toEqual([]);
  });
  it('una empresa pide razón social en vez de nombre y apellido', () => {
    const f = { ...initialCliente(), clientType: 'COMPANY' as const, nationalId: '9', businessName: '', contacts: [phone('7000')] };
    expect(missingClientFields(f)).toEqual(['businessName']);
  });
  it('un correo no cuenta como teléfono', () => {
    const f = { ...initialCliente(), nationalId: '1', firstName: 'Ana', lastName: 'Paz', contacts: [{ ...phone('a@b.com'), contactType: 'EMAIL' as const }] };
    expect(missingClientFields(f)).toEqual(['phone']);
  });

  const ok = { ...initialCliente(), nationalId: '1', firstName: 'Ana', lastName: 'Paz', contacts: [phone('70000000')] };

  it('una dirección agregada sin calle, o un segundo teléfono en blanco, se marcan', () => {
    expect(missingClientFields({ ...ok, locations: [emptyLocation('l1')] })).toEqual(['locationAddress']);
    expect(missingClientFields({ ...ok, contacts: [phone('70000000'), phone('')] })).toEqual(['contactEmpty']);
    expect(missingClientFields({ ...ok, locations: [{ ...emptyLocation('l1'), address: 'Av. Siempre Viva 1' }] })).toEqual([]);
  });

  it('una garantía agregada pide tipo y valor; sin descripción vale', () => {
    expect(missingClientFields({ ...ok, collaterals: [{ ...emptyCollateral('g1'), type: 'VEHICLE' }] })).toEqual(['collateral']);
    expect(missingClientFields({ ...ok, collaterals: [{ ...emptyCollateral('g1'), type: 'VEHICLE', estimatedValue: '900' }] })).toEqual([]);
    expect(missingClientFields({ ...ok, collaterals: [emptyCollateral('g1')] })).toEqual([]); // vacía del todo: se descarta
  });
});
