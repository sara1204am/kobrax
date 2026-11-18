'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { emptyWorkspace, resolveWorkspace, type ResolvedWorkspace, type Workspace } from '@kobrax/shared';

/** Sin proveedor (un test, una pantalla fuera del panel) todo se muestra: «Completo». */
const WorkspaceContext = createContext<ResolvedWorkspace>(resolveWorkspace(emptyWorkspace()));

/**
 * Siembra el espacio de trabajo que el layout del panel ya trajo de `/auth/me`. No pide nada a la API: si lo hiciera,
 * sería la segunda vez en el mismo render (F15, plan §5: «sin llamada extra»). Un cliente viejo o una respuesta sin
 * `workspace` es «Completo».
 */
export function WorkspaceProvider({ workspace, children }: { workspace?: Workspace | null; children: ReactNode }) {
  const value = useMemo(() => resolveWorkspace(workspace ?? emptyWorkspace()), [workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * Qué muestra esta organización: `showsModule`, `shows(opción)`, `fixed(opción)`, `choices(opción)`.
 *
 * 🔴 **Ocultar no es autorizar.** Esto solo decide qué se dibuja; quien autoriza es la API, que valida el permiso en cada
 * request aunque la pantalla no exista en el menú. Y el workspace solo QUITA: nunca muestra algo que el permiso no da.
 */
export function useWorkspace(): ResolvedWorkspace {
  return useContext(WorkspaceContext);
}
