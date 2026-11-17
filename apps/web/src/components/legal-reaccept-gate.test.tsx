import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { LegalReacceptGate } from './legal-reaccept-gate';
import type { PendingDocument } from '@/lib/legal';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const TERMS: PendingDocument = { type: 'TERMS', versionId: 't-2', version: '2.0.0', title: 'Términos', isMaterial: true };
const PRIVACY: PendingDocument = { type: 'PRIVACY', versionId: 'p-2', version: '2.0.0', title: 'Política', isMaterial: true };

const DOC = (title: string, content: string) => ({
  id: 'x', type: 'TERMS', locale: 'es', version: '2.0.0', title, content, contentSha256: 'a'.repeat(64),
  isMaterial: true, changeSummary: null, publishedAt: '2026-11-16T12:00:00.000Z', effectiveAt: '2026-11-16T12:00:00.000Z',
});

beforeEach(() => refresh.mockReset());

const confirmar = () => screen.getByRole('button', { name: 'Aceptar y continuar' });

describe('LegalReacceptGate', () => {
  it('🔴 si cambió UN solo documento, pide solo ese (la otra casilla no aparece)', () => {
    render(<LegalReacceptGate pending={[TERMS]} />);
    expect(screen.getByRole('checkbox', { name: /términos y condiciones de uso/i })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /política de privacidad/i })).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('nada viene premarcado y «Aceptar y continuar» exige TODAS las casillas que se piden', async () => {
    render(<LegalReacceptGate pending={[TERMS, PRIVACY]} />);
    expect(confirmar()).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /términos y condiciones de uso/i }));
    expect(confirmar()).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /política de privacidad/i }));
    expect(confirmar()).toBeEnabled();
  });

  it('🔴 envía solo los ids de lo pendiente, refresca el panel y no manda texto ni hash', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/legal/acceptances', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ pending: [] });
      }),
    );
    render(<LegalReacceptGate pending={[TERMS]} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(confirmar());
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(body?.termsVersionId).toBe('t-2');
    expect(body?.privacyVersionId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('contentSha256');
  });

  it('el enlace abre UN modal con la versión exacta y «He leído y acepto» marca la casilla', async () => {
    const requested: string[] = [];
    server.use(
      http.get('*/api/legal/documents/terms', ({ request }) => {
        requested.push(new URL(request.url).search);
        return HttpResponse.json(DOC('Términos y Condiciones de Uso', 'Texto nuevo de los términos.'));
      }),
    );
    render(<LegalReacceptGate pending={[TERMS]} />);
    await userEvent.click(screen.getByRole('link', { name: 'Términos y Condiciones de Uso' }));
    expect(await screen.findByText('Texto nuevo de los términos.')).toBeInTheDocument();
    expect(requested).toEqual(['?version=2.0.0']);
    expect(screen.getByRole('checkbox')).not.toBeChecked(); // abrirlo no marca nada
    await userEvent.click(screen.getByRole('button', { name: 'He leído y acepto' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  });

  it('🔴 si las versiones cambiaron otra vez: avisa, desmarca y vuelve a pedir lo pendiente', async () => {
    server.use(
      http.post('*/api/legal/acceptances', () =>
        HttpResponse.json({ error: { code: 'LEGAL_VERSION_STALE', message: 'cambiaron' } }, { status: 409 }),
      ),
    );
    render(<LegalReacceptGate pending={[TERMS]} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(confirmar());
    expect(await screen.findByText(/cambiaron otra vez/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(refresh).toHaveBeenCalled();
  });

  it('un error cualquiera se dice y deja reintentar sin perder las casillas', async () => {
    server.use(http.post('*/api/legal/acceptances', () => HttpResponse.json({ error: { code: 'X' } }, { status: 500 })));
    render(<LegalReacceptGate pending={[TERMS]} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(confirmar());
    expect(await screen.findByText(/no se pudo guardar tu aceptación/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('es una pantalla bloqueante accesible (alertdialog modal) y permite cerrar sesión', () => {
    render(<LegalReacceptGate pending={[TERMS]} />);
    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });
});
