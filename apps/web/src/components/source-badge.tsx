import { useTranslations } from 'next-intl';
import { Badge } from '@/components/panel-ui';

/**
 * De qué fuente es un crédito, en las listas (D7).
 *
 * 🔴 **Sólo se dibuja para los externos.** Kobrax es lo normal: marcarlo en cada fila sería ruido y
 * haría que la etiqueta que importa —«este saldo lo reporta el banco»— se pierda entre iguales.
 *
 * Junto a la fuente van las dos cosas que cambian cómo se lee el número de al lado: que la operación
 * **ya no viene en el reporte** (D4 — no es «pagó» ni «al día») y que el dato está viejo (D9).
 */
export function SourceBadge({
  source,
  syncStatus,
  reportedAsOf,
  stale,
}: {
  source?: string | null;
  syncStatus?: string | null;
  /** `YYYY-MM-DD`: la fecha de corte a la que son sus números. */
  reportedAsOf?: string | null;
  stale?: boolean;
}) {
  const t = useTranslations('creditSource');
  if (!source) return null;
  const asOf = reportedAsOf ? `${reportedAsOf.slice(8, 10)}/${reportedAsOf.slice(5, 7)}` : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone="neutral">{asOf ? t('withAsOf', { source, date: asOf }) : source}</Badge>
      {syncStatus === 'ABSENT' && <Badge tone="warning">{t('absent')}</Badge>}
      {syncStatus !== 'ABSENT' && stale && <Badge tone="warning">{t('stale')}</Badge>}
    </span>
  );
}
