'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PAYMENT_METHODS, type PaymentMethod, type PaymentRequestItem } from '@kobrax/shared';
import { Card, EmptyState } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { sendJson } from '@/lib/client';
import { errorText } from '@/lib/api-error';

/**
 * El formulario del cobro. Lo único que hace es crearlo.
 *
 * 🔴 Al crearse **se navega a la solicitud**, no se la muestra acá. Guardada sólo en el estado del
 * componente, cerrar la pestaña se llevaba el QR, el link y el botón de confirmar: el deudor pagaba
 * al día siguiente y no había forma de conciliar ese cobro desde el panel. Ahora vive en una URL
 * que se puede volver a abrir —y que puede abrir **otra persona**, que es como funciona de verdad:
 * `payment:approve` lo tiene el MANAGER, que no tiene `payment:write` y por lo tanto nunca es quien
 * la creó.
 */
export function RequestForm({ creditId, creditCode }: { creditId: string; creditCode?: string }) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const router = useRouter();
  const { can } = usePermissions();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('QR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin `payment:write` el formulario entero es un 403 esperando: se dice antes, no después de
  // llenar el monto. Quien manda sigue siendo la API.
  if (!can('payment:write')) {
    return <EmptyState title={t('request.title')} text={t('errors.AUTH_002')} />;
  }

  const value = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  async function create() {
    if (!valid) return;
    setError(null);
    setBusy(true);
    const res = await sendJson<PaymentRequestItem>('/api/payment-requests', {
      creditId,
      amount: value,
      method,
    });
    if (!res.ok) {
      setBusy(false);
      setError(errorText(res.data.error, t, locale));
      return;
    }
    // `replace` y no `push`: volver atrás al formulario vacío después de generar el cobro sólo
    // sirve para generar un segundo cobro sin querer.
    router.replace(`/pagos/solicitudes/${res.data.id}`);
  }

  return (
    <Card>
      <ErrorBanner message={error} />
      <div className="mt-4 grid max-w-lg gap-4">
        <Field label={t('detail.credit')}>
          <Input value={creditCode ?? creditId} readOnly disabled />
        </Field>
        <Field label={t('request.amount')}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} inputMode="decimal" />
        </Field>
        <Field label={t('request.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.back()} disabled={busy} className="sm:w-auto sm:px-5">
            {t('request.cancel')}
          </Button>
          <Button onClick={create} loading={busy} disabled={!valid} className="sm:w-auto sm:px-5">
            {t('request.confirm')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
