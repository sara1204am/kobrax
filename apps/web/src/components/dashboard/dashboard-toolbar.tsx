'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DashboardDefinition, DashboardWidget } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Modal } from '@/components/modal';
import { WidgetPreview } from './widget-preview';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { saveWidgets } from '@/lib/dashboard-save';
import { CATALOG_ITEMS, widgetDefinition, type CatalogItem } from '@/lib/widget-registry';

/** Minúsculas y sin tildes: «mora» encuentra «Mora» y «gestion» encuentra «gestión». */
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * La barra del tablero: qué vista se está mirando, Ver/Editar y el catálogo de widgets.
 *
 * 🔴 **Ver y Editar no son dos pantallas: son dos modos de la misma.** El modo vive en la URL
 * (`?edit=1`) y no en un estado del navegador, porque el servidor tiene que saberlo para pintar los
 * tiradores de arrastre — y porque así «volver» sale de edición en vez de irse del tablero.
 */
export function DashboardToolbar({
  dashboards,
  current,
  widgets,
  editable,
}: {
  dashboards: DashboardDefinition[];
  current?: DashboardDefinition;
  widgets: DashboardWidget[];
  editable: boolean;
}) {
  const t = useTranslations('panel.dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(current?.name ?? '');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  /** Guardar la lista completa de widgets. Es la misma llamada que usa el arrastre. */
  async function save(next: DashboardWidget[], done: string) {
    setError(null);
    setBusy(true);
    const res = await saveWidgets(current?.id, next, t('defaultName'));
    setBusy(false);
    if (!res.ok) {
      setError(t('saveError'));
      return;
    }
    setAdding(false);
    toast(done);
    router.refresh();
  }

  /**
   * Un widget nuevo entra **abajo de todo**, a lo ancho de su tamaño natural.
   *
   * No se busca un hueco libre: la grilla compacta hacia arriba apenas se suelta, así que el hueco
   * lo encuentra ella. Buscarlo acá sería reimplementar su algoritmo peor.
   */
  function add(item: CatalogItem) {
    const def = widgetDefinition(item.type);
    if (!def) return;
    const size = item.size ?? def.defaultSize;
    const bottom = widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
    void save(
      [
        ...widgets,
        {
          id: `nuevo-${item.id}-${bottom}`,
          type: def.type,
          title: '',
          layout: { x: 0, y: bottom, w: size.w, h: size.h },
          config: { ...item.config },
        },
      ],
      t('widgetAdded'),
    );
  }

  /** El buscador mira lo que el widget **muestra** (nombre, descripción, palabras clave) y el tipo de gráfico. */
  const needle = fold(search.trim());
  const filtered = CATALOG_ITEMS.filter((item) => {
    if (!needle) return true;
    const def = widgetDefinition(item.type);
    const haystack = [
      t(`catalogItems.${item.id}.name`),
      t(`catalogItems.${item.id}.description`),
      t(`catalogItems.${item.id}.keywords`),
      def ? t(`catalog.${def.labelKey}`) : '',
    ].join(' ');
    return needle.split(/\s+/).every((word) => fold(haystack).includes(word));
  });

  return (
    // Sin margen ni `justify-between`: ya no es una fila propia, va dentro de la tarjeta de filtros (ver `DashboardFilters`).
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {editable && current && (
          <button
            type="button"
            onClick={() => {
              setName(current.name);
              setRenaming(true);
            }}
            className="h-10 rounded-xl px-3 text-[13px] font-medium text-k-purple hover:bg-k-bg"
          >
            {t('rename')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button onClick={() => setAdding(true)} className="sm:w-auto sm:px-5">
            {t('addWidget')}
          </Button>
        )}
        {editable && current && (
          <>
            <Button
              variant="ghost"
              onClick={async () => {
                const res = await sendJson(`/api/dashboards/${current.id}/duplicate`, {});
                if (res.ok) {
                  toast(t('duplicated'));
                  router.refresh();
                } else toast(t('saveError'), 'danger');
              }}
              className="sm:w-auto sm:px-4"
            >
              {t('duplicate')}
            </Button>
            {/* Borrar pregunta antes: para quien mira, el tablero desaparece. */}
            <Button
              variant="ghost"
              onClick={async () => {
                if (!window.confirm(t('deleteConfirm', { name: current.name }))) return;
                const res = await sendJson(`/api/dashboards/${current.id}`, {}, 'DELETE');
                if (res.ok) {
                  toast(t('deleted'));
                  go({ view: null, edit: null });
                  router.refresh();
                } else toast(t('saveError'), 'danger');
              }}
              className="sm:w-auto sm:px-4"
            >
              {t('delete')}
            </Button>
          </>
        )}
        <Button onClick={() => go({ edit: editable ? null : '1' })} className="sm:w-auto sm:px-5">
          {editable ? t('done') : t('edit')}
        </Button>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('addWidget')}>
        <ErrorBanner message={error} />
        <Field label={t('searchWidgets')}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </Field>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((item) => {
            const def = widgetDefinition(item.type);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => add(item)}
                  className="h-full w-full rounded-xl border border-k-border px-3 py-2.5 text-left hover:bg-k-bg disabled:opacity-50"
                >
                  <WidgetPreview type={item.type} strip={item.id === 'kpiStrip'} />
                  <span className="mt-2 block text-[14px] font-semibold text-k-text">{t(`catalogItems.${item.id}.name`)}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-k-text-2">
                    {t(`catalogItems.${item.id}.description`)}
                  </span>
                  {def && <span className="mt-1.5 block text-[11px] text-k-muted">{t(`catalog.${def.labelKey}`)}</span>}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="col-span-full py-6 text-center text-[13px] text-k-muted">{t('noWidgetMatch')}</li>}
        </ul>
      </Modal>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('rename')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)} className="sm:w-auto sm:px-5">
              {t('cancel')}
            </Button>
            <Button
              onClick={async () => {
                if (!current) return;
                const res = await sendJson(`/api/dashboards/${current.id}`, { name: name.trim() }, 'PATCH');
                if (!res.ok) {
                  setError(t('saveError'));
                  return;
                }
                setRenaming(false);
                router.refresh();
              }}
              disabled={!name.trim()}
              className="sm:w-auto sm:px-5"
            >
              {t('save')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <Field label={t('dashboardName')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
      </Modal>
    </div>
  );
}
