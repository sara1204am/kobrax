'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  creditFormState,
  initialStateFromForm,
  isUnknownField,
  registeredState,
  termsEditBlock,
  type CreditDetail,
  type Member,
} from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Badge, PageHeader } from '@/components/panel-ui';
import { Button, ErrorBanner } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { money, todayIso } from '@/lib/format';
import { creditDraft, creditPatch, hasCreditChanges, type CreditDraft } from '@/lib/credit-patch';
import { ArrearsActions } from './arrears-actions';
import { CreditEditor } from './credit-editor';
import { CreditView } from './credit-view';

/**
 * La ficha del crédito (F4/06 · Fase 3): **se lee primero, se edita con «Editar»**.
 *
 * 🔴 **Antes era un formulario siempre abierto**, con los campos del alta vieja (modos A/B) y un
 * cronograma que pintaba las fechas un día antes en Bolivia. Ahora la lectura responde cinco preguntas
 * —condiciones, estado actual, plan, cobranza, origen— y la edición vuelve a definir el crédito con los
 * mismos campos y el mismo motor que el alta.
 *
 * Qué se puede editar lo decide `termsEditBlock` (shared), el mismo criterio que aplica la API:
 * condiciones y estado al registrar sólo sin pagos, sin cronograma guardado y si no es importado.
 * La organización (estado, código, tipo, responsable) se edita siempre.
 */
export function CreditCard({
  credit,
  clientId,
  team,
  types,
}: {
  credit: CreditDetail;
  clientId: string;
  /** El equipo, para reasignar el préstamo. Vacío si el rol no puede leer `/users`. */
  team: Member[];
  /** Catálogo `CREDIT_TYPE` del tenant. Vacío = el tipo no se ofrece. */
  types: CatalogOption[];
}) {
  const t = useTranslations('portfolio');
  const td = useTranslations('portfolio.creditDetail');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can('credit:write');
  const block = termsEditBlock(credit);

  /** Cómo se abrió la edición: contra esto se decide qué cambió. `null` = modo lectura. */
  const [opened, setOpened] = useState<CreditDraft | null>(null);
  const [draft, setDraft] = useState<CreditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const state = useMemo(() => (draft ? creditFormState(draft.form) : null), [draft]);
  const registered = useMemo(() => {
    if (!draft || !state || state.missing.length > 0 || !state.calculation.ok) return null;
    return registeredState(state.terms, initialStateFromForm(draft.initial));
  }, [draft, state]);

  const patch = opened && draft ? creditPatch(credit, opened, draft, block === null) : {};
  const redefining = Boolean(patch.terms || patch.initialState);
  // Redefinir sólo se manda si el motor y la regla D13 lo aceptan: la API diría lo mismo.
  const valid = !redefining || Boolean(state?.canSubmit && registered?.ok);

  function startEdit() {
    const d = creditDraft(credit, todayIso());
    setOpened(d);
    setDraft(d);
    setError(null);
  }

  function cancelEdit() {
    setOpened(null);
    setDraft(null);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!hasCreditChanges(patch) || !valid) return;
    setError(null);
    setSaving(true);
    const { ok, data } = await sendJson<CreditDetail>(`/api/credits/${credit.id}`, patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    toast(td('saved'));
    cancelEdit();
    router.refresh();
  }

  const editing = draft !== null && state !== null;

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title={isUnknownField(credit, 'outstandingBalance') ? td('unknown') : money(credit.outstandingBalance, credit.currency)}
        subtitle={t('creditSubtitle', {
          principal: isUnknownField(credit, 'principalAmount') ? td('unknown') : money(credit.principalAmount, credit.currency),
          code: credit.code ?? t('noCode'),
        })}
        /* Las etiquetas van pegadas al saldo que califican, no a media pantalla entre los botones. */
        badge={
          <>
            {credit.locked && <Badge tone="warning">{t('imported')}</Badge>}
            {(credit.daysPastDue ?? 0) > 0 && <Badge tone="danger">{t('days', { count: credit.daysPastDue! })}</Badge>}
            {/* Marcar en mora / poner al día: al lado de los días, que es el dato que cambian. */}
            {canWrite && !editing && (
              <ArrearsActions creditId={credit.id} daysPastDue={credit.daysPastDue ?? 0} locked={credit.locked} />
            )}
          </>
        }
        actions={
          editing ? (
            <>
              <span className="w-36">
                <Button type="button" variant="ghost" onClick={cancelEdit} disabled={saving}>
                  {td('cancelEdit')}
                </Button>
              </span>
              <span className="w-44">
                <Button type="submit" loading={saving} disabled={!hasCreditChanges(patch) || !valid}>
                  {td('save')}
                </Button>
              </span>
            </>
          ) : (
            <>
              {/* Botones y no links de texto: son las salidas de esta pantalla y hay que verlas.
                  La de pagos es además la ÚNICA puerta a los de ESTE crédito — registrar y pedir un
                  cobro los exigen, y el ledger no elige el crédito: se lo tiene que traer quien llega. */}
              <span className="w-44">
                <Button type="button" variant="ghost" onClick={() => router.push(`/pagos?creditId=${credit.id}`)}>
                  {t('creditPayments')}
                </Button>
              </span>
              <span className="w-44">
                <Button type="button" variant="ghost" onClick={() => router.push(`/cartera/${clientId}`)}>
                  {t('backToClient')}
                </Button>
              </span>
              {canWrite && (
                <span className="w-32">
                  <Button type="button" onClick={startEdit}>
                    {td('edit')}
                  </Button>
                </span>
              )}
            </>
          )
        }
      />

      <ErrorBanner message={error} />
      {credit.locked && <p className="text-[13px] text-k-warning-text">{t('lockedHint')}</p>}

      {editing ? (
        <CreditEditor
          credit={credit}
          draft={draft}
          onChange={setDraft}
          block={block}
          state={state}
          registered={registered}
          team={team}
          types={types}
        />
      ) : (
        <CreditView credit={credit} team={team} types={types} />
      )}
    </form>
  );
}
