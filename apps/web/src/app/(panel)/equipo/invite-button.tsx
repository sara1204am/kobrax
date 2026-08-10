'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RoleType, type AssignableRole, type InvitedMember } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { postJson } from '@/lib/client';
import { InvitationCode } from './invitation-code';

const EMPTY = { firstName: '', lastName: '', email: '', roleId: '' };

/**
 * Invitar a alguien al equipo.
 *
 * El tope de asientos lo frena el servidor **dentro de la transacción** (dos invitaciones
 * simultáneas ganaban la carrera). Acá el botón se apaga al llegar al tope: es para no
 * ofrecer lo imposible, no para reemplazar ese freno.
 */
export function InviteButton({
  roles,
  full,
}: {
  roles: AssignableRole[];
  /** Ya no quedan asientos en el plan. */
  full: boolean;
}) {
  const t = useTranslations('team.invite');
  const tr = useTranslations('team.roles');
  const router = useRouter();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [invited, setInvited] = useState<InvitedMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sin permiso no se dibuja. Y sin roles que ofrecer tampoco: el formulario no tendría
  // qué poner en el selector, y `roleId` es obligatorio para el servidor.
  if (!can('user:invite') || roles.length === 0) return null;

  function close() {
    setOpen(false);
    setForm(EMPTY);
    setInvited(null);
    setError(null);
    // La lista la pintó el servidor: sin esto, la persona recién invitada no aparece.
    if (invited) router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<InvitedMember>('/api/users', {
      ...form,
      email: form.email.trim().toLowerCase(),
    });
    setBusy(false);
    if (!ok) {
      // Acá caen el tope de asientos y el correo ya usado: el servidor sabe cuál es.
      setError(data.error?.message ?? t('error'));
      return;
    }
    setInvited(data);
  }

  const label = (name: string) =>
    (Object.values(RoleType) as string[]).includes(name) ? tr(name) : name;

  return (
    <>
      <span className="w-full sm:w-52">
        <Button onClick={() => setOpen(true)} disabled={full} title={full ? t('full') : undefined}>
          {full ? t('full') : t('open')}
        </Button>
      </span>

      <Modal
        open={open}
        onClose={close}
        title={invited ? t('doneTitle') : t('title')}
        actions={
          invited ? (
            <span className="sm:w-40">
              <Button onClick={close}>{t('done')}</Button>
            </span>
          ) : undefined
        }
      >
        {invited ? (
          <InvitationCode code={invited.invitationCode} email={invited.email} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <ErrorBanner message={error} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('firstName')}>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  required
                  maxLength={80}
                />
              </Field>
              <Field label={t('lastName')}>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  required
                  maxLength={80}
                />
              </Field>
            </div>

            <Field label={t('email')}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>

            <Field label={t('role')}>
              <select
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                required
                className="h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-[15px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
              >
                <option value="" disabled>
                  {t('rolePlaceholder')}
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {label(r.name)}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <span className="sm:w-36">
                <Button type="button" variant="ghost" onClick={close}>
                  {t('cancel')}
                </Button>
              </span>
              <span className="sm:w-44">
                <Button type="submit" loading={busy}>
                  {t('send')}
                </Button>
              </span>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
