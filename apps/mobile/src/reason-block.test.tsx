// ui.tsx importa el net store (NetInfo nativo) y los íconos (expo-font): acá solo importan textos y tonos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('./catalogs.service', () => ({ listCatalogCached: async () => ({ status: 'ok', total: 0, data: [] }) }));

import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CatalogOption } from './catalogs.service';
import { ReasonBlock, contextPayload, emptyReasonContext, type ReasonContext } from './reason-block';

const reason = (code: string, label: string, metadata: CatalogOption['metadata'] = null): CatalogOption => ({
  id: code,
  catalog: 'NO_PAYMENT_REASON' as CatalogOption['catalog'],
  code,
  label,
  sortOrder: 1,
  metadata,
});

const REASONS = [
  reason('JOB_LOSS', 'Perdió el empleo', { appliesTo: ['EMPLOYEE', 'OTHER'], suggestion: 'Suele tardar más en recuperarse.' }),
  reason('NO_SALES', 'Sin ventas o negocio caído', { appliesTo: ['BUSINESS'] }),
  reason('LATE_INCOME', 'Ingreso atrasado', { asksExpectedIncomeDate: true, suggestion: 'Pagará al cobrar.' }),
  reason('FORGOT', 'Olvido o descuido', {}),
];
const pretty = (iso: string) => iso;

describe('contextPayload', () => {
  const ctx = (patch: Partial<ReasonContext>): ReasonContext => ({ ...emptyReasonContext(), ...patch });

  it('🔴 sin tocar el bloque no manda nada: la gestión es la de siempre', () => {
    expect(contextPayload(ctx({}), REASONS, true)).toEqual({});
  });

  it('manda lo que se eligió', () => {
    expect(contextPayload(ctx({ reasonCode: 'LATE_INCOME', incomeDate: '2026-10-20', payerParty: 'GUARANTOR' }), REASONS, true)).toEqual({
      reasonCode: 'LATE_INCOME',
      expectedIncomeDate: '2026-10-20',
      payerParty: 'GUARANTOR',
    });
  });

  it('🔴 la fecha solo viaja con un motivo que la pide', () => {
    expect(contextPayload(ctx({ reasonCode: 'FORGOT', incomeDate: '2026-10-20' }), REASONS, true)).toEqual({ reasonCode: 'FORGOT' });
  });

  it('🔴 una nota (bloque deshabilitado) nunca lleva contexto', () => {
    expect(contextPayload(ctx({ reasonCode: 'FORGOT', payerParty: 'HOLDER' }), REASONS, false)).toEqual({});
  });

  it('quién responde puede ir sin motivo', () => {
    expect(contextPayload(ctx({ payerParty: 'NOT_LOCATED' }), REASONS, true)).toEqual({ payerParty: 'NOT_LOCATED' });
  });
});

describe('ReasonBlock', () => {
  const setup = (value = emptyReasonContext(), incomeSource?: string, reasons = REASONS) => {
    const onChange = jest.fn();
    render(<ReasonBlock reasons={reasons} incomeSource={incomeSource} value={value} onChange={onChange} prettyDate={pretty} />);
    return onChange;
  };

  it('sin catálogo no dibuja nada', () => {
    setup(emptyReasonContext(), undefined, []);
    expect(screen.queryByText('Motivo de no pago (opcional)')).toBeNull();
  });

  it('ofrece los motivos y quién responde', () => {
    setup();
    expect(screen.getByText('Perdió el empleo')).toBeTruthy();
    expect(screen.getByText('El garante')).toBeTruthy();
  });

  it('el motivo se filtra por la fuente de ingreso', () => {
    setup(emptyReasonContext(), 'BUSINESS');
    expect(screen.queryByText('Perdió el empleo')).toBeNull();
    expect(screen.getByText('Sin ventas o negocio caído')).toBeTruthy();
    expect(screen.getByText('Olvido o descuido')).toBeTruthy();
  });

  it('elegir un motivo lo devuelve y limpia la fecha anterior', () => {
    const onChange = setup({ ...emptyReasonContext(), reasonCode: 'LATE_INCOME', incomeDate: '2026-10-20' });
    fireEvent.press(screen.getByText('Olvido o descuido'));
    expect(onChange).toHaveBeenCalledWith({ reasonCode: 'FORGOT', incomeDate: '', payerParty: '' });
  });

  it('la fecha solo se pide con el motivo que la pide', () => {
    setup({ ...emptyReasonContext(), reasonCode: 'FORGOT' });
    expect(screen.queryByText('Cuándo espera cobrar')).toBeNull();
  });

  it('con «ingreso atrasado» pide la fecha y muestra la sugerencia', () => {
    setup({ ...emptyReasonContext(), reasonCode: 'LATE_INCOME' });
    expect(screen.getByText('Cuándo espera cobrar')).toBeTruthy();
    expect(screen.getByText('Pagará al cobrar.')).toBeTruthy();
  });

  it('elegir quién responde lo devuelve', () => {
    const onChange = setup();
    fireEvent.press(screen.getByText('El titular'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ payerParty: 'HOLDER' }));
  });
});
