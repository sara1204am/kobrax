import { describe, it, expect } from 'vitest';
import { InterestBase, PaymentFrequency, hydratePrestamo, type CreditDetail, type PrestamoForm } from '@kobrax/shared';
import { creditExtras, creditPatch, hasCreditChanges, type CreditExtras } from './credit-patch';

const CREDIT: CreditDetail = {
  id: 'cr-1',
  code: 'BLK-000001',
  principalAmount: 3000,
  interestRate: 0,
  currency: 'BOB',
  outstandingBalance: 1800,
  installmentAmount: 300,
  installmentsCount: 12,
  frequency: PaymentFrequency.MONTHLY,
  nextDueDate: '2026-09-15',
  notes: 'Cobrar en el puesto',
  status: 'ACTIVE',
};

const formOf = (over: Partial<PrestamoForm> = {}): PrestamoForm => ({ ...hydratePrestamo(CREDIT), ...over });
const extrasOf = (over: Partial<CreditExtras> = {}): CreditExtras => ({ ...creditExtras(CREDIT), ...over });
const patchOf = (form: Partial<PrestamoForm> = {}, extras: Partial<CreditExtras> = {}) =>
  creditPatch(CREDIT, formOf(form), extrasOf(extras));

describe('creditPatch', () => {
  it('abrir la ficha y guardar sin tocar nada no manda nada', () => {
    const patch = patchOf();
    expect(patch).toEqual({});
    expect(hasCreditChanges(patch)).toBe(false);
  });

  it('manda el campo tocado y NADA más', () => {
    expect(patchOf({ installment: '350' })).toEqual({ installmentAmount: 350 });
    expect(patchOf({ nextDueDate: '2026-10-15' })).toEqual({ nextDueDate: '2026-10-15' });
    expect(patchOf({ principal: '3500' })).toEqual({ principalAmount: 3500 });
  });

  /**
   * 🔴 El capital y la tasa se dibujaban de SÓLO LECTURA con un comentario que decía que la API no
   * los aceptaba. `UpdateCreditDto` los acepta desde siempre: un préstamo con el capital mal tipeado
   * no tenía arreglo desde ninguna pantalla.
   */
  it('el capital viaja: no es de sólo lectura', () => {
    expect(patchOf({ principal: '4000' }).principalAmount).toBe(4000);
  });

  /**
   * El borde que decide solo: la cuota es plata congelada —es cómo se cobra este crédito—, no un
   * campo opcional. Un input en blanco es alguien que lo limpió para reescribirlo, no alguien
   * pidiendo que el préstamo deje de tener cuota.
   */
  it('vaciar la cuota NO la borra', () => {
    expect(patchOf({ installment: '' })).toEqual({});
    expect(patchOf({ installment: '   ' })).toEqual({});
  });

  it('vaciar la fecha tampoco manda una fecha vacía, que la API rechazaría', () => {
    expect(patchOf({ nextDueDate: '' })).toEqual({});
  });

  // Una nota SÍ se puede vaciar: es texto, no plata.
  it('vaciar la nota sí viaja', () => {
    expect(patchOf({ notes: '' })).toEqual({ notes: '' });
  });

  it('un texto que no es número no viaja como cero', () => {
    expect(patchOf({ installment: 'trescientos' })).toEqual({});
    expect(patchOf({ principal: 'tres mil' })).toEqual({});
  });

  it('poner cuota donde no había la manda', () => {
    const sinCuota = { ...CREDIT, installmentAmount: undefined };
    const form = { ...hydratePrestamo(sinCuota), installment: '300' };
    expect(creditPatch(sinCuota, form, creditExtras(sinCuota))).toEqual({ installmentAmount: 300 });
  });

  /**
   * 🔴 **En modo A la tasa NO viaja.** El campo ni se dibuja: mandar el valor hidratado convertiría
   * cada guardado de una nota en un `UPDATE` de la tasa del préstamo.
   */
  it('la tasa sólo viaja si se está cotizando por interés (modo B)', () => {
    expect(patchOf({ interestPercent: '5' })).toEqual({}); // modo A: se ignora
    const enB = patchOf({ mode: 'B', interestPercent: '5', base: InterestBase.PER_PERIOD, installmentEdited: true });
    expect(enB.interestRate).toBe(5);
  });

  /**
   * 🔴 **La cuota sale de `currentInstallment`, no del input.** En modo B el campo muestra la cuota
   * calculada sin que nadie la haya tipeado: leer el input crudo dejaría el préstamo recotizado en
   * el panel y sin recotizar en la base.
   */
  it('recotizar en modo B manda la cuota CALCULADA, no la vieja del input', () => {
    // 3000 al 10% por período, 12 cuotas → la cuota deja de ser 300.
    const patch = patchOf({ mode: 'B', interestPercent: '10' });
    expect(patch.installmentAmount).toBeGreaterThan(300);
    expect(patch.interestRate).toBe(10);
  });

  it('estado, código, tipo y responsable viajan cuando cambian', () => {
    expect(patchOf({}, { status: 'DEFAULTED' })).toEqual({ status: 'DEFAULTED' });
    expect(patchOf({}, { code: 'BLK-000002' })).toEqual({ code: 'BLK-000002' });
    expect(patchOf({}, { typeCode: 'CONSUMO' })).toEqual({ typeCode: 'CONSUMO' });
  });

  /** 🔴 `null` borra; `''` dejaría un código de cero caracteres, que no es lo mismo que sin código. */
  it('dejar el código en blanco manda null, no una cadena vacía', () => {
    expect(patchOf({}, { code: '' })).toEqual({ code: null });
    const conTipo = { ...CREDIT, typeCode: 'CONSUMO' };
    const patch = creditPatch(conTipo, hydratePrestamo(conTipo), { ...creditExtras(conTipo), typeCode: '' });
    expect(patch).toEqual({ typeCode: null });
  });

  /** «Sin asignar» es un `''`, y la API pide un uuid: desasignar no se puede desde acá y no se finge. */
  it('dejar el responsable en «sin asignar» no manda un uuid vacío', () => {
    const conDueño = { ...CREDIT, assignedManagerId: '8f97c34e-a481-4f17-b567-796cf1de8866' };
    const patch = creditPatch(conDueño, hydratePrestamo(conDueño), { ...creditExtras(conDueño), assignedManagerId: '' });
    expect(patch).toEqual({});
  });
});
