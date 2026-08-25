'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from './panel-ui';
import { Modal } from './modal';
import { ChangePasswordForm } from './change-password-form';
import { MfaManager } from './mfa-manager';

const OPTIONS = [
  { key: 'password', href: null },
  { key: 'mfa', href: null },
  { key: 'sessions', href: '/settings/security/sessions' },
] as const;

type ModalKey = 'password' | 'mfa';

const CARD =
  'flex w-full items-center justify-between gap-3 rounded-2xl border border-k-border bg-white px-5 py-4 text-left shadow-k-card transition-all hover:border-k-periwinkle';

/**
 * Las tres tarjetas de Seguridad. Las pinta el hub `/settings/security` y también Mi perfil,
 * que las agrupa con el resto de «lo mío» como hace el móvil.
 *
 * Contraseña y MFA abren en `Modal` en vez de navegar: son la acción, no una sección aparte.
 * Sesiones sigue siendo una página — es una lista con acciones por fila, no un formulario corto.
 *
 * `mfaEnabled` es el recordatorio blando que el móvil da en el Home: si no está activa, la tarjeta
 * lo dice en ámbar en vez de esperar a que alguien entre a mirar.
 */
export function SecurityOptions({ mfaEnabled }: { mfaEnabled?: boolean }) {
  const t = useTranslations('security.options');
  const tm = useTranslations('security');
  const router = useRouter();
  const [modal, setModal] = useState<ModalKey | null>(null);

  function closeModal() {
    setModal(null);
    // El estado de MFA que muestra la tarjeta vive en el server component padre.
    router.refresh();
  }

  return (
    <>
      <div className="space-y-3">
        {OPTIONS.map((o) => {
          const content = (
            <>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium text-k-text">{t(o.key)}</span>
                  {o.key === 'mfa' && mfaEnabled !== undefined && (
                    <Badge tone={mfaEnabled ? 'success' : 'warning'} dot>
                      {mfaEnabled ? t('mfaOn') : t('mfaOff')}
                    </Badge>
                  )}
                </span>
                <span className="block text-[13px] text-k-text-2">
                  {o.key === 'mfa' && mfaEnabled === false ? t('mfaOffHint') : t(`${o.key}Desc`)}
                </span>
              </span>
              <span aria-hidden className="text-k-muted">
                ›
              </span>
            </>
          );

          return o.href ? (
            <Link key={o.key} href={o.href} className={CARD}>
              {content}
            </Link>
          ) : (
            <button key={o.key} type="button" onClick={() => setModal(o.key as ModalKey)} className={CARD}>
              {content}
            </button>
          );
        })}
      </div>

      {/*
       * Los `Modal` se montan sólo cuando están abiertos: `ChangePasswordForm` y sobre todo
       * `MfaManager` disparan un fetch a `/api/auth/me` en su `useEffect` de montaje (y
       * redirigen a `/login` si no responde bien). `Modal` sólo oculta con CSS — si viviera
       * siempre montado acá, ese fetch se disparaba en cada visita a Mi perfil, con el modal
       * todavía cerrado.
       */}
      {modal === 'password' && (
        <Modal open onClose={closeModal} title={tm('changePassword.title')} wide>
          <ChangePasswordForm />
        </Modal>
      )}
      {modal === 'mfa' && (
        <Modal open onClose={closeModal} title={tm('mfa.title')} wide>
          <MfaManager />
        </Modal>
      )}
    </>
  );
}
