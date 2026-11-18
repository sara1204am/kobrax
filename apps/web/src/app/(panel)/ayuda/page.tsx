import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { WORKSPACE_MODULES, helpEntries, type WorkspaceNavKey } from '@kobrax/shared';
import { getMe } from '@/lib/authz';
import { visibleNav } from '@/lib/nav';
import { PageHeader } from '@/components/panel-ui';
import { HelpCenter, type HelpItem } from './help-center';

const KNOWN = new Set<string>(WORKSPACE_MODULES.map((m) => m.key));

/**
 * Centro de ayuda (F15 · P10): una explicación por módulo que la persona ve y por acción de pantalla. Sale del MISMO catálogo
 * que el recorrido y las guías (`shared/guides`), así que nunca habla de algo que su plan, su permiso o su espacio de trabajo
 * no le dan (R1). Sin videos.
 */
export default async function AyudaPage() {
  const me = await getMe();
  if (me.status !== 200 || !me.body.data) redirect('/login');
  const user = me.body.data;
  const visibleNavKeys = visibleNav(user.permissions, user.account?.workspace)
    .map((n) => n.label)
    .filter((k): k is WorkspaceNavKey => KNOWN.has(k));

  const t = await getTranslations();
  const items: HelpItem[] = helpEntries({ visibleNavKeys }).map((e) => ({
    id: e.id,
    name: t(`panel.nav.${e.module}`),
    href: WORKSPACE_MODULES.find((m) => m.key === e.module)?.routes[0] ?? '/dashboard',
    what: t(`${e.textKey}.what`),
    does: t(`${e.textKey}.does`),
    startWith: t(`${e.textKey}.startWith`),
    actions: e.actions.map((a) => ({
      id: a.id,
      title: t(`${a.textKey}.title`),
      what: t(`${a.textKey}.what`),
      does: t(`${a.textKey}.does`),
    })),
  }));

  const th = await getTranslations('helpCenter');
  return (
    <>
      <PageHeader title={th('title')} subtitle={th('subtitle')} />
      <HelpCenter items={items} />
    </>
  );
}
