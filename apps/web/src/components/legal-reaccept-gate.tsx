'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorBanner } from '@/components/ui';
import { LegalDocumentModal } from '@/components/legal-document-modal';
import { hardNavigate, postJson, sendJson } from '@/lib/client';
import { LEGAL_PAGES, PAGE_OF_TYPE, type PendingDocument } from '@/lib/legal';

const LINK = 'font-medium text-k-purple underline-offset-2 hover:underline';

/**
 * Pantalla bloqueante de **re-aceptación**: cuando cambió algo MATERIAL en un documento (o la persona nunca lo aceptó), se le pide
 * volver a aceptarlo antes de seguir. Un cambio editorial no llega hasta acá: lo decide la API (`/legal/me › pending`).
 *
 * - Solo se piden los documentos pendientes (si cambió uno, solo ese).
 * - El documento se lee en UN modal encima (la versión exacta que se va a aceptar); desde ahí se marca la casilla.
 * - Se puede **cerrar sesión**: nadie queda atrapado, pero tampoco usa el panel sin aceptar.
 * - La constancia queda con el origen «actualización de documentos», la versión y el hash del servidor.
 *
 * Esto es una barrera de **interfaz**: la API no bloquea el resto de los endpoints por esto (así no se rompe la app móvil ni las
 * integraciones). Es una decisión conocida; ver `docs/legal`.
 */
export function LegalReacceptGate({ pending }: { pending: PendingDocument[] }) {
  const t = useTranslations('legal.reaccept');
  const tc = useTranslations('legal.consent');
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reading, setReading] = useState<PendingDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = pending.every((p) => checked[p.type]);

  async function confirm() {
    setSaving(true);
    setError(null);
    const body = {
      termsVersionId: pending.find((p) => p.type === 'TERMS')?.versionId,
      privacyVersionId: pending.find((p) => p.type === 'PRIVACY')?.versionId,
    };
    const res = await sendJson('/api/legal/acceptances', body, 'POST');
    setSaving(false);
    if (!res.ok) {
      const stale = (res.data as { error?: { code?: string } }).error?.code === 'LEGAL_VERSION_STALE';
      setError(stale ? t('changed') : t('error'));
      if (stale) {
        setChecked({});
        router.refresh(); // vuelve a pedir los pendientes con las versiones vigentes
      }
      return;
    }
    // El layout vuelve a pedir lo pendiente: con la lista vacía el aviso se desmonta solo.
    router.refresh();
  }

  async function logout() {
    await postJson('/api/auth/logout', {});
    hardNavigate('/login');
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reaccept-title"
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-k-bg/95 px-5 py-8"
    >
      <div className="w-full max-w-[480px] rounded-2xl border border-k-border bg-white p-6 shadow-k-card">
        <h1 id="reaccept-title" className="text-k-2xl font-semibold text-k-navy">
          {t('title')}
        </h1>
        <p className="mt-1 text-k-sm text-k-text-2">{t(pending.some((p) => !p.isMaterial) ? 'intro_new' : 'intro')}</p>

        <div className="mt-4 space-y-2.5">
          {error && <ErrorBanner message={error} />}
          {pending.map((p) => {
            const kind = p.type === 'TERMS' ? 'terms' : 'privacy';
            const id = `reaccept-${kind}`;
            const page = LEGAL_PAGES[PAGE_OF_TYPE[p.type]!];
            return (
              <div key={p.type} className="flex items-start gap-2.5">
                <input
                  id={id}
                  type="checkbox"
                  checked={!!checked[p.type]}
                  disabled={saving}
                  onChange={(e) => setChecked((c) => ({ ...c, [p.type]: e.target.checked }))}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-k-navy"
                />
                <label htmlFor={id} className="cursor-pointer text-[12.5px] leading-snug text-k-text">
                  {tc(`${kind}.before`)}
                  <a
                    href={`/${PAGE_OF_TYPE[p.type]}`}
                    className={LINK}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      setReading(p);
                    }}
                  >
                    {tc(`${kind}.link`)}
                  </a>
                  {tc(`${kind}.after`)}{' '}
                  <span className="text-k-muted">({t('version', { version: p.version })})</span>
                </label>
                <LegalDocumentModal
                  open={reading?.type === p.type}
                  onClose={() => setReading(null)}
                  slug={page.slug}
                  version={p.version}
                  pageHref={`/${PAGE_OF_TYPE[p.type]}`}
                  acknowledge={p.type === 'PRIVACY'}
                  onAccept={() => setChecked((c) => ({ ...c, [p.type]: true }))}
                />
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => void logout()} disabled={saving} className={`${LINK} text-k-sm`}>
            {t('logout')}
          </button>
          <Button type="button" variant="primary" className="!w-auto px-6" loading={saving} disabled={!all} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
