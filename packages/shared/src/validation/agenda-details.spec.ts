import { describe, expect, it } from 'vitest';
import { AgendaItemType } from '../enums/agenda.enum.js';
import { validateAgendaDetails } from './agenda-details.js';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Extrae los errores; falla si el caso era válido (así el test dice qué pasó, no `undefined`). */
function errorsOf(type: `${AgendaItemType}`, details: unknown): string[] {
  const res = validateAgendaDetails(type, details);
  if (res.ok) throw new Error(`se esperaba inválido, pero pasó: ${JSON.stringify(res.value)}`);
  return res.errors;
}

describe('validateAgendaDetails', () => {
  it('CALL exige un contactId con forma de UUID', () => {
    const ok = validateAgendaDetails(AgendaItemType.CALL, { contactId: UUID });
    expect(ok).toEqual({ ok: true, value: { contactId: UUID } });
    expect(errorsOf(AgendaItemType.CALL, {})).toHaveLength(1);
    expect(errorsOf(AgendaItemType.CALL, { contactId: '78012345' })).toHaveLength(1);
  });

  it('WHATSAPP exige contacto y mensaje no vacío (≤ 1000)', () => {
    const res = validateAgendaDetails(AgendaItemType.WHATSAPP, { contactId: UUID, message: '  Hola  ' });
    expect(res).toEqual({ ok: true, value: { contactId: UUID, message: 'Hola' } });
    expect(errorsOf(AgendaItemType.WHATSAPP, { contactId: UUID, message: '   ' })).toEqual([
      'message: es obligatorio',
    ]);
    expect(errorsOf(AgendaItemType.WHATSAPP, { contactId: UUID, message: 'x'.repeat(1001) })).toHaveLength(1);
  });

  it('REMINDER exige descripción', () => {
    expect(validateAgendaDetails(AgendaItemType.REMINDER, { description: 'Llamar al aval' }).ok).toBe(true);
    expect(errorsOf(AgendaItemType.REMINDER, {})).toEqual(['description: es obligatorio']);
  });

  it('VISIT acepta locationId o customAddress, y rechaza si no viene ninguno', () => {
    expect(validateAgendaDetails(AgendaItemType.VISIT, { locationId: UUID }).ok).toBe(true);

    const custom = validateAgendaDetails(AgendaItemType.VISIT, {
      customAddress: { address: 'Av. Siempre Viva 742', zone: 'Norte' },
    });
    expect(custom).toEqual({
      ok: true,
      value: { customAddress: { address: 'Av. Siempre Viva 742', zone: 'Norte', reference: undefined } },
    });

    expect(errorsOf(AgendaItemType.VISIT, {})).toHaveLength(1);
    expect(errorsOf(AgendaItemType.VISIT, { customAddress: { address: '' } })).toEqual(['address: es obligatorio']);
  });

  it('PROMISE_TO_PAY exige monto > 0 de hasta 2 decimales, fecha y medio de pago', () => {
    const res = validateAgendaDetails(AgendaItemType.PROMISE_TO_PAY, {
      amount: 1500.5,
      promiseDate: '2026-08-01',
      paymentMethodCode: 'TRANSFER',
      bankCode: 'BNB',
    });
    expect(res.ok).toBe(true);

    expect(errorsOf(AgendaItemType.PROMISE_TO_PAY, { amount: 0, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' })).toEqual(
      ['amount: debe ser un monto mayor a cero'],
    );
    expect(
      errorsOf(AgendaItemType.PROMISE_TO_PAY, { amount: 10.123, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' }),
    ).toEqual(['amount: admite como máximo 2 decimales']);
    expect(
      errorsOf(AgendaItemType.PROMISE_TO_PAY, { amount: 10, promiseDate: '01/08/2026', paymentMethodCode: 'CASH' }),
    ).toHaveLength(1);
  });

  it('acumula todos los errores en vez de cortar en el primero', () => {
    expect(errorsOf(AgendaItemType.PROMISE_TO_PAY, {})).toHaveLength(3);
  });

  it('rechaza un tipo desconocido', () => {
    expect(errorsOf('SMS' as `${AgendaItemType}`, {})).toHaveLength(1);
  });
});
