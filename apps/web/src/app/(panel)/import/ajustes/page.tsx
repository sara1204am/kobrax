import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ConfigScreen } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { ImportSetup } from './import-setup';
import { AdvisorLinks } from './advisor-links';

/**
 * Configurar la importación: el archivo, cómo está organizado, de quién es, sus columnas y las
 * reglas — **todo en una pantalla**.
 *
 * Una sola llamada trae la config, el catálogo de campos, la última corrida y los candidatos de
 * alcance: la pantalla no sirve de nada con la config sin lo demás.
 */
export default async function ImportSettingsPage() {
  const t = await getTranslations('panel.import');
  const [{ status, body }, advisors] = await Promise.all([
    apiCall<ConfigScreen>('/imports/portfolio/config', { method: 'GET', auth: true }),
    apiCall<{ links: { advisorCode: string; userId: string }[]; unlinked: string[] }>('/imports/portfolio/advisors', {
      method: 'GET',
      auth: true,
    }),
  ]);

  // 403 = el rol no tiene `client:import`. El ítem del menú tampoco se le dibuja, así que llegar
  // acá es haber escrito la URL.
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('setup.title')} text={body.error?.message} />;
  }

  return (
    <>
      <Link href="/import" className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
        ← {t('setup.backToRun')}
      </Link>
      <PageHeader title={t('setup.title')} subtitle={t('setup.subtitle')} />
      <ImportSetup screen={body.data} />
      {/* D8: de quién es cada reporte. Aparte del asistente: no es parte de leer el archivo. */}
      <AdvisorLinks
        links={advisors.body.data?.links ?? []}
        unlinked={advisors.body.data?.unlinked ?? []}
        members={body.data.members}
      />
    </>
  );
}
