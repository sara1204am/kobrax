'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import type { PaymentItem, PaymentRequestItem } from '@kobrax/shared';
import { Badge, Card, Fact } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';
import { money } from '@/lib/format';

const STATUS_TONE = {
  PENDING: 'warning',
  PAID: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
} as const;

/**
 * Lo que hay que mandarle al deudor, y el único botón que crea plata desde acá.
 *
 * `qrPayload` y `url` **los arma la API**: esto los pinta y los deja copiar. Inventar el contenido
 * del QR del lado del navegador sería inventarse la referencia con la que después se concilia.
 */
export function RequestView({
  request,
  creditLabel,
  currency,
}: {
  request: PaymentRequestItem;
  creditLabel: string;
  currency: string;
}) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();

  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el QR fallara, el link de abajo sigue sirviendo: por eso no bloquea nada.
  useEffect(() => {
    if (!request.qrPayload) return;
    void QRCode.toDataURL(request.qrPayload, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [request.qrPayload]);

  /** Confirmar **crea el pago**: hereda la regla del ledger, no se deshace. */
  async function confirm() {
    setError(null);
    setBusy(true);
    const res = await sendJson<PaymentItem>(`/api/payment-requests/${request.id}/confirm`, {});
    if (!res.ok) {
      setBusy(false);
      setError(errorText(res.data.error, t, locale));
      return;
    }
    toast(t('request.confirmed'));
    router.replace(`/pagos/${res.data.id}`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[28px] font-semibold text-k-navy">{money(request.amount, currency)}</p>
          <Badge tone={STATUS_TONE[request.status]}>{t(`status.${request.status}`)}</Badge>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Fact label={t('request.method')} value={t(`method.${request.method}`)} />
          <Fact label={t('detail.credit')} value={creditLabel} />
        </dl>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('request.qr')}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt={t('request.qr')} className="mt-3 h-[220px] w-[220px]" />}

        {request.url && (
          <div className="mt-5">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('request.link')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="break-all text-[14px] text-k-text">{request.url}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(request.url!).then(() => setCopied(true));
                }}
                className="sm:w-auto sm:px-5"
              >
                {copied ? t('request.copied') : t('request.copy')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {request.status === 'PENDING' && (
        <Card>
          <ErrorBanner message={error} />
          {/* ⚠️ `payment:approve` es un permiso APARTE de `payment:write`, y ni el supervisor lo
              tiene: sin él el botón no se dibuja, o quedaría un 403 esperando. */}
          {can('payment:approve') ? (
            <>
              <p className="text-[14px] text-k-text-2">{t('request.confirmHint')}</p>
              <div className="mt-4">
                <Button onClick={confirm} loading={busy} className="sm:w-auto sm:px-5">
                  {t('request.confirmEntry')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-k-text-2">{t('request.noApprove')}</p>
          )}
        </Card>
      )}
    </div>
  );
}
