'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PermissionCatalogEntry, RoleDetail, RoleUpdateResult } from '@kobrax/shared';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { groupByModule, permissionKey, scopeOf, setScope, summarizeChange, togglePermission } from '@/lib/roles';
import { ConfirmSensitiveDialog, type RoleSaveFailure } from './confirm-sensitive-dialog';
import { PermissionRow } from './permission-row';
import { ScopeRadio } from './scope-radio';

/**
 * El editor de permisos de un rol (vista C del plan). Todo el estado es local hasta confirmar: marcar una casilla con dependencias marca lo que
 * necesita (y lo avisa), apagar una apaga lo que dependía de ella, y el alcance de datos es uno solo. Nada se guarda hasta el diálogo de confirmación.
 *
 * 🔴 Las reglas de verdad las hace cumplir el servidor (`role.editPermissions`); esto sólo evita mandar lo que sabemos que se rechaza.
 */
export function RoleEditor({ role, catalog, roleName, selfInRole }: { role: RoleDetail; catalog: PermissionCatalogEntry[]; roleName: string; selfInRole: boolean }) {
  const t = useTranslations('roles');
  const tp = useTranslations('permissions');
  const router = useRouter();
  const toast = useToast();

  const original = role.granted;
  const templateSet = useMemo(() => new Set([...original.filter((c) => !role.diff.added.includes(c)), ...role.diff.removed]), [original, role.diff]);
  const [desired, setDesired] = useState<string[]>(original);
  const [notice, setNotice] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const groups = useMemo(() => groupByModule(catalog), [catalog]);
  const summary = useMemo(() => summarizeChange(original, desired, catalog), [original, desired, catalog]);
  const granted = new Set(desired);
  const names = (codes: string[]) => codes.map((c) => tp(`${permissionKey(c)}.name`)).join(', ');

  function toggle(code: string, on: boolean) {
    const r = togglePermission(desired, code, on, catalog);
    setDesired(r.next);
    setFlagged(new Set());
    setNotice(r.autoAdded.length ? t('editor.autoAdded', { list: names(r.autoAdded) }) : r.autoRemoved.length ? t('editor.autoRemoved', { list: names(r.autoRemoved) }) : null);
  }

  function onSaved(result: RoleUpdateResult) {
    setConfirming(false);
    toast(t('editor.saved', { n: result.affectedMembers }), 'success');
    router.push(`/seguridad/roles/${encodeURIComponent(role.key ?? '')}`);
    router.refresh();
  }

  function onFailed(failure: RoleSaveFailure) {
    setFlagged(new Set(failure.flagged));
  }

  return (
    <div className="space-y-4 pb-24">
      {selfInRole && <p className="rounded-lg border border-k-warning bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">{t('editor.selfNote')}</p>}
      {notice && (
        <p role="status" className="rounded-lg border border-k-periwinkle bg-k-highlight px-3 py-2 text-[13px] text-k-text">
          {notice}
        </p>
      )}

      <ScopeRadio
        value={scopeOf(desired)}
        onChange={(scope) => {
          setDesired(setScope(desired, scope));
          setNotice(null);
          setFlagged(new Set());
        }}
      />

      <div className="space-y-2">
        {groups.map((g, i) => {
          const on = g.items.filter((p) => granted.has(p.code)).length;
          return (
            <details key={g.module} open={i === 0 || g.items.some((p) => flagged.has(p.code))} className="rounded-xl border border-k-border bg-k-bg">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] font-semibold text-k-navy">
                <span>{t(`modules.${g.module}`)}</span>
                <span className="text-[12px] font-normal text-k-text-2">{t('editor.moduleCount', { granted: on, total: g.items.length })}</span>
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {g.items.map((p) => (
                  <PermissionRow
                    key={p.code}
                    entry={p}
                    checked={granted.has(p.code)}
                    fromTemplate={templateSet.has(p.code)}
                    flagged={flagged.has(p.code)}
                    onChange={(v) => toggle(p.code, v)}
                    // Quien pertenece al rol sólo puede quitar: encender se rechazaría.
                    disabled={selfInRole && !granted.has(p.code)}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-k-border bg-white/95 px-4 py-3 backdrop-blur sm:pl-[var(--k-sidebar,0px)]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-k-text">
            {summary.count === 0 ? t('editor.noChanges') : t('editor.changes', { n: summary.count })}
            {summary.highRiskAdded.length > 0 && <span className="ml-2 font-medium text-k-danger">· {t('editor.highRisk', { n: summary.highRiskAdded.length })}</span>}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Link href={`/seguridad/roles/${encodeURIComponent(role.key ?? '')}`} className="flex h-12 items-center justify-center rounded-xl border border-k-border bg-white px-5 text-[15px] font-semibold text-k-text-2 hover:bg-k-bg">
              {t('editor.cancel')}
            </Link>
            <Button type="button" className="sm:w-auto sm:px-6" disabled={summary.count === 0} onClick={() => setConfirming(true)}>
              {summary.count > 0 ? t('editor.review') : t('editor.save')}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmSensitiveDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        roleKey={role.key ?? ''}
        roleName={roleName}
        members={role.members ?? 0}
        expectedVersion={role.version ?? 1}
        desired={desired}
        summary={summary}
        onSaved={onSaved}
        onFailed={onFailed}
      />
    </div>
  );
}
