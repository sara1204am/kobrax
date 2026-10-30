'use client';

import { DEFAULT_PREFERENCES, type AccountPreferences } from '@kobrax/shared';
import { useAccountBrand } from '@/components/account-brand';

/**
 * Las preferencias de trabajo de la cuenta (días y horario de la jornada, inicio de semana).
 *
 * Vienen en la marca que sembró el layout con `/auth/me`: las lee cualquier miembro, sin `account:read`. Si no llegaron
 * (un cliente viejo, o la marca no se pudo leer), valen los de fábrica: nada cambia hasta que alguien las configure.
 */
export function useWorkPreferences(): AccountPreferences {
  return useAccountBrand()?.preferences ?? DEFAULT_PREFERENCES;
}
