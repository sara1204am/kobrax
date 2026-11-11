'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { RoleCompare } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { permissionKey } from '@/lib/roles';

/** Dos selectores y una fila por permiso: quién lo tiene. Elegir otro rol escribe la URL (la comparación se comparte por link). */
export function CompareView({ roles, a, b, compare }: { roles: { key: string }[]; a?: string; b?: string; compare: RoleCompare | null }) {
  const t = useTranslations('roles');
  const tp = useTranslations('permissions');
  const router = useRouter();
  const [onlyDiff, setOnlyDiff] = useState(true);

  const roleName = (key: string) => (t.has(`roleNames.${key}`) ? t(`roleNames.${key}`) : key);
  const go = (na?: string, nb?: string) => {
    const qs = new URLSearchParams();
    if (na) qs.set('a', na);
    if (nb) qs.set('b', nb);
    router.push(`/seguridad/roles/comparar${qs.size ? `?${qs}` : ''}`);
  };

  const rows = compare ? compare.rows.filter((r) => !onlyDiff || r.a !== r.b) : [];
  const select = (value: string | undefined, onChange: (v: string) => void, label: string) => (
    <label className="flex items-center gap-2 text-[14px] text-k-text">
      <span className="sr-only">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text">
        <option value="" disabled>
          —
        </option>
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {roleName(r.key)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {select(a, (v) => go(v, b), 'A')}
        <span className="text-[14px] text-k-text-2">{t('compareView.with')}</span>
        {select(b, (v) => go(a, v), 'B')}
        <label className="ml-auto flex items-center gap-2 text-[13px] text-k-text-2">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="accent-k-purple" />
          {t('compareView.onlyDiff')}
        </label>
      </div>

      {!compare ? (
        <EmptyState title={t('compareView.pick')} />
      ) : (
        <>
          <div className="grid gap-2 rounded-lg border border-k-border bg-white p-3 text-[13px] sm:grid-cols-2">
            <p>
              <span className="font-semibold text-k-navy">{roleName(compare.a.key ?? compare.a.name)}</span> · {t('compareView.scope')}: {compare.a.scopeKind ? t(`scope.${compare.a.scopeKind}`) : '—'}
            </p>
            <p>
              <span className="font-semibold text-k-navy">{roleName(compare.b.key ?? compare.b.name)}</span> · {t('compareView.scope')}: {compare.b.scopeKind ? t(`scope.${compare.b.scopeKind}`) : '—'}
            </p>
          </div>
          {rows.length === 0 ? (
            <EmptyState title={t('compareView.noDifferences')} />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-k-border bg-white">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-k-bg text-k-text-2">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('compareView.permission')}</th>
                    <th className="px-3 py-2 text-center font-medium">{roleName(compare.a.key ?? compare.a.name)}</th>
                    <th className="px-3 py-2 text-center font-medium">{roleName(compare.b.key ?? compare.b.name)}</th>
                    <th className="px-3 py-2 font-medium">{t('compareView.difference')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-t border-k-border">
                      <td className="px-3 py-2">
                        <span className="font-medium text-k-text">{tp(`${permissionKey(r.code)}.name`)}</span>
                        <span className="block font-mono text-[11px] text-k-muted">{r.code}</span>
                      </td>
                      <td className="px-3 py-2 text-center">{r.a ? '✅' : '—'}</td>
                      <td className="px-3 py-2 text-center">{r.b ? '✅' : '—'}</td>
                      <td className="px-3 py-2">
                        {r.a === r.b ? (
                          <Badge tone="neutral">{t('compareView.same')}</Badge>
                        ) : (
                          <Badge tone="warning">{r.a ? t('compareView.onlyA', { name: roleName(compare.a.key ?? compare.a.name) }) : t('compareView.onlyB', { name: roleName(compare.b.key ?? compare.b.name) })}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
