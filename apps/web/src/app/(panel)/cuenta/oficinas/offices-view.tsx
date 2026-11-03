'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { buildOfficeTree, type Member } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import {
  activeOffices,
  expandedUpTo,
  filterOfficeTree,
  maxDepthOf,
  moveVerdict,
  rootPortfolioPending,
  type OfficeRow,
  type OfficeType,
} from '@/lib/offices';
import { OfficeTree, type RowAction, type TreeCtx } from './office-tree';
import { OfficeFormDialog } from './office-form';
import { DeactivateDialog, MoveDialog, PreviewDialog, QuickAddDialog } from './office-dialogs';
import { MovePortfolioDialog } from './move-portfolio';
import { TypesEditor } from './types-editor';

type Dialog =
  | { kind: 'preview'; id: string }
  | { kind: 'form'; id: string | null; parentId: string }
  | { kind: 'quick'; parentId: string }
  | { kind: 'move'; id: string; to: string | null }
  | { kind: 'deactivate'; id: string }
  | { kind: 'portfolio' }
  | { kind: 'types' }
  | null;

/** Escribir en el árbol (crear, mover, desactivar): `office:write`. Leerlo: `office:read` (la API valida los dos). */
const WRITE = 'office:write';

/**
 * Cuenta › Oficinas: el árbol de la organización (réplica del comportamiento de Gallium, R7).
 *
 * · Buscador (`/` lo enfoca, Esc lo limpia) que muestra las coincidencias con sus ancestros.
 * · Control de nivel: −/+ y los dígitos 0-9 fijan cuántos niveles se ven.
 * · Arrastrar y soltar para mover, con confirmación; «Mover a…» del menú es la misma acción por teclado o teléfono.
 * · Menú ⋮ por fila, vista previa al hacer clic y la RUTA COMPLETA siempre visible (R10).
 *
 * El árbol llega ya acotado al alcance de quien mira (lo hace la API): acá sólo se muestra y se ocultan botones.
 */
export function OfficesView({
  rows,
  types,
  members,
  plan,
}: {
  rows: OfficeRow[];
  types: OfficeType[];
  members: Member[];
  /** Oficinas usadas y tope del plan (la raíz cuenta). `limit: null` = sin tope. */
  plan: { used: number; limit: number | null };
}) {
  const t = useTranslations('account.offices');
  const router = useRouter();
  const { can } = usePermissions();
  const editable = can(WRITE);
  const canMoveCartera = can('assignment:write');

  const live = useMemo(() => activeOffices(rows), [rows]);
  const trash = rows.length - live.length;
  const tree = useMemo(() => buildOfficeTree(live), [live]);
  const maxDepth = maxDepthOf(live);
  // Abre los dos primeros niveles una sola vez (como Gallium): la raíz y sus hijas.
  const [level, setLevel] = useState<number | null>(2);
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedUpTo(live, 1));
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const { visible, matched } = useMemo(() => filterOfficeTree(live, q), [live, q]);
  const searching = q.trim() !== '';
  const pending = rootPortfolioPending(rows);
  const atLimit = plan.limit !== null && plan.used >= plan.limit;

  function showLevels(n: number) {
    const next = Math.min(Math.max(n, 1), maxDepth + 1);
    setLevel(next);
    setExpanded(expandedUpTo(live, next - 1));
  }

  // Atajos: «/» enfoca el buscador; los dígitos fijan cuántos niveles se ven (0 = sólo la raíz).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      } else if (/^[0-9]$/.test(e.key)) {
        showLevels(e.key === '0' ? 1 : Number(e.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDepth, live]);

  const byId = (id: string) => rows.find((r) => r.id === id) ?? null;
  const root = live.find((r) => r.isRoot) ?? live[0];

  const ctx: TreeCtx = {
    rows,
    visible,
    matched,
    searching,
    expanded,
    editable,
    dragId,
    overId,
    selectedId: dialog?.kind === 'preview' ? dialog.id : null,
    onToggle: (id, deep) => {
      setLevel(null);
      setExpanded((prev) => {
        const next = new Set(prev);
        const ids = deep ? live.filter((r) => r.path.startsWith(byId(id)?.path ?? '\0')).map((r) => r.id) : [id];
        if (prev.has(id)) ids.forEach((x) => next.delete(x));
        else ids.forEach((x) => next.add(x));
        return next;
      });
    },
    onPreview: (row) => setDialog({ kind: 'preview', id: row.id }),
    onAction: (action: RowAction, row) => {
      if (action === 'edit') setDialog({ kind: 'form', id: row.id, parentId: row.parentId ?? row.id });
      else if (action === 'addChild') setDialog({ kind: 'form', id: null, parentId: row.id });
      else if (action === 'quickAdd') setDialog({ kind: 'quick', parentId: row.id });
      else if (action === 'move') setDialog({ kind: 'move', id: row.id, to: null });
      else if (action === 'deactivate') setDialog({ kind: 'deactivate', id: row.id });
      else router.push(`/cuenta/oficinas/${row.id}`);
    },
    onDragStart: (row) => setDragId(row.id),
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
    onDragOver: (row) => setOverId(row?.id ?? null),
    onDrop: (row) => {
      if (dragId && moveVerdict(rows, dragId, row.id) === 'OK') setDialog({ kind: 'move', id: dragId, to: row.id });
      setDragId(null);
      setOverId(null);
    },
  };

  const previewRow = dialog?.kind === 'preview' ? byId(dialog.id) : null;
  const formDialog = dialog?.kind === 'form' ? dialog : null;

  return (
    <Section
      title={t('title')}
      inner="space-y-4 p-4 sm:p-6"
      action={
        <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[13px] font-medium">
          {(trash > 0 || editable) && (
            <Link href="/cuenta/oficinas/papelera" className="text-k-purple hover:underline">
              {t('trash.link', { n: trash })}
            </Link>
          )}
          {editable && (
            <button type="button" onClick={() => setDialog({ kind: 'types' })} className="text-k-purple hover:underline">
              {t('types.link')}
            </button>
          )}
          {editable && root && (
            <button
              type="button"
              disabled={atLimit}
              onClick={() => setDialog({ kind: 'form', id: null, parentId: root.id })}
              className="text-k-purple hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {t('add')}
            </button>
          )}
        </span>
      }
    >
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {atLimit && editable && (
        <p role="note" className="rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          {t('planLimit', { used: plan.used, limit: plan.limit ?? 0 })}{' '}
          <Link href="/cuenta/plan" className="font-semibold underline">
            {t('seePlan')}
          </Link>
        </p>
      )}

      {pending && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          <span>{t('portfolio.pending', { name: pending.name, n: pending.credits })}</span>
          {canMoveCartera ? (
            <button type="button" onClick={() => setDialog({ kind: 'portfolio' })} className="font-semibold underline">
              {t('portfolio.open')}
            </button>
          ) : (
            <span>{t('portfolio.askAdmin')}</span>
          )}
        </div>
      )}

      {/* Barra de herramientas: buscador, contador y control de nivel. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <input
            ref={search}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder={t('toolbar.search')}
            aria-label={t('toolbar.search')}
            aria-keyshortcuts="/"
            className="h-10 w-full rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus-visible:shadow-k-focus"
          />
        </div>
        <span className="text-[13px] text-k-text-2" aria-live="polite">
          {t('toolbar.count', { n: live.length })}
        </span>
        {maxDepth > 0 && (
          <div role="group" aria-label={t('toolbar.level')} className="flex items-center gap-1 rounded-xl border border-k-border bg-white p-0.5 text-[13px]">
            <button type="button" aria-label={t('toolbar.collapseAll')} title={t('toolbar.collapseAll')} onClick={() => showLevels(1)} className="h-8 rounded-lg px-2 hover:bg-k-bg">
              ⇤
            </button>
            <button type="button" aria-label={t('toolbar.less')} onClick={() => showLevels((level ?? 1) - 1)} className="h-8 w-8 rounded-lg hover:bg-k-bg">
              −
            </button>
            <span className="min-w-[2.5rem] text-center tabular-nums text-k-text-2" aria-label={t('toolbar.levelNow', { n: level ?? 0 })}>
              {level ?? '—'}
            </span>
            <button type="button" aria-label={t('toolbar.more')} onClick={() => showLevels((level ?? 0) + 1)} className="h-8 w-8 rounded-lg hover:bg-k-bg">
              +
            </button>
            <button type="button" aria-label={t('toolbar.expandAll')} title={t('toolbar.expandAll')} onClick={() => showLevels(maxDepth + 1)} className="h-8 rounded-lg px-2 hover:bg-k-bg">
              ⇥
            </button>
          </div>
        )}
      </div>
      <p className="hidden text-[12px] text-k-muted sm:block">{t('toolbar.shortcuts')}</p>

      {searching && (
        <p className="rounded-lg bg-k-bg px-3 py-2 text-[13px] text-k-text-2" role="status">
          {matched.size === 0 ? t('toolbar.noResults', { q }) : t('toolbar.results', { n: matched.size, q })}
          {matched.size === 0 && (
            <button type="button" onClick={() => setQ('')} className="ml-2 font-medium text-k-purple hover:underline">
              {t('toolbar.clear')}
            </button>
          )}
        </p>
      )}

      <OfficeTree items={tree} ctx={ctx} label={t('title')} />

      {/* Cada diálogo se monta sólo abierto: con un árbol grande, tener 6 selectores de oficina escondidos en el DOM pesa. */}
      {previewRow && (
        <PreviewDialog
          row={previewRow}
          rows={rows}
          editable={editable}
          onClose={() => setDialog(null)}
          onEdit={(row) => setDialog({ kind: 'form', id: row.id, parentId: row.parentId ?? row.id })}
        />
      )}
      {formDialog && (
        <OfficeFormDialog
          open
          onClose={() => setDialog(null)}
          office={formDialog.id ? byId(formDialog.id) : null}
          defaultParentId={formDialog.parentId}
          rows={rows}
          types={types}
          members={members}
        />
      )}
      {dialog?.kind === 'quick' && byId(dialog.parentId) && (
        <QuickAddDialog parent={byId(dialog.parentId)} rows={rows} types={types} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'move' && <MoveDialog move={{ id: dialog.id, to: dialog.to }} rows={rows} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'deactivate' && byId(dialog.id) && <DeactivateDialog office={byId(dialog.id)} rows={rows} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'portfolio' && <MovePortfolioDialog from={pending ?? root ?? null} rows={rows} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'types' && <TypesEditor open onClose={() => setDialog(null)} types={types} />}
    </Section>
  );
}
