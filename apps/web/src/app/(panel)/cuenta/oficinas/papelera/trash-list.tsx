'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, EmptyState, Section } from '@/components/panel-ui';
import { ErrorBanner } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { sendJson } from '@/lib/client';
import type { OfficeRow } from '@/lib/offices';
import { useOfficeApi } from '../use-office-api';

/** Las oficinas desactivadas. Restaurar es de quien escribe (`office:write`); si el servidor la rechaza, dice por qué. */
export function TrashList({ rows }: { rows: OfficeRow[] }) {
  const t = useTranslations('account.offices');
  const { can } = usePermissions();
  const { busy, error, run } = useOfficeApi();
  const writable = can('office:write');

  return (
    <Section title={t('trash.title')} inner="space-y-4 p-4 sm:p-6">
      <p className="text-[13px] text-k-text-2">{t('trash.intro')}</p>
      <ErrorBanner message={error} />
      {rows.length === 0 ? (
        <EmptyState title={t('trash.empty')} text={t('trash.emptyHint')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-k-border text-[11px] uppercase tracking-wide text-k-text-2">
                <th scope="col" className="pb-2 pr-3">{t('trash.name')}</th>
                <th scope="col" className="pb-2 pr-3">{t('form.fields.code')}</th>
                <th scope="col" className="pb-2 pr-3">{t('form.fields.type')}</th>
                <th scope="col" className="pb-2">
                  <span className="sr-only">{t('trash.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-k-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-3 pr-3">
                    <Link href={`/cuenta/oficinas/${r.id}`} className="font-medium text-k-text hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-[12px] text-k-muted">{r.fullName}</p>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px]">{r.code ?? '—'}</td>
                  <td className="py-3 pr-3">{r.typeName ? <Badge>{r.typeName}</Badge> : '—'}</td>
                  <td className="py-3 text-right">
                    {writable && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('trash.restoreOf', { name: r.name })}
                        onClick={() => void run(() => sendJson(`/api/branches/${r.id}/restore`, null, 'POST'), t('trash.restored'))}
                        className="font-medium text-k-purple hover:underline disabled:opacity-50"
                      >
                        {t('trash.restore')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
