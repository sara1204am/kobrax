'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PAYMENT_CHANNELS, PAYMENT_METHODS, type PaymentChannel, type PaymentMethod } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/** El crédito sobre el que se registra el pago, con lo que hace falta para arrancar el formulario lleno. */
export interface PaymentCredit {
  id: string;
  code?: string;
  /** `suggestedPaymentAmount` del crédito: el monto con que arranca. Ausente = vacío. */
  suggestedAmount?: number;
  /** Operación externa (PSF): el pago no toca el saldo reportado y se avisa (D3). */
  external?: boolean;
}

/**
 * Lo que se puede hacer con la plata desde el ledger: **registrar un pago** que llegó por
 * transferencia o al mostrador, y **pedir un cobro** para el que no va a recibir a nadie.
 *
 * 🔴 Las dos acciones necesitan un crédito, y el ledger no lo elige: se llega acá desde la ficha
 * del crédito (`/pagos?creditId=…`). Sin crédito el botón sigue estando y dice dónde ir — esconderlo
 * dejaría a la persona buscando una acción que existe.
 */
export function PaymentActions({ credit }: { credit?: PaymentCredit }) {
  const t = useTranslations('panel.payments');
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);

  if (!can('payment:write')) return null;

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="sm:w-auto sm:px-5">
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
      <PaymentModal open={open} onClose={() => setOpen(false)} credit={credit} />
    </>
  );
}

/**
 * El formulario de pago. **Monto → confirmar** (§5 de la revisión final): el cobrador ya está
 * identificado, el crédito es el de la pantalla y la fecha es ahora, así que lo único que se pide es
 * el monto — y arranca con el sugerido. Medio, canal y nota van plegados en «Más opciones».
 *
 * Lo abren el ledger y la ficha del crédito, sin navegar: registrar un pago no saca a nadie de donde está.
 */
export function PaymentModal({
  open,
  onClose,
  credit,
}: {
  open: boolean;
  onClose: () => void;
  credit?: PaymentCredit;
}) {
  const t = useTranslations('panel.payments');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  /**
   * 🔴 La clave se genera **al abrir el formulario, no al enviar**. Generada al enviar, cada
   * reintento traería una distinta y la idempotencia no serviría para nada: es justo el doble clic
   * lo que tiene que llegar con la misma clave.
   */
  const [key, setKey] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [channel, setChannel] = useState<PaymentChannel>('KOBRAX_COLLECTED');
  const [notes, setNotes] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Cada apertura es un formulario nuevo: clave nueva y el monto sugerido otra vez. Se hace al pasar
  // de cerrado a abierto (durante el render, no en un efecto: así el primer cuadro ya sale lleno).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKey(crypto.randomUUID());
      setAmount(credit?.suggestedAmount !== undefined ? String(credit.suggestedAmount) : '');
      setMethod('CASH');
      setChannel('KOBRAX_COLLECTED');
      setNotes('');
      setMore(false);
      setError(null);
    }
  }

  const value = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  async function register(e?: FormEvent) {
    e?.preventDefault();
    if (!credit || !valid || busy) return;
    setError(null);
    setBusy(true);
    const res = await sendJson(
      '/api/payments',
      {
        creditId: credit.id,
        amount: value,
        method,
        // Sólo lo que no es el default: el cuerpo mínimo es el de siempre.
        ...(channel !== 'KOBRAX_COLLECTED' ? { channel } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      'POST',
      { 'idempotency-key': key },
    );
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    onClose();
    toast(t('register.done'));
    // Vuelve a leer sólo los datos del servidor de esta ruta; no recarga la página.
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('register.title')}
      actions={
        credit ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy} className="sm:w-auto sm:px-5">
              {t('register.cancel')}
            </Button>
            <Button onClick={() => void register()} loading={busy} disabled={!valid} className="sm:w-auto sm:px-5">
              {t('register.confirm')}
            </Button>
          </>
        ) : undefined
      }
    >
      <ErrorBanner message={error} />
      {credit ? (
        // Un form para que Enter confirme: monto → Enter, sin buscar el botón.
        <form onSubmit={(e) => void register(e)}>
          {/* El aviso va ANTES de confirmar: es el único momento en que el error se puede evitar.
              El ledger no tiene `update` ni `delete`, y no es un olvido de la API. */}
          <p className="text-k-warning-text">{t('register.immutable')}</p>
          {credit.external && <p className="mt-2 text-[14px] text-k-text-2">{t('register.externalHint')}</p>}
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
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            {credit.suggestedAmount !== undefined && Number(amount) === credit.suggestedAmount && (
              <p className="-mt-2 text-[12px] text-k-muted">{t('register.suggested')}</p>
            )}

            <button
              type="button"
              className="text-[14px] font-semibold text-k-slate hover:underline"
              onClick={() => setMore((m) => !m)}
              aria-expanded={more}
            >
              {more ? t('register.lessOptions') : t('register.moreOptions')}
            </button>

            {more && (
              <>
                <Field label={t('register.method')}>
                  <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={busy}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`method.${m}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('register.channel')}>
                  <Select value={channel} onChange={(e) => setChannel(e.target.value as PaymentChannel)} disabled={busy}>
                    {PAYMENT_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {t(`channel.${c}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('register.notes')}>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} maxLength={500} />
                </Field>
              </>
            )}
          </div>
          {/* Enter en un input envía el form; el botón real vive en el pie del modal. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      ) : (
        <p>{t('register.noCredit')}</p>
      )}
    </Modal>
  );
}
