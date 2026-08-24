import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/panel-ui';
import { SecurityOptions } from '@/components/security-options';

export default async function SecurityHub() {
  const t = await getTranslations('security');

  return (
    <>
      <PageHeader title={t('title')} />
      <SecurityOptions />
    </>
  );
}
