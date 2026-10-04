'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, CaseStatus, type Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { canClose } from '@/lib/cases';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

type Action = 'assign' | 'close' | null;

/**
 * Lo que se puede hacer con un caso desde su ficha.
 *
 * Cada botón se dibuja **sólo si el permiso está y la acción tiene sentido en este estado**. Los
 * tres frenos de verdad están en el servidor; esto es para no ofrecer algo que va a rebotar.
 */
export function CaseActions({
  caseId,
  status,
  members,
  canAssign,
  canClose: mayClose,
}: {
  caseId: string;
  status: CaseStatus;
  members: Member[];
  canAssign: boolean;
  canClose: boolean;
}) {
  const t = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [collectorId, setCollectorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closable = mayClose && canClose(status);

  function close() {
    setAction(null);
    setError(null);
    setReason('');
    setCollectorId('');
  }

  async function send(path: string, body: unknown, method: 'POST' | 'PATCH', done: string) {
    setError(null);
    setBusy(true);
    const res = await sendJson(path, body, method);
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    close();
    toast(done);
    router.refresh();
  }

  return (
    <>
      {/* Mover de estado ya no es un botón acá: se toca la etiqueta de estado, que es el dato que
          cambia (`status-control.tsx`). Un botón a media pantalla del dato no decía cuál tocaba. */}
      {canAssign && (
        <Button variant="ghost" onClick={() => setAction('assign')} className="sm:w-auto sm:px-5">
          {t('actions.assign')}
        </Button>
      )}
      {closable && (
        <Button onClick={() => setAction('close')} className="sm:w-auto sm:px-5">
          {t('actions.close')}
        </Button>
      )}

      {/* Asignar. Sin elegir a nadie va `auto`, y el servidor lo manda al que menos casos tiene:
          quién es el menos cargado lo cuenta él, no esta pantalla. */}
      <Modal
        open={action === 'assign'}
        onClose={close}
        title={t('assign.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('assign.cancel')}
            </Button>
            <Button
              onClick={() =>
                send(
                  `/api/cases/${caseId}/assign`,
                  collectorId ? { collectorId } : { auto: true },
                  'POST',
                  t('assign.done'),
                )
              }
              loading={busy}
              className="sm:w-auto sm:px-5"
            >
              {t('assign.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('assign.text')}</p>
        <div className="mt-4">
          {/* Sin `user:read` no hay a quién elegir, pero «al que menos casos tenga» sigue
              funcionando: lo resuelve el servidor. Se dice por qué, en vez de dejar un
              desplegable con una sola opción y sin explicación. */}
          {members.length > 0 ? (
            <Field label={t('assign.collector')}>
              <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)} disabled={busy}>
                <option value="">{t('assign.auto')}</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberName(member)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-[13px] text-k-text-2">{t('assign.noTeam')}</p>
          )}
        </div>
      </Modal>

      {/* Cerrar. El motivo es obligatorio y la API tampoco cierra un caso sin ninguna gestión
          registrada (CASE_001). */}
      <Modal
        open={action === 'close'}
        onClose={close}
        title={t('close.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('close.cancel')}
            </Button>
            <Button
              onClick={() => send(`/api/cases/${caseId}/close`, { reason: reason.trim() }, 'POST', t('close.done'))}
              loading={busy}
              disabled={!reason.trim()}
              className="sm:w-auto sm:px-5"
            >
              {t('close.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('close.text')}</p>
        <div className="mt-4">
          <Field label={t('close.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={200} required />
          </Field>
        </div>
      </Modal>
    </>
  );
}
