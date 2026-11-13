import { emptyWorkspace, resolveWorkspace, type ResolvedWorkspace, type Workspace } from '@kobrax/shared';

/**
 * El workspace de una identidad (`/auth/me`) ya resuelto, para una pantalla de servidor. Un cliente viejo, una cuenta que nunca
 * lo configuró o una respuesta sin `account` es «Completo»: todo se muestra. (En componentes de cliente: `useWorkspace()`.)
 *
 * 🔴 Ocultar no es autorizar: esto solo decide qué se dibuja.
 */
export function workspaceOfMe(me: { account?: { workspace?: Workspace | null } | null } | null | undefined): ResolvedWorkspace {
  return resolveWorkspace(me?.account?.workspace ?? emptyWorkspace());
}
