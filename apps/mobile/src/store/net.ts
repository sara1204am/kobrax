/**
 * Store de conectividad (fuente única). Zustand + NetInfo.
 * `pendingCount` = acciones encoladas sin sincronizar; **0 fijo en P0** (la cola real
 * llega con el SyncService en P6, que hará `setPending`). El `OfflineIndicator` lo lee.
 */
import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

interface NetState {
  isConnected: boolean;
  pendingCount: number;
  setConnected: (v: boolean) => void;
}

export const useNetStore = create<NetState>((set) => ({
  isConnected: true, // optimista hasta el primer evento de NetInfo
  pendingCount: 0, // 0 fijo en P0; el setter lo agrega el SyncService en P6
  setConnected: (v) => set({ isConnected: v }),
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
