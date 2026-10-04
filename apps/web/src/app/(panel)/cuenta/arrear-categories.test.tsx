import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ArrearCategory } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { ArrearCategories } from './arrear-categories';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CATS: ArrearCategory[] = [
  { id: '1', code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null, sortOrder: 1 },
  { id: '2', code: 'B', name: 'Categoría B', fromDays: 31, toDays: 60, color: null, sortOrder: 2 },
  { id: '3', code: 'C', name: 'Categoría C', fromDays: 61, toDays: null, color: null, sortOrder: 3 },
];

function renderIt(permissions = ['collection:read', 'account:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <ArrearCategories categories={CATS} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

describe('ArrearCategories', () => {
  it('valida mientras se escribe, con el mensaje en español, y no deja guardar', async () => {
    renderIt();
    const desde = screen.getByLabelText('Desde (días) 2');
    await userEvent.clear(desde);
    await userEvent.type(desde, '35');

    expect(screen.getByRole('alert')).toHaveTextContent('Faltan días entre dos categorías');
    expect(screen.getByRole('button', { name: 'Guardar categorías' })).toBeDisabled();

    await userEvent.clear(desde);
    await userEvent.type(desde, '25');
    expect(screen.getByRole('alert')).toHaveTextContent('Dos categorías comparten días');
  });

  it('el valor válido vuelve a habilitar guardar y manda el cuerpo que espera la API', async () => {
    let enviado: unknown;
    server.use(
      http.put('*/api/arrear-categories', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: CATS });
      }),
    );

    renderIt();
    const hasta = screen.getByLabelText('Hasta (días) 2');
    await userEvent.clear(hasta);
    await userEvent.type(hasta, '90');
    const desdeC = screen.getByLabelText('Desde (días) 3');
    await userEvent.clear(desdeC);
    await userEvent.type(desdeC, '91');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar categorías' }));

    expect(enviado).toEqual({
      categories: [
        { code: 'A', name: 'Categoría A', fromDays: 1, toDays: 30, color: null },
        { code: 'B', name: 'Categoría B', fromDays: 31, toDays: 90, color: null },
        { code: 'C', name: 'Categoría C', fromDays: 91, toDays: null, color: null },
      ],
    });
    expect(await screen.findByText('Categorías guardadas')).toBeInTheDocument();
  });

  it('muestra el mensaje del servidor si rechaza el guardado', async () => {
    server.use(
      http.put('*/api/arrear-categories', () =>
        HttpResponse.json(
          { error: { code: 'ARREAR_CATEGORIES_INVALID', message: 'Los rangos de las categorías de mora no son válidos' } },
          { status: 400 },
        ),
      ),
    );
    renderIt();
    const hasta = screen.getByLabelText('Hasta (días) 1');
    await userEvent.clear(hasta);
    await userEvent.type(hasta, '40');
    await userEvent.clear(screen.getByLabelText('Desde (días) 2'));
    await userEvent.type(screen.getByLabelText('Desde (días) 2'), '41');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar categorías' }));

    expect(await screen.findByText('Los rangos de las categorías de mora no son válidos')).toBeInTheDocument();
  });

  it('agregar suma una fila y quitar la saca; la última sin límite se ve como «Sin límite»', async () => {
    renderIt();
    expect(screen.getByLabelText('Hasta (días) 3')).toHaveAttribute('placeholder', 'Sin límite');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar C' }));
    expect(screen.queryByLabelText('Código 3')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar categoría' }));
    expect(screen.getByLabelText('Código 3')).toBeInTheDocument();
  });

  it('con sólo collection:read es de lectura: sin botones ni campos editables', () => {
    renderIt(['collection:read']);
    expect(screen.getByLabelText('Código 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar categorías' })).not.toBeInTheDocument();
    expect(screen.getByText('Sólo un administrador puede cambiar estos rangos.')).toBeInTheDocument();
  });
});
