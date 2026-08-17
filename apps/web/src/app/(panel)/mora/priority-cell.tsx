'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CasePriority } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson } from '@/lib/client';
import { PRIORITY_TONE } from '@/lib/cases';

/** De mayor a menor: la que más se elige queda primera y no hay que recorrer la lista. */
export const PRIORITIES: CasePriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as CasePriority[];

/**
 * La prioridad, **cambiable desde la propia celda**.
 *
 * 🔴 **La prioridad la calcula el sistema, y por eso hace falta poder pisarla.** Sale del saldo, los
 * días de mora y el segmento de riesgo: buena regla para el caso general, y equivocada justo cuando
 * más importa —un deudor con dos días de atraso cae en baja aunque quien lo conoce sepa que es
 * moroso frecuente y hay que ir hoy—. Bajarla pasa menos, pero pasa.
 *
 * 🔴 **Cambiarla la FIJA, y eso se ve con el candado.** Si no se marcara, un préstamo de 200 días en
 * prioridad baja sería inexplicable desde la pantalla: parecería el cálculo roto en vez de una
 * decisión de alguien. Y sin verlo, tampoco habría cómo soltarla.
 *
 * 🔴 **Abre el modal del panel, no un `<select>`.** El primer intento fue un select nativo
 * transparente encima de la pastilla: dos líneas de código y el desplegable que abre es el crudo del
 * sistema operativo —sin los colores de la marca, desalineado del control que lo disparó y distinto
 * en cada máquina—. Que el truco sea corto no lo hace bueno; lo que se ve es un menú que parece de
 * otra aplicación.
 */
export function PriorityCell({
  caseId,
  priority,
  pinned,
  canWrite,
}: {
  caseId: string;
  priority: CasePriority;
  pinned?: boolean;
  canWrite: boolean;
}) {
  const t = useTranslations('panel.cases');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const etiqueta = <Badge tone={PRIORITY_TONE[priority]}>{t(`priority.${priority}`)}</Badge>;
  if (!canWrite) return etiqueta;

  async function aplicar(value: string) {
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson(
      `/api/cases/${caseId}/priority`,
      value === 'auto' ? { auto: true } : { priority: value },
    );
    setBusy(false);
    if (!ok) return setError(data.error?.message ?? t('priorityError'));
    setOpen(false);
    toast(value === 'auto' ? t('priorityAuto') : t('prioritySet'));
    router.refresh();
  }

  return (
    <>
      {/* `title` **y** `aria-label`: el tooltip es para quien ve, el rótulo para quien no. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('priorityChange')}
        aria-label={t('priorityChange')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-1 py-0.5 hover:border-k-border hover:bg-k-bg"
      >
        {etiqueta}
        {pinned ? (
          <span aria-hidden title={t('priorityPinned')} className="text-[11px]">
            📌
          </span>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-k-muted">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
          </svg>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('priorityChange')}
        actions={
          <span className="sm:w-40">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t('bulk.cancel')}
            </Button>
          </span>
        }
      >
        <ErrorBanner message={error} />
        <p>{pinned ? t('priorityPinnedText') : t('priorityAutoText')}</p>

        {/*
         * Una fila por prioridad, con su pastilla de color. Elegir aplica y cierra: son cuatro
         * opciones sin consecuencia irreversible, y pedir un «Confirmar» encima sería un segundo
         * clic para ratificar lo que ya se decidió.
         */}
        <ul className="mt-4 space-y-1.5">
          {PRIORITIES.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => void aplicar(p)}
                disabled={busy}
                aria-current={p === priority}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                  p === priority ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white hover:bg-k-bg'
                }`}
              >
                <Badge tone={PRIORITY_TONE[p]}>{t(`priority.${p}`)}</Badge>
                <span className="text-[13px] text-k-text-2">{t(`priorityHint.${p}`)}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Sólo si está fijada: ofrecer «volver a la automática» sobre una que ya lo es no hace nada. */}
        {pinned && (
          <button
            type="button"
            onClick={() => void aplicar('auto')}
            disabled={busy}
            className="mt-4 text-[13px] font-medium text-k-periwinkle hover:underline disabled:opacity-50"
          >
            {t('priorityBackToAuto')}
          </button>
        )}
      </Modal>
    </>
  );
}
