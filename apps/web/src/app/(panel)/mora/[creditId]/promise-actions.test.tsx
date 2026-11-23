import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import type { MoraPromise } from '@kobrax/shared';
import { PromisesSection } from './promises-section';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => '/mora/x', useSearchParams: () => new URLSearchParams('') }));

const promise = (over: Partial<MoraPromise> = {}): MoraPromise =>
  ({ id: 'p1', amount: 5208.33, promiseDate: '2026-11-20', status: 'ACTIVE', assigneeId: 'u1', createdAt: '2026-11-20T10:00:00Z', ...over }) as MoraPromise;

const view = (promises: MoraPromise[], canWrite = true) =>
  render(
    <ToastProvider>
      <PromisesSection promises={promises} members={[]} currency="BOB" canWrite={canWrite} />
    </ToastProvider>,
  );

describe('Promesas · cerrar a mano', () => {
  it('una promesa vigente se cierra como cumplida con un botón, con el mismo desenlace que la agenda', async () => {
    let enviado: unknown = null;
    server.use(
      http.post('*/api/agenda/p1/complete', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'p1' } });
      }),
    );
    view([promise()]);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar cumplida' }));
    await vi.waitFor(() => expect(enviado).toEqual({ outcome: 'PROMISE_KEPT' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('también se puede marcar incumplida', async () => {
    let enviado: unknown = null;
    server.use(http.post('*/api/agenda/p1/complete', async ({ request }) => ((enviado = await request.json()), HttpResponse.json({ data: {} }))));
    view([promise({ status: 'OVERDUE' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar incumplida' }));
    await vi.waitFor(() => expect(enviado).toEqual({ outcome: 'PROMISE_BROKEN' }));
  });

  it('una promesa ya cerrada no ofrece los botones; sin permiso de escritura, tampoco', () => {
    view([promise({ status: 'KEPT' })]);
    expect(screen.queryByRole('button', { name: 'Marcar cumplida' })).toBeNull();
    view([promise({ id: 'p2' })], false);
    expect(screen.queryAllByRole('button', { name: 'Marcar cumplida' })).toHaveLength(0);
  });
});
