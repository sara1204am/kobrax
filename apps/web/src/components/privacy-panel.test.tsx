import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { PrivacyPanel } from './privacy-panel';
import type { LegalOverview } from '@/lib/legal';

const base = (over: Partial<LegalOverview> = {}): LegalOverview => ({
  pending: [],
  acceptances: [],
  consents: [
    { purpose: 'MARKETING', status: 'WITHDRAWN', decided: false, recordedAt: null },
    { purpose: 'ANALYTICS', status: 'WITHDRAWN', decided: false, recordedAt: null },
    { purpose: 'COOKIES_NON_ESSENTIAL', status: 'WITHDRAWN', decided: false, recordedAt: null },
  ],
  history: [],
  ...over,
});

const draw = (o: LegalOverview) =>
  render(
    <ToastProvider>
      <PrivacyPanel overview={o} />
    </ToastProvider>,
  );

const marketing = () => screen.getByRole('switch', { name: /noticias, promociones/i });

describe('PrivacyPanel', () => {
  it('🔴 quien nunca decidió NO consintió: el interruptor está apagado y lo dice', () => {
    draw(base());
    expect(marketing()).not.toBeChecked();
    expect(screen.getByText(/todavía no lo has aceptado/i)).toBeInTheDocument();
  });

  it('otorgar envía granted:true a la finalidad correcta, refleja el estado nuevo y avisa', async () => {
    let sent: { url: string; body: unknown } | undefined;
    server.use(
      http.put('*/api/legal/consents/MARKETING', async ({ request }) => {
        sent = { url: new URL(request.url).pathname, body: await request.json() };
        return HttpResponse.json(
          base({
            consents: [{ purpose: 'MARKETING', status: 'GRANTED', decided: true, recordedAt: '2026-11-16T15:00:00.000Z' }],
            history: [{ id: 'h1', purpose: 'MARKETING', status: 'GRANTED', source: 'PROFILE', recordedAt: '2026-11-16T15:00:00.000Z' }],
          }),
        );
      }),
    );
    draw(base());
    await userEvent.click(marketing());
    expect(sent).toEqual({ url: '/api/legal/consents/MARKETING', body: { granted: true } });
    expect(await screen.findByText(/lo aceptaste el/i)).toBeInTheDocument();
    expect(marketing()).toBeChecked();
    expect(screen.getByText('Preferencia guardada')).toBeInTheDocument();
    // El historial de decisiones aparece.
    expect(screen.getByText('Historial de tus decisiones')).toBeInTheDocument();
  });

  it('🔴 retirar es un solo clic y envía granted:false (tan fácil como otorgar)', async () => {
    let body: unknown;
    server.use(
      http.put('*/api/legal/consents/MARKETING', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(base({ consents: [{ purpose: 'MARKETING', status: 'WITHDRAWN', decided: true, recordedAt: '2026-11-16T16:00:00.000Z' }] }));
      }),
    );
    draw(
      base({
        consents: [{ purpose: 'MARKETING', status: 'GRANTED', decided: true, recordedAt: '2026-11-16T15:00:00.000Z' }],
      }),
    );
    expect(marketing()).toBeChecked();
    await userEvent.click(marketing());
    expect(body).toEqual({ granted: false });
    expect(await screen.findByText(/lo retiraste el/i)).toBeInTheDocument();
    expect(marketing()).not.toBeChecked();
  });

  it('si no se pudo guardar, avisa y deja el interruptor como estaba', async () => {
    server.use(http.put('*/api/legal/consents/MARKETING', () => HttpResponse.json({ error: { code: 'X' } }, { status: 500 })));
    draw(base());
    await userEvent.click(marketing());
    expect(await screen.findByText(/no se pudo guardar/i)).toBeInTheDocument();
    expect(marketing()).not.toBeChecked();
  });

  it('lista los documentos aceptados con su versión, acción, origen y un enlace a ESA versión exacta', () => {
    draw(
      base({
        acceptances: [
          { id: 'a1', type: 'TERMS', version: '0.1.0', title: 'Términos y Condiciones de Uso', locale: 'es', action: 'ACCEPTED', source: 'SIGNUP_WEB', acceptedAt: '2026-11-16T12:00:00.000Z', contentSha256: 'a'.repeat(64) },
          { id: 'a2', type: 'PRIVACY', version: '0.1.0', title: 'Política de Privacidad', locale: 'es', action: 'ACKNOWLEDGED', source: 'RE_ACCEPT', acceptedAt: '2026-11-17T12:00:00.000Z', contentSha256: 'b'.repeat(64) },
        ],
      }),
    );
    expect(screen.getByText(/Términos y Condiciones de Uso · Versión 0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Aceptado · .* · Registro web/)).toBeInTheDocument();
    expect(screen.getByText(/Reconocido · .* · Actualización de documentos/)).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Ver esta versión' });
    expect(links[0]).toHaveAttribute('href', '/terminos?v=0.1.0');
    expect(links[1]).toHaveAttribute('href', '/privacidad?v=0.1.0');
  });

  it('sin constancias lo dice, y siempre ofrece los documentos vigentes', () => {
    draw(base());
    expect(screen.getByText(/todavía no hay constancias/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute('href', '/terminos');
    expect(screen.getByRole('link', { name: 'Política de Privacidad' })).toHaveAttribute('href', '/privacidad');
  });

  it('no ofrece interruptores de analítica ni cookies: hoy no hay nada que consentir', () => {
    draw(base());
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});
