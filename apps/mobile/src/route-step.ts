import { router } from 'expo-router';
import type { Step } from './auth-service';
import { routeAfterAuth } from './post-login';

/** Navegación común tras un paso del login (reutilizada por todas las pantallas). */
export function goToStep(step: Step): void {
  switch (step) {
    case 'done':
      // El destino real (offline / cambio forzado / biometría / home) lo decide routeAfterAuth.
      void routeAfterAuth();
      break;
    case 'mfa':
      router.push('/(auth)/mfa');
      break;
    case 'mfa_setup':
      router.push('/(auth)/mfa-setup');
      break;
    case 'select_account':
      router.push('/(auth)/select-account');
      break;
  }
}
