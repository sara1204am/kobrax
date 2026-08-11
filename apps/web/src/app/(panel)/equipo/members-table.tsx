'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  memberName,
  memberStatus,
  type AssignableRole,
  type InvitedMember,
  type Member,
} from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { Button } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { postJson, sendJson } from '@/lib/client';
import { isKnownRole, memberActions } from '@/lib/team';
import { InvitationCode } from './invitation-code';

const TONE = { active: 'success', pending: 'warning', inactive: 'neutral' } as const;

/** Confirmación pendiente: qué se le va a hacer a quién. */
type Pending =
  | { kind: 'deactivate' | 'reactivate' | 'remove'; member: Member }
  | null;

export function MembersTable({
  members,
  roles,
  meId,
  filtered,
}: {
  members: Member[];
  roles: AssignableRole[];
  meId: string;
  /** Hay una búsqueda puesta: «no hay nadie» y «nadie coincide» no se arreglan igual. */
  filtered?: boolean;
}) {
  const t = useTranslations('team');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const perms = { canWrite: can('user:write'), canInvite: can('user:invite') };
  const [pending, setPending] = useState<Pending>(null);
  const [resent, setResent] = useState<InvitedMember | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function run(path: string, body: unknown, method: 'PATCH' | 'DELETE', okMessage: string) {
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
    router.refresh();
  }

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: t('columns.member'),
      sortable: true,
      render: (m) => (
        <span className="block">
          <span className="block font-medium text-k-text">{memberName(m)}</span>
          <span className="block text-[13px] text-k-text-2">{m.email}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: t('columns.role'),
      sortable: true,
      render: (m) => (
        <RoleCell
          member={m}
          roles={roles}
          editable={memberActions(m, meId, perms).changeRole}
          onPick={(roleId) => run(`/api/users/${m.userId}`, { roleId }, 'PATCH', t('roleChanged'))}
          busy={busy}
        />
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (m) => {
        const status = memberStatus(m);
        return <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>;
      },
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      numeric: true,
      render: (m) => {
        const a = memberActions(m, meId, perms);
        return (
          <span className="flex justify-end gap-3 whitespace-nowrap">
            {a.deactivate && (
              <RowAction onClick={() => setPending({ kind: 'deactivate', member: m })}>
                {t('actions.deactivate')}
              </RowAction>
            )}
            {a.reactivate && (
              <RowAction onClick={() => setPending({ kind: 'reactivate', member: m })}>
                {t('actions.reactivate')}
              </RowAction>
            )}
            {a.resend && (
              <RowAction onClick={() => void resend(m)}>{t('actions.resend')}</RowAction>
            )}
            {a.remove && (
              <RowAction danger onClick={() => setPending({ kind: 'remove', member: m })}>
                {t('actions.remove')}
              </RowAction>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={members}
        rowKey={(m) => m.userId}
        meta={{ total: members.length, page: 1, limit: members.length || 1, pages: 1 }}
        empty={
          <EmptyState
            title={filtered ? t('noResults') : t('empty')}
            text={filtered ? t('noResultsHint') : t('emptyHint')}
          />
        }
      />

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
                loading={busy}
                onClick={() => {
                  if (!pending) return;
                  const { kind, member } = pending;
                  if (kind === 'remove') {
                    void run(`/api/users/${member.userId}`, null, 'DELETE', t('removed'));
                  } else {
                    void run(
                      `/api/users/${member.userId}`,
                      { isActive: kind === 'reactivate' },
                      'PATCH',
                      t(kind === 'reactivate' ? 'reactivated' : 'deactivated'),
                    );
                  }
                }}
              >
                {pending ? t(`confirm.${pending.kind}.ok`) : ''}
              </Button>
            </span>
          </>
        }
      >
        {pending ? t(`confirm.${pending.kind}.text`, { name: memberName(pending.member) }) : ''}
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
}

function RowAction({
  children,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[13px] font-medium hover:underline ${danger ? 'text-k-danger' : 'text-k-purple'}`}
    >
      {children}
    </button>
  );
}

/**
 * El rol: un `<select>` cuando se puede cambiar, y texto cuando no.
 *
 * Los rótulos salen de i18n y no de `ROLE_LABEL` de `shared`, que está en español: el panel
 * se muestra en dos idiomas. La **regla** —qué roles son asignables— sigue siendo del
 * servidor, que es quien arma esta lista.
 */
function RoleCell({
  member,
  roles,
  editable,
  onPick,
  busy,
}: {
  member: Member;
  roles: AssignableRole[];
  editable: boolean;
  onPick: (roleId: string) => void;
  busy: boolean;
}) {
  const t = useTranslations('team.roles');
  const label = (name: string) => (isKnownRole(name) ? t(name) : name);

  if (!editable) return <span className="text-k-text-2">{label(member.roleName)}</span>;

  return (
    <select
      value={member.roleId}
      disabled={busy}
      onChange={(e) => onPick(e.target.value)}
      aria-label={label(member.roleName)}
      className="rounded-lg border border-k-border bg-white px-2 py-1.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle disabled:opacity-60"
    >
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {label(r.name)}
        </option>
      ))}
    </select>
  );
}
