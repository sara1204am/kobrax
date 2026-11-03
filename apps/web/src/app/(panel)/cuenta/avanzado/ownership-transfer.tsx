'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { memberLabel } from '@/lib/branches';

/**
 * Pasar la propiedad de la cuenta a otro administrador.
 *
 * Es de las pocas acciones que no se deshacen sola: el dueño responde por la cuenta ante Kobrax. Por eso pide la
 * contraseña y, si la persona tiene verificación en dos pasos, un código — y antes, una confirmación explícita. Sólo el
 * dueño actual puede; la API lo valida igual (esta pantalla sólo dice quién es para no mostrar un formulario inútil).
 */
export function OwnershipTransfer({ members, selfId, isOwner }: { members: Member[]; selfId: string; isOwner: boolean }) {
  const t = useTranslations('account.advanced.ownership');
  const router = useRouter();
  const toast = useToast();

  const candidates = members.filter((m) => m.userId !== selfId && m.isActive && m.roleName === 'ACCOUNT_ADMIN' && m.userStatus === 'ACTIVE');
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = candidates.find((m) => m.userId === target);

  async function transfer() {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson('/api/account/transfer-ownership', { userId: target, password, ...(code.trim() ? { code: code.trim() } : {}) }, 'POST');
    setBusy(false);
    if (!ok) {
      // El error se ve en el formulario y no en el modal: ahí es donde se corrige la contraseña o el código.
      setConfirming(false);
      setError(data.error?.message ?? t('error'));
      return;
    }
    setConfirming(false);
    setTarget('');
    setPassword('');
    setCode('');
    toast(t('done'));
    router.refresh();
  }

  return (
    <Section title={t('title')} inner="space-y-4 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {!isOwner ? (
        <p className="rounded-xl bg-k-light-bg px-4 py-3 text-[13px] text-k-text-2">{t('notOwner')}</p>
      ) : candidates.length === 0 ? (
        <p className="rounded-xl bg-k-light-bg px-4 py-3 text-[13px] text-k-text-2">{t('noCandidates')}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming(true);
          }}
          className="space-y-4"
        >
          <ErrorBanner message={error} />
          <Field label={t('target')}>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('choose')}</option>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('password')}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label={t('code')} hint={t('codeHint')}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          </div>
          <div className="sm:w-56">
            <Button type="submit" variant="danger" disabled={!target || !password}>
              {t('submit')}
            </Button>
          </div>
        </form>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('confirmTitle')}
        actions={
          <>
            <span className="sm:w-36">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button variant="danger" loading={busy} onClick={() => void transfer()}>
                {t('confirmOk')}
              </Button>
            </span>
          </>
        }
      >
        {chosen ? t('confirmText', { name: memberLabel(chosen) }) : ''}
      </Modal>
    </Section>
  );
}
