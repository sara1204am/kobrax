'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { PRIORITIES } from './priority-cell';

const MODES = ['next_period', 'date', 'none'] as const;

/** A quién se puede asignar: lo que devuelve `GET /assignments/assignees` (no depende de `user:read`). */
export interface Collector {
  userId: string;
  name: string;
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Lo que se puede hacer con varias filas de Mora a la vez.
 *
 * 🔴 **Las dos obligan a elegir qué se hace, y ninguna es un «resolver» genérico.** Un botón que
 * vaciara cuarenta filas sin decir qué les hizo es donde se esconde cartera: el motivo es lo que
 * después deja contestar por qué desaparecieron cuarenta un martes.
 *
 * Las acciones operan por **créditos** (F4/08): reasignar el responsable, fijar la prioridad del episodio y poner al día.
 *
 * 🔴 **Poner al día en lote muestra el número antes de confirmar y avisa que no se deshace.** Es la
 * única acción del panel que puede cerrar decenas de cobranzas de un clic.
 */
export function BulkActions({
  ids,
  clear,
  collectors,
  canAssign,
  canWrite,
}: {
  /** Ids de **crédito**. */
  ids: string[];
  clear: () => void;
  collectors: Collector[];
  /** Sin `assignment:write` la API rechaza asignar; el botón no se dibuja. */
  canAssign: boolean;
  /** `collection:write` — sin él no se cambia la prioridad. */
  canWrite: boolean;
}) {
  const t = useTranslations('panel.mora');
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
      creditIds: ids,
      ...payload,
    });
    setBusy(false);
    if (!res.ok) return setError(res.data.error?.message ?? t('bulk.error'));

    const { done, failed, message } = res.data;
    // 🔴 Se dice cuántas entraron **y cuántas no**. «Listo» a secas sobre un lote parcial es mentira.
    // `message` puede ser el código del motivo (reasignar) o el texto de la API.
    const reason = message && t.has(`bulk.skip.${message}` as never) ? t(`bulk.skip.${message}` as never) : (message ?? '');
    if (failed > 0) setError(t('bulk.partial', { done, failed, reason }));
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
              <Button loading={busy} disabled={!collectorId} onClick={() => void aplicar({ action: 'assign', userId: collectorId })}>
                {t('bulk.assign')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('bulk.assignText')}</p>
        <div className="mt-4">
          <Field label={t('filters.responsible')}>
            <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)} disabled={busy}>
              <option value="">{t('bulk.collectorPlaceholder')}</option>
              {collectors.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
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
