'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth-shell';
import { ErrorBanner } from '@/components/ui';
import { postJson, type AccountOption } from '@/lib/client';

export default function SelectAccountPage() {
  const router = useRouter();
  const t = useTranslations('selectAccount');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('k_accounts');
    if (raw) {
      try {
        setAccounts(JSON.parse(raw) as AccountOption[]);
      } catch {
        router.replace('/login');
      }
    } else {
      router.replace('/login');
    }
  }, [router]);

  async function choose(accountId: string) {
    setError(null);
    setBusy(accountId);
    const { ok, data } = await postJson('/api/auth/select-account', { accountId });
    if (!ok) {
      setBusy(null);
      setError(data.error?.message ?? t('error'));
      return;
    }
    sessionStorage.removeItem('k_accounts');
    router.replace('/dashboard');
  }

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <div className="space-y-3">
        <ErrorBanner message={error} />
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => choose(a.id)}
            disabled={!!busy}
            className="flex w-full items-center justify-between rounded-[10px] border border-k-border bg-white px-4 py-3 text-left transition-all hover:border-k-periwinkle hover:bg-k-bg disabled:opacity-50"
          >
            <span>
              <span className="block text-[15px] font-medium text-k-text">{a.name}</span>
              <span className="block text-[12px] text-k-text-2">{a.role}</span>
            </span>
            <span aria-hidden className="text-k-muted">
              {busy === a.id ? '···' : '›'}
            </span>
          </button>
        ))}
        {accounts.length === 0 && <p className="text-[13px] text-k-text-2">{t('loading')}</p>}
      </div>
    </AuthShell>
  );
}
