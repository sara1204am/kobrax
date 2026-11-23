'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  PROMISE_RESULT,
  RECOVERY_ACTIVITY_TYPES,
  RECOVERY_NOTES_MAX_LENGTH,
  RECOVERY_RESULTS_BY_TYPE,
  validateActivityTarget,
  validateRecoveryActivity,
  type RecoveryActivityType,
} from '@kobrax/shared';
import { ActivityOutcomeFields, emptyOutcome, outcomeBody, type OutcomeContact, type OutcomeLocation } from '@/components/activity-outcome-fields';
import type { CatalogOption } from '@/components/client-form';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { postJson } from '@/lib/client';
import { todayIso } from '@/lib/format';

/** Si el tenant no cargó el catálogo de medios de pago, estos son los de siempre (los mismos del cobro). */
const FALLBACK_METHODS = ['CASH', 'TRANSFER', 'QR'];

/**
 * Registrar una gestión: **qué se hizo, a dónde o a quién, cómo terminó y, si prometió pagar, la promesa**.
 *
 * 🔴 **Pide lo mismo que se pide al agendar.** Antes, agendar una llamada o una visita preguntaba a qué teléfono o a qué dirección, pero
 * registrarla directo aquí no: la gestión quedaba sin decir dónde. Ahora el cuerpo del formulario es el de la agenda
 * (`ActivityOutcomeFields`): teléfono (llamada y mensaje), dirección visitada (visita), canal y plantilla (mensaje), resultado, motivo de no
 * pago —solo si se habló con el deudor— y observaciones.
 *
 * 🔴 **«Quién responde por el crédito» ya no se pregunta acá**: es un dato del crédito y se edita en su card.
 *
 * 🔴 **La regla es la de shared** (`validateRecoveryActivity`), la misma que aplica la API: se ofrecen sólo los resultados que corresponden
 * al tipo y «promesa de pago» y los datos de la promesa van juntos.
 *
 * Sirve con **cualquier crédito que se vea, esté o no en mora** (F4/08): no abre ni exige ningún caso.
 */
export function RegisterActivityButton({
  creditId,
  clientId,
  suggestedAmount,
  methods,
  banks,
  reasons = [],
  incomeSource,
  templates = [],
}: {
  creditId: string;
  /** El deudor: de él salen los teléfonos y las direcciones que se ofrecen. Ausente = no se ofrecen. */
  clientId?: string;
  /** Con qué monto arranca la promesa. Ausente = vacío. */
  suggestedAmount?: number;
  /** Catálogo `PAYMENT_METHOD` del tenant. Vacío = los medios de siempre. */
  methods: CatalogOption[];
  /** Catálogo `BANK` del tenant. Vacío = no se ofrece el campo. */
  banks: CatalogOption[];
  /** Catálogo `NO_PAYMENT_REASON` (F4/13 · E4). Vacío = no se ofrece el bloque de motivo. */
  reasons?: CatalogOption[];
  /** Fuente de ingreso del cliente: filtra qué motivos se ofrecen. Desconocida = se ofrecen todos. */
  incomeSource?: string;
  /** Catálogo `WHATSAPP_TEMPLATE`: las plantillas que se ofrecen al registrar un mensaje. */
  templates?: CatalogOption[];
}) {
  const t = useTranslations('panel.mora');
  const tf = useTranslations('panel.mora.ficha.activity');
  const tMethod = useTranslations('panel.payments.method');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  /** El día de la gestión: hoy por defecto; se puede cargar una de un día anterior, nunca una futura. */
  const [activityDate, setActivityDate] = useState(todayIso);
  const [type, setType] = useState<RecoveryActivityType>('CALL');
  const [out, setOut] = useState(emptyOutcome);
  const [amount, setAmount] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [method, setMethod] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  /** Los teléfonos y direcciones del deudor (los mismos que ofrece el alta de la agenda). Se piden al abrir. */
  const [contacts, setContacts] = useState<OutcomeContact[]>([]);
  const [locations, setLocations] = useState<OutcomeLocation[]>([]);

  useEffect(() => {
    if (!open || !clientId) return;
    let alive = true;
    void fetch(`/api/agenda/context/${clientId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { contacts?: OutcomeContact[]; locations?: OutcomeLocation[] } | null) => {
        if (!alive || !data) return;
        setContacts(data.contacts ?? []);
        setLocations(data.locations ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, clientId]);

  const results = RECOVERY_RESULTS_BY_TYPE[type];
  const promises = out.result === PROMISE_RESULT;
  const methodOptions = methods.length > 0 ? methods : FALLBACK_METHODS.map((code) => ({ code, label: tMethod(code as never) }));

  const body = outcomeBody(type, out, reasons);
  const promise = promises ? { amount: Number(amount.replace(',', '.')), promiseDate, paymentMethodCode: method, ...(bank ? { bankCode: bank } : {}) } : undefined;
  const invalid =
    (!activityDate || activityDate > todayIso() ? ('ACTIVITY_DATE_INVALID' as const) : null) ??
    validateRecoveryActivity({ type, ...body, promise } as never, todayIso()) ??
    (validateActivityTarget({ locationId: body.locationId, contactId: body.contactId, channel: body.channel }, type) ? ('TYPE_INVALID' as const) : null);

  function reset() {
    setActivityDate(todayIso());
    setType('CALL');
    setOut(emptyOutcome());
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
    if (!(RECOVERY_RESULTS_BY_TYPE[next] as readonly string[]).includes(out.result)) setOut({ ...out, result: '' });
  }

  function changeOut(next: typeof out) {
    // Al prometer, el monto arranca con el sugerido: lo habitual es prometer la cuota o lo vencido.
    if (next.result === PROMISE_RESULT && out.result !== PROMISE_RESULT && amount === '' && suggestedAmount !== undefined) setAmount(String(suggestedAmount));
    setOut(next);
  }

  async function submit() {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const res = await postJson(`/api/mora/${creditId}/activities`, { activityDate, type, ...body, ...(promise ? { promise } : {}) });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    setOpen(false);
    reset();
    toast(tf('done'));
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
          {/* Lo PRIMERO: cuándo fue. Hoy ya viene elegido; se puede ir hacia atrás, no hacia adelante. */}
          <Field label={tf('activityDate')} hint={tf('activityDateHint')} required>
            <Input type="date" max={todayIso()} value={activityDate} onChange={(e) => setActivityDate(e.target.value)} disabled={busy} />
          </Field>
          <Field label={tf('type')} required>
            <Select value={type} onChange={(e) => changeType(e.target.value as RecoveryActivityType)} disabled={busy}>
              {RECOVERY_ACTIVITY_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`activityType.${k}`)}
                </option>
              ))}
            </Select>
          </Field>

          <ActivityOutcomeFields
            type={type}
            value={out}
            onChange={changeOut}
            results={results}
            resultLabel={(r) => tf(`results.${r}`)}
            contacts={contacts}
            locations={locations}
            reasons={reasons}
            incomeSource={incomeSource}
            templates={templates}
            disabled={busy}
            notesMax={RECOVERY_NOTES_MAX_LENGTH}
            afterResult={
              promises ? (
                <fieldset className="space-y-4 rounded-xl border border-k-border bg-k-bg p-3">
                  <legend className="px-1 text-k-xs font-semibold uppercase tracking-wide text-k-text-2">{tf('promise')}</legend>
                  <Field label={tf('amount')} required>
                    <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
                  </Field>
                  <Field label={tf('date')} required>
                    <Input type="date" min={todayIso()} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} disabled={busy} />
                  </Field>
                  <Field label={tf('method')} required>
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
              ) : undefined
            }
          />

          {/* Recién después del primer intento: no se le grita a quien todavía no escribió nada. */}
          {touched && invalid && <ErrorBanner message={tf(`errors.${invalid}`)} />}
        </div>
      </Modal>
    </>
  );
}
