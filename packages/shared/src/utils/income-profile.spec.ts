import { describe, expect, it } from 'vitest';
import {
  cycleHasDay,
  emptyIncomeForm,
  hasIncomeData,
  incomeFormError,
  incomeFormFromProfile,
  incomeProfileFromForm,
  sameIncome,
  validateIncomeProfile,
} from './income-profile.js';
import { buildClientePayload, hydrateCliente, initialCliente } from './client-form.js';
import { diffCliente, hasClientChanges } from './client-diff.js';

describe('validateIncomeProfile', () => {
  it('un perfil completo es válido', () => {
    expect(validateIncomeProfile({ incomeSourceCode: 'EMPLOYEE', occupationCode: 'PUBLIC_SERVANT', incomeCycle: 'QUARTERLY', incomeDay: 15, notes: 'Cobra cada 3 meses', origin: 'MANUAL' })).toBeNull();
  });
  it('uno vacío también: todo es opcional', () => expect(validateIncomeProfile({})).toBeNull());
  it('no acepta lo que no es un objeto', () => {
    for (const v of [null, 'x', 5, []]) expect(validateIncomeProfile(v)).toBe('NOT_OBJECT');
  });
  it('🔴 rechaza campos desconocidos', () => expect(validateIncomeProfile({ sueldo: 5000 })).toBe('UNKNOWN_FIELD'));

  it('🔴 la fuente de ingreso es del conjunto fijo: filtra qué motivos se ofrecen', () => {
    expect(validateIncomeProfile({ incomeSourceCode: 'JEFE' })).toBe('SOURCE_INVALID');
    for (const s of ['EMPLOYEE', 'BUSINESS', 'OTHER']) expect(validateIncomeProfile({ incomeSourceCode: s })).toBeNull();
  });

  it('el rubro es un código; no se verifica que exista en el catálogo (la cuenta pudo editarlo)', () => {
    expect(validateIncomeProfile({ occupationCode: 'transportista' })).toBe('OCCUPATION_INVALID');
    expect(validateIncomeProfile({ occupationCode: '' })).toBe('OCCUPATION_INVALID');
    expect(validateIncomeProfile({ occupationCode: 'RUBRO_QUE_YA_NO_EXISTE' })).toBeNull();
  });

  it('el ciclo es uno de los conocidos', () => {
    expect(validateIncomeProfile({ incomeCycle: 'CADA_LUNA' })).toBe('CYCLE_INVALID');
    for (const c of ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEASONAL', 'IRREGULAR']) expect(validateIncomeProfile({ incomeCycle: c })).toBeNull();
  });

  it('🔴 el día solo existe con un ciclo que lo tenga', () => {
    expect(validateIncomeProfile({ incomeDay: 5 })).toBe('DAY_NOT_ALLOWED'); // sin ciclo
    expect(validateIncomeProfile({ incomeCycle: 'DAILY', incomeDay: 5 })).toBe('DAY_NOT_ALLOWED');
    expect(validateIncomeProfile({ incomeCycle: 'SEASONAL', incomeDay: 5 })).toBe('DAY_NOT_ALLOWED');
    expect(validateIncomeProfile({ incomeCycle: 'BIWEEKLY', incomeDay: 5 })).toBe('DAY_NOT_ALLOWED');
  });

  it('semanal: 1 a 7; mensual y trimestral: 1 a 31', () => {
    expect(validateIncomeProfile({ incomeCycle: 'WEEKLY', incomeDay: 8 })).toBe('DAY_INVALID');
    expect(validateIncomeProfile({ incomeCycle: 'WEEKLY', incomeDay: 5 })).toBeNull();
    expect(validateIncomeProfile({ incomeCycle: 'MONTHLY', incomeDay: 32 })).toBe('DAY_INVALID');
    expect(validateIncomeProfile({ incomeCycle: 'MONTHLY', incomeDay: 0 })).toBe('DAY_INVALID');
    expect(validateIncomeProfile({ incomeCycle: 'QUARTERLY', incomeDay: 31 })).toBeNull();
    expect(validateIncomeProfile({ incomeCycle: 'MONTHLY', incomeDay: 1.5 })).toBe('DAY_INVALID');
  });

  it('la nota y el origen tienen sus límites', () => {
    expect(validateIncomeProfile({ notes: 'x'.repeat(281) })).toBe('NOTES_INVALID');
    expect(validateIncomeProfile({ origin: 'ROBOT' })).toBe('ORIGIN_INVALID');
  });

  it('cycleHasDay lo dice para la pantalla', () => {
    expect(cycleHasDay('MONTHLY')).toBe(true);
    expect(cycleHasDay('DAILY')).toBe(false);
    expect(cycleHasDay('')).toBe(false);
    expect(cycleHasDay(undefined)).toBe(false);
  });
});

describe('formulario ↔ perfil', () => {
  it('un formulario vacío no es un perfil', () => {
    expect(hasIncomeData(emptyIncomeForm())).toBe(false);
    expect(incomeProfileFromForm(emptyIncomeForm())).toBeUndefined();
  });

  it('ida y vuelta conserva todo', () => {
    const p = { incomeSourceCode: 'EMPLOYEE' as const, occupationCode: 'PUBLIC_SERVANT', incomeCycle: 'QUARTERLY' as const, incomeDay: 15, notes: 'Alcaldía' };
    expect(incomeProfileFromForm(incomeFormFromProfile(p))).toEqual(p);
  });

  it('🔴 cambiar de mensual a diario no deja un día huérfano que el servidor rechazaría', () => {
    const f = { ...emptyIncomeForm(), incomeCycle: 'DAILY', incomeDay: '15' };
    expect(incomeProfileFromForm(f)).toEqual({ incomeCycle: 'DAILY' });
  });

  it('hidratar tolera lo que no se reconoce', () => {
    expect(incomeFormFromProfile(null)).toEqual(emptyIncomeForm());
    expect(incomeFormFromProfile('basura')).toEqual(emptyIncomeForm());
    expect(incomeFormFromProfile({ incomeCycle: 'NOPE', incomeDay: 'x', otro: 1, occupationCode: 'TRANSPORT' })).toEqual({ ...emptyIncomeForm(), occupationCode: 'TRANSPORT' });
  });

  it('el origen viaja solo si se pide', () => {
    expect(incomeProfileFromForm({ ...emptyIncomeForm(), occupationCode: 'TRANSPORT' }, 'DICTATION')).toEqual({ occupationCode: 'TRANSPORT', origin: 'DICTATION' });
  });

  it('el error del formulario marca un día fuera de rango', () => {
    expect(incomeFormError({ ...emptyIncomeForm(), incomeCycle: 'WEEKLY', incomeDay: '9' })).toBe('DAY_INVALID');
    expect(incomeFormError({ ...emptyIncomeForm(), incomeCycle: 'DAILY', incomeDay: '3' })).toBe('DAY_NOT_ALLOWED');
    expect(incomeFormError({ ...emptyIncomeForm(), incomeCycle: 'MONTHLY', incomeDay: '15' })).toBeNull();
  });

  it('🔴 tolera que falte el campo (un borrador anterior al perfil)', () => {
    expect(hasIncomeData(undefined)).toBe(false);
    expect(incomeProfileFromForm(undefined)).toBeUndefined();
    expect(sameIncome(undefined, emptyIncomeForm())).toBe(true);
    expect(incomeFormError(undefined)).toBeNull();
  });
});

describe('integración con el alta, el payload y el diff del cliente', () => {
  const server = {
    clientType: 'PERSON' as const,
    firstName: 'Ana',
    lastName: 'Quispe',
    nationalId: '123',
    status: 'ACTIVE' as const,
    incomeProfile: { incomeSourceCode: 'BUSINESS', occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY', incomeDay: 5 },
  };

  it('el alta lleva el perfil de ingreso', () => {
    const f = initialCliente();
    f.firstName = 'Ana';
    f.lastName = 'Quispe';
    f.income = { ...emptyIncomeForm(), occupationCode: 'MERCHANT', incomeCycle: 'DAILY' };
    expect(buildClientePayload(f).incomeProfile).toEqual({ occupationCode: 'MERCHANT', incomeCycle: 'DAILY' });
  });

  it('sin perfil, el alta no manda nada', () => {
    expect(buildClientePayload(initialCliente()).incomeProfile).toBeUndefined();
  });

  it('hidrata el perfil del servidor', () => {
    const f = hydrateCliente(server);
    expect(f.income).toEqual({ incomeSourceCode: 'BUSINESS', occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY', incomeDay: '5', notes: '' });
  });

  it('🔴 abrir y guardar sin tocar nada no genera cambios', () => {
    const ops = diffCliente(hydrateCliente(server), hydrateCliente(server));
    expect(ops.income).toBeUndefined();
    expect(hasClientChanges(ops)).toBe(false);
  });

  it('cambiar el rubro genera el perfil nuevo', () => {
    const before = hydrateCliente(server);
    const after = hydrateCliente(server);
    after.income.occupationCode = 'MERCHANT';
    expect(diffCliente(before, after).income).toMatchObject({ occupationCode: 'MERCHANT', incomeCycle: 'WEEKLY' });
  });

  it('🔴 vaciar el perfil que ya existía manda null (borrarlo)', () => {
    const before = hydrateCliente(server);
    const after = hydrateCliente(server);
    after.income = emptyIncomeForm();
    const ops = diffCliente(before, after);
    expect(ops.income).toBeNull();
    expect(hasClientChanges(ops)).toBe(true);
  });

  it('cargar un perfil donde no había ninguno es un cambio', () => {
    const before = hydrateCliente({ ...server, incomeProfile: null });
    const after = hydrateCliente({ ...server, incomeProfile: null });
    after.income.incomeSourceCode = 'EMPLOYEE';
    expect(diffCliente(before, after).income).toEqual({ incomeSourceCode: 'EMPLOYEE' });
  });
});
