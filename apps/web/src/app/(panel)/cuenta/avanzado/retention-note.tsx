import { getTranslations } from 'next-intl/server';
import { Section } from '@/components/panel-ui';

/**
 * Cuántas fotos pasaron el plazo de conservación del plan. **Sólo informa**: ningún proceso las elimina ni las archiva
 * (la evidencia es inmutable y su hash respalda las gestiones). La pantalla lo dice con todas las letras para que
 * nadie asuma que, pasado el plazo, desaparecen.
 */
export async function RetentionNote({ report }: { report: { retentionMonths: number | null; total: number; older: number } }) {
  const t = await getTranslations('account.advanced.retention');
  return (
    <Section title={t('title')} inner="space-y-3 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">
        {report.retentionMonths === null ? t('unlimited') : t('months', { n: report.retentionMonths })}
      </p>
      {report.retentionMonths !== null && (
        <p className="text-[14px] text-k-text">{t('older', { older: report.older, total: report.total })}</p>
      )}
      <p className="rounded-xl bg-k-light-bg px-4 py-3 text-[13px] leading-relaxed text-k-text-2">{t('noDelete')}</p>
    </Section>
  );
}
