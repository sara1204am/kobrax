'use client';

import { useEffect, useState } from 'react';
import { Button, ErrorBanner, Field } from '@/components/ui';
import { Modal } from '@/components/modal';
import { OfficeSelect } from '@/components/office-select';
import { sendJson } from '@/lib/client';
import { flattenTree, activeOffices, type OfficeRow } from '@/lib/offices';
import { buildOfficeTree } from '@kobrax/shared';
import { useOfficeApi } from './use-office-api';

/**
 * «Mover cartera» (ADR-0004): la cartera de la raíz se vacía hacia las oficinas nuevas. Necesita `assignment:write`
 * (lo valida la API). Mueve TODOS los créditos de la oficina de origen a la elegida, por lotes auditados; los pagos
 * anteriores conservan su oficina de origen (A-2) y no se tocan.
 */
export function MovePortfolioDialog({ from, rows, onClose }: { from: OfficeRow | null; rows: OfficeRow[]; onClose: () => void }) {
  const { busy, error, setError, run, t } = useOfficeApi();
  const [to, setTo] = useState('');
  const [moved, setMoved] = useState<number | null>(null);

  useEffect(() => {
    if (from) {
      setTo('');
      setMoved(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.id]);

  const options = flattenTree(buildOfficeTree(activeOffices(rows)))
    .filter((r) => from && r.id !== from.id)
    .map((r) => ({ id: r.id, name: r.fullName || r.name, depth: r.depth }));

  async function go() {
    if (!from) return;
    setMoved(null);
    // El BFF pagina los créditos y los reasigna por lote; contesta cuántos pasaron.
    await run(
      async () => {
        const res = await sendJson<{ moved?: number }>(`/api/branches/${from.id}/move-portfolio`, { toBranchId: to }, 'POST');
        if (res.ok) setMoved(res.data.moved ?? 0);
        return res;
      },
      t('portfolio.done'),
    );
  }

  return (
    <Modal
      open={from !== null}
      onClose={onClose}
      locked={busy}
      title={t('portfolio.title')}
      actions={
        <>
          <span className="sm:w-36">
            <Button variant="ghost" onClick={onClose}>
              {t('form.close')}
            </Button>
          </span>
          <span className="sm:w-48">
            <Button loading={busy} disabled={!to || moved !== null} onClick={() => void go()}>
              {t('portfolio.ok')}
            </Button>
          </span>
        </>
      }
    >
      {from && (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <p className="text-[14px] text-k-text">{t('portfolio.text', { name: from.fullName || from.name, n: from.credits })}</p>
          <Field label={t('portfolio.to')}>
            <OfficeSelect options={options} emptyLabel={t('portfolio.pick')} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <p className="text-[12px] text-k-muted">{t('portfolio.paymentsNote')}</p>
          {moved !== null && <p role="status" className="rounded-xl bg-k-success-bg px-3 py-2 text-[13px] text-k-success">{t('portfolio.moved', { n: moved })}</p>}
        </div>
      )}
    </Modal>
  );
}
