import { describe, it, expect } from 'vitest';
import { CreditDefinition, PaymentFrequency, type CreditDetail, type CreditTerms } from '@kobrax/shared';
import { creditDraft, creditPatch, hasCreditChanges, type CreditDraft } from './credit-patch';

const TERMS: CreditTerms = {
  definition: CreditDefinition.AGREED_INSTALLMENT,
  principal: 3000,
  installmentAmount: 300,
  installmentsCount: 12,
  frequency: PaymentFrequency.MONTHLY,
  firstDueDate: '2026-09-15',
};

const CREDIT: CreditDetail = {
  id: 'cr-1',
  code: 'BLK-000001',
  principalAmount: 3000,
  interestRate: 0,
  currency: 'BOB',
  outstandingBalance: 3600,
  installmentAmount: 300,
  installmentsCount: 12,
  frequency: PaymentFrequency.MONTHLY,
  nextDueDate: '2026-09-15',
  notes: 'Cobrar en el puesto',
  status: 'ACTIVE',
  terms: TERMS,
};

const TODAY = '2026-09-01';

/** El borrador tal como se abrió, con los cambios encima. */
function edit(
  credit: CreditDetail,
  change: { form?: Partial<CreditDraft['form']>; initial?: Partial<CreditDraft['initial']>; extras?: Partial<CreditDraft['extras']> },
  redefinable = true,
) {
  const opened = creditDraft(credit, TODAY);
  const draft: CreditDraft = {
    form: { ...opened.form, ...change.form },
    initial: { ...opened.initial, ...change.initial },
    extras: { ...opened.extras, ...change.extras },
  };
  return creditPatch(credit, opened, draft, redefinable);
}

describe('creditPatch', () => {
  it('abrir la ficha y guardar sin tocar nada no manda nada', () => {
    const patch = edit(CREDIT, {});
    expect(patch).toEqual({});
    expect(hasCreditChanges(patch)).toBe(false);
  });

  it('cambiar una condición manda las condiciones completas, no el campo suelto', () => {
    expect(edit(CREDIT, { form: { installmentAmount: '320' } })).toEqual({ terms: { ...TERMS, installmentAmount: 320 } });
  });

  it('el estado al registrar viaja entero cuando cambia', () => {
    expect(edit(CREDIT, { initial: { paidInstallments: '2' } })).toEqual({ initialState: { paidInstallments: 2, daysPastDue: 0 } });
    expect(edit(CREDIT, { initial: { outstandingBalance: '3000', daysPastDue: '10' } })).toEqual({
      initialState: { paidInstallments: 0, outstandingBalance: 3000, daysPastDue: 10 },
    });
  });

  /**
   * 🔴 Un crédito anterior a F4/06 se abre como «cuota acordada». Guardar sólo una nota no puede
   * redefinirlo: con pagos, la API lo rechazaría por algo que nadie tocó.
   */
  it('crédito sin condiciones: guardar una nota no lo redefine', () => {
    const legacy = { ...CREDIT, terms: undefined };
    expect(edit(legacy, { form: { notes: 'otra' } })).toEqual({ notes: 'otra' });
    expect(edit(legacy, { form: { installmentAmount: '320' } })).toEqual({
      terms: { ...TERMS, installmentAmount: 320 },
    });
  });

  it('sin poder redefinir (con pagos): condiciones y estado no viajan, el próximo cobro sí', () => {
    const patch = edit(CREDIT, { form: { installmentAmount: '320' }, initial: { paidInstallments: '2' }, extras: { nextDueDate: '2026-10-01' } }, false);
    expect(patch).toEqual({ nextDueDate: '2026-10-01' });
  });

  it('al redefinir, el próximo cobro no viaja aparte: lo deriva la API', () => {
    const patch = edit(CREDIT, { form: { installmentAmount: '320' }, extras: { nextDueDate: '2026-10-01' } });
    expect(patch.nextDueDate).toBeUndefined();
  });

  it('vaciar la fecha no manda una fecha vacía, que la API rechazaría', () => {
    expect(edit(CREDIT, { extras: { nextDueDate: '' } }, false)).toEqual({});
  });

  // Una nota SÍ se puede vaciar: es texto, no plata.
  it('vaciar la nota sí viaja', () => {
    expect(edit(CREDIT, { form: { notes: '' } })).toEqual({ notes: '' });
  });

  it('estado, código, tipo y responsable viajan cuando cambian', () => {
    expect(edit(CREDIT, { extras: { status: 'DEFAULTED' } })).toEqual({ status: 'DEFAULTED' });
    expect(edit(CREDIT, { extras: { code: 'BLK-000002' } })).toEqual({ code: 'BLK-000002' });
    expect(edit(CREDIT, { extras: { typeCode: 'CONSUMO' } })).toEqual({ typeCode: 'CONSUMO' });
  });

  /** 🔴 `null` borra; `''` dejaría un código de cero caracteres, que no es lo mismo que sin código. */
  it('dejar el código o el tipo en blanco manda null, no una cadena vacía', () => {
    expect(edit(CREDIT, { extras: { code: '' } })).toEqual({ code: null });
    expect(edit({ ...CREDIT, typeCode: 'CONSUMO' }, { extras: { typeCode: '' } })).toEqual({ typeCode: null });
  });

  /** «Sin asignar» es un `''`, y la API pide un uuid: desasignar no se puede desde acá y no se finge. */
  it('dejar el responsable en «sin asignar» no manda un uuid vacío', () => {
    const conDueño = { ...CREDIT, assignedManagerId: '8f97c34e-a481-4f17-b567-796cf1de8866' };
    expect(edit(conDueño, { extras: { assignedManagerId: '' } })).toEqual({});
  });
});
