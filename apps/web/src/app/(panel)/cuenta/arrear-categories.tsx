'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ArrearCategory } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import {
  blankRow,
  rowsFromCategories,
  sameRows,
  toPayload,
  validateRows,
  type CategoryRow,
} from '@/lib/arrear-categories';

const CELL =
  'h-10 w-full rounded-lg border border-k-border bg-white px-2.5 text-[13px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus disabled:bg-k-bg disabled:text-k-text-2';

/**
 * Categorías de mora (A / B / C…) de la cuenta (F4/08 · D1-b).
 *
 * La categoría de un crédito NO se guarda ni la elige nadie: se calcula con los días de mora y los rangos que se
 * editan acá. Por eso los rangos no pueden quedar con huecos ni solapes, y esta pantalla lo dice **mientras se
 * escribe** con la misma `validateArrearCategories` que aplica el servidor (que además revalida al guardar).
 *
 * `account:write` gobierna la edición (la API lo valida igual); con sólo `collection:read` la tabla es de lectura.
 */
export function ArrearCategories({ categories }: { categories: ArrearCategory[] }) {
  const t = useTranslations('account.arrearCategories');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const initial = useMemo(() => rowsFromCategories(categories), [categories]);
  const [rows, setRows] = useState<CategoryRow[]>(initial);
  const [saved, setSaved] = useState<CategoryRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = useMemo(() => validateRows(rows), [rows]);
  const dirty = !sameRows(rows, saved);

  function patch(key: string, change: Partial<CategoryRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  async function save() {
    if (errors.length > 0) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson('/api/arrear-categories', toPayload(rows), 'PUT');
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    setSaved(rows);
    toast(t('saved'));
    router.refresh();
  }

  return (
    <Section title={t('title')} inner="p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
              <th scope="col" className="w-24 pb-2 pr-2">{t('columns.code')}</th>
              <th scope="col" className="pb-2 pr-2">{t('columns.name')}</th>
              <th scope="col" className="w-28 pb-2 pr-2">{t('columns.from')}</th>
              <th scope="col" className="w-28 pb-2 pr-2">{t('columns.to')}</th>
              <th scope="col" className="w-32 pb-2 pr-2">{t('columns.color')}</th>
              {editable && <th scope="col" className="w-10 pb-2"><span className="sr-only">{t('remove')}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t('columns.code')} ${i + 1}`}
                    value={r.code}
                    maxLength={16}
                    disabled={!editable || busy}
                    onChange={(e) => patch(r.key, { code: e.target.value })}
                    className={CELL}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t('columns.name')} ${i + 1}`}
                    value={r.name}
                    maxLength={60}
                    disabled={!editable || busy}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                    className={CELL}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t('columns.from')} ${i + 1}`}
                    inputMode="numeric"
                    value={r.fromDays}
                    disabled={!editable || busy}
                    onChange={(e) => patch(r.key, { fromDays: e.target.value })}
                    className={CELL}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`${t('columns.to')} ${i + 1}`}
                    inputMode="numeric"
                    value={r.toDays}
                    // Vacío = sin límite: sólo la última categoría puede quedar así.
                    placeholder={t('unlimited')}
                    disabled={!editable || busy}
                    onChange={(e) => patch(r.key, { toDays: e.target.value })}
                    className={CELL}
                  />
                </td>
                <td className="py-1 pr-2">
                  <span className="flex items-center gap-2">
                    {/* El color es un apoyo del código, nunca su reemplazo: el código se lee igual sin él. */}
                    <span
                      aria-hidden
                      className="h-5 w-5 shrink-0 rounded-full border border-k-border"
                      style={{ background: r.color.trim() || 'transparent' }}
                    />
                    <input
                      aria-label={`${t('columns.color')} ${i + 1}`}
                      value={r.color}
                      maxLength={32}
                      placeholder="#E67E22"
                      disabled={!editable || busy}
                      onChange={(e) => patch(r.key, { color: e.target.value })}
                      className={CELL}
                    />
                  </span>
                </td>
                {editable && (
                  <td className="py-1">
                    <button
                      type="button"
                      aria-label={`${t('remove')} ${r.code || i + 1}`}
                      disabled={busy}
                      onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      className="h-10 w-10 rounded-lg text-[18px] text-k-danger hover:bg-k-danger-bg disabled:opacity-50"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* La validación en vivo: cada regla rota, en sus propias palabras. */}
      {editable && errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-xl bg-k-danger-bg px-4 py-3 text-[13px] text-k-danger">
          {errors.map((code) => (
            <li key={code}>{t(`validation.${code}`)}</li>
          ))}
        </ul>
      )}

      {editable ? (
        <div className="mt-4 space-y-3">
          <ErrorBanner message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || rows.length >= 26}
              onClick={() => setRows((prev) => [...prev, blankRow(prev[prev.length - 1])])}
              className="text-[13px] font-medium text-k-purple hover:underline disabled:opacity-50"
            >
              {t('add')}
            </button>
            <span className="ml-auto sm:w-48">
              <Button loading={busy} disabled={errors.length > 0 || !dirty} onClick={() => void save()}>
                {t('save')}
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-k-text-2">{t('readOnly')}</p>
      )}
    </Section>
  );
}
