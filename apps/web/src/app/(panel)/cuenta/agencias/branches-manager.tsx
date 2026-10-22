'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Badge, EmptyState, Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { candidatesFor, memberLabel, membersOf, type BranchRow } from '@/lib/branches';

/** Qué está abierto: el alta/edición de una agencia, sus miembros, o la confirmación de quitarla. */
type Form = { id?: string; name: string; code: string; city: string; address: string; managerUserId: string; active: boolean };

const EMPTY: Form = { id: undefined, name: '', code: '', city: '', address: '', managerUserId: '', active: true };

const formOf = (b: BranchRow): Form => ({
  id: b.id,
  name: b.name,
  code: b.code ?? '',
  city: b.city ?? '',
  address: b.address ?? '',
  managerUserId: b.managerUserId ?? '',
  active: b.active,
});

/** Vaciar un dato opcional es quitarlo: viaja como `null` (un `''` chocaría con el `@Length(1, n)` de la API). */
const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * Agencias de la cuenta: crear, editar, dar de baja y mover gente.
 *
 * 🔴 **Mover a alguien de agencia cambia lo que ve** (el alcance del supervisor sale de su agencia), y la API no deja
 * dar de baja una agencia con miembros activos: primero se los pasa a otra. La pantalla lo dice antes de que el
 * servidor lo rechace.
 *
 * `account:write` gobierna los botones (la API lo valida igual); con sólo `user:read` la lista es de lectura.
 */
export function BranchesManager({ branches, members }: { branches: BranchRow[]; members: Member[] }) {
  const t = useTranslations('account.branches');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const [form, setForm] = useState<Form | null>(null);
  const [removing, setRemoving] = useState<BranchRow | null>(null);
  const [managing, setManaging] = useState<BranchRow | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOfBranch = (id: string | null | undefined) => branches.find((b) => b.id === id)?.name;
  const eligibleManagers = members.filter((m) => m.isActive && m.userStatus === 'ACTIVE');

  /** Una llamada al BFF con su `busy`, su error en pantalla y el refresco de la lista al terminar bien. */
  async function run(call: () => ReturnType<typeof sendJson>, done: () => void, okMessage: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { ok, data } = await call();
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return false;
    }
    done();
    toast(okMessage);
    router.refresh();
    return true;
  }

  function save() {
    if (!form) return;
    const body = {
      name: form.name.trim(),
      code: orNull(form.code),
      city: orNull(form.city),
      address: orNull(form.address),
      managerUserId: form.managerUserId || null,
    };
    return form.id
      ? run(() => sendJson(`/api/branches/${form.id}`, { ...body, active: form.active }, 'PATCH'), () => setForm(null), t('saved'))
      : // En el alta, un dato vacío se omite: `null` no es un valor válido de creación.
        run(
          () => sendJson('/api/branches', Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)), 'POST'),
          () => setForm(null),
          t('created'),
        );
  }

  function remove() {
    if (!removing) return;
    return run(() => sendJson(`/api/branches/${removing.id}`, null, 'DELETE'), () => setRemoving(null), t('removed'));
  }

  function addPicked() {
    if (!managing || picked.length === 0) return;
    return run(() => sendJson(`/api/branches/${managing.id}/members`, { userIds: picked }, 'POST'), () => setPicked([]), t('membersAdded'));
  }

  function takeOut(userId: string) {
    return run(() => sendJson(`/api/users/${userId}`, { branchId: null }, 'PATCH'), () => undefined, t('memberRemoved'));
  }

  function closeManage() {
    setManaging(null);
    setPicked([]);
    setError(null);
  }

  // La agencia que se está administrando, con los datos que acaba de traer el servidor (el contador se actualiza).
  const live = managing ? (branches.find((b) => b.id === managing.id) ?? managing) : null;

  return (
    <Section
      title={t('title')}
      inner="space-y-5 p-6"
      action={
        editable ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setForm(EMPTY);
            }}
            className="text-[13px] font-medium text-k-purple hover:underline"
          >
            {t('add')}
          </button>
        ) : undefined
      }
    >
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {branches.length === 0 ? (
        <EmptyState title={t('empty')} text={editable ? t('emptyHint') : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-k-border text-[11px] uppercase tracking-wide text-k-text-2">
                <th scope="col" className="pb-2 pr-3">{t('columns.name')}</th>
                <th scope="col" className="pb-2 pr-3">{t('columns.city')}</th>
                <th scope="col" className="pb-2 pr-3">{t('columns.manager')}</th>
                <th scope="col" className="pb-2 pr-3 text-right">{t('columns.members')}</th>
                <th scope="col" className="pb-2 pr-3 text-right">{t('columns.credits')}</th>
                <th scope="col" className="pb-2 pr-3">{t('columns.status')}</th>
                <th scope="col" className="pb-2"><span className="sr-only">{t('columns.actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-k-border">
              {branches.map((b) => (
                <tr key={b.id} className={b.active ? '' : 'text-k-text-2'}>
                  <td className="py-3 pr-3">
                    <p className="font-medium text-k-text">{b.name}</p>
                    {b.code && <p className="font-mono text-[11px] text-k-muted">{b.code}</p>}
                  </td>
                  <td className="py-3 pr-3">{b.city ?? '—'}</td>
                  <td className="py-3 pr-3">{b.managerName ?? '—'}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{b.members}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{b.credits}</td>
                  <td className="py-3 pr-3">
                    <Badge dot tone={b.active ? 'success' : 'neutral'}>
                      {b.active ? t('active') : t('inactive')}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap py-3 text-right">
                    <button
                      type="button"
                      aria-label={t('manageOf', { name: b.name })}
                      onClick={() => {
                        setError(null);
                        setManaging(b);
                      }}
                      className="mr-3 font-medium text-k-purple hover:underline"
                    >
                      {t('manage')}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        aria-label={t('editOf', { name: b.name })}
                        onClick={() => {
                          setError(null);
                          setForm(formOf(b));
                        }}
                        className="font-medium text-k-purple hover:underline"
                      >
                        {t('edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Alta y edición */}
      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? t('editTitle') : t('addTitle')}
        actions={
          <>
            {form?.id && (
              <span className="mr-auto sm:w-40">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const target = branches.find((b) => b.id === form.id) ?? null;
                    setForm(null);
                    setRemoving(target);
                  }}
                >
                  {t('remove')}
                </Button>
              </span>
            )}
            <span className="sm:w-36">
              <Button variant="ghost" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-44">
              <Button loading={busy} disabled={form !== null && form.name.trim().length < 2} onClick={() => void save()}>
                {t('save')}
              </Button>
            </span>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <ErrorBanner message={error} />
            <Field label={t('fields.name')}>
              <Input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.code')} hint={t('fields.codeHint')}>
                <Input value={form.code} maxLength={20} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label={t('fields.city')}>
                <Input value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
            </div>
            <Field label={t('fields.address')}>
              <Input value={form.address} maxLength={240} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label={t('fields.manager')}>
              <Select value={form.managerUserId} onChange={(e) => setForm({ ...form, managerUserId: e.target.value })}>
                <option value="">{t('fields.noManager')}</option>
                {eligibleManagers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
            {form.id && (
              <label className="flex items-center gap-2 text-[14px] text-k-text">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                {t('fields.active')}
              </label>
            )}
            {form.id && <p className="text-[12px] text-k-muted">{t('fields.activeHint')}</p>}
          </div>
        )}
      </Modal>

      {/* Quitar */}
      <Modal
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          setError(null);
        }}
        title={removing ? t('removeTitle', { name: removing.name }) : ''}
        actions={
          <>
            <span className="sm:w-36">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-44">
              <Button loading={busy} disabled={removing !== null && removing.members > 0} onClick={() => void remove()}>
                {t('removeOk')}
              </Button>
            </span>
          </>
        }
      >
        <div className="space-y-3">
          <ErrorBanner message={error} />
          <p>{removing && removing.members > 0 ? t('removeBlocked', { n: removing.members }) : t('removeText')}</p>
        </div>
      </Modal>

      {/* Miembros */}
      <Modal
        wide
        open={live !== null}
        onClose={closeManage}
        title={live ? t('membersTitle', { name: live.name }) : ''}
        actions={
          <span className="sm:w-36">
            <Button variant="ghost" onClick={closeManage}>
              {t('close')}
            </Button>
          </span>
        }
      >
        {live && (
          <div className="space-y-5">
            <ErrorBanner message={error} />
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('currentMembers')}</h3>
              {membersOf(members, live.id).length === 0 ? (
                <p className="mt-2 text-[13px] text-k-text-2">{t('noMembers')}</p>
              ) : (
                <ul className="mt-2 divide-y divide-k-border rounded-xl border border-k-border">
                  {membersOf(members, live.id).map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-[14px] text-k-text">{memberLabel(m)}</span>
                      {editable && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={t('takeOutOf', { name: memberLabel(m) })}
                          onClick={() => void takeOut(m.userId)}
                          className="text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
                        >
                          {t('takeOut')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {editable && live.active && (
              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('addMembers')}</h3>
                <p className="mt-1 text-[12px] text-k-muted">{t('scopeWarning')}</p>
                {candidatesFor(members, live.id).length === 0 ? (
                  <p className="mt-2 text-[13px] text-k-text-2">{t('noCandidates')}</p>
                ) : (
                  <>
                    <ul className="mt-2 max-h-56 divide-y divide-k-border overflow-y-auto rounded-xl border border-k-border">
                      {candidatesFor(members, live.id).map((m) => (
                        <li key={m.userId}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[14px] text-k-text">
                            <input
                              type="checkbox"
                              checked={picked.includes(m.userId)}
                              onChange={(e) =>
                                setPicked((prev) => (e.target.checked ? [...prev, m.userId] : prev.filter((id) => id !== m.userId)))
                              }
                            />
                            <span className="flex-1">{memberLabel(m)}</span>
                            <span className="text-[12px] text-k-text-2">
                              {nameOfBranch(m.branchId) ? t('comesFrom', { name: nameOfBranch(m.branchId) as string }) : t('noBranch')}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex justify-end">
                      <span className="sm:w-56">
                        <Button loading={busy} disabled={picked.length === 0} onClick={() => void addPicked()}>
                          {t('addPicked', { n: picked.length })}
                        </Button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </Section>
  );
}
