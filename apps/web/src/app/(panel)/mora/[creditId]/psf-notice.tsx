import { useTranslations } from 'next-intl';
import type { ExternalSyncStatus } from '@kobrax/shared';

/** `YYYY-MM-DD` → `dd/mm` (la forma en que el reporte PSF dice «del 03/10»). */
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * El aviso de la fuente externa en la ficha (F4/08 · D9).
 *
 * 🔴 **Ausente no es pagado.** Si el crédito ya no aparece en el reporte se dice exactamente eso y que pudo ponerse al
 * día o cancelarse —el reporte no dice cuál—. Nunca «pagado». Un dato viejo se avisa aparte. Ninguno de los dos
 * bloquea el trabajo de campo: se puede seguir registrando acciones y agendando.
 */
export function PsfNotice({
  externalSource,
  syncStatus,
  absentSince,
  reportedAsOf,
  reportedStale,
}: {
  externalSource?: string;
  syncStatus?: ExternalSyncStatus;
  /** `YYYY-MM-DD`: desde cuándo ya no aparece en el reporte. */
  absentSince?: string;
  /** `YYYY-MM-DD`: el corte del último reporte. */
  reportedAsOf?: string;
  reportedStale?: boolean;
}) {
  const t = useTranslations('panel.cases.gestion.psf');
  const tSource = useTranslations('creditSource');
  if (!externalSource) return null;

  const cls = 'rounded-xl border border-k-border bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text';
  if (syncStatus === 'ABSENT') {
    const when = absentSince ?? reportedAsOf;
    return (
      <p role="status" className={cls}>
        {when ? t('absent', { date: ddmm(when) }) : t('absentNoDate')}
      </p>
    );
  }
  if (reportedStale) {
    return (
      <p role="status" className={cls}>
        {tSource('stale')}
        {reportedAsOf ? ` · ${tSource('withAsOf', { source: externalSource, date: ddmm(reportedAsOf) })}` : ''}
      </p>
    );
  }
  return null;
}
