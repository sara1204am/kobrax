'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Section, EmptyState } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';

/** Lo que devuelve `GET /catalogs/WHATSAPP_TEMPLATE` (el cuerpo viaja en `metadata.body`). */
export interface TemplateItem {
  id: string;
  code: string;
  label: string;
  metadata?: { body?: string } | null;
}

/** Qué está abierto: el alta, la edición de una, o la confirmación de quitar. */
type Editing = { id?: string; label: string; body: string } | null;

/**
 * Tres puntos de partida, del más suave al más firme — la escalera real de un recordatorio de
 * cobranza. Tocarlos abre el modal **precargado**, no guarda: el tono es de la casa y se ajusta.
 *
 * En español fijo y no en i18n: es contenido PARA EL DEUDOR, no UI del panel — y además las
 * llaves de `{{cliente}}` chocarían con el formato ICU de los mensajes.
 */
const EJEMPLOS = [
  {
    key: 'suave',
    label: 'Recordatorio amable',
    body: 'Hola {{cliente}}, le saludamos de {{negocio}}. Le recordamos que tiene una cuota pendiente por {{saldo}}. Si ya realizó el pago, ignore este mensaje. ¡Gracias!',
  },
  {
    key: 'media',
    label: 'Pago vencido',
    body: 'Hola {{cliente}}, le escribimos de {{negocio}}. Su cuenta registra un saldo vencido de {{saldo}}. Le pedimos regularizarlo a la brevedad, o contactarnos para acordar una forma de pago.',
  },
  {
    key: 'firme',
    label: 'Último aviso',
    body: 'Sr./Sra. {{cliente}}: su deuda de {{saldo}} con {{negocio}} sigue pendiente pese a los avisos anteriores. De no regularizarla en las próximas 48 horas, continuaremos con las acciones de cobranza que correspondan.',
  },
] as const;

/**
 * Plantillas de WhatsApp de la cuenta.
 *
 * El consumidor existe hace rato: el móvil las ofrece al mandar un WhatsApp desde una gestión
 * (`agenda-register.tsx`), con las variables ya resueltas. Lo que no existía era **quién las
 * crea** — nacían por seed o por SQL. Este editor es esa pieza: lista, alta, edición y quitar
 * sobre el CRUD de catálogos que la API ya tenía.
 *
 * `catalog:write` gobierna los botones (la API lo valida igual); sin él la sección es de lectura.
 */
export function WhatsappTemplates({ items }: { items: TemplateItem[] }) {
  const t = useTranslations('account.templates');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('catalog:write');

  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<TemplateItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const { ok, data } = editing.id
      ? await sendJson(
          `/api/catalogs/WHATSAPP_TEMPLATE/${editing.id}`,
          { label: editing.label.trim(), metadata: { body: editing.body.trim() } },
          'PATCH',
        )
      : await sendJson(
          '/api/catalogs/WHATSAPP_TEMPLATE',
          {
            // El code es interno (el móvil elige por id/label); único y estable alcanza.
            code: `tpl-${Date.now().toString(36)}`,
            label: editing.label.trim(),
            metadata: { body: editing.body.trim() },
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
    setRemoving(null);
    if (!ok) {
      toast(data.error?.message ?? t('saveError'), 'danger');
      return;
    }
    toast(t('removed'));
    router.refresh();
  }

  return (
    <Section title={t('title')} inner="p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">
        {t('intro')}{' '}
        {/* Las variables son contrato con el móvil (`renderTemplate`): se nombran acá para que
            no haya que adivinarlas. */}
        <code className="rounded bg-k-bg px-1 text-[12px]">{'{{cliente}}'}</code>{' '}
        <code className="rounded bg-k-bg px-1 text-[12px]">{'{{saldo}}'}</code>{' '}
        <code className="rounded bg-k-bg px-1 text-[12px]">{'{{negocio}}'}</code>
      </p>

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
                  onClick={() => setEditing({ label: e.label, body: e.body })}
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
        <ul className="mt-4 divide-y divide-k-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-k-text">{item.label}</p>
                <p className="mt-0.5 whitespace-pre-line text-[13px] text-k-text-2">
                  {item.metadata?.body ?? ''}
                </p>
              </div>
              {editable && (
                <span className="flex shrink-0 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: item.id, label: item.label, body: item.metadata?.body ?? '' })
                    }
                    className="text-[13px] font-medium text-k-purple hover:underline"
                  >
                    {t('edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(item)}
                    className="text-[13px] font-medium text-k-danger hover:underline"
                  >
                    {t('remove')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setEditing({ label: '', body: '' })}
            className="text-[13px] font-medium text-k-purple hover:underline"
          >
            {t('add')}
          </button>
        </div>
      )}

      <Modal
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
          <div className="space-y-4">
            <ErrorBanner message={error} />
            <Field label={t('label')} hint={t('labelHint')}>
              <Input
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                maxLength={60}
              />
            </Field>
            <Field label={t('body')} hint={t('bodyHint')}>
              <textarea
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                rows={5}
                aria-label={t('body')}
                className="w-full rounded-xl border border-k-border bg-white px-3 py-2 text-[14px] text-k-text outline-none focus:border-k-periwinkle"
              />
            </Field>
          </div>
        )}
      </Modal>

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
