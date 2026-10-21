'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AccountBrand } from '@kobrax/shared';

const BrandContext = createContext<AccountBrand | null>(null);

/**
 * La marca del negocio activo (nombre, teléfono, logo), sembrada por el layout del panel con lo que ya trajo
 * `/auth/me`. La puede leer cualquier miembro: no depende de `account:read`, que un cobrador no tiene.
 */
export function AccountBrandProvider({ brand, children }: { brand: AccountBrand | null; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useAccountBrand(): AccountBrand | null {
  return useContext(BrandContext);
}
