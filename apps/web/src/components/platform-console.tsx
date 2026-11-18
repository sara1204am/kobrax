'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { postJson, sendJson } from '@/lib/client';

export interface PlatformReport {
  id: string;
  subjectKind: string;
  type: string;
  status: string;
  reportedSubject: string | null;
  description: string;
  rejectionReason: string | null;
  createdAt: string;
  allowedNext: string[];
  requester: { email: string; name: string | null };
  events: { status: string; note: string | null; actorKind: string; createdAt: string }[];
}

export interface PlatformAccount {
  accountId: string;
  businessName: string;
  status: string;
  planCode: string;
  createdAt: string;
  ownerEmail: string | null;
}

/** Las que exigen escribir algo: rechazar pide la justificación; pedir información, qué falta (lo valida también la API). */
const NEEDS_TEXT = new Set(['REJECTED', 'NEEDS_INFO']);
const MIN_TEXT = 5;
const MIN_REASON = 10;

const dateFmt = (iso: string) => new Date(iso).toLocaleString();

/**
 * Consola de PLATAFORMA: dos pestañas, «Reportes y solicitudes» (lo que escriben las personas, con o sin cuenta) y «Cuentas» (buscar, suspender y
 * reactivar). Todo va por `/api/plataforma/*`; la API decide qué se puede (máquina de estados, motivo mínimo, solo cuentas suspendidas se reactivan).
 */
export function PlatformConsole({ initialReports, initialAccounts }: { initialReports: PlatformReport[]; initialAccounts: PlatformAccount[] }) {
  const t = useTranslations('platform.console');
  const router = useRouter();
  const [tab, setTab] = useState<'reports' | 'accounts'>('reports');
  const [reports, setReports] = useState(initialReports);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<{ report: PlatformReport; to: string } | null>(null);
  const [target, setTarget] = useState<{ account: PlatformAccount; to: 'SUSPENDED' | 'ACTIVE' } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = filter === 'open' ? reports.filter((r) => r.status !== 'COMPLETED' && r.status !== 'REJECTED') : reports;

  function expired(status: number): boolean {
    if (status === 401 || status === 403) {
      router.replace('/plataforma/login?e=expired');
      return true;
    }
    return false;
  }

  async function logout() {
    await postJson('/api/plataforma/logout', {});
    router.replace('/plataforma/login');
  }

  async function searchAccounts(q: string) {
    setQuery(q);
    const res = await fetch(`/api/plataforma/cuentas?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).catch(() => null);
    if (!res) return;
    if (expired(res.status)) return;
    if (res.ok) setAccounts((await res.json()) as PlatformAccount[]);
  }

  function openStep(report: PlatformReport, to: string) {
    setError(null);
    setText('');
    setStep({ report, to });
  }

  async function confirmStep() {
    if (!step) return;
    const needsText = NEEDS_TEXT.has(step.to);
    if (needsText && text.trim().length < MIN_TEXT) {
      setError(step.to === 'REJECTED' ? t('reasonRequired') : t('noteRequired'));
      return;
    }
    setBusy(true);
    const { ok, status, data } = await sendJson<PlatformReport>(
      `/api/plataforma/reportes/${step.report.id}/status`,
      { status: step.to, ...(step.to === 'REJECTED' ? { rejectionReason: text.trim() } : { note: text.trim() }) },
      'PATCH',
    );
    setBusy(false);
    if (expired(status)) return;
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    const updated = data as unknown as PlatformReport;
    setReports((list) => list.map((r) => (r.id === step.report.id ? { ...r, ...updated, requester: r.requester } : r)));
    setStep(null);
  }

  async function confirmAccount() {
    if (!target) return;
    if (text.trim().length < MIN_REASON) {
      setError(t('accountReasonRequired'));
      return;
    }
    setBusy(true);
    const { ok, status, data } = await postJson<{ status: string }>(`/api/plataforma/cuentas/${target.account.accountId}/status`, {
      status: target.to,
      reason: text.trim(),
    });
    setBusy(false);
    if (expired(status)) return;
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    const next = (data as unknown as { status: string }).status;
    setAccounts((list) => list.map((a) => (a.accountId === target.account.accountId ? { ...a, status: next } : a)));
    setTarget(null);
  }

  return (
    <div className="min-h-screen bg-k-bg">
      <header className="border-b border-k-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <span className="text-k-md font-semibold tracking-[0.16em] text-k-navy">KOBRAX · {t('brand')}</span>
          <Button variant="ghost" onClick={logout} size="sm" fullWidth={false}>
            {t('logout')}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <div role="tablist" className="mb-5 flex gap-2">
          {(['reports', 'accounts'] as const).map((k) => (
            <Button
              key={k}
              role="tab"
              aria-selected={tab === k}
              variant={tab === k ? 'primary' : 'ghost'}
              onClick={() => setTab(k)}
              size="sm" fullWidth={false}
            >
              {t(`tabs.${k}`)}
            </Button>
          ))}
        </div>

        {tab === 'reports' && (
          <section aria-label={t('tabs.reports')}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-k-sm text-k-muted">{t('reportsCount', { count: visible.length })}</p>
              <Button variant="ghost" onClick={() => setFilter(filter === 'open' ? 'all' : 'open')} size="sm" fullWidth={false}>
                {filter === 'open' ? t('showAll') : t('showOpen')}
              </Button>
            </div>
            {visible.length === 0 ? (
              <p role="status" className="rounded-xl border border-k-border bg-white px-5 py-4 text-k-base text-k-text-2">
                {t('noReports')}
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-k-sm text-k-muted">
                      <span className="font-semibold text-k-navy">{t(`types.${r.type}`)}</span>
                      <span>{t(`status.${r.status}`)}</span>
                      <span>{dateFmt(r.createdAt)}</span>
                      <span className="font-mono">{r.id.slice(0, 8).toUpperCase()}</span>
                      <span>{r.subjectKind === 'THIRD_PARTY' ? t('fromThirdParty') : t('fromUser')}</span>
                    </div>
                    <p className="mt-2 text-k-base text-k-text">
                      {r.requester.name ? `${r.requester.name} · ` : ''}
                      {r.requester.email}
                    </p>
                    {r.reportedSubject && <p className="mt-1 text-k-sm text-k-text-2">{t('about', { subject: r.reportedSubject })}</p>}
                    <p className="mt-2 whitespace-pre-wrap text-k-base text-k-text">{r.description}</p>
                    {r.rejectionReason && <p className="mt-2 text-k-sm text-k-danger">{t('rejectedBecause', { reason: r.rejectionReason })}</p>}
                    {r.allowedNext.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.allowedNext.map((to) => (
                          <Button key={to} variant={to === 'REJECTED' ? 'danger' : 'ghost'} onClick={() => openStep(r, to)} size="sm" fullWidth={false}>
                            {t(`actions.${to}`)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'accounts' && (
          <section aria-label={t('tabs.accounts')}>
            <div className="mb-3 max-w-sm">
              <Field label={t('searchAccounts')}>
                <Input value={query} onChange={(e) => void searchAccounts(e.target.value)} placeholder={t('searchPlaceholder')} />
              </Field>
            </div>
            {accounts.length === 0 ? (
              <p role="status" className="rounded-xl border border-k-border bg-white px-5 py-4 text-k-base text-k-text-2">
                {t('noAccounts')}
              </p>
            ) : (
              <ul className="space-y-3">
                {accounts.map((a) => (
                  <li key={a.accountId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card">
                    <div>
                      <p className="text-k-md font-semibold text-k-navy">{a.businessName}</p>
                      <p className="text-k-sm text-k-muted">
                        {t(`accountStatus.${a.status}`)} · {a.planCode}
                        {a.ownerEmail ? ` · ${a.ownerEmail}` : ''}
                      </p>
                    </div>
                    {a.status === 'SUSPENDED' ? (
                      <Button variant="ghost" onClick={() => { setError(null); setText(''); setTarget({ account: a, to: 'ACTIVE' }); }} size="sm" fullWidth={false}>
                        {t('reactivate')}
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => { setError(null); setText(''); setTarget({ account: a, to: 'SUSPENDED' }); }} size="sm" fullWidth={false}>
                        {t('suspend')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {step && (
      <Modal
        open
        onClose={() => setStep(null)}
        locked={busy}
        title={t(`actions.${step.to}`)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setStep(null)} disabled={busy} fullWidth={false}>
              {t('cancel')}
            </Button>
            <Button variant={step.to === 'REJECTED' ? 'danger' : 'primary'} loading={busy} onClick={() => void confirmStep()} fullWidth={false}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <Field label={NEEDS_TEXT.has(step.to) ? (step.to === 'REJECTED' ? t('reason') : t('whatIsMissing')) : t('noteOptional')}>
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        </Field>
      </Modal>
      )}

      {target && (
      <Modal
        open
        onClose={() => setTarget(null)}
        locked={busy}
        title={`${target.to === 'SUSPENDED' ? t('suspend') : t('reactivate')} · ${target.account.businessName}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={busy} fullWidth={false}>
              {t('cancel')}
            </Button>
            <Button variant={target.to === 'SUSPENDED' ? 'danger' : 'primary'} loading={busy} onClick={() => void confirmAccount()} fullWidth={false}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p className="mb-3 text-k-sm text-k-text-2">{target.to === 'SUSPENDED' ? t('suspendWarning') : t('reactivateInfo')}</p>
        <Field label={t('accountReason')} hint={t('accountReasonHint')}>
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        </Field>
      </Modal>
      )}
    </div>
  );
}
