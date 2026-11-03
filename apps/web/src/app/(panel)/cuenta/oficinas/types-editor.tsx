'use client';

import { useState } from 'react';
import { Button, ErrorBanner, Field, Input, Switch } from '@/components/ui';
import { Modal } from '@/components/modal';
import { sendJson } from '@/lib/client';
import type { OfficeType } from '@/lib/offices';
import { useOfficeApi } from './use-office-api';

/**
 * El catálogo de tipos de oficina de la cuenta (R1: los niveles son flexibles; el tipo es una etiqueta, no una regla de
 * jerarquía). Con `office:write` se crean y se editan; los tipos en uso se desactivan, no se borran.
 */
export function TypesEditor({ open, onClose, types }: { open: boolean; onClose: () => void; types: OfficeType[] }) {
  const { busy, error, run, t } = useOfficeApi();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const sorted = [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={t('types.title')}
      actions={
        <span className="sm:w-36">
          <Button variant="ghost" onClick={onClose}>
            {t('form.close')}
          </Button>
        </span>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] text-k-text-2">{t('types.intro')}</p>
        <ErrorBanner message={error} />
        {sorted.length === 0 ? (
          <p className="text-[13px] text-k-text-2">{t('types.empty')}</p>
        ) : (
          <ul className="divide-y divide-k-border rounded-xl border border-k-border">
            {sorted.map((x) => (
              <TypeRow key={x.id} type={x} busy={busy} onPatch={(patch) => run(() => sendJson(`/api/branch-types/${x.id}`, patch, 'PATCH'), t('types.saved'))} />
            ))}
          </ul>
        )}
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <Field label={t('types.code')}>
            <Input value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('types.name')}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <span className="sm:w-36">
            <Button
              loading={busy}
              disabled={code.trim().length < 2 || name.trim().length < 2}
              onClick={() =>
                void run(
                  () => sendJson('/api/branch-types', { code: code.trim().toUpperCase(), name: name.trim(), sortOrder: sorted.length + 1 }, 'POST'),
                  t('types.created'),
                  () => {
                    setCode('');
                    setName('');
                  },
                )
              }
            >
              {t('types.add')}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function TypeRow({ type, busy, onPatch }: { type: OfficeType; busy: boolean; onPatch: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useOfficeApi();
  const [name, setName] = useState(type.name);
  const dirty = name.trim() !== type.name && name.trim().length >= 2;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <span className="w-24 font-mono text-[12px] text-k-text-2">{type.code}</span>
      <span className="min-w-[10rem] flex-1">
        <Input aria-label={t('types.nameOf', { code: type.code })} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </span>
      {dirty && (
        <button type="button" disabled={busy} onClick={() => void onPatch({ name: name.trim() })} className="text-[13px] font-medium text-k-purple hover:underline disabled:opacity-50">
          {t('form.save')}
        </button>
      )}
      <span className="flex items-center gap-2 text-[13px] text-k-text-2">
        <Switch checked={type.isActive} disabled={busy} onChange={(v) => void onPatch({ isActive: v })} aria-label={t('types.activeOf', { code: type.code })} />
        {t('types.active')}
      </span>
    </li>
  );
}
