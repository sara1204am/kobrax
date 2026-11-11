'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { PermissionCatalogEntry } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { permissionKey } from '@/lib/roles';
import { RiskBadge } from './risk-badge';

/**
 * Un permiso del editor: su nombre, qué hace, riesgo, de qué depende y si viene de la plantilla. Cada uno es un `fieldset` con `legend` y su estado
 * está escrito (Concedido / Denegado / Reservado), no sólo coloreado.
 */
export function PermissionRow({
  entry,
  checked,
  fromTemplate,
  flagged,
  disabled,
  onChange,
}: {
  entry: PermissionCatalogEntry;
  checked: boolean;
  /** ¿La plantilla del rol lo trae? Si el estado actual difiere, es «personalizado». */
  fromTemplate: boolean;
  /** El servidor lo señaló como causa de un rechazo. */
  flagged?: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('roles.editor');
  const tp = useTranslations('permissions');
  const id = useId();
  const key = permissionKey(entry.code);
  const locked = entry.reserved !== null;
  const custom = checked !== fromTemplate;
  const requires = entry.requires.map((r) => tp(`${permissionKey(r)}.name`)).join(', ');

  return (
    <fieldset
      className={`rounded-lg border px-3 py-2.5 ${flagged ? 'border-k-danger bg-k-danger-bg' : 'border-k-border bg-white'} ${locked ? 'opacity-80' : ''}`}
      data-code={entry.code}
    >
      <legend className="sr-only">{tp(`${key}.name`)}</legend>
      <div className="flex flex-wrap items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled || locked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-k-purple"
          aria-describedby={`${id}-desc`}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-[14px] font-medium text-k-text">
            {tp(`${key}.name`)}
          </label>
          <p id={`${id}-desc`} className="mt-0.5 text-[13px] text-k-text-2">
            {tp(`${key}.description`)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-k-muted">{entry.code}</p>
          {requires && <p className="mt-1 text-[12px] text-k-muted">{t('requires', { list: requires })}</p>}
          {locked && <p className="mt-1 text-[12px] font-medium text-k-text-2">🔒 {t('locked')}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <RiskBadge risk={entry.risk} />
          <Badge tone={custom ? 'warning' : 'neutral'}>{custom ? t('origin.custom') : t('origin.inherited')}</Badge>
          <Badge tone={locked ? 'neutral' : checked ? 'success' : 'neutral'}>{locked ? t('reservedShort') : checked ? t('granted') : t('denied')}</Badge>
        </div>
      </div>
    </fieldset>
  );
}
