'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';

/** Los tres modos de ponerlo al día. La regla de cuáles hay vive en el DTO de la API. */
const MODES = ['next_period', 'date', 'none'] as const;
type Mode = (typeof MODES)[number];

const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Las dos acciones de mora del crédito: **marcarlo** y **ponerlo al día**.
 *
 * 🔴 **«Poner al día» mueve la fecha; no pone un número en cero.** Un botón que sólo bajara la mora
 * sería mentirle al sistema: la fecha seguiría vencida y el trabajo diario reabriría el caso esta
 * misma noche, y quien lo tocó vería reaparecer lo que creyó haber resuelto. Por eso pregunta cómo:
 * avanzar un período, la fecha que se acordó, o sin vencimiento.
 *
 * 🔴 **«Marcar en mora» no espera al trabajo diario**: abre el caso en el acto. Es el botón del
 * prestamista que presta sin cronograma y sabe que le deben — decirle que su decisión vale dentro de
 * seis horas sería no haberla ofrecido.
 *
 * Ninguna de las dos se dibuja para un crédito importado: su mora la manda el archivo, y la API las
 * rechaza con `CREDIT_LOCKED`.
 */
export function ArrearsActions({
  creditId,
  daysPastDue,
  locked,
}: {
  creditId: string;
  daysPastDue: number;
  /** Importado: su mora es del archivo. Ni se marca ni se pone al día desde acá. */
  locked?: boolean;
}) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState<'mark' | 'clear' | null>(null);
  const [days, setDays] = useState('');
  const [mode, setMode] = useState<Mode>('next_period');
  const [date, setDate] = useState(hoyIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (locked) return null;
  const enMora = daysPastDue > 0;

  async function enviar(path: string, payload: unknown, ok: string) {
    setError(null);
    setBusy(true);
    const res = await postJson(`/api/credits/${creditId}/arrears${path}`, payload);
    setBusy(false);
    if (!res.ok) {
      // El servidor sabe por qué: fecha pasada, crédito importado, no está activo.
      setError(res.data.error?.message ?? t('saveError'));
      return;
    }
    setAbierto(null);
    toast(ok);
    router.refresh();
  }

  return (
    <>
      {enMora ? (
        <button type="button" onClick={() => setAbierto('clear')} className="text-[13px] font-medium text-k-success hover:underline">
          {t('arrears.clearCta')}
        </button>
      ) : (
        <button type="button" onClick={() => setAbierto('mark')} className="text-[13px] font-medium text-k-danger hover:underline">
          {t('arrears.markCta')}
        </button>
      )}

      <Modal
        open={abierto === 'mark'}
        onClose={() => setAbierto(null)}
        title={t('arrears.markTitle')}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setAbierto(null)} disabled={busy}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button loading={busy} onClick={() => void enviar('', { days: Number(days) || 0 }, t('arrears.marked'))}>
                {t('arrears.markOk')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('arrears.markText')}</p>
        <div className="mt-4">
          {/* Vacío = desde hoy. Lo que se guarda es la fecha, no el número: así los días avanzan
              solos sin que nadie tenga que volver a tocarlos. */}
          <Field label={t('arrears.days')}>
            <Input type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} placeholder="0" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={abierto === 'clear'}
        onClose={() => setAbierto(null)}
        title={t('arrears.clearTitle')}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setAbierto(null)} disabled={busy}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button
                loading={busy}
                onClick={() => void enviar('/clear', { mode, ...(mode === 'date' ? { date } : {}) }, t('arrears.cleared'))}
              >
                {t('arrears.clearOk')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>
          {t('arrears.clearText')} <Badge tone="danger">{t('days', { count: daysPastDue })}</Badge>
        </p>
        <div className="mt-4 space-y-4">
          <Field label={t('arrears.mode')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={busy}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`arrears.modes.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'date' && (
            <Field label={t('fields.nextDue')}>
              {/* `min` de hoy: una fecha pasada la rechaza el servidor, y es mejor no ofrecerla. */}
              <Input type="date" min={hoyIso()} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            </Field>
          )}
          <p className="text-[13px] text-k-text-2">{t(`arrears.modeHint.${mode}`)}</p>
        </div>
      </Modal>
    </>
  );
}
