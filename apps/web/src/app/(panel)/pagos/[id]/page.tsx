import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  type AccountInfo,
  type ClientDetail,
  type CreditDetail,
  type Member,
  type PaymentItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { isUuid } from '@/lib/payments';
import { dateTime, fullName, money } from '@/lib/format';

/**
 * Un pago y su comprobante.
 *
 * Acá **sí** aparece el nombre del deudor, que la lista no muestra: el ledger devuelve `creditId`,
 * no el nombre, y resolverlo por fila serían dos llamadas por pago —cuarenta por página—. Una fila
 * sola se lo puede permitir, y es la pantalla donde el nombre hace falta de verdad.
 *
 * 🔴 **No hay nada que editar ni que anular**: `payments` no tiene `update` ni `delete`. Un pago mal
 * cargado se corrige con otro asiento, y la pantalla lo dice en vez de dejarlo suponer.
 */
export default async function PagoPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('panel.payments');
  const locale = await getLocale();

  // `/pagos/loquesea` cae acá por el segmento dinámico: sin esto se le pedía a la API un id que no
  // es uno y la pantalla mostraba el texto crudo de una validación. Un id que no existe es un 404.
  if (!isUuid(params.id)) notFound();

  const [detail, team, account] = await Promise.all([
    apiCall<PaymentItem>(`/payments/${params.id}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('detail.title')} text={detail.body.error?.message} />;
  }
  const payment = detail.body.data;

  // El crédito primero y el deudor después: el pago no trae el cliente, lo trae el crédito. Son dos
  // llamadas encadenadas y no hay forma de ahorrárselas — por eso esto no se hace por fila.
  const credit = (await apiCall<CreditDetail>(`/credits/${payment.creditId}`, { method: 'GET', auth: true })).body.data;
  const client = credit?.clientId
    ? (await apiCall<ClientDetail>(`/clients/${credit.clientId}`, { method: 'GET', auth: true })).body.data
    : null;

  const currency = credit?.currency ?? account.body.data?.currencyCode ?? 'BOB';
  const who = (team.body.data ?? []).find((m) => m.userId === payment.registeredBy);

  return (
    <>
      <PageHeader
        title={client ? fullName(client) : t('detail.title')}
        subtitle={dateTime(payment.paymentDate, locale)}
      />

      <div className="space-y-6">
        <Card>
          <p className="text-[28px] font-semibold text-k-navy">{money(payment.amount, currency)}</p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('columns.method')} value={t(`method.${payment.method}`)} />
            {/* Sin nombre no es «nadie»: `/users` da 403 sin `user:read`, y todo pago tiene quien lo cargó. */}
            <Fact label={t('detail.registeredBy')} value={who ? memberName(who) : t('unknownUser')} />
            <Fact
              label={t('detail.receiptNumber')}
              value={payment.receiptNumber != null ? `#${payment.receiptNumber}` : '—'}
            />
            <Fact label={t('detail.provider')} value={payment.provider ?? '—'} />
            <Fact label={t('detail.externalId')} value={payment.externalTransactionId ?? '—'} />
          </dl>

          <div className="mt-5 flex flex-wrap gap-4">
            {credit?.clientId && (
              <Link
                href={`/cartera/${credit.clientId}/credito/${payment.creditId}`}
                className="text-[14px] font-medium text-k-purple hover:underline"
              >
                {t('detail.credit')}
              </Link>
            )}
            {payment.caseId && (
              <Link href={`/casos/${payment.caseId}`} className="text-[14px] font-medium text-k-purple hover:underline">
                {t('detail.case')}
              </Link>
            )}
          </div>
        </Card>

        {payment.receiptUrl && (
          <Card>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('columns.receipt')}</p>
            {/*
              🔴 `receiptUrl` **ya es la ruta**: `uploads` devuelve `/api/uploads/<nombre>` y se guarda
              tal cual. Anteponer el prefijo otra vez fue lo que en W6 dejó todas las fotos rotas. Sólo
              se dibuja lo que apunta a nuestro handler, que es el que proxea con el Bearer; una URL
              externa no se puede autenticar, así que va como enlace.

              🔴 Y el enlace **sólo si es http(s)**: `receiptUrl` es un `@IsString()` libre en el DTO,
              así que quien registra pagos puede guardar `javascript:…` y React no lo frena — lo
              ejecutaría en el origen del panel al hacer clic. Lo que no es una URL navegable se
              muestra como texto.
            */}
            {payment.receiptUrl.startsWith('/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={payment.receiptUrl}
                alt={t('columns.receipt')}
                className="mt-3 max-h-80 w-full rounded-xl border border-k-border object-contain"
              />
            ) : /^https?:\/\//i.test(payment.receiptUrl) ? (
              <a
                href={payment.receiptUrl}
                rel="noreferrer"
                target="_blank"
                className="mt-3 block break-all text-[13px] text-k-purple hover:underline"
              >
                {t('detail.openReceipt')}
              </a>
            ) : (
              <p className="mt-3 break-all text-[13px] text-k-text-2">{payment.receiptUrl}</p>
            )}
          </Card>
        )}

        <p className="text-[13px] text-k-text-2">{t('detail.immutable')}</p>
      </div>
    </>
  );
}
