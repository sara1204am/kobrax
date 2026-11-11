'use client';

import { useTranslations } from 'next-intl';
import { permissionKey } from '@/lib/roles';

/** Los alcances de datos que un rol puede tener, de más a menos; `null` = lo propio (sin permiso de alcance). */
const OPTIONS: { value: string | null; label: 'ALL' | 'SUBTREE' | 'BRANCH' | 'OWN'; code: string | null }[] = [
  { value: 'data:scope:all', label: 'ALL', code: 'data:scope:all' },
  { value: 'data:scope:subtree', label: 'SUBTREE', code: 'data:scope:subtree' },
  { value: 'data:scope:branch', label: 'BRANCH', code: 'data:scope:branch' },
  { value: null, label: 'OWN', code: null },
];

/** El alcance de datos del rol: UNO solo (radio). Cambiar uno quita el anterior. */
export function ScopeRadio({ value, onChange, disabled }: { value: string | null; onChange: (scope: string | null) => void; disabled?: boolean }) {
  const t = useTranslations('roles');
  const tp = useTranslations('permissions');
  return (
    <fieldset className="rounded-lg border border-k-border bg-white p-4" disabled={disabled}>
      <legend className="px-1 text-[13px] font-semibold text-k-navy">{t('editor.scopeTitle')}</legend>
      <p className="mb-3 text-[13px] text-k-text-2">{t('editor.scopeHelp')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label key={o.label} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[14px] ${value === o.value ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border'}`}>
            <input type="radio" name="scope" checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-k-purple" />
            <span>
              <span className="block font-medium text-k-text">{t(`scope.${o.label}`)}</span>
              {o.code && <span className="block text-[12px] text-k-text-2">{tp(`${permissionKey(o.code)}.description`)}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
