import { Permission } from '@kobrax/shared';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getMe, requirePermission } from '@/lib/authz';
import { EmptyState, PageHeader } from '@/components/panel-ui';

/**
 * Índice de Seguridad (F14 · F6): lista sólo las pantallas de la sección que esta persona puede abrir.
 * «Roles y permisos» (`role:read`, F7) y «Accesos de soporte» (`support:consent`, F5).
 */
export default async function SecurityHubPage() {
  const blocked = await requirePermission({ anyOf: [Permission.ROLE_READ, Permission.USER_SESSIONS_REVOKE, Permission.SUPPORT_CONSENT] });
  if (blocked) return blocked;
  const t = await getTranslations('panel.pages.security');
  const tSupport = await getTranslations('panel.pages.support');
  const granted = new Set((await getMe()).body.data?.permissions ?? []);

  const sections = [
    granted.has(Permission.ROLE_READ) && { href: '/seguridad/roles', title: t('rolesTitle'), text: t('rolesText') },
    granted.has(Permission.SUPPORT_CONSENT) && { href: '/seguridad/soporte', title: tSupport('title'), text: t('supportText') },
  ].filter((s): s is { href: string; title: string; text: string } => Boolean(s));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {sections.length === 0 ? (
        <EmptyState title={t('title')} text={t('empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="block rounded-2xl border border-k-border bg-white p-5 hover:border-k-periwinkle">
                <span className="text-[15px] font-semibold text-k-navy">{s.title}</span>
                <span className="mt-1 block text-[13px] text-k-text-2">{s.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
