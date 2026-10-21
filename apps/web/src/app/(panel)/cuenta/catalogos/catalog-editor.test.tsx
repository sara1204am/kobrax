import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import type { CatalogRow } from '@/lib/catalog-editor';
import { CatalogEditor } from './catalog-editor';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const ROWS: CatalogRow[] = [
  { id: 'i1', code: 'CASH', label: 'Efectivo', sortOrder: 1, isActive: true },
  { id: 'i2', code: 'QR', label: 'Transferencia QR', sortOrder: 2, isActive: true },
  { id: 'i3', code: 'CHEQUE', label: 'Cheque', sortOrder: 3, isActive: false },
];

function renderIt(permissions = ['catalog:read', 'catalog:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <CatalogEditor catalog="PAYMENT_METHOD" items={ROWS} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

/** Captura el cuerpo de un PATCH a un ítem y responde con el ítem cambiado. */
function capturePatch(id: string, sink: unknown[]) {
  return http.patch(`*/api/catalogs/PAYMENT_METHOD/${id}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    sink.push(body);
    const row = ROWS.find((r) => r.id === id)!;
    return HttpResponse.json({ data: { ...row, ...body } });
  });
}

describe('CatalogEditor', () => {
  it('lista los ítems, incluso los desactivados, con su código', () => {
    renderIt();
    expect(screen.getByDisplayValue('Efectivo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cheque')).toBeInTheDocument();
    expect(screen.getByText('CHEQUE')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Activo: Cheque' })).not.toBeChecked();
  });

  it('renombrar al salir del campo manda sólo el nombre', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('i1', enviados));
    renderIt();

    const campo = screen.getByLabelText('Nombre del ítem CASH');
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Efectivo en caja');
    await userEvent.tab();

    expect(enviados).toEqual([{ label: 'Efectivo en caja' }]);
    expect(await screen.findByText('Cambio guardado')).toBeInTheDocument();
  });

  it('salir del campo sin cambiar nada, o vaciado, no pide nada y vuelve al nombre de siempre', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('i1', enviados));
    renderIt();

    const campo = screen.getByLabelText('Nombre del ítem CASH');
    await userEvent.click(campo);
    await userEvent.tab();
    await userEvent.clear(campo);
    await userEvent.tab();

    expect(enviados).toEqual([]);
    expect(screen.getByLabelText('Nombre del ítem CASH')).toHaveValue('Efectivo');
  });

  it('desactivar manda isActive:false y NO borra', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('i2', enviados));
    renderIt();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Activo: Transferencia QR' }));

    expect(enviados).toEqual([{ isActive: false }]);
    expect(await screen.findByRole('checkbox', { name: 'Activo: Transferencia QR' })).not.toBeChecked();
  });

  it('bajar un ítem intercambia el orden con su vecino', async () => {
    const sort: Record<string, unknown> = {};
    server.use(
      http.patch('*/api/catalogs/PAYMENT_METHOD/:id', async ({ request, params }) => {
        sort[params.id as string] = ((await request.json()) as { sortOrder: number }).sortOrder;
        return HttpResponse.json({ data: ROWS[0] });
      }),
    );
    renderIt();

    await userEvent.click(screen.getByRole('button', { name: 'Bajar Efectivo' }));

    expect(sort).toEqual({ i2: 1, i1: 2 });
    // Ya en pantalla: Transferencia QR quedó antes que Efectivo.
    const nombres = screen.getAllByLabelText(/Nombre del ítem/).map((el) => (el as HTMLInputElement).value);
    expect(nombres.slice(0, 2)).toEqual(['Transferencia QR', 'Efectivo']);
  });

  it('el primero no sube y el último no baja', () => {
    renderIt();
    expect(screen.getByRole('button', { name: 'Subir Efectivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar Cheque' })).toBeDisabled();
  });

  it('agregar arma el código del nombre y lo pone al final', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/catalogs/PAYMENT_METHOD', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({
          data: { id: 'i4', code: 'PAGO_MOVIL', label: 'Pago móvil', sortOrder: 4, isActive: true },
        });
      }),
    );
    renderIt();

    await userEvent.type(screen.getByLabelText('Nuevo ítem'), 'Pago móvil');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(enviado).toEqual({ code: 'PAGO_MOVIL', label: 'Pago móvil', sortOrder: 4 });
    expect(await screen.findByDisplayValue('Pago móvil')).toBeInTheDocument();
    expect(screen.getByLabelText('Nuevo ítem')).toHaveValue('');
  });

  it('muestra el mensaje del servidor si rechaza el cambio', async () => {
    server.use(
      http.patch('*/api/catalogs/PAYMENT_METHOD/i1', () =>
        HttpResponse.json({ error: { code: 'X', message: 'No tienes permiso' } }, { status: 403 }),
      ),
    );
    renderIt();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Activo: Efectivo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
  });

  it('cambiar de catálogo navega con ?c=', async () => {
    renderIt();
    await userEvent.selectOptions(screen.getByLabelText('Catálogo'), 'BANK');
    expect(push).toHaveBeenCalledWith('/cuenta/catalogos?c=BANK');
  });

  it('sin catalog:write es de lectura: no hay campos, ni agregar, ni reordenar', () => {
    renderIt(['catalog:read']);
    expect(screen.queryByLabelText(/Nombre del ítem/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subir/ })).not.toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
  });
});
