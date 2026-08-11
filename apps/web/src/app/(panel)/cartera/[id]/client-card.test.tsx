import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ClientDetail } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { ClientCard } from './client-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** Como lo devuelve la API sin `reveal`: todo tokenizado. */
const TAPADO: ClientDetail = {
  id: 'cl-1',
  clientType: 'PERSON',
  firstName: 'Ana',
  lastName: 'Ruiz',
  nationalId: '1234***',
  status: 'ACTIVE',
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '7****23', isPrimary: true }],
  locations: [{ id: 'lo-1', locationType: 'HOME', address: 'Calle ****' }],
};

const EN_CLARO: ClientDetail = {
  ...TAPADO,
  nationalId: '12345678',
  contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '70012323', isPrimary: true }],
  locations: [{ id: 'lo-1', locationType: 'HOME', address: 'Calle Falsa 123' }],
};

function renderCard(client = TAPADO, permissions = ['client:read', 'client:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <ClientCard client={client} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

describe('ClientCard — la PII se revela con un click, no sola', () => {
  it('abre tapada: ni el documento ni el teléfono ni la dirección están en claro', () => {
    renderCard();
    expect(screen.getByText('1234***')).toBeInTheDocument();
    expect(screen.queryByText('12345678')).not.toBeInTheDocument();
    expect(screen.queryByText('70012323')).not.toBeInTheDocument();
    expect(screen.queryByText('Calle Falsa 123')).not.toBeInTheDocument();
  });

  /**
   * El revelado deja rastro en la auditoría, así que tiene que salir de un click. Si la ficha lo
   * pidiera al abrirse, el registro se llenaría de ruido y sería inútil el día que haga falta.
   */
  it('no llama al revelado hasta que alguien lo pide', async () => {
    let pedidos = 0;
    server.use(
      http.post('*/api/clients/cl-1/reveal', () => {
        pedidos += 1;
        return HttpResponse.json(EN_CLARO);
      }),
    );

    renderCard();
    expect(pedidos).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Ver datos completos' }));
    expect(await screen.findByText('12345678')).toBeInTheDocument();
    expect(pedidos).toBe(1);
  });

  // La respuesta reemplaza la ficha entera: enmascarado y en claro son la misma ficha con
  // distinta profundidad, no dos pedazos que haya que pegar.
  it('al revelar, también aparecen el teléfono y la dirección completos', async () => {
    server.use(http.post('*/api/clients/cl-1/reveal', () => HttpResponse.json(EN_CLARO)));

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Ver datos completos' }));

    expect(await screen.findByText('70012323')).toBeInTheDocument();
    expect(screen.getByText('Calle Falsa 123')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver datos completos' })).not.toBeInTheDocument();
  });

  it('si el servidor dice que no, la ficha se queda tapada', async () => {
    server.use(
      http.post('*/api/clients/cl-1/reveal', () =>
        HttpResponse.json({ error: { code: 'AUTH_002', message: 'Sin permiso' } }, { status: 403 }),
      ),
    );

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Ver datos completos' }));

    expect(await screen.findByText('Sin permiso')).toBeInTheDocument();
    expect(screen.getByText('1234***')).toBeInTheDocument();
    expect(screen.queryByText('12345678')).not.toBeInTheDocument();
  });

  it('sin permiso de escritura no ofrece editar', () => {
    renderCard(TAPADO, ['client:read']);
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
