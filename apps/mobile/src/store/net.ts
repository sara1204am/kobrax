/**
 * Store de conectividad (fuente única). Zustand + NetInfo.
 * `pendingCount` = acciones encoladas sin sincronizar. Lo escribe el `sync.service` (P6) y lo
 * lee el `OfflineIndicator`.
 */
import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

interface NetState {
  isConnected: boolean;
  pendingCount: number;
  setConnected: (v: boolean) => void;
  setPending: (n: number) => void;
}

export const useNetStore = create<NetState>((set) => ({
  isConnected: true, // optimista hasta el primer evento de NetInfo
  pendingCount: 0,
  setConnected: (v) => set({ isConnected: v }),
  setPending: (n) => set({ pendingCount: n }),
}));

/**
 * Suscribe el store a NetInfo. Se llama una vez al montar el shell de tabs.
 * Devuelve el unsubscribe. `isInternetReachable` puede ser null (desconocido) →
 * solo marcamos sin conexión cuando es explícitamente false.
 */
export function subscribeConnectivity(): () => void {
  return NetInfo.addEventListener((state) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    useNetStore.getState().setConnected(online);
  });
}
