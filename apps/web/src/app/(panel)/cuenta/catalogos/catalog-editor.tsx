'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ledgerMethodOf } from '@kobrax/shared';
import { Button, ErrorBanner, Input, Select, Switch } from '@/components/ui';
import { Badge, Section } from '@/components/panel-ui';
import { Dropdown, Icon, type IconName } from '@/components/panel-shell';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { EDITABLE_CATALOGS, descriptionOf, movePatches, type CatalogRow, type EditableCatalog } from '@/lib/catalog-editor';
import { OptionModal } from './option-modal';

/** El mismo orden que usa la API al listar: primero `sortOrder`, después el nombre. */
const byOrder = (a: CatalogRow, b: CatalogRow) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);

/** Sin tildes ni mayúsculas: «Cancelación» se encuentra escribiendo «cancel». */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ICON_OF: Record<EditableCatalog, IconName> = {
  PAYMENT_METHOD: 'payments',
  BANK: 'bank',
  NO_PAYMENT_REASON: 'ban',
  OCCUPATION: 'briefcase',
  CREDIT_TYPE: 'file',
  COLLATERAL_TYPE: 'security',
  COLLECTION_MODALITY: 'swap',
  CANCEL_REASON: 'xcircle',
  RESCHEDULE_REASON: 'agenda',
  SPECIAL_CATEGORY: 'tag',
};

type Filter = 'all' | 'active' | 'inactive';
type Dialog = { mode: 'add' } | { mode: 'edit'; row: CatalogRow } | null;
type ItemResponse = { data?: CatalogRow };

/**
 * Los vocabularios del negocio (medios de pago, bancos, motivos de no pago, rubros…): la lista de catálogos a la
 * izquierda y las opciones del elegido a la derecha.
 *
 * Cada cambio se guarda al instante —activar/desactivar, reordenar, agregar, editar— y no pasa por la barra de guardado
 * de la pestaña: son filas sueltas, no un formulario. **Desactivar y no borrar**: la opción deja de ofrecerse en los
 * desplegables pero los registros viejos que la usan siguen mostrándola.
 *
 * **Se reordena arrastrando** (HTML5 nativo, como las columnas de `DataTable`) y también con el teclado desde el agarre
 * (↑/↓) o desde el menú de la fila. Con una búsqueda o un filtro activo no se reordena: el orden de una vista recortada
 * no dice nada del orden real.
 *
 * El código de una opción no se edita: nace del nombre y es lo que el móvil y los registros guardan.
 * `catalog:write` gobierna la edición (la API lo valida igual); sin él, todo es de lectura.
 */
export function CatalogEditor({ catalog: initial, lists }: { catalog: EditableCatalog; lists: Record<EditableCatalog, CatalogRow[]> }) {
  const t = useTranslations('account.catalogs');
  const tMethod = useTranslations('panel.payments.method');
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('catalog:write');

  const [catalog, setCatalog] = useState<EditableCatalog>(initial);
  const [data, setData] = useState<Record<EditableCatalog, CatalogRow[]>>(() => {
    const sorted = { ...lists };
    for (const c of EDITABLE_CATALOGS) sorted[c] = [...(lists[c] ?? [])].sort(byOrder);
    return sorted;
  });
  const [catalogQuery, setCatalogQuery] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data[catalog];
  const url = `/api/catalogs/${catalog}`;

  const visible = useMemo(() => {
    const q = plain(query.trim());
    return rows.filter(
      (r) =>
        (filter === 'all' || (filter === 'active' ? r.isActive : !r.isActive)) &&
        (q === '' || plain(`${r.label} ${r.code} ${descriptionOf(r)}`).includes(q)),
    );
  }, [rows, query, filter]);
  const canReorder = editable && query.trim() === '' && filter === 'all';

  const catalogs = EDITABLE_CATALOGS.filter((c) => plain(t(`names.${c}`)).includes(plain(catalogQuery.trim())));

  function setRows(update: (prev: CatalogRow[]) => CatalogRow[]) {
    setData((prev) => ({ ...prev, [catalog]: update(prev[catalog]) }));
  }

  function select(next: EditableCatalog) {
    setCatalog(next);
    setQuery('');
    setFilter('all');
    setError(null);
    // Para poder compartir o recargar el catálogo abierto; no navega, así que no vuelve a pedir nada al servidor.
    window.history.replaceState(null, '', `?c=${next}`);
  }

  async function toggle(row: CatalogRow, isActive: boolean) {
    setBusy(true);
    setError(null);
    const res = await sendJson<ItemResponse>(`${url}/${row.id}`, { isActive }, 'PATCH');
    setBusy(false);
    if (!res.ok || !res.data.data) {
      setError(res.data.error?.message ?? t('saveError'));
      return;
    }
    const updated = res.data.data;
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    toast(t('saved'));
  }

  async function reorder(from: number, to: number) {
    const patches = movePatches(rows, from, to);
    if (patches.length === 0) return;
    const before = rows;
    const orderOf = new Map(patches.map((p) => [p.id, p.sortOrder]));
    setRows((prev) => prev.map((r) => ({ ...r, sortOrder: orderOf.get(r.id) ?? r.sortOrder })).sort(byOrder));
    setBusy(true);
    setError(null);
    const results = await Promise.all(patches.map((p) => sendJson<ItemResponse>(`${url}/${p.id}`, { sortOrder: p.sortOrder }, 'PATCH')));
    setBusy(false);
    // Se movió en pantalla antes de preguntar; si el servidor no lo aceptó, se vuelve al orden de antes.
    if (results.some((r) => !r.ok)) {
      setRows(() => before);
      setError(t('moveError'));
    }
  }

  function saved(row: CatalogRow) {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]).sort(byOrder));
    setDialog(null);
    toast(t('saved'));
  }

  return (
    <Section
      title={t('title')}
      description={t('intro')}
      inner="p-6"
      action={
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <span className="text-[13px] text-k-text-2">{t('count', { count: EDITABLE_CATALOGS.length })}</span>
          <Link
            href="/cuenta/general"
            className="rounded-xl border border-k-border bg-white px-3 py-2 text-[13px] font-medium text-k-slate hover:bg-k-bg"
          >
            {t('settings')}
          </Link>
        </span>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── Los catálogos ── */}
        <nav aria-label={t('title')} className="space-y-2 rounded-2xl border border-k-border p-3">
          <Input
            icon={<Icon name="search" className="h-4 w-4" />}
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder={t('searchCatalog')}
            aria-label={t('searchCatalog')}
            className="!h-11 !text-[14px]"
          />
          <ul className="list-none space-y-1">
            {catalogs.map((c) => {
              const active = c === catalog;
              const count = data[c].filter((r) => r.isActive).length;
              return (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl border-l-[3px] px-3 py-2.5 text-left hover:bg-k-bg ${
                      active ? 'border-k-periwinkle bg-k-highlight' : 'border-transparent'
                    }`}
                  >
                    <Icon name={ICON_OF[c]} className="h-5 w-5 shrink-0 text-k-slate" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-k-text">{t(`names.${c}`)}</span>
                      <span className="block text-[12px] text-k-text-2">{t('options', { count })}</span>
                    </span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-k-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
          {catalogs.length === 0 && <p className="px-2 py-3 text-[13px] text-k-text-2">{t('catalogsEmpty')}</p>}
        </nav>

        {/* ── Las opciones del catálogo abierto ── */}
        <div className="min-w-0 space-y-4 rounded-2xl border border-k-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-k-bg text-k-slate">
                <Icon name={ICON_OF[catalog]} className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[20px] font-semibold text-k-navy">{t(`names.${catalog}`)}</h3>
                <p className="text-[13px] text-k-text-2">{t('panelSubtitle')}</p>
              </div>
            </div>
            {editable && (
              <span className="w-full sm:w-auto">
                <Button type="button" onClick={() => setDialog({ mode: 'add' })} className="sm:px-5">
                  <span className="flex items-center gap-2">
                    <Icon name="plus" className="h-4 w-4" />
                    {t('add.open')}
                  </span>
                </Button>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-[200px] flex-1">
              <Input
                icon={<Icon name="search" className="h-4 w-4" />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchOption')}
                aria-label={t('searchOption')}
                className="!h-11 !text-[14px]"
              />
            </span>
            <span className="w-full sm:w-44">
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                aria-label={t('filterLabel')}
                className="!h-11 !text-[14px]"
              >
                <option value="all">{t('filter.all')}</option>
                <option value="active">{t('filter.active')}</option>
                <option value="inactive">{t('filter.inactive')}</option>
              </Select>
            </span>
          </div>

          <ErrorBanner message={error} />

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-k-border px-4 py-6 text-center text-[13px] text-k-text-2">{t('empty')}</p>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-k-border px-4 py-6 text-center text-[13px] text-k-text-2">{t('emptyFiltered')}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-k-border">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="bg-k-bg text-[12px] font-semibold text-k-text-2">
                    <th scope="col" className="w-16 px-3 py-3 text-center">
                      {t('columns.order')}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {t('columns.name')}
                    </th>
                    <th scope="col" className="hidden px-3 py-3 md:table-cell">
                      {t('columns.code')}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {t('columns.state')}
                    </th>
                    {editable && (
                      <th scope="col" className="w-20 px-3 py-3 text-center">
                        {t('columns.actions')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-k-border">
                  {visible.map((row) => {
                    const index = rows.indexOf(row);
                    const ledger = catalog === 'PAYMENT_METHOD' ? ledgerMethodOf(row) : undefined;
                    const description = descriptionOf(row);
                    return (
                      <tr
                        key={row.id}
                        draggable={canReorder}
                        onDragStart={() => setDragged(row.id)}
                        onDragEnd={() => setDragged(null)}
                        // Sin el `preventDefault` el navegador no acepta la soltada: es el default de HTML5.
                        onDragOver={(e) => canReorder && e.preventDefault()}
                        onDrop={() => {
                          const from = rows.findIndex((r) => r.id === dragged);
                          if (canReorder && from >= 0) void reorder(from, index);
                          setDragged(null);
                        }}
                        className={`${row.isActive ? '' : 'bg-k-bg'} ${dragged === row.id ? 'opacity-40' : ''}`}
                      >
                        <td className="px-3 py-3 text-center">
                          {canReorder ? (
                            <button
                              type="button"
                              aria-label={t('dragOf', { name: row.label })}
                              disabled={busy}
                              onKeyDown={(e) => {
                                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                                e.preventDefault();
                                void reorder(index, index + (e.key === 'ArrowUp' ? -1 : 1));
                              }}
                              className="cursor-grab rounded p-1 text-k-muted hover:bg-k-highlight hover:text-k-text-2 focus-visible:shadow-k-focus focus-visible:outline-none active:cursor-grabbing disabled:opacity-40"
                            >
                              <Icon name="grip" className="h-5 w-5" />
                            </button>
                          ) : (
                            <span className="text-[13px] text-k-muted">{index + 1}</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <p className={`text-[14px] font-medium ${row.isActive ? 'text-k-text' : 'text-k-text-2'}`}>{row.label}</p>
                          {description && <p className="mt-0.5 text-[13px] text-k-text-2">{description}</p>}
                          {catalog === 'PAYMENT_METHOD' &&
                            (ledger ? (
                              <p className="mt-0.5 text-[12px] text-k-muted">{t('ledgerShort', { method: tMethod(ledger) })}</p>
                            ) : (
                              <p className="mt-0.5 text-[12px] text-k-warning-text">{t('noLedger')}</p>
                            ))}
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <span className="font-mono">
                            <Badge>{row.code}</Badge>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2 text-[13px] text-k-text-2">
                            <Switch
                              checked={row.isActive}
                              disabled={!editable || busy}
                              onChange={(next) => void toggle(row, next)}
                              aria-label={t('activeOf', { name: row.label })}
                            />
                            {row.isActive ? t('active') : t('inactive')}
                          </span>
                        </td>
                        {editable && (
                          <td className="px-3 py-3 text-center">
                            <Dropdown
                              chevron={false}
                              label={
                                <>
                                  <Icon name="dots" className="h-5 w-5" />
                                  <span className="sr-only">{t('actionsOf', { name: row.label })}</span>
                                </>
                              }
                              summaryClass="mx-auto flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-k-text-2 hover:bg-k-bg [&::-webkit-details-marker]:hidden"
                              panelClass="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-k-border bg-white py-1 text-left shadow-k-card"
                            >
                              <MenuItem onPick={() => setDialog({ mode: 'edit', row })}>{t('editAction')}</MenuItem>
                              {canReorder && index > 0 && (
                                <MenuItem onPick={() => void reorder(index, index - 1)}>{t('moveUp', { name: row.label })}</MenuItem>
                              )}
                              {canReorder && index < rows.length - 1 && (
                                <MenuItem onPick={() => void reorder(index, index + 1)}>{t('moveDown', { name: row.label })}</MenuItem>
                              )}
                            </Dropdown>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {editable ? (
            canReorder &&
            rows.length > 1 && (
              <p className="flex items-center gap-2 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-slate">
                <Icon name="info" className="h-4 w-4 shrink-0" />
                {t('dragHint')}
              </p>
            )
          ) : (
            <p className="text-[13px] text-k-text-2">{t('readOnly')}</p>
          )}
        </div>
      </div>

      {editable && dialog && (
        <OptionModal
          // Una opción distinta es un formulario nuevo: sin esto se arrastraría lo escrito en la anterior.
          key={dialog.mode === 'edit' ? dialog.row.id : 'add'}
          open
          catalog={catalog}
          rows={rows}
          item={dialog.mode === 'edit' ? dialog.row : undefined}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </Section>
  );
}

/** Un renglón del menú de una fila. Cierra el menú al elegir: el `<details>` no se cierra solo por un clic adentro. */
function MenuItem({ onPick, children }: { onPick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        const menu = e.currentTarget.closest('details');
        if (menu) menu.open = false;
        onPick();
      }}
      className="block w-full px-3 py-2 text-left text-[13px] text-k-text hover:bg-k-bg focus:bg-k-bg focus:outline-none"
    >
      {children}
    </button>
  );
}
