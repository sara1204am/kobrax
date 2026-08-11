'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

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
    <div className="space-y-3">
      <p className="text-[14px] text-k-text-2">{t('sentTo', { email })}</p>

      <div className="flex items-center gap-2 rounded-xl border border-k-border bg-k-bg p-3">
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
      {failed && <p className="text-[12px] text-k-text-2">{t('copyFailed')}</p>}

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
