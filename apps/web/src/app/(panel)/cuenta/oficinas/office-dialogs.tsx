'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Badge } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { OfficeSelect } from '@/components/office-select';
import { sendJson } from '@/lib/client';
import {
  deactivateBlockers,
  flattenTree,
  activeOffices,
  moveVerdict,
  willBranchRootWithPortfolio,
  type OfficeRow,
  type OfficeType,
} from '@/lib/offices';
import { buildOfficeTree } from '@kobrax/shared';
import { useOfficeApi } from './use-office-api';

/** Vista previa al hacer clic: ruta completa, datos, conteos y las salidas (Editar · Detalles completos). */
export function PreviewDialog({
  row,
  rows,
  editable,
  onClose,
  onEdit,
}: {
  row: OfficeRow | null;
  rows: OfficeRow[];
  editable: boolean;
  onClose: () => void;
  onEdit: (row: OfficeRow) => void;
}) {
  const { t } = useOfficeApi();
  const parent = row?.parentId ? rows.find((r) => r.id === row.parentId) : null;
  const kids = row ? rows.filter((r) => r.parentId === row.id && r.active).length : 0;
  const facts: [string, string | null][] = row
    ? [
        [t('preview.parent'), parent ? parent.fullName || parent.name : null],
        [t('preview.city'), row.city],
        [t('preview.address'), row.address],
        [t('preview.manager'), row.managerName ?? null],
      ]
    : [];
  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title={row?.name ?? ''}
      actions={
        <>
          <span className="sm:w-32">
            <Button variant="ghost" onClick={onClose}>
              {t('form.close')}
            </Button>
          </span>
          {row && (
            <Link
              href={`/cuenta/oficinas/${row.id}`}
              className="flex h-12 items-center justify-center rounded-xl border border-k-border px-4 text-[14px] font-semibold text-k-text-2 hover:bg-k-bg sm:w-48"
            >
              {t('preview.full')}
            </Link>
          )}
          {row && editable && row.active && (
            <span className="sm:w-32">
              <Button onClick={() => onEdit(row)}>{t('menu.edit')}</Button>
            </span>
          )}
        </>
      }
    >
      {row && (
        <div className="space-y-4">
          {/* La ruta completa, siempre (R10). */}
          <p className="text-[13px] text-k-text-2">{row.isRoot ? t('tree.root') : row.fullName}</p>
          <div className="flex flex-wrap gap-2">
            <Badge dot tone={row.active ? 'success' : 'neutral'}>
              {row.active ? t('status.active') : t('status.inactive')}
            </Badge>
            {row.typeName && <Badge>{row.typeName}</Badge>}
            {row.code && <Badge>{row.code}</Badge>}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className={k === t('preview.parent') ? 'sm:col-span-2' : ''}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{k}</dt>
                  <dd className="mt-0.5 break-words text-[14px] text-k-text">{v}</dd>
                </div>
              ))}
          </dl>
          <ul className="flex flex-wrap gap-2 border-t border-k-border pt-3 text-[13px] text-k-text-2">
            <li className="rounded-lg bg-k-bg px-2.5 py-1">{t('preview.members', { n: row.members })}</li>
            <li className="rounded-lg bg-k-bg px-2.5 py-1">{t('preview.credits', { n: row.credits })}</li>
            <li className="rounded-lg bg-k-bg px-2.5 py-1">{t('preview.children', { n: kids })}</li>
          </ul>
        </div>
      )}
    </Modal>
  );
}

/** Alta rápida bajo una oficina: código, nombre y tipo (la oficina superior ya está elegida). */
export function QuickAddDialog({
  parent,
  rows,
  types,
  onClose,
}: {
  parent: OfficeRow | null;
  rows: OfficeRow[];
  types: OfficeType[];
  onClose: () => void;
}) {
  const { busy, error, setError, run, t } = useOfficeApi();
  const activeTypes = types.filter((x) => x.isActive);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [typeId, setTypeId] = useState('');

  useEffect(() => {
    if (parent) {
      setName('');
      setCode('');
      setTypeId(activeTypes[0]?.id ?? '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.id]);

  const dup = code.trim() !== '' && rows.some((r) => r.code?.toLowerCase() === code.trim().toLowerCase());
  const invalid = name.trim().length < 2 || !typeId || dup;
  const branching = parent ? willBranchRootWithPortfolio(rows, parent.id) : false;

  return (
    <Modal
      open={parent !== null}
      onClose={onClose}
      locked={busy}
      title={parent ? t('quick.title', { name: parent.name }) : ''}
      actions={
        <>
          <span className="sm:w-36">
            <Button variant="ghost" onClick={onClose}>
              {t('form.cancel')}
            </Button>
          </span>
          <span className="sm:w-44">
            <Button
              loading={busy}
              disabled={invalid}
              onClick={() =>
                parent &&
                void run(
                  () =>
                    sendJson(
                      '/api/branches',
                      { name: name.trim(), ...(code.trim() ? { code: code.trim() } : {}), typeId, parentId: parent.id },
                      'POST',
                    ),
                  t('form.created'),
                  onClose,
                )
              }
            >
              {t('form.save')}
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {parent && <p className="text-[13px] text-k-text-2">{t('quick.under', { path: parent.fullName || parent.name })}</p>}
        {branching && <p role="note" className="rounded-xl bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">{t('form.branchingWarning')}</p>}
        <Field label={t('form.fields.name')}>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.fields.code')} error={dup ? t('quick.dupCode') : null} hint={t('form.fields.codeHint')}>
            <Input value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('form.fields.type')}>
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {activeTypes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Mover una oficina (y todo lo que cuelga de ella) bajo otra. Se llega por arrastre (`to` ya viene) o por «Mover a…»
 * del menú (se elige el destino: es la alternativa de teclado y de teléfono, donde arrastrar no existe).
 *
 * Confirma con lo que cambia —personas y créditos de la rama— y, si el servidor lo rechaza (ciclo, profundidad, plan),
 * muestra su motivo SIN mover nada: el árbol se vuelve a leer del servidor, no se adivina.
 */
export function MoveDialog({
  move,
  rows,
  onClose,
}: {
  move: { id: string; to: string | null } | null;
  rows: OfficeRow[];
  onClose: () => void;
}) {
  const { busy, error, setError, run, t } = useOfficeApi();
  const [target, setTarget] = useState('');
  const node = move ? rows.find((r) => r.id === move.id) : undefined;

  useEffect(() => {
    if (move) {
      setTarget(move.to ?? '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.id, move?.to]);

  const options = flattenTree(buildOfficeTree(activeOffices(rows))).map((r) => ({ id: r.id, name: r.fullName || r.name, depth: r.depth }));
  const blocked = new Set(node ? options.filter((o) => moveVerdict(rows, node.id, o.id) !== 'OK').map((o) => o.id) : []);
  const dest = rows.find((r) => r.id === target);
  const branch = node ? rows.filter((r) => r.path.startsWith(node.path)) : [];
  const people = branch.reduce((n, r) => n + r.members, 0);
  const credits = branch.reduce((n, r) => n + r.credits, 0);

  return (
    <Modal
      open={move !== null && node !== undefined}
      onClose={onClose}
      locked={busy}
      title={node ? t('move.title', { name: node.name }) : ''}
      actions={
        <>
          <span className="sm:w-36">
            <Button variant="ghost" onClick={onClose}>
              {t('form.cancel')}
            </Button>
          </span>
          <span className="sm:w-44">
            <Button
              loading={busy}
              disabled={!target || blocked.has(target)}
              onClick={() => node && void run(() => sendJson(`/api/branches/${node.id}/move`, { parentId: target }, 'POST'), t('move.done'), onClose)}
            >
              {t('move.ok')}
            </Button>
          </span>
        </>
      }
    >
      {node && (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <Field label={t('move.to')}>
            <OfficeSelect options={options} disabledIds={blocked} emptyLabel={t('move.pick')} value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          {dest && (
            <p className="text-[14px] text-k-text">
              {t('move.confirm', { name: node.fullName || node.name, to: dest.fullName || dest.name })}
            </p>
          )}
          {(people > 0 || credits > 0) && (
            <p role="note" className="rounded-xl bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">
              {t('move.impact', { people, credits, offices: branch.length })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Desactivar (a la papelera). Antes de intentarlo dice por qué no se podrá, igual que lo rechazaría el servidor. */
export function DeactivateDialog({ office, rows, onClose }: { office: OfficeRow | null; rows: OfficeRow[]; onClose: () => void }) {
  const { busy, error, setError, run, t } = useOfficeApi();
  useEffect(() => {
    if (office) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.id]);
  const check = office ? deactivateBlockers(rows, office.id) : null;
  const blocked = (check?.blockers.length ?? 0) > 0;

  return (
    <Modal
      open={office !== null}
      onClose={onClose}
      locked={busy}
      title={office ? t('deactivate.title', { name: office.name }) : ''}
      actions={
        <>
          <span className="sm:w-36">
            <Button variant="ghost" onClick={onClose}>
              {t('form.cancel')}
            </Button>
          </span>
          <span className="sm:w-44">
            <Button
              variant="danger"
              loading={busy}
              disabled={blocked}
              onClick={() => office && void run(() => sendJson(`/api/branches/${office.id}/deactivate`, null, 'POST'), t('deactivate.done'), onClose)}
            >
              {t('deactivate.ok')}
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorBanner message={error} />
        {blocked && check ? (
          <ul className="list-disc space-y-1 pl-5 text-[14px] text-k-text">
            {check.blockers.includes('ROOT') && <li>{t('deactivate.root')}</li>}
            {check.blockers.includes('ACTIVE_CHILDREN') && <li>{t('deactivate.children', { n: check.children })}</li>}
            {check.blockers.includes('MEMBERS') && <li>{t('deactivate.members', { n: check.members })}</li>}
            {check.blockers.includes('CREDITS') && <li>{t('deactivate.credits', { n: check.credits })}</li>}
          </ul>
        ) : (
          <p className="text-[14px] text-k-text">{t('deactivate.text')}</p>
        )}
      </div>
    </Modal>
  );
}
