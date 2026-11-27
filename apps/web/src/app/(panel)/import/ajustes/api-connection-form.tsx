'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImportApiConnection, ImportApiConnectionInput } from '@kobrax/shared';
import { Button, Field, Input, Select, TextButton, Textarea } from '@/components/ui';

interface HeaderRow {
  name: string;
  value: string;
  /** El nombre con el que hay un valor guardado. Si cambia el nombre, ese valor ya no es suyo. */
  saved?: string;
}

/**
 * La petición a la API del banco: método, dirección, cabeceras y cuerpo, como en Postman.
 *
 * Los valores guardados **no vuelven** del servidor (ahí va la clave): el campo queda vacío y dejarlo
 * así conserva lo guardado.
 */
export function ApiConnectionForm({
  saved,
  busy,
  onCall,
}: {
  saved: ImportApiConnection | null;
  busy: boolean;
  onCall: (input: ImportApiConnectionInput) => Promise<boolean>;
}) {
  const t = useTranslations('panel.import.api');
  const [method, setMethod] = useState<'GET' | 'POST'>(saved?.method ?? 'GET');
  const [url, setUrl] = useState(saved?.url ?? '');
  const [headers, setHeaders] = useState<HeaderRow[]>(
    () => saved?.headerNames.map((name) => ({ name, value: '', saved: name })) ?? [],
  );
  const [body, setBody] = useState('');
  const [dropBody, setDropBody] = useState(false);
  const keepsBody = Boolean(saved?.hasBody) && !dropBody;

  const change = (index: number, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit() {
    const ok = await onCall({
      method,
      url: url.trim(),
      headers: headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value || undefined })),
      body: method !== 'POST' ? undefined : body || (keepsBody ? undefined : ''),
    });
    // Ya quedaron guardados: se limpian de la pantalla.
    if (ok) {
      setHeaders((rows) => rows.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: '', saved: h.name.trim() })));
      setBody('');
      setDropBody(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <Field label={t('method')}>
          <Select value={method} disabled={busy} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </Select>
        </Field>
        <Field label={t('url')}>
          <Input
            type="url"
            required
            value={url}
            disabled={busy}
            placeholder="https://api.banco.com/cartera"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-k-sm font-medium text-k-text">{t('headers')}</p>
        <p className="text-k-xs text-k-text-2">{t('headersHint')}</p>
        {headers.map((header, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label={t('headerName')}
              placeholder="x-api-key"
              value={header.name}
              disabled={busy}
              onChange={(e) => change(i, { name: e.target.value })}
            />
            <Input
              aria-label={t('headerValue')}
              type="password"
              autoComplete="off"
              placeholder={header.saved && header.saved === header.name ? t('savedValue') : t('headerValue')}
              value={header.value}
              disabled={busy}
              onChange={(e) => change(i, { value: e.target.value })}
            />
            <TextButton type="button" disabled={busy} onClick={() => setHeaders((rows) => rows.filter((_, j) => j !== i))}>
              {t('remove')}
            </TextButton>
          </div>
        ))}
        <TextButton type="button" disabled={busy} onClick={() => setHeaders((rows) => [...rows, { name: '', value: '' }])}>
          {t('addHeader')}
        </TextButton>
      </div>

      {method === 'POST' && (
        <div className="space-y-2">
          <Field label={t('body')} hint={keepsBody ? t('bodySaved') : t('bodyHint')}>
            <Textarea rows={5} value={body} disabled={busy} placeholder="{ }" onChange={(e) => setBody(e.target.value)} />
          </Field>
          {keepsBody && (
            <TextButton type="button" disabled={busy} onClick={() => setDropBody(true)}>
              {t('dropBody')}
            </TextButton>
          )}
        </div>
      )}

      <p className="text-k-xs text-k-warning-text">{t('fullPortfolio')}</p>
      <div className="sm:w-64">
        <Button type="submit" loading={busy} disabled={!url.trim()}>
          {t('saveAndFetch')}
        </Button>
      </div>
    </form>
  );
}
