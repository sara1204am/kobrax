'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { PRIORITIES } from './priority-cell';

const MODES = ['next_period', 'date', 'none'] as const;

const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Lo que se puede hacer con varias filas de Mora a la vez.
 *
 * 🔴 **Las dos obligan a elegir qué se hace, y ninguna es un «resolver» genérico.** Un botón que
 * vaciara cuarenta filas sin decir qué les hizo es donde se esconde cartera: el motivo es lo que
 * después deja contestar por qué desaparecieron cuarenta un martes.
 *
 * 🔴 **Poner al día en lote muestra el número antes de confirmar y avisa que no se deshace.** Es la
 * única acción del panel que puede cerrar decenas de cobranzas de un clic.
 */
export function BulkActions({
  ids,
  clear,
  members,
  canAssign,
  canWrite,
}: {
  ids: string[];
  clear: () => void;
  members: Member[];
  /** Sin `case:assign` la API rechaza asignar; el botón no se dibuja. */
  canAssign: boolean;
  /** `case:write` — sin él no se cambia ni la prioridad ni la mora. */
  canWrite: boolean;
}) {
  const t = useTranslations('panel.cases');
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState<'assign' | 'clear' | 'priority' | null>(null);
  const [collectorId, setCollectorId] = useState('');
  const [priority, setPriority] = useState<string>('HIGH');
  const [mode, setMode] = useState<(typeof MODES)[number]>('next_period');
  const [date, setDate] = useState(hoyIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aplicar(payload: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    const res = await postJson<{ done: number; failed: number; message?: string }>('/api/mora/bulk', {
      caseIds: ids,
      ...payload,
    });
    setBusy(false);
    if (!res.ok) return setError(res.data.error?.message ?? t('bulk.error'));

    const { done, failed, message } = res.data;
    // 🔴 Se dice cuántas entraron **y cuántas no**. «Listo» a secas sobre un lote parcial es mentira.
    if (failed > 0) setError(t('bulk.partial', { done, failed, reason: message ?? '' }));
    else {
      setAbierto(null);
      clear();
      toast(t('bulk.done', { count: done }));
    }
    router.refresh();
  }

  return (
    <>
      {canAssign && (
        <button
          type="button"
          onClick={() => setAbierto('assign')}
          className="h-8 rounded-lg bg-white px-3 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
        >
          {t('bulk.assign')}
        </button>
      )}
      {canWrite && (
        <button
          type="button"
          onClick={() => setAbierto('priority')}
          className="h-8 rounded-lg bg-white px-3 text-[13px] font-medium text-k-periwinkle hover:bg-k-light-bg"
        >
          {t('bulk.priority')}
        </button>
      )}
      <button
        type="button"
        onClick={() => setAbierto('clear')}
        className="h-8 rounded-lg bg-white px-3 text-[13px] font-medium text-k-success hover:bg-k-light-bg"
      >
        {t('bulk.clear')}
      </button>

      <Modal
        open={abierto === 'priority'}
        onClose={() => setAbierto(null)}
        title={t('bulk.priorityTitle', { count: ids.length })}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setAbierto(null)} disabled={busy}>
                {t('bulk.cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void aplicar({ action: 'priority', priority })}>
                {t('bulk.priorityOk')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('bulk.priorityText')}</p>
        <div className="mt-4">
          <Field label={t('columns.priority')}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={busy}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
              {/* Soltarlas en lote: devuelve al cálculo del trabajo diario las que estén fijadas. */}
              <option value="auto">{t('priorityBackToAuto')}</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={abierto === 'assign'}
        onClose={() => setAbierto(null)}
        title={t('bulk.assignTitle', { count: ids.length })}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setAbierto(null)} disabled={busy}>
                {t('bulk.cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void aplicar({ action: 'assign', collectorId: collectorId || undefined })}>
                {t('bulk.assign')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <Field label={t('filters.assignee')}>
          <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)} disabled={busy}>
            {/* Vacío = al de menor carga. Es lo que ya sabe hacer `POST /cases/:id/assign` con `auto`. */}
            <option value="">{t('assign.auto')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberName(m)}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={abierto === 'clear'}
        onClose={() => setAbierto(null)}
        title={t('bulk.clearTitle', { count: ids.length })}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setAbierto(null)} disabled={busy}>
                {t('bulk.cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void aplicar({ action: 'clear', mode, ...(mode === 'date' ? { date } : {}) })}>
                {t('bulk.clearOk')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('bulk.clearText', { count: ids.length })}</p>
        <p className="mt-2 font-medium text-k-warning-text">{t('bulk.warning')}</p>
        <div className="mt-4 space-y-4">
          <Field label={t('arrearsMode')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])} disabled={busy}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`bulk.modes.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'date' && (
            <Field label={t('bulk.date')}>
              <Input type="date" min={hoyIso()} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}
