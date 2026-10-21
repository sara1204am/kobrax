'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import {
  EDITABLE_CATALOGS,
  codeFromLabel,
  reorderPatches,
  type CatalogRow,
  type EditableCatalog,
} from '@/lib/catalog-editor';

/** El mismo orden que usa la API al listar: primero `sortOrder`, después el nombre. */
const byOrder = (a: CatalogRow, b: CatalogRow) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);

type ItemResponse = { data?: CatalogRow };

/**
 * Editor de un catálogo del negocio (medios de pago, bancos, motivos de no pago, rubros…).
 *
 * Cada cambio se guarda al instante —renombrar al salir del campo, activar/desactivar, subir/bajar, agregar— y no
 * pasa por la barra de guardado de la pestaña: son filas sueltas, no un formulario. **Desactivar y no borrar**: el
 * ítem deja de ofrecerse en los desplegables pero los registros viejos que lo usan siguen mostrándolo.
 *
 * El código interno de un ítem no se edita: nace del nombre y es lo que el móvil y los registros guardan. Renombrar
 * sólo cambia lo que se lee. El contenido adicional (`metadata`: banderas de un motivo, sinónimos de un rubro) no se
 * toca desde acá y se conserva tal cual.
 *
 * `catalog:write` gobierna la edición (la API lo valida igual); sin él la lista es de lectura.
 */
export function CatalogEditor({ catalog, items }: { catalog: EditableCatalog; items: CatalogRow[] }) {
  const t = useTranslations('account.catalogs');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('catalog:write');

  const [rows, setRows] = useState<CatalogRow[]>(() => [...items].sort(byOrder));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const url = `/api/catalogs/${catalog}`;

  function replace(updated: CatalogRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)).sort(byOrder));
  }

  async function patch(row: CatalogRow, body: Partial<Pick<CatalogRow, 'label' | 'isActive'>>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson<ItemResponse>(`${url}/${row.id}`, body, 'PATCH');
    setBusy(false);
    if (!ok || !data.data) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    replace(data.data);
    toast(t('saved'));
    return true;
  }

  async function rename(row: CatalogRow) {
    const draft = (drafts[row.id] ?? row.label).trim();
    setDrafts(({ [row.id]: _gone, ...rest }) => rest);
    // Vacío o sin cambios: se vuelve al nombre de siempre, sin pedir nada al servidor.
    if (!draft || draft === row.label) return;
    await patch(row, { label: draft });
  }

  async function move(index: number, direction: -1 | 1) {
    const patches = reorderPatches(rows, index, direction);
    if (patches.length === 0) return;
    setBusy(true);
    setError(null);
    const results = await Promise.all(patches.map((p) => sendJson<ItemResponse>(`${url}/${p.id}`, { sortOrder: p.sortOrder }, 'PATCH')));
    setBusy(false);
    if (results.some((r) => !r.ok)) {
      setError(t('moveError'));
      return;
    }
    const orderOf = new Map(patches.map((p) => [p.id, p.sortOrder]));
    setRows((prev) => prev.map((r) => ({ ...r, sortOrder: orderOf.get(r.id) ?? r.sortOrder })).sort(byOrder));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson<ItemResponse>(
      url,
      {
        code: codeFromLabel(label, rows.map((r) => r.code)),
        label,
        sortOrder: rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1,
      },
      'POST',
    );
    setBusy(false);
    if (!ok || !data.data) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setRows((prev) => [...prev, data.data as CatalogRow].sort(byOrder));
    setNewLabel('');
    toast(t('saved'));
  }

  return (
    <Section title={t('title')} inner="space-y-5 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      <Field label={t('catalog')}>
        <Select value={catalog} onChange={(e) => router.push(`/cuenta/catalogos?c=${e.target.value}`)}>
          {EDITABLE_CATALOGS.map((c) => (
            <option key={c} value={c}>
              {t(`names.${c}`)}
            </option>
          ))}
        </Select>
      </Field>

      <ErrorBanner message={error} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-k-border px-4 py-6 text-center text-[13px] text-k-text-2">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-k-border rounded-xl border border-k-border">
          {rows.map((row, i) => (
            <li key={row.id} className={`flex items-center gap-3 px-3 py-2.5 ${row.isActive ? '' : 'bg-k-bg'}`}>
              {editable && (
                <span className="flex flex-col">
                  <button
                    type="button"
                    aria-label={t('moveUp', { name: row.label })}
                    disabled={busy || i === 0}
                    onClick={() => void move(i, -1)}
                    className="h-5 w-6 text-[11px] leading-none text-k-text-2 hover:text-k-navy disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveDown', { name: row.label })}
                    disabled={busy || i === rows.length - 1}
                    onClick={() => void move(i, 1)}
                    className="h-5 w-6 text-[11px] leading-none text-k-text-2 hover:text-k-navy disabled:opacity-30"
                  >
                    ▼
                  </button>
                </span>
              )}

              <div className="min-w-0 flex-1">
                {editable ? (
                  <Input
                    aria-label={t('nameOf', { code: row.code })}
                    value={drafts[row.id] ?? row.label}
                    maxLength={120}
                    disabled={busy}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    onBlur={() => void rename(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <p className={`text-[14px] ${row.isActive ? 'text-k-text' : 'text-k-text-2'}`}>{row.label}</p>
                )}
                <p className="mt-0.5 font-mono text-[11px] text-k-muted">{row.code}</p>
              </div>

              {editable ? (
                <label className="flex shrink-0 items-center gap-2 text-[13px] text-k-text-2">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    disabled={busy}
                    aria-label={t('activeOf', { name: row.label })}
                    onChange={(e) => void patch(row, { isActive: e.target.checked })}
                  />
                  {t('active')}
                </label>
              ) : (
                !row.isActive && <span className="shrink-0 text-[12px] text-k-text-2">{t('inactive')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <span className="min-w-[200px] flex-1">
            <Field label={t('newLabel')}>
              <Input
                value={newLabel}
                maxLength={120}
                disabled={busy}
                placeholder={t('newPlaceholder')}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </Field>
          </span>
          <span className="sm:w-40">
            <Button type="submit" loading={busy} disabled={!newLabel.trim()}>
              {t('add')}
            </Button>
          </span>
        </form>
      ) : (
        <p className="text-[13px] text-k-text-2">{t('readOnly')}</p>
      )}
    </Section>
  );
}
