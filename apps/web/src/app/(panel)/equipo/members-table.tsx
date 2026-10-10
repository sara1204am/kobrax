'use client';

import { useState, type ReactNode } from 'react';
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
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
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

/** Lo que una persona tiene a su nombre y hay que pasar antes de desactivarla (lo informa la API). */
interface PendingWork {
  agenda: number;
  credits: number;
  routes: number;
}

export function MembersTable({
  members,
  team,
  meta,
  roles,
  roleNames,
  meId,
  filtered,
  userId,
  action,
}: {
  members: Member[];
  /** El equipo completo (sin paginar ni filtrar): de acá se elige a quién pasarle el trabajo. */
  team: Member[];
  meta: PageMeta;
  /** Los asignables (`GET /roles`), que son los que ofrece el selector de la fila. */
  roles: AssignableRole[];
  /** Los que de verdad hay en el equipo, para el filtro. Incluye los que no se pueden asignar. */
  roleNames: string[];
  meId: string;
  /** Hay una búsqueda o un filtro puesto: «no hay nadie» y «nadie coincide» no se arreglan igual. */
  filtered?: boolean;
  userId?: string;
  /** «Invitar a alguien». Va en la barra de la tabla, no en el encabezado. */
  action?: ReactNode;
}) {
  const t = useTranslations('team');
  // Los rótulos de rol salen de i18n y no de `ROLE_LABEL` de `shared`, que está en español.
  const tRoles = useTranslations('team.roles');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const perms = { canWrite: can('user:write'), canInvite: can('user:invite') };
  const [pending, setPending] = useState<Pending>(null);
  const [resent, setResent] = useState<InvitedMember | null>(null);
  const [busy, setBusy] = useState(false);
  /** Quien se quiere desactivar tiene trabajo a su nombre: se pide a quién pasarlo. */
  const [transfer, setTransfer] = useState<{ member: Member; work: PendingWork } | null>(null);
  const [target, setTarget] = useState('');

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

  /**
   * Los filtros del panel. Se aplican **en memoria** (`teamView`), porque `GET /users` no filtra:
   * las claves son igual las de la URL, así que la vista se comparte por link como en las demás.
   */
  const filters: FilterDef[] = [
    {
      keys: ['role'],
      label: t('columns.role'),
      type: 'select',
      allLabel: t('filters.allRoles'),
      options: roleNames.map((name) => ({ value: name, label: isKnownRole(name) ? tRoles(name) : name })),
    },
    {
      keys: ['status'],
      label: t('columns.status'),
      type: 'radio',
      options: (['active', 'pending', 'inactive'] as const).map((s) => ({ value: s, label: t(`status.${s}`) })),
    },
  ];

  return (
    <>
      <DataTable
        tableId="equipo"
        userId={userId}
        columns={columns}
        rows={members}
        rowKey={(m) => m.userId}
        meta={meta}
        filters={filters}
        filtered={filtered}
        entityLabel={t('entity')}
        actions={action}
        search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} />}
        empty={<EmptyState title={t('empty')} text={t('emptyHint')} />}
        noResults={<EmptyState title={t('noResults')} text={t('noResultsHint')} />}
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
                  } else if (kind === 'deactivate') {
                    void deactivate(member);
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

      <Modal
        open={transfer !== null}
        onClose={() => setTransfer(null)}
        title={transfer ? t('transfer.title', { name: memberName(transfer.member) }) : ''}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={() => setTransfer(null)} disabled={busy}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-56">
              <Button loading={busy} disabled={!target} onClick={() => transfer && void deactivate(transfer.member, target)}>
                {t('transfer.confirm')}
              </Button>
            </span>
          </>
        }
      >
        {transfer && (
          <div className="space-y-4">
            <p className="text-[14px] text-k-text">
              {t('transfer.text', { name: memberName(transfer.member), agenda: transfer.work.agenda, credits: transfer.work.credits, routes: transfer.work.routes })}
            </p>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-k-text-2">{t('transfer.target')}</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border-[1.5px] border-k-border bg-white px-3 py-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle"
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
