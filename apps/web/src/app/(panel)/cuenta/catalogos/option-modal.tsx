'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ledgerMethodOf, PAYMENT_METHODS } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select, Switch, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { sendJson } from '@/lib/client';
import {
  CATALOG_DESCRIPTION_MAX,
  CATALOG_NAME_MAX,
  CODE_MAX,
  codeFromLabel,
  codeProblem,
  descriptionOf,
  type CatalogRow,
  type EditableCatalog,
} from '@/lib/catalog-editor';

/**
 * Alta y edición de una opción del catálogo abierto (un solo formulario para las dos).
 *
 * **Alta:** el código nace del nombre (`codeFromLabel`) hasta que alguien lo toca; se valida el formato y que no esté
 * repetido entre las opciones ya cargadas (también las desactivadas); la API tiene la última palabra y su 409 se muestra
 * junto al campo. **Edición (`item`):** el código no se toca —es lo que el móvil y los registros guardan—; lo demás sí.
 *
 * La descripción y, en los medios de pago, el método del libro (`ledgerMethod`) viajan en `metadata`; al editar se
 * conserva el resto de lo que ya traiga (`requiresBank`, banderas de un motivo…).
 */
export function OptionModal({
  open,
  catalog,
  rows,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  catalog: EditableCatalog;
  rows: CatalogRow[];
  /** La opción a editar; sin ella, es un alta. */
  item?: CatalogRow;
  onClose: () => void;
  onSaved: (row: CatalogRow) => void;
}) {
  const t = useTranslations('account.catalogs');
  const tMethod = useTranslations('panel.payments.method');
  const formId = useId();
  const stateId = useId();
  const stateHintId = useId();
  const editing = item !== undefined;

  const [label, setLabel] = useState(item?.label ?? '');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState(item ? descriptionOf(item) : '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [ledger, setLedger] = useState(item ? (ledgerMethodOf(item) ?? '') : '');
  const [serverCodeError, setServerCodeError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const taken = rows.map((r) => r.code);
  const trimmed = label.trim();
  // Sin tocar el código, se sigue al nombre; en cuanto se edita a mano, se respeta lo escrito.
  const effectiveCode = editing ? item.code : codeTouched ? code : trimmed ? codeFromLabel(trimmed, taken) : '';
  const problem = !editing && effectiveCode ? codeProblem(effectiveCode, taken) : null;
  const codeError =
    serverCodeError || problem === 'duplicate'
      ? t('add.codeDuplicate')
      : problem === 'format'
        ? t('add.codeFormat')
        : null;
  // Un medio de pago se anota en el libro con uno de sus métodos: se propone el de su código, si lo conoce.
  const isPayment = catalog === 'PAYMENT_METHOD';
  const effectiveLedger = ledger || (isPayment && !editing ? (ledgerMethodOf({ code: effectiveCode }) ?? '') : '');
  const valid = trimmed.length > 0 && effectiveCode.length > 0 && !codeError && (!isPayment || effectiveLedger !== '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // `saving` ya está en `true` mientras viaja la petición: un segundo Enter o clic no manda otra.
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    setServerCodeError(false);

    const desc = description.trim();
    const { description: _old, ...kept } = (item?.metadata ?? {}) as Record<string, unknown>;
    const metadata = { ...kept, ...(desc ? { description: desc } : {}), ...(isPayment ? { ledgerMethod: effectiveLedger } : {}) };

    const { ok, data } = editing
      ? await sendJson<{ data?: CatalogRow }>(`/api/catalogs/${catalog}/${item.id}`, { label: trimmed, isActive, metadata }, 'PATCH')
      : await sendJson<{ data?: CatalogRow }>(
          `/api/catalogs/${catalog}`,
          {
            code: effectiveCode,
            label: trimmed,
            isActive,
            sortOrder: rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1,
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          },
          'POST',
        );
    setSaving(false);
    if (!ok || !data.data) {
      if (data.error?.code === 'CATALOG_CODE_DUPLICATE') setServerCodeError(true);
      else setError(data.error?.message ?? t('saveError'));
      return;
    }
    onSaved(data.data);
  }

  function close() {
    if (!saving) onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      locked={saving}
      title={editing ? t('edit.title') : t('add.title')}
      actions={
        <>
          <span className="sm:w-36">
            <Button type="button" variant="ghost" disabled={saving} onClick={close}>
              {t('add.cancel')}
            </Button>
          </span>
          <span className="sm:w-36">
            <Button type="submit" form={formId} loading={saving} disabled={!valid}>
              {t('add.save')}
            </Button>
          </span>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-5">
        <div>
          <p className="text-[13px] font-medium text-k-periwinkle">{t(`names.${catalog}`)}</p>
          <p className="mt-0.5 text-[13px] text-k-text-2">{editing ? t('edit.subtitle') : t('add.subtitle')}</p>
        </div>

        <ErrorBanner message={error} />

        <div>
          <Field label={`${t('add.nameLabel')} *`} hint={t('add.nameHint')}>
            <Input
              value={label}
              maxLength={CATALOG_NAME_MAX}
              placeholder={t('add.namePlaceholder')}
              disabled={saving}
              required
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <p className="mt-1 text-right text-[12px] text-k-muted">
            {label.length}/{CATALOG_NAME_MAX}
          </p>
        </div>

        <Field
          label={`${t('add.codeLabel')} *`}
          hint={editing ? t('edit.codeLocked') : t('add.codeHint')}
          error={codeError}
        >
          <Input
            value={effectiveCode}
            maxLength={CODE_MAX}
            disabled={saving || editing}
            required
            error={codeError !== null}
            className="font-mono"
            onChange={(e) => {
              setCodeTouched(true);
              setServerCodeError(false);
              setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'));
            }}
          />
        </Field>

        <div>
          <Field label={t('add.descriptionLabel')}>
            <Textarea
              value={description}
              rows={3}
              maxLength={CATALOG_DESCRIPTION_MAX}
              placeholder={t('add.descriptionPlaceholder')}
              disabled={saving}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <p className="mt-1 text-right text-[12px] text-k-muted">
            {description.length}/{CATALOG_DESCRIPTION_MAX}
          </p>
        </div>

        {isPayment && (
          <Field label={`${t('ledgerLabel')} *`} hint={t('ledgerHint')}>
            <Select value={effectiveLedger} disabled={saving} required onChange={(e) => setLedger(e.target.value)}>
              <option value="" disabled>
                {t('ledgerChoose')}
              </option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tMethod(m)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Switch
              checked={isActive}
              onChange={setIsActive}
              disabled={saving}
              aria-labelledby={stateId}
              aria-describedby={stateHintId}
            />
            <span id={stateId} className="text-[14px] font-medium text-k-text">
              {isActive ? t('active') : t('inactive')}
            </span>
          </div>
          <p id={stateHintId} className="text-[12px] text-k-muted">
            {t('add.stateHint')}
          </p>
        </div>
      </form>
    </Modal>
  );
}
