// ui.tsx importa el net store (NetInfo nativo) y los íconos (expo-font): acá solo importan textos y tonos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./catalogs.service', () => ({
  listCatalogCached: async (type: string) => ({
    status: 'ok',
    total: 2,
    data:
      type === 'OCCUPATION'
        ? [
            { id: '1', catalog: 'OCCUPATION', code: 'TRANSPORT', label: 'Transportista', sortOrder: 1, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'WEEKLY' } },
            { id: '2', catalog: 'OCCUPATION', code: 'PUBLIC_SERVANT', label: 'Funcionario público', sortOrder: 2, metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY' } },
          ]
        : [
            { id: '3', catalog: 'INCOME_SOURCE', code: 'EMPLOYEE', label: 'Asalariado o profesional', sortOrder: 1, metadata: null },
            { id: '4', catalog: 'INCOME_SOURCE', code: 'BUSINESS', label: 'Comerciante o productivo', sortOrder: 2, metadata: null },
          ],
  }),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { emptyIncomeForm, type IncomeProfileForm } from '@kobrax/shared';
import { IncomeBlock, describeIncome } from './income-block';

describe('describeIncome', () => {
  it('arma una línea con el rubro y el ciclo', () => {
    expect(describeIncome({ occupationCode: 'PUBLIC_SERVANT', incomeCycle: 'QUARTERLY', incomeDay: 15 }, { occupations: new Map([['PUBLIC_SERVANT', 'Funcionario público']]) })).toBe(
      'Funcionario público · Cada tres meses (día 15)',
    );
  });

  it('en semanal dice el día de la semana', () => {
    expect(describeIncome({ occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY', incomeDay: 5 })).toBe('TRANSPORT · Cada semana (viernes)');
  });

  it('sin rubro cae a la fuente de ingreso', () => {
    expect(describeIncome({ incomeSourceCode: 'BUSINESS' })).toBe('Comerciante o productivo');
  });

  it('un cliente sin perfil no muestra nada', () => {
    expect(describeIncome(undefined)).toBe('');
    expect(describeIncome(null)).toBe('');
    expect(describeIncome({})).toBe('');
  });

  it('incluye el detalle si lo hay', () => {
    expect(describeIncome({ incomeCycle: 'IRREGULAR', notes: 'le atrasan el flete' })).toBe('Sin ritmo fijo · le atrasan el flete');
  });
});

describe('IncomeBlock', () => {
  const setup = (initial: IncomeProfileForm = emptyIncomeForm()) => {
    const onChange = jest.fn();
    render(<IncomeBlock value={initial} onChange={onChange} />);
    return onChange;
  };

  it('ofrece las fuentes y los rubros de la cuenta', async () => {
    setup();
    await waitFor(() => screen.getByText('Transportista'));
    expect(screen.getByText('Asalariado o profesional')).toBeTruthy();
  });

  it('elegir un rubro propone la fuente y el ciclo, sin obligarlos', async () => {
    const onChange = setup();
    await waitFor(() => screen.getByText('Transportista'));
    fireEvent.press(screen.getByText('Transportista'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ occupationCode: 'TRANSPORT', incomeSourceCode: 'BUSINESS', incomeCycle: 'WEEKLY' }));
  });

  it('🔴 no pisa un ciclo que la persona ya eligió', async () => {
    const onChange = setup({ ...emptyIncomeForm(), incomeCycle: 'IRREGULAR' });
    await waitFor(() => screen.getByText('Transportista'));
    fireEvent.press(screen.getByText('Transportista'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ incomeCycle: 'IRREGULAR' }));
  });

  it('el rubro se filtra por la fuente elegida', async () => {
    setup({ ...emptyIncomeForm(), incomeSourceCode: 'EMPLOYEE' });
    await waitFor(() => screen.getByText('Funcionario público'));
    expect(screen.queryByText('Transportista')).toBeNull();
  });

  it('🔴 cambiar a un ciclo sin día borra el día que ya no corresponde', () => {
    const onChange = setup({ ...emptyIncomeForm(), incomeCycle: 'MONTHLY', incomeDay: '15' });
    fireEvent.press(screen.getByText('Todos los días'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ incomeCycle: 'DAILY', incomeDay: '' }));
  });

  it('el campo de día aparece solo con un ciclo que lo tiene', () => {
    setup({ ...emptyIncomeForm(), incomeCycle: 'DAILY' });
    expect(screen.queryByText('Día del mes')).toBeNull();
  });

  it('un día fuera de rango se marca', () => {
    setup({ ...emptyIncomeForm(), incomeCycle: 'MONTHLY', incomeDay: '40' });
    expect(screen.getByText('El día no corresponde al ciclo elegido.')).toBeTruthy();
  });
});
