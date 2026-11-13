import { useTranslations } from 'next-intl';
import type { PermissionRisk } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';

const TONE = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'danger', CRITICAL: 'danger' } as const;

/** El riesgo de un permiso. El texto siempre acompaña al color: el estado se lee, no se adivina. */
export function RiskBadge({ risk }: { risk: PermissionRisk }) {
  const t = useTranslations('roles.risk');
  return (
    <Badge tone={TONE[risk]}>
      {t('label')}: {t(risk)}
    </Badge>
  );
}
