import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { SessionInfo } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import SessionsPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const sessions: SessionInfo[] = [
  { id: 's1', accountName: 'DEMO', deviceType: 'mobile', os: 'Android', isCurrent: false },
  { id: 's2', accountName: 'DEMO', deviceType: 'web', os: 'Windows', isCurrent: true },
];

describe('SessionsPage', () => {
  it('lista las sesiones y marca la actual', async () => {
    server.use(http.get('*/api/account/sessions', () => HttpResponse.json({ sessions })));
    render(<SessionsPage />);

    expect(await screen.findByText(/esta sesión/i)).toBeInTheDocument();
    expect(screen.getByText(/mobile · DEMO/i)).toBeInTheDocument();
    expect(screen.getByText(/web · DEMO/i)).toBeInTheDocument();
  });

  it('cierra una sesión ajena y refresca la lista', async () => {
    let revoked = false;
    server.use(
      http.get('*/api/account/sessions', () =>
        HttpResponse.json({ sessions: revoked ? sessions.filter((s) => s.id !== 's1') : sessions }),
      ),
      http.delete('*/api/account/sessions/s1', () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<SessionsPage />);

    await screen.findByText(/mobile · DEMO/i);
    await userEvent.click(screen.getByRole('button', { name: /^cerrar$/i }));

    await waitFor(() => expect(screen.queryByText(/mobile · DEMO/i)).not.toBeInTheDocument());
    expect(screen.getByText(/web · DEMO/i)).toBeInTheDocument(); // la actual permanece
  });
});
