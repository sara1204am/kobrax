import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ClientDetail } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { LinkReview } from './link-review';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const PROVISIONAL = {
  id: 'prov-1',
  clientType: 'PERSON',
  lastName: 'Miriam Cruz Apaza',
  linkReviewPending: true,
  linkSuggestions: [{ id: 'cli-9', displayName: 'Cruz Apaza, Miriam', creditCount: 1 }],
} as unknown as ClientDetail;

function renderReview(client: ClientDetail, creditIds = ['cr-1', 'cr-2']) {
  return render(
    <PermissionsProvider permissions={['credit:write']}>
      <ToastProvider>
        <LinkReview client={client} creditIds={creditIds} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

describe('LinkReview — D2 · opción B', () => {
  it('sin revisión pendiente no dibuja nada', () => {
    renderReview({ ...PROVISIONAL, linkReviewPending: false } as ClientDetail);
    expect(screen.queryByText('Revisar vínculo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Es esta persona' })).not.toBeInTheDocument();
  });

  it('«Es esta persona» mueve cada crédito al cliente elegido y abre su ficha', async () => {
    const moved: { credit: string; clientId: unknown }[] = [];
    server.use(
      http.post('*/api/credits/:id/link-client', async ({ request, params }) => {
        moved.push({ credit: String(params.id), clientId: ((await request.json()) as { clientId: unknown }).clientId });
        return HttpResponse.json({ id: params.id });
      }),
    );
    renderReview(PROVISIONAL);
    expect(screen.getByText(/Cruz Apaza, Miriam/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Es esta persona' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/cartera/cli-9'));
    expect(moved).toEqual([
      { credit: 'cr-1', clientId: 'cli-9' },
      { credit: 'cr-2', clientId: 'cli-9' },
    ]);
  });

  it('«Es otra persona» cierra la revisión sin mover nada', async () => {
    let confirmed = false;
    server.use(
      http.post('*/api/credits/link-review/:clientId/confirm', () => {
        confirmed = true;
        return HttpResponse.json({ clientId: 'prov-1' });
      }),
    );
    renderReview(PROVISIONAL);
    await userEvent.click(screen.getByRole('button', { name: 'Es otra persona' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(confirmed).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});
