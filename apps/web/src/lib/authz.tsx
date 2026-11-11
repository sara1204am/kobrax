import { cache, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { decideAccess, type PermissionNeed } from '@/lib/authz-check';
import { NoAccess } from '@/components/no-access';
import { RetryState } from '@/components/retry-state';

/**
 * La identidad de la sesión, pedida **una sola vez por petición**: el layout del panel y cada pantalla que protege su
 * ruta comparten esta llamada (`cache` de React vale por render del servidor), en vez de repetir `/auth/me`.
 */
export const getMe = cache(() => apiCall<MeInfo & { sessionId?: string }>('/auth/me', { method: 'GET', auth: true }));

/**
 * La puerta de una pantalla de servidor. Devuelve `null` si puede entrar, o lo que hay que pintar en su lugar:
 * `<NoAccess/>` si no tiene el permiso, o «reintentar» si no se pudo comprobar.
 *
 *     const blocked = await requirePermission(Permission.OFFICE_READ);
 *     if (blocked) return blocked;
 *
 * 🔴 Ocultar no es autorizar: la API valida igual cada llamada de la pantalla.
 */
export async function requirePermission(need: PermissionNeed): Promise<ReactNode | null> {
  const me = await getMe();
  const decision = decideAccess({ status: me.status, permissions: me.body.data?.permissions }, need);
  if (decision === 'ok') return null;
  if (decision === 'denied') return <NoAccess />;
  const t = await getTranslations('panel.noAccess');
  return <RetryState title={t('errorTitle')} text={t('errorText')} />;
}
