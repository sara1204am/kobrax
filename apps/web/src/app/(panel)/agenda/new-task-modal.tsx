'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AgendaItemType, AgendaTimeSlot, ScheduleTimeMode } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { money } from '@/lib/format';
import type { PortfolioRow } from '@/lib/portfolio';

/**
 * Los cinco tipos, en el mismo orden que el teléfono.
 *
 * 🔴 **`RANGE` no está entre los modos de hora, y no es un olvido**: quedó fuera del núcleo del
 * módulo. Ofrecerlo acá crearía gestiones que el teléfono no sabe dibujar.
 */
const TIPOS = [
  AgendaItemType.CALL,
  AgendaItemType.VISIT,
  AgendaItemType.WHATSAPP,
  AgendaItemType.REMINDER,
  AgendaItemType.PROMISE_TO_PAY,
] as const;

interface Ctx {
  client: { id: string; displayName: string; nationalId: string | null };
  credits: { creditId: string; caseId: string; code?: string; outstandingBalance: number; currency: string; daysPastDue: number }[];
  contacts: { id: string; contactType: string; value: string; isPrimary: boolean }[];
  locations: { id: string; locationType: string; address: string | null; zone?: string }[];
}

/**
 * Agendar una gestión desde el panel.
 *
 * 🔴 **Antes «Nueva gestión» llevaba a la cartera**, con la idea de que el alta era cosa del
 * teléfono. Pero quien supervisa agenda igual —acuerda una visita por teléfono y la deja cargada— y
 * mandarla a otra pantalla a buscar el cliente para volver era pedirle que arme el camino sola.
 *
 * 🔴 **Qué pide cada tipo lo decide el servidor** (`validateAgendaDetails`), la misma función que
 * valida lo que manda el teléfono. Acá sólo se dibujan los campos que ese contrato necesita: una
 * llamada quiere un teléfono, una visita una dirección, un recordatorio un texto, y una promesa
 * monto, fecha y medio de pago. Re-validarlo del lado del navegador sería una segunda copia de la
 * regla, que se separa la primera vez que cambia una.
 */
export function NewTaskModal({
  open,
  onClose,
  date,
  time,
}: {
  open: boolean;
  onClose: () => void;
  /** El día que se está mirando: es el que se propone, no «hoy». */
  date: string;
  /** La hora del hueco desde el que se abrió, si vino de uno. */
  time?: string;
}) {
  const t = useTranslations('panel.agenda');
  const router = useRouter();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PortfolioRow[]>([]);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [buscando, setBuscando] = useState(false);

  /**
   * El crédito elegido. Se guarda el `creditId` y no el `caseId` porque el alta pide **los dos**, y
   * el caso se deriva de él: al revés habría que buscar el crédito de vuelta en la lista.
   */
  const [creditId, setCreditId] = useState('');
  const [tipo, setTipo] = useState<AgendaItemType>(AgendaItemType.CALL);
  const [contactId, setContactId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [promiseDate, setPromiseDate] = useState(date);
  const [metodo, setMetodo] = useState('');
  const [metodos, setMetodos] = useState<CatalogOption[]>([]);

  const [timeMode, setTimeMode] = useState<ScheduleTimeMode>(time ? ScheduleTimeMode.FIXED : ScheduleTimeMode.LAPSE);
  const [hora, setHora] = useState(/^\d{2}:\d{2}$/.test(time ?? '') ? time! : '09:00');
  const [franja, setFranja] = useState<string>(AgendaTimeSlot.MORNING);
  const [scheduledDate, setScheduledDate] = useState(date);
  const [observations, setObservations] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El día propuesto sigue al que se está mirando mientras no se haya elegido cliente.
  useEffect(() => {
    if (!ctx) { setScheduledDate(date); setPromiseDate(date); }
  }, [date, ctx]);

  /*
   * Búsqueda con freno: sin él, cada tecla es una consulta al servidor y las respuestas vuelven
   * desordenadas — la de «te» puede llegar después de la de «tere» y pisar los resultados buenos.
   */
  useEffect(() => {
    if (q.trim().length < 3) return setHits([]);
    const id = setTimeout(async () => {
      setBuscando(true);
      const res = await fetch(`/api/clients?q=${encodeURIComponent(q.trim())}&limit=8`);
      const body = await res.json().catch(() => ({}));
      setBuscando(false);
      setHits(Array.isArray(body?.data) ? body.data : []);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  // Los medios de pago sólo hacen falta para una promesa: se piden al elegir ese tipo.
  useEffect(() => {
    if (tipo !== AgendaItemType.PROMISE_TO_PAY || metodos.length > 0) return;
    void fetch('/api/catalogs/PAYMENT_METHOD')
      .then((r) => r.json())
      .then((b) => setMetodos(Array.isArray(b?.data) ? b.data : []))
      .catch(() => setMetodos([]));
  }, [tipo, metodos.length]);

  async function elegirCliente(clientId: string) {
    setError(null);
    setBuscando(true);
    const res = await fetch(`/api/agenda/context/${clientId}`);
    const body = await res.json().catch(() => ({}));
    setBuscando(false);
    if (!res.ok) return setError(body?.error?.message ?? t('create.contextError'));
    const data = body as Ctx;
    setCtx(data);
    setCreditId(data.credits[0]?.creditId ?? '');
    setContactId(data.contacts.find((c) => c.isPrimary)?.id ?? data.contacts[0]?.id ?? '');
    setLocationId(data.locations[0]?.id ?? '');
  }

  function details(): Record<string, unknown> {
    switch (tipo) {
      case AgendaItemType.CALL:
        return { contactId };
      case AgendaItemType.WHATSAPP:
        return { contactId, message: mensaje };
      case AgendaItemType.REMINDER:
        return { description: descripcion };
      case AgendaItemType.VISIT:
        return { locationId };
      default:
        return { amount: Number(monto) || 0, promiseDate, paymentMethodCode: metodo };
    }
  }

  async function guardar() {
    setError(null);
    setSaving(true);
    const res = await postJson('/api/agenda', {
      caseId: credito!.caseId,
      creditId,
      type: tipo,
      details: details(),
      scheduledDate,
      timeMode,
      ...(timeMode === ScheduleTimeMode.FIXED ? { scheduledTime: hora } : { timeSlot: franja }),
      ...(observations.trim() ? { observations: observations.trim() } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      // El servidor dice qué falta, campo por campo: repetir la regla acá sería una segunda copia.
      return setError(res.data.error?.message ?? t('create.error'));
    }
    toast(t('create.done'));
    cerrar();
    router.refresh();
  }

  function cerrar() {
    setCtx(null);
    setQ('');
    setHits([]);
    setError(null);
    setMensaje('');
    setDescripcion('');
    setMonto('');
    setObservations('');
    onClose();
  }

  /** El crédito elegido, que es de donde salen los dos ids que pide el alta. */
  const credito = ctx?.credits.find((c) => c.creditId === creditId);
  /** Sin crédito no hay gestión: el resto de lo que falte lo dice el servidor con su mensaje. */
  const puede = Boolean(credito);

  return (
    <Modal
      wide
      open={open}
      onClose={cerrar}
      title={t('create.title')}
      actions={
        <>
          <span className="sm:w-40">
            <Button variant="ghost" onClick={cerrar} disabled={saving}>
              {t('create.cancel')}
            </Button>
          </span>
          <span className="sm:w-48">
            <Button onClick={() => void guardar()} loading={saving} disabled={!puede}>
              {t('create.confirm')}
            </Button>
          </span>
        </>
      }
    >
      <ErrorBanner message={error} />

      {!ctx ? (
        <>
          {/*
           * Primero el deudor, siempre. Una gestión cuelga de un caso, y el caso de un crédito suyo:
           * sin cliente no hay nada que agendar, así que preguntar el tipo antes sería pedir un dato
           * que todavía no significa nada.
           */}
          <Field label={t('create.searchClient')}>
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('create.searchHint')}
            />
          </Field>
          <div className="mt-3 min-h-[80px]">
            {buscando && <p className="text-[13px] text-k-text-2">{t('create.searching')}</p>}
            {!buscando && q.trim().length >= 3 && hits.length === 0 && (
              <p className="text-[13px] text-k-text-2">{t('create.noClients')}</p>
            )}
            <ul className="space-y-1">
              {hits.map((c) => {
                const nombre = c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void elegirCliente(c.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-k-border bg-white px-3 py-2.5 text-left text-[14px] text-k-text hover:bg-k-bg"
                    >
                      <span>{nombre}</span>
                      {/* El carnet enmascarado: con dos «Teresa Mamani» es lo único que las separa. */}
                      {c.nationalId && <span className="text-[12px] text-k-muted">{c.nationalId}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-k-border bg-k-bg px-3 py-2.5">
            <span className="text-[14px] font-medium text-k-text">{ctx.client.displayName}</span>
            <button type="button" onClick={() => setCtx(null)} className="text-[13px] font-medium text-k-periwinkle hover:underline">
              {t('create.changeClient')}
            </button>
          </div>

          {/* Sin caso agendable no hay nada que hacer con este deudor, y conviene decirlo entero. */}
          {ctx.credits.length === 0 ? (
            <p className="rounded-xl bg-k-warning-bg px-3 py-2.5 text-[13px] text-k-warning-text">{t('create.noCases')}</p>
          ) : (
            <Field label={t('create.credit')}>
              <Select value={creditId} onChange={(e) => setCreditId(e.target.value)} disabled={saving}>
                {ctx.credits.map((c) => (
                  <option key={c.creditId} value={c.creditId}>
                    {(c.code ?? t('create.noCode')) + ' · ' + money(c.outstandingBalance, c.currency)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t('create.type')}>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as AgendaItemType)} disabled={saving}>
              {TIPOS.map((v) => (
                <option key={v} value={v}>
                  {t(`type.${v}`)}
                </option>
              ))}
            </Select>
          </Field>

          {/* Lo que cada tipo necesita. El servidor exige exactamente esto y nada más. */}
          {(tipo === AgendaItemType.CALL || tipo === AgendaItemType.WHATSAPP) && (
            <Field label={t('create.contact')}>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={saving}>
                {ctx.contacts.length === 0 && <option value="">{t('create.noContacts')}</option>}
                {ctx.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.value} {c.isPrimary ? `· ${t('create.primary')}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {tipo === AgendaItemType.WHATSAPP && (
            <Field label={t('create.message')}>
              <Input value={mensaje} onChange={(e) => setMensaje(e.target.value)} disabled={saving} maxLength={1000} />
            </Field>
          )}

          {tipo === AgendaItemType.VISIT && (
            <Field label={t('create.location')}>
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={saving}>
                {ctx.locations.length === 0 && <option value="">{t('create.noLocations')}</option>}
                {ctx.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.address ?? '—'} {l.zone ? `· ${l.zone}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {tipo === AgendaItemType.REMINDER && (
            <Field label={t('create.description')}>
              <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} disabled={saving} maxLength={500} />
            </Field>
          )}

          {tipo === AgendaItemType.PROMISE_TO_PAY && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('create.amount')}>
                <Input value={monto} onChange={(e) => setMonto(e.target.value)} disabled={saving} type="number" min={0} step="0.01" />
              </Field>
              <Field label={t('create.promiseDate')}>
                <Input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} disabled={saving} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('create.method')}>
                  <Select value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={saving}>
                    <option value="">{t('create.pickMethod')}</option>
                    {metodos.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label || m.code}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {/*
           * Cuándo. Son dos formas de programar y no una hora que a veces falta: la franja es lo
           * normal cuando se sale a la calle, y la hora exacta cuando hay una cita.
           */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('create.date')}>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} disabled={saving} />
            </Field>
            <Field label={t('create.timeMode')}>
              <Select value={timeMode} onChange={(e) => setTimeMode(e.target.value as ScheduleTimeMode)} disabled={saving}>
                <option value={ScheduleTimeMode.LAPSE}>{t('create.modeLapse')}</option>
                <option value={ScheduleTimeMode.FIXED}>{t('create.modeFixed')}</option>
              </Select>
            </Field>
            {timeMode === ScheduleTimeMode.FIXED ? (
              <Field label={t('create.time')}>
                <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} disabled={saving} />
              </Field>
            ) : (
              <Field label={t('create.slot')}>
                <Select value={franja} onChange={(e) => setFranja(e.target.value)} disabled={saving}>
                  {Object.values(AgendaTimeSlot).map((s) => (
                    <option key={s} value={s}>
                      {t(`timeSlot.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field label={t('create.observations')}>
            <Input value={observations} onChange={(e) => setObservations(e.target.value)} disabled={saving} maxLength={500} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
