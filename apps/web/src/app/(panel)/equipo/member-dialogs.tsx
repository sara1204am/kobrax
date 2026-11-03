'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberName, type InvitedMember, type Member } from '@kobrax/shared';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';
import { InvitationCode } from './invitation-code';
import { MemberHeader, WorkRow } from './team-ui';

/** Confirmación pendiente: qué se le va a hacer a quién. */
type Pending = { kind: 'deactivate' | 'reactivate' | 'remove'; member: Member } | null;

/** Lo que una persona tiene a su nombre y hay que pasar antes de desactivarla (lo informa la API). */
interface PendingWork {
  agenda: number;
  credits: number;
  routes: number;
}

/**
 * Las acciones sobre un miembro y las ventanas que las confirman: **una sola implementación** para la
 * lista y para la ficha. Antes vivían dentro de la tabla; al abrir la ficha, copiarlas habría sido
 * tener dos veces la regla de «no se desactiva a quien tiene trabajo sin pasarlo».
 *
 * - `ask(kind, member)` abre la confirmación de desactivar, reactivar o cancelar la invitación.
 * - `changeRole` y `resend` actúan directo.
 * - `dialogs` es el JSX de las ventanas: quien usa el hook lo pinta una vez.
 * - `onRemoved` corre al cancelar una invitación (la ficha de alguien que ya no existe no sirve).
 */
export function useMemberDialogs({
  team,
  seats,
  onRemoved,
}: {
  /** El equipo completo (sin paginar ni filtrar): de acá se elige a quién pasarle el trabajo. */
  team: Member[];
  /** Asientos del plan, para decir cuántos ocupará reactivar a alguien. Sin permiso de cuenta no viene. */
  seats?: { used: number; max: number | null };
  onRemoved?: () => void;
}) {
  const t = useTranslations('team');
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [resent, setResent] = useState<InvitedMember | null>(null);
  const [busy, setBusy] = useState(false);
  /** Quien se quiere desactivar tiene trabajo a su nombre: se pide a quién pasarlo. */
  const [transfer, setTransfer] = useState<{ member: Member; work: PendingWork } | null>(null);
  const [target, setTarget] = useState('');
  /** «Confirmo que quiero pasar todo»: el pase es masivo y no se deshace solo. */
  const [confirmed, setConfirmed] = useState(false);

  async function resend(member: Member) {
    setBusy(true);
    const { ok, data } = await postJson<InvitedMember>(`/api/users/${member.userId}/resend`, {});
    setBusy(false);
    if (!ok) {
      toast(data.error?.message ?? t('actionError'), 'danger');
      return;
    }
    setResent(data);
  }

  async function run(path: string, body: unknown, method: 'PATCH' | 'DELETE', okMessage: string, after?: () => void) {
    setBusy(true);
    const { ok, data } = await sendJson(path, body, method);
    setBusy(false);
    setPending(null);
    if (!ok) {
      // El mensaje del servidor es el que sabe por qué: último administrador, no es tuyo,
      // ya aceptó la invitación. Re-escribirlo acá sería adivinar.
      toast(data.error?.message ?? t('actionError'), 'danger');
      return;
    }
    toast(okMessage);
    if (after) after();
    else router.refresh();
  }

  /**
   * Desactivar. 🔴 La API no desactiva a quien tiene gestiones, créditos o rutas a su nombre (quedarían a nombre de alguien
   * que ya no entra): contesta `USER_HAS_PENDING_WORK` con cuántos de cada uno, y acá se pide a quién pasarlos. Con
   * `reassignToUserId` la API pasa todo y desactiva en un solo paso.
   */
  async function deactivate(member: Member, reassignToUserId?: string) {
    setBusy(true);
    const { ok, data } = await sendJson(
      `/api/users/${member.userId}`,
      { isActive: false, ...(reassignToUserId ? { reassignToUserId } : {}) },
      'PATCH',
    );
    setBusy(false);
    setPending(null);
    if (!ok && data.error?.code === 'USER_HAS_PENDING_WORK') {
      setTarget('');
      setConfirmed(false);
      setTransfer({ member, work: data.error.details as PendingWork });
      return;
    }
    setTransfer(null);
    if (!ok) {
      toast(data.error?.message ?? t('actionError'), 'danger');
      return;
    }
    toast(t('deactivated'));
    router.refresh();
  }

  /** A quién se le puede pasar el trabajo: cobradores y supervisores activos, no la misma persona. */
  const candidates = (member: Member): Member[] =>
    team.filter((m) => m.userId !== member.userId && m.isActive && ['COLLECTOR', 'SUPERVISOR'].includes(m.roleName));

  const kind = pending?.kind;

  const dialogs: ReactNode = (
    <>
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        // El `{name}` va también en el título: sin los valores, next-intl no puede formatear
        // y pinta la ruta cruda de la clave.
        title={pending ? t(`confirm.${pending.kind}.title`, { name: memberName(pending.member) }) : ''}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setPending(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button
                variant={kind === 'reactivate' ? 'primary' : 'danger'}
                loading={busy}
                onClick={() => {
                  if (!pending) return;
                  const { kind, member } = pending;
                  if (kind === 'remove') {
                    void run(`/api/users/${member.userId}`, null, 'DELETE', t('removed'), onRemoved);
                  } else if (kind === 'deactivate') {
                    void deactivate(member);
                  } else {
                    void run(`/api/users/${member.userId}`, { isActive: true }, 'PATCH', t('reactivated'));
                  }
                }}
              >
                {pending ? t(`confirm.${pending.kind}.ok`) : ''}
              </Button>
            </span>
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            <MemberHeader member={pending.member} />
            {pending.kind === 'reactivate' ? (
              <div>
                <p className="mb-2 text-k-text">{t('confirm.reactivate.lead')}</p>
                <ul className="list-disc space-y-1.5 rounded-xl bg-k-bg py-3 pl-9 pr-4 text-k-text marker:text-k-periwinkle">
                  <li>{t('confirm.reactivate.access')}</li>
                  <li>
                    {seats && seats.max !== null
                      ? t('confirm.reactivate.seatOf', { used: seats.used + 1, max: seats.max })
                      : t('confirm.reactivate.seat')}
                  </li>
                </ul>
              </div>
            ) : (
              <p>{t(`confirm.${pending.kind}.text`, { name: memberName(pending.member) })}</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={transfer ? t('transfer.title') : ''}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setTransfer(null)} disabled={busy}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-56">
              <Button
                variant="danger"
                loading={busy}
                disabled={!target || !confirmed}
                onClick={() => transfer && void deactivate(transfer.member, target)}
              >
                {t('transfer.confirm')}
              </Button>
            </span>
          </>
        }
      >
        {transfer && (
          <div className="space-y-4">
            <MemberHeader member={transfer.member} />
            <p className="text-[13px] text-k-text-2">{t('transfer.text')}</p>
            <ul className="divide-y divide-k-border rounded-xl bg-k-bg px-4 py-1.5">
              <WorkRow icon="credit" label={t('transfer.credits')} value={transfer.work.credits} />
              <WorkRow icon="visit" label={t('transfer.agenda')} value={transfer.work.agenda} />
              <WorkRow icon="route" label={t('transfer.routes')} value={transfer.work.routes} />
            </ul>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-k-text-2">{t('transfer.target')}</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={busy}
                className="h-12 w-full rounded-xl border-[1.5px] border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
              >
                <option value="">{t('transfer.pick')}</option>
                {candidates(transfer.member).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </select>
            </label>
            {candidates(transfer.member).length === 0 && <p className="text-[13px] text-k-danger">{t('transfer.nobody')}</p>}
            <label className="flex items-start gap-2.5 text-[13px] text-k-text">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 shrink-0 accent-k-navy"
              />
              {t('transfer.ack')}
            </label>
          </div>
        )}
      </Modal>

      {/* El reenvío devuelve un código NUEVO y mata el anterior: hay que decirlo, o se
          terminan mandando dos y el primero ya no sirve. */}
      <Modal
        open={resent !== null}
        onClose={() => setResent(null)}
        title={t('resentTitle')}
        actions={
          <span className="sm:w-40">
            <Button onClick={() => setResent(null)}>{t('close')}</Button>
          </span>
        }
      >
        {resent && (
          <div className="space-y-3">
            <p className="text-[14px] text-k-warning-text">{t('resentWarning')}</p>
            <InvitationCode code={resent.invitationCode} email={resent.email} />
          </div>
        )}
      </Modal>
    </>
  );

  return {
    busy,
    ask: (kind: 'deactivate' | 'reactivate' | 'remove', member: Member) => setPending({ kind, member }),
    resend,
    changeRole: (member: Member, roleId: string) => run(`/api/users/${member.userId}`, { roleId }, 'PATCH', t('roleChanged')),
    dialogs,
  };
}
