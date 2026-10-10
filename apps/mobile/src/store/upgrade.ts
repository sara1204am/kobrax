/**
 * Store de «hay que actualizar la app» (426 `APP_001`, ver `AppVersionGuard` en la API).
 *
 * Lo escribe `api.ts` en UN solo punto —cualquier respuesta 426— y lo lee `UpgradeGate`, montado en la raíz.
 * No es un error de la acción que estaba en curso: es el estado de toda la app, así que vive acá y no en cada pantalla.
 *
 * 🔴 Nada de la cola se pierde por esto: un 426 no es un rechazo (ver `isPermanentRejection`); el drenaje se detiene y
 * lo pendiente espera a que el cobrador actualice.
 */
import { create } from 'zustand';

interface UpgradeState {
  required: boolean;
  /** El texto del servidor («Tu versión de la app ya no es compatible…»), o `null` para el mensaje por defecto. */
  message: string | null;
  mark: (message?: string | null) => void;
  clear: () => void;
}

export const useUpgradeStore = create<UpgradeState>((set) => ({
  required: false,
  message: null,
  mark: (message) => set({ required: true, message: message ?? null }),
  clear: () => set({ required: false, message: null }),
}));

/** `true` si una respuesta HTTP es el corte de versión mínima. */
export function isUpgradeRequired(httpStatus: number | undefined): boolean {
  return httpStatus === 426;
}
