'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AccountInfo } from '@kobrax/shared';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { Button } from '@/components/ui';

/**
 * «Revisar con el asistente» (D-14): el enlace discreto de Cuenta › Espacio de trabajo con el que una cuenta que ya existía
 * —o quien lo omitió— recorre el asistente cuando quiera. Si el asistente ya estaba resuelto, el servidor conserva esa
 * resolución (el primero gana); lo que se guarda es el espacio de trabajo.
 */
export function OnboardingLauncher({ account }: { account: AccountInfo }) {
  const t = useTranslations('onboarding.launcher');
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-border bg-white px-4 py-3">
      <p className="text-[13px] text-k-text-2">{t('hint')}</p>
      <Button variant="ghost" className="!w-auto" onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      {open && <OnboardingWizard account={account} onClose={() => setOpen(false)} />}
    </div>
  );
}
