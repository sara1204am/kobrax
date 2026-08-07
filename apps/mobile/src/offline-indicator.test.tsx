/**
 * El banner de estado. Se testea aparte de `ui.test.tsx` porque necesita mover el store por caso,
 * y el de allá lo fija en "conectado, sin pendientes" para el resto de los componentes.
 */
const mockNet = { isConnected: true, pendingCount: 0 };
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel(mockNet) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { fireEvent, render } from '@testing-library/react-native';
import { OfflineIndicator } from './ui';

beforeEach(() => {
  mockNet.isConnected = true;
  mockNet.pendingCount = 0;
});

describe('OfflineIndicator', () => {
  it('con red y sin pendientes no ocupa lugar', () => {
    const { toJSON } = render(<OfflineIndicator />);
    expect(toJSON()).toBeNull();
  });

  it('sin red lo dice', () => {
    mockNet.isConnected = false;
    const { getByText } = render(<OfflineIndicator />);
    expect(getByText(/Sin conexión/)).toBeTruthy();
  });

  // El caso contraintuitivo: hay señal, pero algo que el cobrador dio por hecho sigue en el
  // teléfono. Si el banner sólo apareciera sin red, eso quedaría invisible.
  it('CON red pero con cola pendiente igual se muestra', () => {
    mockNet.pendingCount = 3;
    const { getByText } = render(<OfflineIndicator />);
    expect(getByText(/Subiendo · 3 pendientes/)).toBeTruthy();
  });

  it('sin red suma el contador al aviso', () => {
    mockNet.isConnected = false;
    mockNet.pendingCount = 1;
    const { getByText } = render(<OfflineIndicator />);
    expect(getByText(/1 pendiente de sync/)).toBeTruthy();
  });

  it('con pendientes se puede abrir para ver qué son', () => {
    mockNet.pendingCount = 2;
    const onPress = jest.fn();
    const { getByRole } = render(<OfflineIndicator onPressPending={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  // Sin cola no hay nada que listar: el banner de "sin conexión" solo no lleva a ninguna parte.
  it('sin pendientes no es pulsable aunque le pasen el handler', () => {
    mockNet.isConnected = false;
    const onPress = jest.fn();
    const { getByRole } = render(<OfflineIndicator onPressPending={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
