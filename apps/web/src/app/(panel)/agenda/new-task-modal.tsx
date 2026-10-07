'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AgendaItemType, AgendaTimeSlot, renderTemplate, ScheduleTimeMode, type AgendaAssignee, type AgendaListItem } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { TONES, type Tone } from '@/components/tone-tile';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';
import { money } from '@/lib/format';
import type { PortfolioRow } from '@/lib/portfolio';
import { LocationPicker, type Loc } from './location-picker';

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

/**
 * El icono y el color de cada tipo: los mismos que pinta el historial de la mora (llamada verde, visita
 * violeta, mensaje turquesa), para que una gestión se reconozca igual al agendarla que al verla hecha.
 */
const TIPO_LOOK: Record<(typeof TIPOS)[number], { tone: Tone; icon: ReactNode }> = {
  [AgendaItemType.CALL]: {
    tone: 'green',
    icon: <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />,
  },
  [AgendaItemType.VISIT]: {
    tone: 'purple',
    icon: <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />,
  },
  [AgendaItemType.WHATSAPP]: {
    tone: 'teal',
    icon: <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />,
  },
  [AgendaItemType.REMINDER]: {
    tone: 'amber',
    icon: <path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z" />,
  },
  [AgendaItemType.PROMISE_TO_PAY]: {
    tone: 'blue',
    icon: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15.5V19h-2v-1.5a3.5 3.5 0 0 1-2.5-2.2l1.8-.8c.3.8.9 1.2 1.7 1.2.9 0 1.4-.4 1.4-1 0-.6-.4-.9-1.7-1.3-1.6-.5-3-1.1-3-2.9 0-1.3.9-2.3 2.3-2.7V7h2v1.4c1 .2 1.8.9 2.1 1.9l-1.7.7c-.2-.6-.7-1-1.4-1-.8 0-1.2.4-1.2.9 0 .5.4.8 1.6 1.2 1.7.5 3.1 1.1 3.1 3 0 1.4-1 2.4-2.5 2.9z" />,
  },
};

interface Ctx {
  client: { id: string; displayName: string; nationalId: string | null };
  /** TODOS los créditos del deudor que ve quien agenda (F4/08): al día o en mora. */
  credits: { creditId: string; code?: string; principalAmount: number; outstandingBalance: number; overdueAmount: number; currency: string; daysPastDue: number }[];
  contacts: { id: string; contactType: string; value: string; isPrimary: boolean }[];
  /**
   * Direcciones **en claro**. `latitude`/`longitude` pueden faltar: una dirección importada de un
   * extracto trae texto y nada más, y es justamente la que hay que ir a marcar al mapa.
   */
  locations: Loc[];
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
  editing,
  assign,
}: {
  open: boolean;
  onClose: () => void;
  /** El día que se está mirando: es el que se propone, no «hoy». */
  date: string;
  /** La hora del hueco desde el que se abrió, si vino de uno. */
  time?: string;
  /**
   * Modo edición: la gestión que se corrige. El deudor, el crédito y el día quedan fijos (el ancla del agendado y
   * mover el día es reagendar); el tipo, sus datos, la hora y las observaciones se pueden cambiar.
   */
  editing?: AgendaListItem;
  /** Solo para quien puede asignar (`agenda:assign`): muestra el selector «Asignar a». */
  assign?: { meId: string };
}) {
  const t = useTranslations('panel.agenda');
  const router = useRouter();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PortfolioRow[]>([]);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [buscando, setBuscando] = useState(false);

  /**
   * El crédito elegido. La gestión cuelga del crédito (F4/08): ya no hace falta un caso abierto, así que
   * también se agendan acciones preventivas sobre un crédito al día.
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
  /** Plantillas de WhatsApp de la cuenta (catálogo `WHATSAPP_TEMPLATE`): las mismas que ofrece el teléfono. */
  const [plantillas, setPlantillas] = useState<{ code: string; label: string; metadata?: { body?: string } }[]>([]);

  const [timeMode, setTimeMode] = useState<ScheduleTimeMode>(time ? ScheduleTimeMode.FIXED : ScheduleTimeMode.LAPSE);
  const [hora, setHora] = useState(/^\d{2}:\d{2}$/.test(time ?? '') ? time! : '09:00');
  const [franja, setFranja] = useState<string>(AgendaTimeSlot.MORNING);
  const [scheduledDate, setScheduledDate] = useState(date);
  const [observations, setObservations] = useState('');

  /** A quién se asigna. Vacío = el de siempre (el responsable del crédito, o quien agenda). */
  const [assigneeId, setAssigneeId] = useState('');
  const [assignees, setAssignees] = useState<AgendaAssignee[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El día propuesto sigue al que se está mirando mientras no se haya elegido cliente.
  useEffect(() => {
    if (!ctx && !editing) { setScheduledDate(date); setPromiseDate(date); }
  }, [date, ctx, editing]);

  // Personas a las que se puede asignar: sólo se piden si quien agenda puede asignar, y no al editar.
  useEffect(() => {
    if (!assign) return;
    void fetch('/api/agenda/assignees')
      .then((r) => r.json())
      .then((b) => setAssignees(Array.isArray(b?.data) ? b.data : []))
      .catch(() => setAssignees([]));
  }, [assign]);

  // Editar: se precarga lo guardado y se trae el contexto del deudor (teléfonos, direcciones) sin elegirlo de nuevo.
  useEffect(() => {
    if (!editing) return;
    const d = editing.details;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    setTipo(editing.type);
    setContactId(str(d.contactId));
    setLocationId(str(d.locationId));
    setMensaje(str(d.message));
    setDescripcion(str(d.description));
    setMonto(typeof d.amount === 'number' ? String(d.amount) : '');
    setPromiseDate(str(d.promiseDate) || editing.scheduledDate.slice(0, 10));
    setMetodo(str(d.paymentMethodCode));
    setTimeMode(editing.timeMode);
    setHora(editing.scheduledTime ?? '09:00');
    setFranja(editing.timeSlot ?? AgendaTimeSlot.MORNING);
    setScheduledDate(editing.scheduledDate.slice(0, 10));
    setObservations(editing.observations ?? '');
    setAssigneeId(editing.assigneeId);
    void elegirCliente(editing.clientId, editing.creditId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

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

  // Las plantillas sólo hacen falta para un WhatsApp: se piden al elegir ese tipo.
  useEffect(() => {
    if (tipo !== AgendaItemType.WHATSAPP || plantillas.length > 0) return;
    void fetch('/api/catalogs/WHATSAPP_TEMPLATE')
      .then((r) => r.json())
      .then((b) => setPlantillas(Array.isArray(b?.data) ? b.data : []))
      .catch(() => setPlantillas([]));
  }, [tipo, plantillas.length]);

  async function elegirCliente(clientId: string, keepCreditId?: string) {
    setError(null);
    setBuscando(true);
    const res = await fetch(`/api/agenda/context/${clientId}`);
    const body = await res.json().catch(() => ({}));
    setBuscando(false);
    if (!res.ok) return setError(body?.error?.message ?? t('create.contextError'));
    const data = body as Ctx;
    setCtx(data);
    // Editando, el crédito y los datos ya están precargados: no se pisan con los de por omisión.
    if (keepCreditId) return setCreditId(keepCreditId);
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
    const horario = timeMode === ScheduleTimeMode.FIXED ? { scheduledTime: hora } : { timeSlot: franja };
    // Editar manda sólo lo editable (sin día, crédito ni responsable); las observaciones vacías limpian las anteriores.
    const res = editing
      ? await sendJson(
          `/api/agenda/${editing.id}`,
          {
            type: tipo,
            details: details(),
            timeMode,
            ...horario,
            observations: observations.trim(),
            // Reasignar: solo si cambió (quien reasigna es el creador; la API valida el destinatario).
            ...(assigneeId && assigneeId !== editing.assigneeId ? { assigneeId } : {}),
          },
          'PATCH',
        )
      : await postJson('/api/agenda', {
          creditId,
          type: tipo,
          details: details(),
          scheduledDate,
          timeMode,
          ...horario,
          ...(observations.trim() ? { observations: observations.trim() } : {}),
          ...(assigneeId ? { assigneeId } : {}),
        });
    setSaving(false);
    if (!res.ok) {
      // El servidor dice qué falta, campo por campo: repetir la regla acá sería una segunda copia.
      return setError(res.data.error?.message ?? t(editing ? 'edit.error' : 'create.error'));
    }
    toast(t(editing ? 'edit.done' : 'create.done'));
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

  /** El crédito elegido. */
  const credito = ctx?.credits.find((c) => c.creditId === creditId);
  /** Sin crédito no hay gestión: el resto de lo que falte lo dice el servidor con su mensaje. */
  /*
   * Una visita exige la dirección CON punto en el mapa (la API lo rechaza con AGENDA_013): se avisa y se frena antes de mandarla,
   * en vez de dejar que choque. El aviso y el mapa para marcarlo están en el selector de dirección.
   */
  const lugar = ctx?.locations.find((l) => l.id === locationId);
  const visitaSinPunto = tipo === AgendaItemType.VISIT && !(lugar?.latitude != null && lugar.longitude != null);
  const puede = Boolean(credito) && !visitaSinPunto;

  return (
    <Modal
      wide
      open={open}
      onClose={cerrar}
      title={t(editing ? 'edit.title' : 'create.title')}
      actions={
        <>
          <span className="sm:w-40">
            <Button variant="ghost" onClick={cerrar} disabled={saving}>
              {t('create.cancel')}
            </Button>
          </span>
          <span className="sm:w-48">
            <Button onClick={() => void guardar()} loading={saving} disabled={!puede}>
              {t(editing ? 'edit.confirm' : 'create.confirm')}
            </Button>
          </span>
        </>
      }
    >
      <ErrorBanner message={error} />

      {!ctx && editing ? (
        <p className="text-[13px] text-k-text-2">{t('create.searching')}</p>
      ) : !ctx ? (
        <>
          {/*
           * Primero el deudor, siempre. Una gestión cuelga de un crédito suyo:
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
            {!editing && (
              <button type="button" onClick={() => setCtx(null)} className="text-[13px] font-medium text-k-periwinkle hover:underline">
                {t('create.changeClient')}
              </button>
            )}
          </div>

          {/* Sin ningún crédito visible no hay nada que agendar, y conviene decirlo entero. */}
          {ctx.credits.length === 0 ? (
            <p className="rounded-xl bg-k-warning-bg px-3 py-2.5 text-[13px] text-k-warning-text">{t('create.noCredits')}</p>
          ) : (
            <Field label={t('create.credit')}>
              <Select value={creditId} onChange={(e) => setCreditId(e.target.value)} disabled={saving || !!editing}>
                {ctx.credits.map((c) => (
                  <option key={c.creditId} value={c.creditId}>
                    {(c.code ?? t('create.noCode')) +
                      ' · ' +
                      money(c.outstandingBalance, c.currency) +
                      ' · ' +
                      (c.daysPastDue > 0 ? t('create.inArrears', { days: c.daysPastDue }) : t('create.current'))}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {assign && (
            <Field label={editing ? t('detail.assignee') : t('create.assignTo')}>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={saving}>
                {/* Al crear, sin elegir se asigna al responsable del crédito; al editar siempre hay uno actual. */}
                {editing ? (
                  !assignees.some((a) => a.userId === editing.assigneeId) && <option value={editing.assigneeId}>{editing.assigneeName ?? '—'}</option>
                ) : (
                  <option value="">{t('create.assignDefault')}</option>
                )}
                {assignees.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {[a.firstName, a.lastName].filter(Boolean).join(' ') || '—'}
                    {a.userId === assign.meId ? ` (${t('create.me')})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div>
            <span id="tipo-gestion" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-k-text-2">
              {t('create.type')}
            </span>
            <div role="radiogroup" aria-labelledby="tipo-gestion" className="flex flex-wrap gap-2">
              {TIPOS.map((v) => {
                const on = tipo === v;
                const look = TIPO_LOOK[v];
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={saving}
                    onClick={() => setTipo(v)}
                    className={`flex items-center gap-2 rounded-full border-[1.5px] py-1 pl-1 pr-3 text-[13px] font-medium transition-colors disabled:opacity-60 ${
                      on
                        ? 'border-k-periwinkle bg-k-highlight text-k-navy shadow-k-focus'
                        : 'border-k-border bg-white text-k-text hover:bg-k-bg'
                    }`}
                  >
                    <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full ${TONES[look.tone].tile}`}>
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                        {look.icon}
                      </svg>
                    </span>
                    {t(`type.${v}`)}
                  </button>
                );
              })}
            </div>
          </div>

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
              <div className="space-y-2">
                {plantillas.length > 0 && (
                  <div className="flex flex-wrap gap-2" aria-label={t('create.templates')}>
                    {plantillas.map((p) => (
                      <button
                        key={p.code}
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          setMensaje(
                            renderTemplate(p.metadata?.body ?? '', {
                              cliente: ctx.client.displayName,
                              saldo: credito ? money(credito.outstandingBalance, credito.currency) : undefined,
                            }),
                          )
                        }
                        className="rounded-full border border-k-border bg-white px-3 py-1.5 text-[13px] font-medium text-k-text hover:bg-k-bg disabled:opacity-60"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  disabled={saving}
                  maxLength={1000}
                  rows={4}
                  placeholder={t('create.messageHint')}
                  className="w-full rounded-xl border-[1.5px] border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle"
                />
              </div>
            </Field>
          )}

          {tipo === AgendaItemType.VISIT && (
            <LocationPicker
              locations={ctx.locations}
              value={locationId}
              onChange={setLocationId}
              onAdded={(l) => {
                // Entra a la lista y queda elegida: se cargó para usarla ahora, no para después.
                setCtx({ ...ctx, locations: [...ctx.locations, l] });
                setLocationId(l.id);
              }}
              onUpdated={(l) => setCtx({ ...ctx, locations: ctx.locations.map((x) => (x.id === l.id ? l : x)) })}
              clientId={ctx.client.id}
              disabled={saving}
            />
          )}

          {tipo === AgendaItemType.REMINDER && (
            <Field label={t('create.description')}>
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                disabled={saving}
                maxLength={500}
                rows={3}
                className="w-full rounded-xl border-[1.5px] border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle disabled:opacity-60"
              />
            </Field>
          )}

          {tipo === AgendaItemType.PROMISE_TO_PAY && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('create.amount')}>
                <Input value={monto} onChange={(e) => setMonto(e.target.value)} disabled={saving} type="number" min={0} step="0.01" />
              </Field>
              {/* Referencia de sólo lectura, igual que en el teléfono: se negocia el monto mirando estos números. */}
              {credito && (
                <dl className="grid grid-cols-3 gap-3 rounded-xl border border-k-border bg-k-bg px-3 py-2.5 sm:col-span-2">
                  {(
                    [
                      ['principal', credito.principalAmount],
                      ['overdue', credito.overdueAmount],
                      ['outstanding', credito.outstandingBalance],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-k-text-2">{t(`create.ref.${k}`)}</dt>
                      <dd className="text-[14px] font-medium text-k-text">{money(v, credito.currency)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Field label={t('create.promiseDate')}>
                <Input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} disabled={saving || !!editing} />
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('create.date')}>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} disabled={saving || !!editing} />
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
            <textarea
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                disabled={saving}
                maxLength={500}
                rows={3}
                className="w-full rounded-xl border-[1.5px] border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle disabled:opacity-60"
              />
          </Field>
        </div>
      )}
    </Modal>
  );
}
