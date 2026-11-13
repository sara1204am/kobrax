'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner } from '@/components/ui';
import { OfficeSelect } from '@/components/office-select';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { officeLabelOf, officeOptions, type OfficeRow } from '@/lib/offices';
import { useRouter } from 'next/navigation';

/**
 * La oficina de una persona en su ficha (como Gallium: la asignación vive en el usuario). Sólo existe si la cuenta tiene
 * más de una oficina, y cambiarla pide `office:write`.
 *
 * 🔴 **Una sola oficina por persona** (por ahora): elegir otra la MUEVE; no se ofrece «agregar otra». Cambia la cartera
 * que ve. Si el servidor responde 409 (ya tiene una vigente), se muestra su motivo.
 */
export function MemberOffice({ userId, branchId, offices }: { userId: string; branchId: string | null; offices: OfficeRow[] }) {
  const t = useTranslations('team.detail');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = officeLabelOf(offices, branchId);

  async function call(go: () => ReturnType<typeof sendJson>, ok: string) {
    setBusy(true);
    setError(null);
    const res = await go();
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error?.message ?? t('officeError'));
      return;
    }
    setPicked('');
    toast(ok);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p>{label ?? <span className="text-k-muted">{t('noBranch')}</span>}</p>
      {can('office:write') && (
        <div className="space-y-2">
          <ErrorBanner message={error} />
          <label className="block text-[12px] font-medium text-k-text-2" htmlFor={`office-of-${userId}`}>
            {t('changeOffice')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[14rem] flex-1">
              <OfficeSelect
                id={`office-of-${userId}`}
                options={officeOptions(offices).filter((o) => o.id !== branchId)}
                emptyLabel={t('officePick')}
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
              />
            </span>
            <span className="w-32">
              <Button loading={busy} disabled={!picked} onClick={() => void call(() => sendJson(`/api/branches/${picked}/members`, { userId }, 'POST'), t('officeMoved'))}>
                {t('officeSave')}
              </Button>
            </span>
            {branchId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void call(() => sendJson(`/api/branches/${branchId}/members/${userId}`, null, 'DELETE'), t('officeRemoved'))}
                className="text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
              >
                {t('officeRemove')}
              </button>
            )}
          </div>
          <p className="text-[12px] text-k-muted">{t('officeOne')}</p>
        </div>
      )}
    </div>
  );
}
