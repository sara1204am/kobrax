jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

import NetInfo from '@react-native-community/netinfo';
import { subscribeConnectivity, useNetStore } from './net';

const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useNetStore.setState({ isConnected: true, pendingCount: 0 });
});

describe('useNetStore', () => {
  it('setConnected actualiza el estado', () => {
    useNetStore.getState().setConnected(false);
    expect(useNetStore.getState().isConnected).toBe(false);
  });
});

describe('subscribeConnectivity — derivación de NetInfo', () => {
  function emit(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
    subscribeConnectivity();
    const listener = mockAddEventListener.mock.calls[0][0];
    listener(state);
    return useNetStore.getState().isConnected;
  }

  it('conectado y con internet → online', () => {
    expect(emit({ isConnected: true, isInternetReachable: true })).toBe(true);
  });

  it('sin conexión → offline', () => {
    expect(emit({ isConnected: false, isInternetReachable: null })).toBe(false);
  });

  it('internet explícitamente inalcanzable → offline', () => {
    expect(emit({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it('reachability desconocida (null) → se considera online (optimista)', () => {
    expect(emit({ isConnected: true, isInternetReachable: null })).toBe(true);
  });
});
