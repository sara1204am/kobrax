import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/panel-ui';
import { RENEWED_COOKIE } from '@/lib/bff';

/**
 * «No tienes acceso a esta pantalla». Uno solo para todo el panel: mismo texto, mismo tono, y sin pistas de cómo entrar
 * (quien llegó escribiendo la URL no necesita que le digamos qué permiso le falta).
 *
 * Si la sesión se acaba de renovar porque sus permisos cambiaron (`AUTHZ_STALE`, F1), el aviso lo dice: la pantalla que
 * tenía abierta ya no le corresponde y no es un error suyo.
 */
export async function NoAccess({ text }: { text?: string }) {
  const t = await getTranslations('panel.noAccess');
  let changed = false;
  try {
    changed = Boolean(cookies().get(RENEWED_COOKIE));
  } catch {
    // fuera de un pedido (un test): sin aviso
  }
  return changed ? <EmptyState title={t('changedTitle')} text={t('changedText')} /> : <EmptyState title={t('title')} text={text ?? t('text')} />;
}
