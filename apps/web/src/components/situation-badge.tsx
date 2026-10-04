import { useTranslations } from 'next-intl';
import type { MoraCategoryTag, MoraSituation } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';

/**
 * La situación de un crédito (F4/08 · D1): **Al día** o **En mora**, y el castigo aparte.
 *
 * 🔴 **La categoría llega de la API y se pinta tal cual**: nunca se calcula acá ni se conocen sus rangos (los
 * configura la cuenta en Administración). Sin categoría (al día, o la cuenta no tiene) no se dibuja.
 *
 * 🔴 **Castigado es independiente de la situación**: va **además** del chip de situación, con los días de mora
 * que tenía («240 días de mora · Categoría C»). Gestiones, promesas y pagos NO se derivan en estados acá.
 */
export function SituationBadge({
  situation,
  daysPastDue,
  category,
  writtenOff = false,
  inline = false,
}: {
  situation: MoraSituation;
  daysPastDue: number;
  category?: MoraCategoryTag;
  writtenOff?: boolean;
  /** Todo en una línea (cabecera de la ficha). Por defecto, el detalle va debajo (celda de tabla). */
  inline?: boolean;
}) {
  const t = useTranslations('panel.cases.situation');
  const inArrears = situation === 'IN_ARREARS';

  const parts: string[] = [];
  if (inArrears || (writtenOff && daysPastDue > 0)) {
    if (!writtenOff && category) parts.push(t('category', { code: category.code }));
    if (daysPastDue > 0) parts.push(t('daysPastDue', { n: daysPastDue }));
    if (writtenOff && category) parts.push(t('category', { code: category.code }));
  }
  const detail = parts.join(' · ');

  return (
    <span className={inline ? 'inline-flex flex-wrap items-center gap-2' : 'flex flex-col items-start gap-1'}>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone={inArrears ? 'danger' : 'success'} dot>
          {t(situation)}
        </Badge>
        {writtenOff && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-k-navy px-2 py-1 text-[12px] font-medium text-white">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
            {t('writtenOff')}
          </span>
        )}
      </span>
      {detail && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-k-text-2" title={category?.name}>
          {category?.color && (
            <span aria-hidden data-testid="category-dot" className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
          )}
          {detail}
        </span>
      )}
    </span>
  );
}
