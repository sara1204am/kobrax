'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { memberStatus, type AssignableRole, type Member } from '@kobrax/shared';
import { Button } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { isKnownRole, memberActions } from '@/lib/team';
import { useMemberDialogs } from '../member-dialogs';

/**
 * Las acciones de la cabecera de la ficha. Todas salen de `memberActions` —la misma regla que la
 * lista— y la API las vuelve a validar: acá sólo se esconde lo que va a rechazar.
 *
 * No hay «Editar»: los datos de otra persona no se cambian desde acá (el nombre es suyo y las
 * oficinas se administran en otra parte). Lo único editable de un miembro es su rol y su estado.
 */
export function MemberHeaderActions({
  member,
  team,
  roles,
  meId,
  seats,
}: {
  member: Member;
  team: Member[];
  roles: AssignableRole[];
  meId: string;
  seats?: { used: number; max: number | null };
}) {
  const t = useTranslations('team');
  const tr = useTranslations('team.roles');
  const router = useRouter();
  const { can } = usePermissions();
  const a = memberActions(member, meId, { canWrite: can('user:write'), canInvite: can('user:invite') });
  const { busy, ask, resend, changeRole, dialogs } = useMemberDialogs({
    team,
    seats,
    onRemoved: () => router.push('/equipo'),
  });
  const pending = memberStatus(member) === 'pending';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {a.changeRole && (
          <select
            aria-label={t('detail.changeRole')}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && void changeRole(member, e.target.value)}
            className="h-11 rounded-xl border border-k-border bg-white px-3 text-[14px] font-medium text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60"
          >
            <option value="">{t('detail.changeRole')}</option>
            {roles
              .filter((r) => r.id !== member.roleId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {isKnownRole(r.name) ? tr(r.name) : r.name}
                </option>
              ))}
          </select>
        )}
        {a.resend && (
          <span className="w-auto">
            <Button variant="ghost" className="h-11 px-4" onClick={() => void resend(member)} disabled={busy}>
              {t('actions.resend')}
            </Button>
          </span>
        )}
        {a.deactivate && (
          <span className="w-auto">
            <Button variant="ghost" className="h-11 px-4 !text-k-danger" onClick={() => ask('deactivate', member)}>
              {t('actions.deactivate')}
            </Button>
          </span>
        )}
        {a.reactivate && (
          <span className="w-auto">
            <Button className="h-11 px-5" onClick={() => ask('reactivate', member)}>
              {t('actions.reactivate')}
            </Button>
          </span>
        )}
        {a.remove && pending && (
          <span className="w-auto">
            <Button variant="ghost" className="h-11 px-4 !text-k-danger" onClick={() => ask('remove', member)}>
              {t('actions.remove')}
            </Button>
          </span>
        )}
      </div>
      {dialogs}
    </>
  );
}
