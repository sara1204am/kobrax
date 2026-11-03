'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TeamIcon } from './team-ui';

/**
 * El código de una invitación, para copiarlo y mandarlo por donde sea.
 *
 * Existe porque el correo **no es el camino garantizado**: la API lo manda después del commit
 * y sin esperar la respuesta del servidor de correo. La invitación ya está creada; el código
 * en pantalla es lo que siempre funciona. Es el mismo camino que el móvil comparte por
 * WhatsApp.
 */
export function InvitationCode({ code, email }: { code: string; email: string }) {
  const t = useTranslations('team.invite');
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Copiar puede no estar disponible: `navigator.clipboard` no existe fuera de un contexto
   * seguro y el navegador puede negar el permiso. Si falla no se rompe nada ni se miente con
   * un «copiado» — el código queda `select-all`, así que se agarra con un triple clic.
   */
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-k-success-bg text-k-success">
          <TeamIcon name="check" className="h-8 w-8" />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-k-text">{t('sentTitle')}</p>
          <p className="mt-1 text-[14px] text-k-text-2">{t('sentTo', { email })}</p>
        </div>
      </div>

      <div className="rounded-xl border border-k-border bg-k-bg p-4">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-k-text-2">{t('codeLabel')}</p>
        <div className="flex items-center gap-2 rounded-xl border border-k-border bg-white p-2 pl-3">
          <code className="flex-1 select-all break-all font-mono text-[16px] font-semibold tracking-wider text-k-navy">
            {code}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 rounded-lg border border-k-border bg-white px-3 py-2 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-k-text-2">{t('expires')}</p>
        {failed && <p className="mt-1 text-[12px] text-k-text-2">{t('copyFailed')}</p>}
      </div>

      <p className="text-[13px] text-k-text-2">
        {t.rich('howTo', {
          link: (chunks) => (
            <a href="/invitacion" className="font-medium text-k-purple hover:underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
