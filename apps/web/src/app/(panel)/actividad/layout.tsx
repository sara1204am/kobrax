import type { ReactNode } from 'react';
import { requireModuleVisible } from '@/lib/workspace-guard';

/**
 * F15 · P2: la puerta del módulo. Si la organización lo ocultó, vuelve a Inicio con un aviso (`?oculto=activity`). Se monta al
 * ENTRAR al módulo desde otro, así que cubre también la navegación suave. 🔴 Ocultar no es autorizar: la API valida igual.
 */
export default async function ActividadLayout({ children }: { children: ReactNode }) {
  await requireModuleVisible('activity');
  return <>{children}</>;
}
