'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_VARIABLES,
  formatCurrency,
  isTemplateCategory,
  missingTemplateKeys,
  renderTemplate,
  unknownTemplateKeys,
  type CurrencyCode,
  type TemplateCategory,
  type TemplateVariable,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Badge, Section, EmptyState, Segmented } from '@/components/panel-ui';
import { DictationButton } from '@/components/dictation-button';
import { Modal } from '@/components/modal';
import { SendWhatsappDialog } from '@/components/send-whatsapp-dialog';
import { useAccountBrand } from '@/components/account-brand';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { TEMPLATE_SUGGESTIONS, TEMPLATE_TONES, type TemplateTone } from '@/lib/template-suggestions';

/** Lo que devuelve `GET /catalogs/WHATSAPP_TEMPLATE` (el cuerpo viaja en `metadata.body`, la categoría en `metadata.category`). */
export interface TemplateItem {
  id: string;
  code: string;
  label: string;
  metadata?: { body?: string; category?: string } | null;
}

/** El tope del mensaje: el mismo que el campo de WhatsApp de la agenda. */
const MAX_BODY = 1000;

/** Qué está abierto en el modal: el alta o la edición de una. `extra` conserva lo que otras plataformas hayan guardado. */
type Editing = {
  id?: string;
  label: string;
  body: string;
  category: TemplateCategory | '';
  extra: Record<string, unknown>;
} | null;

type Sample = Record<TemplateVariable, string>;

/**
 * Tres puntos de partida para la lista vacía, del más suave al más firme — la escalera real de un recordatorio de
 * cobranza. Tocarlos abre el modal **precargado**, no guarda: el tono es de la casa y se ajusta. Salen de las
 * mismas sugerencias por categoría que ofrece el modal.
 */
const EJEMPLOS = (
  [
    ['suave', 'REMINDER', 'AMABLE'],
    ['media', 'INITIAL', 'FORMAL'],
    ['firme', 'LAST_NOTICE', 'FIRME'],
  ] as const
).map(([key, category, tone]) => ({ key, category, ...TEMPLATE_SUGGESTIONS[category][tone] }));

const categoryOf = (item: TemplateItem): TemplateCategory | undefined =>
  isTemplateCategory(item.metadata?.category) ? item.metadata.category : undefined;

/**
 * Plantillas de WhatsApp de la cuenta.
 *
 * El consumidor existe hace rato: el móvil las ofrece al mandar un WhatsApp desde una gestión
 * (`agenda-register.tsx`), con las variables ya resueltas. Lo que no existía era **quién las
 * crea** — nacían por seed o por SQL. Este editor es esa pieza: lista con vista previa, alta,
 * edición y quitar sobre el CRUD de catálogos que la API ya tenía.
 *
 * Acá se **configura** el mensaje, con datos de ejemplo. Copiarlo o abrir WhatsApp con un deudor real
 * es otra cosa y vive donde está el deudor (el detalle de la gestión), no en esta pantalla.
 *
 * `catalog:write` gobierna los botones (la API lo valida igual); sin él la sección es de lectura.
 */
export function WhatsappTemplates({
  items,
  currency,
  currencyDecimals,
}: {
  items: TemplateItem[];
  /** La moneda de la cuenta, para que el saldo de ejemplo se vea como lo verá el deudor. */
  currency?: string;
  currencyDecimals?: number;
}) {
  const t = useTranslations('account.templates');
  const tw = useTranslations('panel.whatsapp');
  const router = useRouter();
  const toast = useToast();
  const brand = useAccountBrand();
  const { can } = usePermissions();
  const editable = can('catalog:write');
  // Escribirle a un deudor es de quien registra gestiones, no de quien edita el catálogo.
  const canSend = can('collection:write');
  const [sending, setSending] = useState(false);

  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<TemplateItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TemplateCategory | 'ALL'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<TemplateTone>('AMABLE');

  // Datos inventados y rotulados como tales: jamás son los de un deudor real. Se editan en el modal.
  const [sample, setSample] = useState<Sample>(() => ({
    cliente: 'Juan Pérez',
    saldo: sampleBalance(currency, currencyDecimals),
    negocio: brand?.name ?? 'Mi Negocio',
    telefono_negocio: brand?.phone ?? '70000000',
  }));

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  /** Dónde estaba el cursor al salir del campo; `null` = nunca se tocó, y se inserta al final. */
  const caret = useRef<{ start: number; end: number } | null>(null);
  /** Dónde dejar el cursor después del próximo render (lo que se acaba de insertar). */
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [editing?.body]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c: Partial<Record<TemplateCategory, number>> = {};
    for (const i of items) {
      const k = categoryOf(i);
      if (k) c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === 'ALL' || categoryOf(i) === filter) &&
        (!q || i.label.toLowerCase().includes(q) || (i.metadata?.body ?? '').toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

  function open(next: Editing) {
    caret.current = null;
    pendingCaret.current = null;
    setError(null);
    setEditing(next);
  }

  function edit(item: TemplateItem) {
    const { body, category, ...extra } = item.metadata ?? {};
    open({ id: item.id, label: item.label, body: body ?? '', category: isTemplateCategory(category) ? category : '', extra });
  }

  /** Mete texto donde estaba el cursor (o reemplaza lo seleccionado); sin foco previo, al final. */
  function insertText(raw: string, spaced = false) {
    if (!editing) return;
    const start0 = Math.min(caret.current?.start ?? editing.body.length, editing.body.length);
    // Lo dictado llega sin espacios en los bordes: se separa de la palabra anterior.
    const token = spaced && start0 > 0 && !/\s$/.test(editing.body.slice(0, start0)) ? ` ${raw}` : raw;
    const start = start0;
    const end = Math.min(caret.current?.end ?? start, editing.body.length);
    const next = editing.body.slice(0, start) + token + editing.body.slice(end);
    if (next.length > MAX_BODY) return;
    pendingCaret.current = start + token.length;
    caret.current = { start: start + token.length, end: start + token.length };
    setEditing({ ...editing, body: next });
  }

  /** Pone el texto sugerido como mensaje (y su nombre, si todavía no hay uno): se ajusta antes de guardar. */
  function applySuggestion(sug: { label: string; body: string }) {
    if (!editing) return;
    caret.current = null;
    pendingCaret.current = sug.body.length;
    setEditing({ ...editing, body: sug.body, label: editing.label.trim() ? editing.label : sug.label });
  }

  const insert = (key: TemplateVariable) => insertText(`{{${key}}}`);

  const unknown = editing ? unknownTemplateKeys(editing.body) : [];

  async function save() {
    if (!editing) return;
    if (unknown.length > 0) return setError(t('unknownBlock', { names: unknown.map((k) => `{{${k}}}`).join(', ') }));
    setBusy(true);
    setError(null);
    const metadata = {
      ...editing.extra,
      body: editing.body.trim(),
      ...(editing.category ? { category: editing.category } : {}),
    };
    const { ok, data } = editing.id
      ? await sendJson(
          `/api/catalogs/WHATSAPP_TEMPLATE/${editing.id}`,
          { label: editing.label.trim(), metadata },
          'PATCH',
        )
      : await sendJson(
          '/api/catalogs/WHATSAPP_TEMPLATE',
          {
            // El code es interno (el móvil elige por id/label); único y estable alcanza.
            code: `tpl-${Date.now().toString(36)}`,
            label: editing.label.trim(),
            metadata,
          },
          'POST',
        );
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setEditing(null);
    toast(t('saved'));
    router.refresh();
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const { ok, data } = await sendJson(`/api/catalogs/WHATSAPP_TEMPLATE/${removing.id}`, null, 'DELETE');
    setBusy(false);
    const gone = removing.id;
    setRemoving(null);
    if (!ok) {
      toast(data.error?.message ?? t('saveError'), 'danger');
      return;
    }
    if (selectedId === gone) setSelectedId(null);
    toast(t('removed'));
    router.refresh();
  }

  return (
    <Section
      title={t('title')}
      inner="p-6"
      action={
        editable ? (
          <Button
            type="button"
            className="sm:w-auto sm:px-5"
            onClick={() => open({ label: '', body: '', category: '', extra: {} })}
          >
            {t('add')}
          </Button>
        ) : undefined
      }
    >
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {items.length === 0 ? (
        <div className="mt-4 space-y-4">
          <EmptyState title={t('empty')} text={editable ? t('emptyHint') : undefined} />
          {editable && (
            <div className="space-y-2">
              <p className="text-[13px] text-k-text-2">{t('examples')}</p>
              {EJEMPLOS.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => open({ label: e.label, body: e.body, category: e.category, extra: {} })}
                  className="block w-full rounded-xl border border-k-border bg-white px-4 py-3 text-left hover:bg-k-bg"
                >
                  <span className="block text-[14px] font-medium text-k-text">{e.label}</span>
                  <span className="mt-0.5 block text-[13px] text-k-text-2">{e.body}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-3">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterBy')}>
              <Chip active={filter === 'ALL'} onClick={() => setFilter('ALL')}>
                {t('all')} ({items.length})
              </Chip>
              {TEMPLATE_CATEGORIES.filter((c) => counts[c]).map((c) => (
                <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>
                  {t(`category.${c}`)} ({counts[c]})
                </Chip>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-k-muted">{t('noResults')}</p>
            ) : (
              <ul className="space-y-2">
                {visible.map((item) => {
                  const cat = categoryOf(item);
                  const on = item.id === selectedId;
                  return (
                    <li
                      key={item.id}
                      className={`flex items-stretch gap-1 rounded-xl border-[1.5px] bg-white transition-colors ${
                        on ? 'border-k-periwinkle bg-k-highlight shadow-k-focus' : 'border-k-border hover:bg-k-bg'
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelectedId(on ? null : item.id)}
                        className="min-w-0 flex-1 rounded-xl px-4 py-3 text-left outline-none focus-visible:shadow-k-focus"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-k-text">{item.label}</span>
                          {cat && <Badge>{t(`category.${cat}`)}</Badge>}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] text-k-text-2">
                          {item.metadata?.body ?? ''}
                        </span>
                      </button>
                      {editable && (
                        <span className="flex shrink-0 items-center gap-3 pr-4">
                          <button
                            type="button"
                            onClick={() => edit(item)}
                            aria-label={`${t('edit')} ${item.label}`}
                            className="text-[13px] font-medium text-k-periwinkle hover:underline"
                          >
                            {t('edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(item)}
                            aria-label={`${t('remove')} ${item.label}`}
                            className="text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
                          >
                            {t('remove')}
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside aria-label={t('previewTitle')} className="min-w-0 rounded-2xl border border-k-border bg-k-bg p-4 lg:sticky lg:top-4 lg:self-start">
            {selected ? (
              <>
                <h3 className="text-[15px] font-semibold text-k-navy">{selected.label}</h3>
                <p className="mb-3 mt-0.5 text-[12px] text-k-muted">{t('previewHint')}</p>
                <MessagePreview body={selected.metadata?.body ?? ''} sample={sample} />
                {canSend && (
                  <div className="mt-3">
                    <Button onClick={() => setSending(true)}>{tw('sendToClient')}</Button>
                  </div>
                )}
              </>
            ) : (
              <p className="py-10 text-center text-[13px] text-k-muted">{t('pickOne')}</p>
            )}
          </aside>
        </div>
      )}

      <Modal
        wide
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('editTitle') : t('addTitle')}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button
                loading={busy}
                disabled={!editing?.label.trim() || !editing?.body.trim()}
                onClick={() => void save()}
              >
                {t('save')}
              </Button>
            </span>
          </>
        }
      >
        {editing && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-4">
              <ErrorBanner message={error} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('label')} hint={t('labelHint')}>
                  <Input
                    value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    maxLength={60}
                  />
                </Field>
                <Field label={t('categoryLabel')} hint={t('categoryHint')}>
                  <Select
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({ ...editing, category: isTemplateCategory(e.target.value) ? e.target.value : '' })
                    }
                  >
                    <option value="">{t('noCategory')}</option>
                    {TEMPLATE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`category.${c}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label={t('body')}
                error={unknown.length > 0 ? t('unknownVars', { names: unknown.map((k) => `{{${k}}}`).join(', ') }) : null}
                hint={t('bodyHint')}
              >
                <textarea
                  ref={bodyRef}
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  onSelect={(e) =>
                    (caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
                  }
                  onBlur={(e) =>
                    (caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
                  }
                  rows={5}
                  maxLength={MAX_BODY}
                  aria-label={t('body')}
                  className="w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 py-2.5 text-[15px] text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus"
                />
              </Field>
              <div className="-mt-2 flex items-center justify-between gap-3">
                <DictationButton onText={(text) => insertText(text, true)} onError={(m) => setError(m)} />
                <span className="text-[12px] text-k-muted">
                  {editing.body.length}/{MAX_BODY}
                </span>
              </div>

              <div>
                <p className="mb-2 text-[14px] font-medium text-k-text">
                  {editing.category ? t('suggestionsFor', { category: t(`category.${editing.category}`) }) : t('suggestions')}
                </p>
                {editing.category ? (
                  (() => {
                    const sug = TEMPLATE_SUGGESTIONS[editing.category][tone];
                    return (
                      <div className="space-y-2">
                        <Segmented
                          label={t('tone')}
                          value={tone}
                          onChange={setTone}
                          options={TEMPLATE_TONES.map((v) => ({ value: v, label: t(`tones.${v}`) }))}
                        />
                        <div className="rounded-xl border border-k-border bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-k-text">{sug.label}</p>
                              <p className="mt-0.5 line-clamp-3 text-[12px] text-k-text-2">{sug.body}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => applySuggestion(sug)}
                              aria-label={`${t('useSuggestion')} ${sug.label}`}
                              className="shrink-0 text-[13px] font-medium text-k-periwinkle hover:underline"
                            >
                              {t('useSuggestion')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <p className="text-[12px] text-k-muted">{t('suggestionsPick')}</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-[14px] font-medium text-k-text">{t('insertVariable')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      // No quitar el foco al textarea: así el cursor sigue donde estaba.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insert(v)}
                      className="flex min-h-11 flex-col items-start rounded-xl border border-k-border bg-white px-3 py-2 text-left hover:bg-k-bg focus-visible:shadow-k-focus focus-visible:outline-none"
                    >
                      <span className="text-[13px] text-k-text">{t(`variable.${v}`)}</span>
                      <span className="text-[12px] font-medium text-k-purple">{`{{${v}}}`}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-k-muted">{t('insertHint')}</p>
              </div>
            </div>

            <div className="min-w-0 space-y-4 rounded-2xl border border-k-border bg-k-bg p-4">
              <div>
                <h3 className="text-[15px] font-semibold text-k-navy">{t('previewTitle')}</h3>
                <p className="mt-0.5 text-[12px] text-k-muted">{t('previewHint')}</p>
              </div>
              <MessagePreview body={editing.body} sample={sample} />

              <div className="space-y-3 border-t border-k-border pt-3">
                <div>
                  <h4 className="text-[14px] font-medium text-k-text">{t('sampleTitle')}</h4>
                  <p className="text-[12px] text-k-muted">{t('sampleHint')}</p>
                </div>
                {TEMPLATE_VARIABLES.map((v) => (
                  <Field key={v} label={t(`sample.${v}`)}>
                    <Input value={sample[v]} onChange={(e) => setSample({ ...sample, [v]: e.target.value })} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <SendWhatsappDialog
        open={sending}
        onClose={() => setSending(false)}
        templates={items}
        templateCode={selected?.code}
      />

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t('removeTitle', { name: removing.label }) : ''}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void remove()}>
                {t('removeOk')}
              </Button>
            </span>
          </>
        }
      >
        {t('removeText')}
      </Modal>
    </Section>
  );
}

function sampleBalance(currency?: string, decimals?: number): string {
  try {
    return formatCurrency(1250.5, (currency ?? 'BOB') as CurrencyCode, decimals);
  } catch {
    return '1.250,50';
  }
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[13px] font-medium transition-colors ${
        active ? 'border-k-navy bg-k-navy text-white' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * El mensaje como lo vería el deudor, con los datos de EJEMPLO. Lo que no se pudo llenar (una variable
 * sin dato de ejemplo, o una que el sistema no conoce) queda literal y se avisa: nunca se presenta
 * un `{{saldo}}` suelto como si el mensaje estuviera listo.
 */
function MessagePreview({ body, sample }: { body: string; sample: Sample }) {
  const t = useTranslations('account.templates');
  const unknown = unknownTemplateKeys(body);
  const missing = missingTemplateKeys(body, sample);
  const text = renderTemplate(
    body,
    Object.fromEntries(Object.entries(sample).filter(([, v]) => v.trim() !== '')),
  );
  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-k-light-bg p-3" aria-label={t('previewBubble')}>
        <p className="mb-1 text-center text-[11px] font-medium uppercase tracking-wide text-k-text-2">{t('exampleTag')}</p>
        <div className="ml-auto max-w-[92%] whitespace-pre-line break-words rounded-xl rounded-tr-sm bg-k-success-bg px-3 py-2 text-[14px] text-k-text">
          {text.trim() ? text : <span className="text-k-muted">{t('previewEmpty')}</span>}
        </div>
      </div>
      {(unknown.length > 0 || missing.length > 0) && (
        <div role="status" className="rounded-md border-l-[3px] border-k-warning bg-k-warning-bg px-3 py-2 text-[12px] text-k-warning-text">
          {unknown.length > 0 && <p>{t('unknownVars', { names: unknown.map((k) => `{{${k}}}`).join(', ') })}</p>}
          {missing.length > 0 && <p>{t('missingSample', { names: missing.map((k) => `{{${k}}}`).join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}
