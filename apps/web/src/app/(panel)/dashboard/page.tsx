import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/panel-ui';

/**
 * Aterrizaje post-login. Es el destino al que apuntan `app/page.tsx`, `lib/client.ts`,
 * `login/select-account` y el shell, así que la ruta tiene que existir.
 *
 * ponytail: no pide `/auth/me`. El layout ya trajo la identidad y la pinta en la topbar;
 * repetir la llamada acá sería la segunda del mismo render para decir el mismo nombre.
 * **W8 reemplaza esta pantalla entera** por el dashboard de KPIs — hasta entonces no se
 * dibujan tarjetas de métricas vacías.
 */
export default async function DashboardPage() {
  const t = await getTranslations('panel.home');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <p className="text-[14px] text-k-text-2">{t('building')}</p>
    </>
  );
}
