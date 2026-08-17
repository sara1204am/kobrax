import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { memberName, type CaseListItem, type Member } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'neutral',
  ACTIVE: 'warning',
  IN_NEGOTIATION: 'warning',
  PROMISE_TO_PAY: 'warning',
  PAID: 'success',
  CLOSED: 'neutral',
  WRITTEN_OFF: 'danger',
};

/**
 * Los casos de cobranza de esta persona.
 *
 * Va **al final de la ficha** a propósito: el caso es cómo la empresa organiza el trabajo, no un
 * dato del deudor. Quien abre esta pantalla viene a ver cuánto debe y a quién llamar; el caso es lo
 * que mira después, y desde acá salta a `/mora/[id]`, que es donde se gestiona.
 *
 * Un cliente puede tener varios: uno por crédito en mora.
 */
export async function CasesSection({
  cases,
  members,
  denied,
}: {
  cases: CaseListItem[];
  members: Member[];
  /** Sin `case:read` la lista viene vacía; decirlo es mejor que mostrar un cero que no es cierto. */
  denied?: boolean;
}) {
  const t = await getTranslations('portfolio');
  const tc = await getTranslations('panel.cases');
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  return (
    <section aria-label={t('sections.cases')}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('sections.cases')}</h2>
      <div className="rounded-2xl border border-k-border bg-white">
        {denied || cases.length === 0 ? (
          <p className="px-4 py-5 text-[13px] text-k-muted">{denied ? t('casesDenied') : t('noCases')}</p>
        ) : (
          <ul>
            {cases.map((k) => (
              <li key={k.id} className="border-b border-k-border last:border-0">
                <Link href={`/mora/${k.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-k-bg">
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-k-text">{tc(`priority.${k.priority}`)}</span>
                    <span className="block text-[12px] text-k-muted">
                      {k.assigneeId ? (byId.get(k.assigneeId) ?? t('unknownCollector')) : t('unassigned')}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {(k.daysPastDue ?? 0) > 0 && (
                      <span className="text-[13px] font-medium text-k-danger">{t('days', { count: k.daysPastDue ?? 0 })}</span>
                    )}
                    <Badge tone={STATUS_TONE[k.status] ?? 'neutral'} dot>
                      {tc(`status.${k.status}`)}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
