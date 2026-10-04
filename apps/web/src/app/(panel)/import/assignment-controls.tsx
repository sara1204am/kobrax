'use client';

import { useTranslations } from 'next-intl';
import type { Assignee } from '@kobrax/shared';

/**
 * Las piezas del reparto en la vista previa del import. Todas trabajan por **nº de operación** y no
 * guardan nada: el estado vive en `ImportRunner` y viaja recién al confirmar.
 *
 * Los selectores son `<select>` nativos: con cien filas, un desplegable propio por fila es cien
 * menús montados; el nativo además se maneja con teclado y en el teléfono abre la rueda del sistema.
 */

const SELECT =
  'h-9 max-w-[220px] rounded-lg border border-k-border bg-white px-2 text-[13px] text-k-text focus:outline-none focus:ring-2 focus:ring-k-periwinkle disabled:opacity-50';

/** Cómo se lee un responsable: «Yo (Ana)», el nombre, o «Sin asignar». */
export type NameOf = (userId: string | null | undefined) => string;

/**
 * El responsable de UNA fila. Ofrece a quien se le puede asignar (P3); el valor actual, si no está
 * entre ellos (un gerente, alguien dado de baja), se muestra igual para no esconder lo que hay.
 */
export function AssigneeSelect({
  value,
  onChange,
  assignees,
  nameOf,
  allowEmpty,
  label,
  highlight,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  assignees: Assignee[];
  nameOf: NameOf;
  /** Los nuevos pueden quedar «Sin asignar» (y entonces no se confirma); los existentes no. */
  allowEmpty?: boolean;
  label: string;
  /** Resalta la fila que cambió: una reasignación no puede pasar desapercibida. */
  highlight?: boolean;
}) {
  const t = useTranslations('panel.import.assign');
  const known = value === null || assignees.some((a) => a.userId === value);
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`${SELECT} ${!value ? 'border-k-danger text-k-danger' : highlight ? 'border-k-purple bg-k-highlight font-medium text-k-purple' : ''}`}
    >
      {(allowEmpty || !value) && <option value="">{t('unassigned')}</option>}
      {!known && value && <option value={value}>{nameOf(value)}</option>}
      {assignees.map((a) => (
        <option key={a.userId} value={a.userId}>
          {a.isMe ? t('me', { name: a.name }) : a.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Lo que se hace con las filas elegidas: «3 seleccionados → [Asignar a ▼] [Asignar a mí]».
 * Elegir del desplegable ya aplica: un botón «Aplicar» al lado sería confirmar lo que se acaba de elegir.
 */
export function AssignBar({
  count,
  assignees,
  onAssign,
  verb,
}: {
  count: number;
  assignees: Assignee[];
  onAssign: (userId: string) => void;
  /** «Asignar a…» para los nuevos, «Reasignar a…» para los existentes. */
  verb: string;
}) {
  const t = useTranslations('panel.import.assign');
  const me = assignees.find((a) => a.isMe);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[13px] font-medium text-k-text">{t('selected', { n: count })} →</span>
      <select
        aria-label={verb}
        value=""
        onChange={(e) => e.target.value && onAssign(e.target.value)}
        className={SELECT}
      >
        <option value="">{verb}</option>
        {assignees.map((a) => (
          <option key={a.userId} value={a.userId}>
            {a.isMe ? t('me', { name: a.name }) : a.name}
          </option>
        ))}
      </select>
      {me && (
        <button
          type="button"
          onClick={() => onAssign(me.userId)}
          className="inline-flex h-9 items-center rounded-lg bg-k-highlight px-3 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
        >
          {t('assignToMe')}
        </button>
      )}
    </div>
  );
}

/**
 * Encima de la tabla de nuevos: cuántos tienen responsable, el reparto por persona, asignar de una
 * todos los que faltan y filtrar sólo los que faltan. Es lo que hace eficiente repartir 100 en 30/40/30.
 */
export function AssignToolbar({
  stats,
  nameOf,
  assignees,
  onAssignUnassigned,
  onlyUnassigned,
  onOnlyUnassigned,
}: {
  stats: { assigned: number; unassigned: number; byUser: { userId: string; count: number }[] };
  nameOf: NameOf;
  assignees: Assignee[];
  onAssignUnassigned: (userId: string) => void;
  onlyUnassigned: boolean;
  onOnlyUnassigned: (v: boolean) => void;
}) {
  const t = useTranslations('panel.import.assign');
  return (
    <div className="space-y-3 rounded-2xl border border-k-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={`text-[14px] font-semibold ${stats.unassigned > 0 ? 'text-k-danger' : 'text-k-navy'}`}>
          {t('stats', { assigned: stats.assigned, unassigned: stats.unassigned })}
        </span>
        {/* El reparto en vivo: «Juan 30 · María 40 · Pedro 30». Es lo que se mira antes de confirmar. */}
        <span className="flex flex-wrap gap-2">
          {stats.byUser.map((u) => (
            <span key={u.userId} className="rounded-full bg-k-bg px-2.5 py-1 text-[12px] text-k-text-2">
              {nameOf(u.userId)} <span className="font-semibold tabular-nums text-k-text">{u.count}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {stats.unassigned > 0 && (
          <select
            aria-label={t('assignAllUnassigned')}
            value=""
            onChange={(e) => e.target.value && onAssignUnassigned(e.target.value)}
            className={SELECT}
          >
            <option value="">{t('assignAllUnassigned')}</option>
            {assignees.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.isMe ? t('me', { name: a.name }) : a.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-[13px] text-k-text-2">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={(e) => onOnlyUnassigned(e.target.checked)}
            className="h-4 w-4 accent-k-purple"
          />
          {t('onlyUnassigned')}
        </label>
      </div>
    </div>
  );
}
