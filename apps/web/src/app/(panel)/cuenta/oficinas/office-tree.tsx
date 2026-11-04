'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { OfficeTreeItem } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { childCount, moveVerdict, type OfficeRow } from '@/lib/offices';

/** Cuántas hijas se dibujan de una vez: un nodo con cientos de hijas no clava el navegador. */
export const CHILDREN_PAGE = 50;

export type RowAction = 'edit' | 'addChild' | 'quickAdd' | 'detail' | 'move' | 'deactivate';

export interface TreeCtx {
  rows: OfficeRow[];
  visible: Set<string>;
  matched: Set<string>;
  searching: boolean;
  expanded: Set<string>;
  editable: boolean;
  dragId: string | null;
  overId: string | null;
  selectedId: string | null;
  onToggle: (id: string, deep: boolean) => void;
  onPreview: (row: OfficeRow) => void;
  onAction: (action: RowAction, row: OfficeRow) => void;
  onDragStart: (row: OfficeRow) => void;
  onDragEnd: () => void;
  onDragOver: (row: OfficeRow | null) => void;
  onDrop: (row: OfficeRow) => void;
}

/** El menú ⋮ de una fila. Se cierra con Esc y con un clic afuera; las flechas recorren las acciones. */
function RowMenu({ row, ctx }: { row: OfficeRow; ctx: TreeCtx }) {
  const t = useTranslations('account.offices.menu');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const items: { action: RowAction; label: string; danger?: boolean; write: boolean }[] = [
    { action: 'edit', label: t('edit'), write: true },
    { action: 'addChild', label: t('addChild'), write: true },
    { action: 'quickAdd', label: t('quickAdd'), write: true },
    { action: 'detail', label: t('detail'), write: false },
    { action: 'move', label: t('move'), write: true },
    { action: 'deactivate', label: t('deactivate'), write: true, danger: true },
  ];
  const shown = items.filter((i) => (!i.write || ctx.editable) && !(row.isRoot && (i.action === 'move' || i.action === 'deactivate')));
  if (!row.active) return null;

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const at = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % btns.length : (at - 1 + btns.length) % btns.length;
      btns[next]?.focus();
    }
  }

  return (
    <div ref={box} className="relative" onKeyDown={onKey}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('of', { name: row.name })}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-k-text-2 hover:bg-k-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-k-periwinkle"
      >
        <span aria-hidden>⋮</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-xl border border-k-border bg-white py-1 shadow-k-card">
          {shown.map((i) => (
            <button
              key={i.action}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                ctx.onAction(i.action, row);
              }}
              className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-k-bg focus-visible:bg-k-bg focus-visible:outline-none ${i.danger ? 'text-k-danger' : 'text-k-text'}`}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode({ item, ctx, level }: { item: OfficeTreeItem<OfficeRow>; ctx: TreeCtx; level: number }) {
  const t = useTranslations('account.offices');
  const { node } = item;
  const [shown, setShown] = useState(CHILDREN_PAGE);
  if (!ctx.visible.has(node.id) || !node.active) return null;

  const kids = item.children.filter((c) => ctx.visible.has(c.node.id) && c.node.active);
  const hasKids = kids.length > 0;
  // Buscando se abre todo el camino hacia lo que coincide; si no, manda el estado de expansión (que se conserva al limpiar).
  const open = hasKids && (ctx.searching || ctx.expanded.has(node.id));
  const dragging = ctx.dragId === node.id;
  const canDrop = ctx.dragId !== null && ctx.dragId !== node.id && moveVerdict(ctx.rows, ctx.dragId, node.id) === 'OK';
  const isOver = ctx.overId === node.id && canDrop;
  const direct = childCount(ctx.rows.filter((r) => r.active), node.id);

  return (
    <li role="treeitem" aria-level={level} aria-expanded={hasKids ? open : undefined} aria-selected={ctx.selectedId === node.id}>
      <div
        data-office-row={node.id}
        draggable={ctx.editable && !node.isRoot}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.id);
          ctx.onDragStart(node);
        }}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          ctx.onDragOver(node);
        }}
        onDragLeave={() => ctx.overId === node.id && ctx.onDragOver(null)}
        onDrop={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          ctx.onDrop(node);
        }}
        className={`group flex items-center gap-1 rounded-xl border px-1 py-1 ${
          isOver ? 'border-k-periwinkle bg-k-highlight' : 'border-transparent hover:bg-k-bg'
        } ${dragging ? 'opacity-40' : ''}`}
        style={{ marginLeft: Math.min(level - 1, 6) * 14 }}
      >
        {hasKids ? (
          <button
            type="button"
            aria-label={open ? t('tree.collapse', { name: node.name }) : t('tree.expand', { name: node.name })}
            onClick={(e) => ctx.onToggle(node.id, e.altKey || e.shiftKey)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-k-text-2 hover:bg-white"
          >
            <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
              ›
            </span>
          </button>
        ) : (
          <span aria-hidden className="h-9 w-9 shrink-0" />
        )}

        <button
          type="button"
          data-office-main
          onClick={() => ctx.onPreview(node)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && hasKids && !open) ctx.onToggle(node.id, false);
            if (e.key === 'ArrowLeft' && hasKids && open) ctx.onToggle(node.id, false);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const all = Array.from(
                (e.currentTarget.closest('[role="tree"]') as HTMLElement | null)?.querySelectorAll<HTMLButtonElement>('[data-office-main]') ?? [],
              );
              const next = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
              if (next) {
                e.preventDefault();
                next.focus();
              }
            }
          }}
          className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-k-periwinkle"
          title={[node.fullName, node.address].filter(Boolean).join(' — ')}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`truncate text-[14px] font-medium ${ctx.matched.has(node.id) ? 'text-k-purple' : 'text-k-text'}`}>{node.name}</span>
            {node.typeName && <Badge>{node.typeName}</Badge>}
            {node.code && <span className="rounded-md bg-k-light-bg px-1.5 py-0.5 font-mono text-[11px] text-k-text-2">{node.code}</span>}
          </span>
          {/* La ruta completa SIEMPRE visible (R10): «Central › Chuquisaca › Central» no se confunde con otra «Central». */}
          <span className="mt-0.5 block truncate text-[12px] text-k-muted">
            {node.isRoot ? t('tree.root') : node.fullName}
            {node.city ? ` · ${node.city}` : ''}
          </span>
        </button>

        <span className="hidden shrink-0 items-center gap-3 pr-1 text-[12px] text-k-text-2 sm:flex">
          {direct > 0 && (
            <span title={t('tree.children', { n: direct })} aria-label={t('tree.children', { n: direct })}>
              ⑂ {direct}
            </span>
          )}
          <span title={t('tree.members', { n: node.members })} aria-label={t('tree.members', { n: node.members })}>
            ☺ {node.members}
          </span>
        </span>
        <RowMenu row={node} ctx={ctx} />
      </div>

      {open && (
        <ul role="group">
          {kids.slice(0, shown).map((c) => (
            <TreeNode key={c.node.id} item={c} ctx={ctx} level={level + 1} />
          ))}
          {kids.length > shown && (
            <li style={{ marginLeft: Math.min(level, 6) * 14 }}>
              <button
                type="button"
                onClick={() => setShown((n) => n + CHILDREN_PAGE)}
                className="ml-10 rounded-lg px-2 py-1.5 text-[13px] font-medium text-k-purple hover:underline"
              >
                {t('tree.showMore', { n: kids.length - shown })}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function OfficeTree({ items, ctx, label }: { items: OfficeTreeItem<OfficeRow>[]; ctx: TreeCtx; label: string }) {
  return (
    <ul role="tree" aria-label={label} className="space-y-0.5">
      {items.map((i) => (
        <TreeNode key={i.node.id} item={i} ctx={ctx} level={1} />
      ))}
    </ul>
  );
}
