'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AssignableRole, InvitedMember } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { OfficeSelect } from '@/components/office-select';
import type { OfficeOption } from '@/lib/offices';
import { Modal } from '@/components/modal';
import { postJson } from '@/lib/client';
import { isKnownRole } from '@/lib/team';
import { InvitationCode } from './invitation-code';

const EMPTY = { firstName: '', lastName: '', email: '', roleId: '', branchId: '' };

/**
 * El formulario de invitar a alguien al equipo, como diálogo. Lo usa el botón de Equipo y también el selector de
 * responsable de una oficina («Agregar usuario»), para no mandar a nadie a otra pantalla a mitad de lo que hacía.
 *
 * El tope de asientos lo frena el servidor **dentro de la transacción**. Sin `roles` los pide él mismo al abrirse.
 * `defaultOfficeId` preselecciona la oficina del gerente regional (MANAGER la necesita).
 */
export function InviteDialog({
  open,
  onClose,
  roles: given,
  offices,
  defaultOfficeId = '',
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  roles?: AssignableRole[];
  offices: OfficeOption[];
  defaultOfficeId?: string;
  /** Avisa cuando la invitación salió, antes de mostrar el código. */
  onInvited?: (member: InvitedMember) => void;
}) {
  const t = useTranslations('team.invite');
  const tr = useTranslations('team.roles');
  const router = useRouter();
  const [loaded, setLoaded] = useState<AssignableRole[] | null>(null);
  const roles = given ?? loaded ?? [];
  const [form, setForm] = useState({ ...EMPTY, branchId: defaultOfficeId });
  const [invited, setInvited] = useState<InvitedMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, branchId: defaultOfficeId });
    setInvited(null);
    setError(null);
    if (given) return;
    void fetch('/api/roles')
      .then((r) => r.json())
      .then((body: { data?: AssignableRole[] }) => setLoaded(body.data ?? []))
      .catch(() => setLoaded([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    onClose();
    // La lista la pintó el servidor: sin esto, la persona recién invitada no aparece.
    if (invited) router.refresh();
  }

  const selected = roles.find((r) => r.id === form.roleId);
  const needsOffice = selected?.name === 'MANAGER';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { ok, data } = await postJson<InvitedMember>('/api/users', {
      ...form,
      branchId: needsOffice ? form.branchId : undefined,
      email: form.email.trim().toLowerCase(),
    });
    setBusy(false);
    if (!ok) {
      // Acá caen el tope de asientos y el correo ya usado: el servidor sabe cuál es.
      setError(data.error?.message ?? t('error'));
      return;
    }
    setInvited(data);
    onInvited?.(data);
  }

  const label = (name: string) => (isKnownRole(name) ? tr(name) : name);

  return (
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

          {needsOffice && (
            <Field label={t('office')}>
              <OfficeSelect
                options={offices}
                emptyLabel={t('officePlaceholder')}
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                required
              />
            </Field>
          )}

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
  );
}
