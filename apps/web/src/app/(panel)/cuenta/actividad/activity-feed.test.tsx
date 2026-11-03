import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AccountActivityEvent, AccountActivityPage } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ActivityFeed } from './activity-feed';

const event = (over: Partial<AccountActivityEvent> = {}): AccountActivityEvent => ({
  id: 'e1',
  at: '2026-10-21T12:00:00.000Z',
  entity: 'account',
  action: 'UPDATE',
  actorName: 'Sara Admin',
  ip: '10.0.0.1',
  changes: [{ field: 'city', from: 'La Paz', to: 'Sucre' }],
  via: null,
  ...over,
});

const page = (items: AccountActivityEvent[], next: string | null = null): AccountActivityPage => ({ items, next });

describe('ActivityFeed', () => {
  it('cada renglón dice quién, qué y cuándo, con los campos que cambiaron', () => {
    render(<ActivityFeed initial={page([event()])} timezone="America/La_Paz" />);
    expect(screen.getByText('Sara Admin')).toBeInTheDocument();
    expect(screen.getByText(/Cambió Datos de la cuenta/)).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    expect(screen.getByText(/La Paz → Sucre/)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
  });

  it('🔴 un cambio hecho por Kobrax por consola no se atribuye a una persona', () => {
    render(<ActivityFeed initial={page([event({ actorName: null, via: 'plan:set', changes: [] })])} timezone={null} />);
    expect(screen.getByText('Kobrax (plan:set)')).toBeInTheDocument();
    expect(screen.queryByText('Sara Admin')).not.toBeInTheDocument();
  });

  it('sin actividad lo dice, y sin cursor no ofrece cargar más', () => {
    render(<ActivityFeed initial={page([])} timezone={null} />);
    expect(screen.getByText('Todavía no hay actividad para mostrar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('«Cargar más» pide la página siguiente con el cursor y la suma al final', async () => {
    let pedido = '';
    server.use(
      http.get('*/api/account/activity', ({ request }) => {
        pedido = new URL(request.url).search;
        return HttpResponse.json(page([event({ id: 'e2', actorName: 'Luis', changes: [] })]));
      }),
    );
    render(<ActivityFeed initial={page([event()], 'CURSOR-1')} timezone={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('Luis')).toBeInTheDocument();
    expect(screen.getByText('Sara Admin')).toBeInTheDocument();
    expect(pedido).toContain('before=CURSOR-1');
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('filtrar por tipo vuelve a pedir desde el principio y reemplaza la lista', async () => {
    let pedido = '';
    server.use(
      http.get('*/api/account/activity', ({ request }) => {
        pedido = new URL(request.url).search;
        return HttpResponse.json(page([event({ id: 'b1', entity: 'branch', action: 'CREATE', actorName: 'Ana', changes: [] })]));
      }),
    );
    render(<ActivityFeed initial={page([event()], 'CURSOR-1')} timezone={null} />);
    await userEvent.selectOptions(screen.getByLabelText('Tipo de cambio'), 'branch');

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Sara Admin')).not.toBeInTheDocument();
    expect(pedido).toContain('entity=branch');
    expect(pedido).not.toContain('before=');
  });

  it('si la carga falla lo dice y conserva lo que ya estaba', async () => {
    server.use(http.get('*/api/account/activity', () => HttpResponse.json({ error: { code: 'X', message: 'Sin permiso' } }, { status: 403 })));
    render(<ActivityFeed initial={page([event()], 'CURSOR-1')} timezone={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso');
    expect(screen.getByText('Sara Admin')).toBeInTheDocument();
  });
});
