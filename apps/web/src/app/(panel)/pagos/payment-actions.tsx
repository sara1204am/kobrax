'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PAYMENT_METHODS, type PaymentItem, type PaymentMethod } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/** El crédito contra el que se cobra. Sin él no hay nada que registrar: la API lo exige. */
export interface CreditTarget {
  id: string;
  code?: string;
}

/**
 * Lo que se puede hacer con la plata desde el ledger: **registrar un pago** que llegó por
 * transferencia o al mostrador, y **pedir un cobro** para el que no va a recibir a nadie.
 *
 * 🔴 Las dos acciones necesitan un crédito, y el ledger no lo elige: se llega acá desde la ficha
 * del crédito (`/pagos?creditId=…`). Sin crédito el botón sigue estando y dice dónde ir — esconderlo
 * dejaría a la persona buscando una acción que existe.
 */
export function PaymentActions({ credit }: { credit?: CreditTarget }) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();

  const [open, setOpen] = useState(false);
  /**
   * 🔴 La clave se genera **al abrir el formulario, no al enviar**. Generada al enviar, cada
   * reintento traería una distinta y la idempotencia no serviría para nada: es justo el doble clic
   * lo que tiene que llegar con la misma clave.
   */
  const [key, setKey] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!can('payment:write')) return null;

  const value = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  function start() {
    setKey(crypto.randomUUID());
    setAmount('');
    setMethod('CASH');
    setError(null);
    setOpen(true);
  }

  async function register() {
    if (!credit || !valid) return;
    setError(null);
    setBusy(true);
    const res = await sendJson<PaymentItem>(
      '/api/payments',
      { creditId: credit.id, amount: value, method },
      'POST',
      { 'idempotency-key': key },
    );
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    setOpen(false);
    toast(t('register.done'));
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={start} className="sm:w-auto sm:px-5">
        {t('register.cta')}
      </Button>
      {credit && (
        <Link
          href={`/pagos/solicitudes/nueva?creditId=${credit.id}`}
          className="flex h-12 items-center rounded-xl bg-k-navy px-5 text-[15px] font-semibold text-white hover:bg-k-slate"
        >
          {t('request.cta')}
        </Link>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('register.title')}
        actions={
          credit ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy} className="sm:w-auto sm:px-5">
                {t('register.cancel')}
              </Button>
              <Button onClick={register} loading={busy} disabled={!valid} className="sm:w-auto sm:px-5">
                {t('register.confirm')}
              </Button>
            </>
          ) : undefined
        }
      >
        <ErrorBanner message={error} />
        {credit ? (
          <>
            {/* El aviso va ANTES de confirmar: es el único momento en que el error se puede evitar.
                El ledger no tiene `update` ni `delete`, y no es un olvido de la API. */}
            <p className="text-k-warning-text">{t('register.immutable')}</p>
            <div className="mt-4 space-y-4">
              <Field label={t('register.credit')}>
                <Input value={credit.code ?? credit.id} readOnly disabled />
              </Field>
              <Field label={t('register.amount')}>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  inputMode="decimal"
                  autoFocus
                />
              </Field>
              <Field label={t('register.method')}>
                <Select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  disabled={busy}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`method.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        ) : (
          <p>{t('register.noCredit')}</p>
        )}
      </Modal>
    </>
  );
}
