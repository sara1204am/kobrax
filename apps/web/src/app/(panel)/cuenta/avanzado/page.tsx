import { getTranslations } from 'next-intl/server';
import type { AccountRequestInfo, MeInfo, Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Section } from '@/components/panel-ui';
import { getAccount } from '../get-account';
import { ClosureRequest } from './closure-request';
import { OwnershipTransfer } from './ownership-transfer';
import { RetentionNote } from './retention-note';

/**
 * Lo que se usa poco y pesa mucho: el respaldo completo, la retención de fotos, pasar la propiedad y pedir la baja.
 * Pide `account:write`. Quién es el dueño sale de la lista de miembros cruzada con la sesión (`/auth/me`).
 */
export default async function CuentaAvanzadoPage() {
  const t = await getTranslations('account.advanced');
  const { body } = await getAccount();
  if (!body.data) return null;

  const [me, members, requests, retention] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountRequestInfo[]>('/accounts/me/requests', { method: 'GET', auth: true }),
    apiCall<{ retentionMonths: number | null; total: number; older: number }>('/accounts/me/retention', { method: 'GET', auth: true }),
  ]);
  const selfId = me.body.data?.userId ?? '';
  const list = members.body.data ?? [];
  const isOwner = list.some((m) => m.userId === selfId && m.isOwner);

  return (
    <>
      <Section title={t('backup.title')} inner="space-y-3 p-6">
        <p className="text-[13px] leading-relaxed text-k-text-2">{t('backup.text')}</p>
        {/* Descarga directa: la ruta del BFF ya valida `report:export` y audita la exportación. */}
        <a
          href="/api/exports/backup"
          className="inline-flex h-11 items-center rounded-xl border border-k-border bg-white px-5 text-[14px] font-semibold text-k-navy hover:bg-k-bg"
        >
          {t('backup.download')}
        </a>
      </Section>

      {retention.body.data && <RetentionNote report={retention.body.data} />}

      <OwnershipTransfer members={list} selfId={selfId} isOwner={isOwner} />

      <ClosureRequest businessName={body.data.businessName} requests={requests.body.data ?? []} timezone={body.data.timezone} />
    </>
  );
}
