'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  PROMISE_RESULT,
  RECOVERY_ACTIVITY_TYPES,
  RECOVERY_NOTES_MAX_LENGTH,
  RECOVERY_RESULTS_BY_TYPE,
  validateRecoveryActivity,
  type RecoveryActivityType,
} from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { postJson } from '@/lib/client';
import { todayIso } from '@/lib/format';

/** Si el tenant no cargó el catálogo de medios de pago, estos son los de siempre (los mismos del cobro). */
const FALLBACK_METHODS = ['CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT'];

/**
 * Registrar una gestión: **qué se hizo, cómo terminó y, si prometió pagar, la promesa**.
 *
 * 🔴 **Antes sólo se podía dejar una nota.** El formulario de la ficha no exponía el resultado ni la promesa
 * aunque la API los aceptaba, así que ninguna gestión hecha desde el panel decía cómo terminó — y sin eso no hay
 * ni cumplimiento de promesas ni resumen de qué se logró.
 *
 * 🔴 **La regla es la de shared** (`validateRecoveryActivity`), la misma que aplica la API: se ofrecen sólo los
 * resultados que corresponden al tipo («no lo encontró» es de una visita), y «promesa de pago» y los datos de la
 * promesa van juntos. El panel no ofrece lo que la API va a rechazar.
 *
 * Sirve **con o sin caso**: si el crédito no tiene uno, la API lo abre al registrar la gestión.
 */
export function RegisterActivityButton({
  creditId,
  suggestedAmount,
  methods,
  banks,
}: {
  creditId: string;
  /** Con qué monto arranca la promesa. Ausente = vacío. */
  suggestedAmount?: number;
  /** Catálogo `PAYMENT_METHOD` del tenant. Vacío = los medios de siempre. */
  methods: CatalogOption[];
  /** Catálogo `BANK` del tenant. Vacío = no se ofrece el campo. */
  banks: CatalogOption[];
}) {
  const t = useTranslations('panel.cases');
  const tf = useTranslations('panel.cases.ficha.activity');
  const tMethod = useTranslations('panel.payments.method');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RecoveryActivityType>('CALL');
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [method, setMethod] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const results = RECOVERY_RESULTS_BY_TYPE[type];
  const promises = result === PROMISE_RESULT;
  const methodOptions = methods.length > 0 ? methods : FALLBACK_METHODS.map((code) => ({ code, label: tMethod(code as never) }));

  const input = {
    type,
    result: result || undefined,
    notes,
    promise: promises
      ? { amount: Number(amount.replace(',', '.')), promiseDate, paymentMethodCode: method, ...(bank ? { bankCode: bank } : {}) }
      : undefined,
  };
  const invalid = validateRecoveryActivity(input, todayIso());

  function reset() {
    setType('CALL');
    setResult('');
    setNotes('');
    setAmount('');
    setPromiseDate('');
    setMethod('');
    setBank('');
    setError(null);
    setTouched(false);
  }

  function changeType(next: RecoveryActivityType) {
    setType(next);
    // Un resultado que no corresponde al tipo nuevo no se arrastra.
    if (!(RECOVERY_RESULTS_BY_TYPE[next] as readonly string[]).includes(result)) setResult('');
  }

  function changeResult(next: string) {
    setResult(next);
    // Al prometer, el monto arranca con el sugerido: lo habitual es prometer la cuota o lo vencido.
    if (next === PROMISE_RESULT && amount === '' && suggestedAmount !== undefined) setAmount(String(suggestedAmount));
  }

  async function submit() {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const res = await postJson<{ data?: { caseOpened?: boolean } }>(`/api/mora/${creditId}/activities`, {
      type,
      result: result || undefined,
      notes: notes.trim() || undefined,
      promise: input.promise,
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    const opened = (res.data as { caseOpened?: boolean }).caseOpened;
    setOpen(false);
    reset();
    toast(opened ? tf('doneOpened') : tf('done'));
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="sm:w-auto sm:px-5">
        {tf('cta')}
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={tf('title')}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={busy}
              className="sm:w-auto sm:px-5"
            >
              {tf('cancel')}
            </Button>
            <Button onClick={submit} loading={busy} disabled={touched && invalid !== null} className="sm:w-auto sm:px-5">
              {tf('confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{tf('text')}</p>
        <div className="mt-4 space-y-4">
          <Field label={tf('type')}>
            <Select value={type} onChange={(e) => changeType(e.target.value as RecoveryActivityType)} disabled={busy}>
              {RECOVERY_ACTIVITY_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`activityType.${k}`)}
                </option>
              ))}
            </Select>
          </Field>

          {results.length > 0 && (
            <Field label={tf('result')}>
              <Select value={result} onChange={(e) => changeResult(e.target.value)} disabled={busy}>
                <option value="">{tf('resultPlaceholder')}</option>
                {results.map((r) => (
                  <option key={r} value={r}>
                    {tf(`results.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {promises && (
            <fieldset className="space-y-4 rounded-xl border border-k-border bg-k-bg p-3">
              <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{tf('promise')}</legend>
              <Field label={tf('amount')}>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
              </Field>
              <Field label={tf('date')}>
                <Input type="date" min={todayIso()} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} disabled={busy} />
              </Field>
              <Field label={tf('method')}>
                <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy}>
                  <option value="">{tf('methodPlaceholder')}</option>
                  {methodOptions.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {banks.length > 0 && (
                <Field label={tf('bank')}>
                  <Select value={bank} onChange={(e) => setBank(e.target.value)} disabled={busy}>
                    <option value="">{tf('bankPlaceholder')}</option>
                    {banks.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </fieldset>
          )}

          <Field label={type === 'NOTE' ? tf('noteText') : tf('notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} maxLength={RECOVERY_NOTES_MAX_LENGTH} />
          </Field>

          {/* Recién después del primer intento: no se le grita a quien todavía no escribió nada. */}
          {touched && invalid && <ErrorBanner message={tf(`errors.${invalid}`)} />}
        </div>
      </Modal>
    </>
  );
}
