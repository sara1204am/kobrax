import { describe, expect, it } from 'vitest';
import { creditCodeMaskOf, creditCodePattern, DEFAULT_CREDIT_CODE_MASK, formatCreditCode, parseCreditCodeMask } from './credit-code.js';

describe('máscara del Nº de crédito', () => {
  it('formatea con ceros y texto fijo', () => {
    expect(formatCreditCode('CR-######', 1)).toBe('CR-000001');
    expect(formatCreditCode('PRE-####/A', 42)).toBe('PRE-0042/A');
    expect(formatCreditCode('####', 12345)).toBe('12345'); // no se corta
  });
  it('rechaza máscaras inválidas', () => {
    for (const m of ['', 'CR-', 'CR-##-##', '##########', 'C R-###', 'X'.repeat(25) + '###', 5, null]) expect(parseCreditCodeMask(m)).toBe(null);
  });
  it('sin configurar o inválida cae a CR-######', () => {
    expect(creditCodeMaskOf({})).toBe(DEFAULT_CREDIT_CODE_MASK);
    expect(creditCodeMaskOf(null)).toBe(DEFAULT_CREDIT_CODE_MASK);
    expect(creditCodeMaskOf({ creditCodeMask: 'xx' })).toBe(DEFAULT_CREDIT_CODE_MASK);
    expect(creditCodeMaskOf({ creditCodeMask: 'AB-####' })).toBe('AB-####');
  });
  it('el patrón SQL sólo calza los códigos de la máscara', () => {
    const re = new RegExp(creditCodePattern('CR-######'));
    expect(re.exec('CR-000012')?.[1]).toBe('000012');
    expect(re.exec('CR-12')).toBe(null);
    expect(re.exec('XX-000012')).toBe(null);
    expect(new RegExp(creditCodePattern('A.B-###')).exec('AxB-001')).toBe(null); // el punto es literal
  });
});
