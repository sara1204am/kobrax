'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AgendaItemType,
  AgendaTimeSlot,
  RECOVERY_NOTES_MAX_LENGTH,
  ScheduleTimeMode,
  renderTemplate,
  templateKeys,
  whatsappLink,
} from '@kobrax/shared';
import { useAccountBrand } from '@/components/account-brand';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { postJson } from '@/lib/client';
import { fullName, money, todayIso } from '@/lib/format';
import type { PortfolioRow } from '@/lib/portfolio';

/** Una plantilla del catálogo `WHATSAPP_TEMPLATE`. */
export interface WhatsappTemplateOption {
  code: string;
  label: string;
  metadata?: { body?: string } | null;
}

/** Lo que devuelve `GET /api/agenda/context/:clientId`: sus créditos y sus teléfonos en claro (la lectura se audita). */
interface Ctx {
  client: { id: string; displayName: string };
  credits: { creditId: string; code?: string; outstandingBalance: number; currency: string }[];
  contacts: { id: string; contactType: string; value: string; isPrimary: boolean }[];
}

/** La franja del día para agendar «ahora»: no se pide una hora exacta que ya pasó. */
function currentSlot(): AgendaTimeSlot {
  const h = new Date().getHours();
  return h < 12 ? AgendaTimeSlot.MORNING : h < 19 ? AgendaTimeSlot.AFTERNOON : AgendaTimeSlot.NIGHT;
}

/**
 * Escribirle a un deudor por WhatsApp con una plantilla: se arma el mensaje con SUS datos, se copia o se abre la
 * conversación.
 *
 * 🔴 **Abrir WhatsApp no es enviar, y el resultado no se sabe todavía.** `wa.me` abre la conversación con el texto
 * escrito; que el mensaje salga lo decide quien lo manda, y nadie nos avisa. Por eso al abrirlo queda una **gestión de
 * WhatsApp pendiente de resultado** en la agenda (el estado que ya existe para eso): quien escribió dice después cómo
 * terminó —contactado, sin respuesta…— desde ahí, sin que este diálogo le pida un resultado que no tiene.
 *
 * 🔴 **No es la API de WhatsApp Business**: no se envía nada desde Kobrax. Tampoco se copia ni se abre con una variable
 * sin resolver (`{{saldo}}` literal): falta un dato y se dice cuál.
 *
 * Con `clientId` el deudor viene dado (la ficha de mora); sin él se elige de una lista. Los teléfonos se piden al
 * elegir al deudor y no antes: es un dato personal cuya lectura se audita.
 */
export function SendWhatsappDialog({
  open,
  onClose,
  templates: given,
  clientId: fixedClientId,
  creditId: fixedCreditId,
  templateCode: initialTemplate,
}: {
  open: boolean;
  onClose: () => void;
  /** Sin esto, el diálogo pide las plantillas del catálogo al abrirse (`GET /api/catalogs/WHATSAPP_TEMPLATE`). */
  templates?: WhatsappTemplateOption[];
  clientId?: string;
  creditId?: string;
  templateCode?: string;
}) {
  const t = useTranslations('panel.whatsapp');
  const router = useRouter();
  const toast = useToast();
  const brand = useAccountBrand();

  const [fetched, setFetched] = useState<WhatsappTemplateOption[]>([]);
  const templates = given ?? fetched;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PortfolioRow[]>([]);
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [creditId, setCreditId] = useState(fixedCreditId ?? '');
  const [contactId, setContactId] = useState('');
  const [templateCode, setTemplateCode] = useState(initialTemplate ?? '');
  const [message, setMessage] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura empieza limpia: lo que quedó de otro deudor no se arrastra.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFound([]);
    setClientId(fixedClientId ?? '');
    setCtx(null);
    setCreditId(fixedCreditId ?? '');
    setContactId('');
    setTemplateCode(initialTemplate ?? templates[0]?.code ?? '');
    setMessage('');
    setPendingId(null);
    setError(null);
    // Solo al abrir: las props describen el punto de partida, no una dependencia viva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Sin plantillas dadas, se piden al abrir (sin caché: una recién creada en Cuenta tiene que aparecer).
  useEffect(() => {
    if (!open || given) return;
    let live = true;
    void fetch('/api/catalogs/WHATSAPP_TEMPLATE', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        if (!live) return;
        const list: WhatsappTemplateOption[] = Array.isArray(b?.data) ? b.data : [];
        setFetched(list);
        setTemplateCode((cur) => cur || initialTemplate || list[0]?.code || '');
      })
      .catch(() => live && setFetched([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, given]);

  // Buscar deudor (solo cuando no viene dado), con una pausa para no pedir en cada tecla.
  useEffect(() => {
    if (!open || fixedClientId || query.trim().length < 2) return setFound([]);
    const timer = setTimeout(() => {
      void fetch(`/api/clients?q=${encodeURIComponent(query.trim())}&limit=8`)
        .then((r) => r.json())
        .then((b) => setFound(Array.isArray(b?.data) ? b.data : []))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, fixedClientId]);

  // Los datos del deudor elegido: sus créditos (para el saldo) y sus teléfonos.
  useEffect(() => {
    if (!open || !clientId) return setCtx(null);
    let live = true;
    setError(null);
    void fetch(`/api/agenda/context/${clientId}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (!ok || !body?.client) return setError(body?.error?.message ?? t('contextError'));
        const c = body as Ctx;
        setCtx(c);
        setCreditId((cur) => (c.credits.some((x) => x.creditId === cur) ? cur : (c.credits[0]?.creditId ?? '')));
        const phones = c.contacts.filter((x) => x.contactType === 'WHATSAPP' || x.contactType === 'PHONE');
        const best = phones.find((x) => x.contactType === 'WHATSAPP' && x.isPrimary) ?? phones.find((x) => x.isPrimary) ?? phones[0];
        setContactId(best?.id ?? '');
      })
      .catch(() => live && setError(t('contextError')));
    return () => {
      live = false;
    };
  }, [open, clientId, t]);

  const template = templates.find((x) => x.code === templateCode);
  const credit = ctx?.credits.find((c) => c.creditId === creditId);
  const phones = ctx?.contacts.filter((x) => x.contactType === 'WHATSAPP' || x.contactType === 'PHONE') ?? [];
  const phone = phones.find((p) => p.id === contactId)?.value ?? '';

  // El mensaje se arma con los datos reales al cambiar la plantilla, el crédito o el deudor; después se puede ajustar.
  useEffect(() => {
    if (!ctx || !template) return setMessage('');
    setMessage(
      renderTemplate(template.metadata?.body ?? '', {
        cliente: ctx.client.displayName,
        saldo: credit ? money(credit.outstandingBalance, credit.currency) : undefined,
        negocio: brand?.name,
        telefono_negocio: brand?.phone ?? undefined,
      }),
    );
  }, [ctx, template, credit, brand]);

  const pending = useMemo(() => templateKeys(message), [message]);
  const digits = phone.replace(/\D/g, '');
  const validPhone = digits.length >= 8 && digits.length <= 15;

  /** Lo que impide copiar o abrir; `null` = listo. Se dice cuál dato falta. */
  function blocker(): string | null {
    if (!message.trim()) return t('noMessage');
    if (pending.length > 0) return t('incomplete', { names: pending.map((k) => `{{${k}}}`).join(', ') });
    return null;
  }

  function copy() {
    const why = blocker();
    if (why) return setError(why);
    setError(null);
    void navigator.clipboard
      ?.writeText(message)
      .then(() => toast(t('copied')))
      .catch(() => toast(message));
  }

  async function openWhatsapp() {
    const why = blocker() ?? (validPhone ? null : t('invalidPhone'));
    if (why) return setError(why);
    setError(null);
    const tab = window.open(whatsappLink(phone, message), '_blank');
    if (tab) tab.opener = null;
    // Una sola gestión pendiente por apertura del diálogo: volver a abrir la conversación no agenda otra.
    if (pendingId || !creditId || !contactId) return;
    setBusy(true);
    const res = await postJson('/api/agenda', {
      creditId,
      type: AgendaItemType.WHATSAPP,
      details: { contactId, message, ...(template ? { templateCode: template.code } : {}) },
      scheduledDate: todayIso(),
      timeMode: ScheduleTimeMode.LAPSE,
      timeSlot: currentSlot(),
    });
    setBusy(false);
    // `/api/agenda` devuelve la gestión misma (`{ id, … }`), sin el sobre `{ data }`.
    const id = (res.data as { id?: string }).id;
    if (!res.ok || !id) {
      // La conversación ya se abrió: no se tapa con un error, pero se dice que no quedó anotada.
      toast(res.data.error?.message ?? t('pendingError'), 'danger');
      return;
    }
    setPendingId(id);
    toast(t('pendingLogged'));
    router.refresh();
  }

  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={t('title')}
      actions={
        <Button variant="ghost" onClick={onClose} className="sm:w-auto sm:px-5">
          {t('close')}
        </Button>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />

        {!fixedClientId && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('searchClient')} hint={t('searchHint')}>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} />
            </Field>
            <Field label={t('client')}>
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">{found.length === 0 && query.trim().length >= 2 ? t('noResults') : t('pickClient')}</option>
                {found.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fullName(c)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {ctx && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('template')}>
                <Select value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
                  {templates.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('credit')}>
                <Select value={creditId} onChange={(e) => setCreditId(e.target.value)} disabled={ctx.credits.length === 0}>
                  {ctx.credits.length === 0 && <option value="">{t('noCredits')}</option>}
                  {ctx.credits.map((c) => (
                    <option key={c.creditId} value={c.creditId}>
                      {c.code ?? c.creditId.slice(0, 8)} · {money(c.outstandingBalance, c.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('phone')}>
                <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={phones.length === 0}>
                  {phones.length === 0 && <option value="">{t('noPhones')}</option>}
                  {phones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.value}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label={t('message')} hint={t('messageHint')}>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={RECOVERY_NOTES_MAX_LENGTH}
                className="w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 py-2.5 text-[15px] text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus"
              />
            </Field>

            {pending.length > 0 && (
              <p role="status" className="rounded-md border-l-[3px] border-k-warning bg-k-warning-bg px-3 py-2 text-[12px] text-k-warning-text">
                {t('incomplete', { names: pending.map((k) => `{{${k}}}`).join(', ') })}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={copy} className="sm:w-auto sm:px-5">
                {t('copy')}
              </Button>
              <Button onClick={() => void openWhatsapp()} loading={busy} className="sm:w-auto sm:px-5">
                {t('open')}
              </Button>
            </div>

            {/* Abrir no confirma el envío: queda pendiente y el resultado se dice después. */}
            <p className={`rounded-xl border px-3 py-2 text-[12px] ${pendingId ? 'border-k-periwinkle bg-k-highlight text-k-text' : 'border-k-border bg-k-bg text-k-text-2'}`}>
              {pendingId ? (
                <>
                  {t('pendingDone')}{' '}
                  <Link href={`/agenda/${pendingId}`} className="font-medium text-k-periwinkle hover:underline">
                    {t('pendingLink')}
                  </Link>
                </>
              ) : (
                t('pendingHint')
              )}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** El botón que abre el diálogo, para donde el deudor ya está dado (la ficha de mora). Sin plantillas no se ofrece. */
export function SendWhatsappButton({
  templates,
  clientId,
  creditId,
}: {
  templates: WhatsappTemplateOption[];
  clientId: string;
  creditId: string;
}) {
  const t = useTranslations('panel.whatsapp');
  const [open, setOpen] = useState(false);
  if (templates.length === 0) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="sm:w-auto sm:px-5">
        {t('send')}
      </Button>
      <SendWhatsappDialog open={open} onClose={() => setOpen(false)} templates={templates} clientId={clientId} creditId={creditId} />
    </>
  );
}
