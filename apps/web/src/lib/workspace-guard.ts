import { redirect } from 'next/navigation';
import { resolveWorkspace, type WorkspaceModuleKey } from '@kobrax/shared';
import { getMe } from '@/lib/authz';

/**
 * La puerta de un módulo que la organización puede ocultar (F15 · P2). Va en el `layout.tsx` de cada módulo: entrar a
 * `/rutas` desde otro módulo monta ese layout de nuevo, así que la comprobación corre también en la navegación suave.
 * Un layout NO se vuelve a ejecutar entre las rutas hijas de un mismo segmento, y no hace falta: la puerta se cruza al entrar.
 *
 * Si el módulo está oculto, vuelve a Inicio con `?oculto=<módulo>` y un aviso. Si no se pudo leer la identidad no bloquea:
 * de eso se ocupa el layout del panel (reintentar o ir al login).
 *
 * 🔴 Ocultar no es autorizar, y esto tampoco: es cosmética de navegación. La API valida igual cada llamada.
 */
export async function requireModuleVisible(key: WorkspaceModuleKey): Promise<void> {
  const me = await getMe();
  const workspace = me.body.data?.account?.workspace;
  if (workspace && !resolveWorkspace(workspace).showsModule(key)) redirect(`/dashboard?oculto=${key}`);
}
