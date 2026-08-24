import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { WhatsappTemplates, type TemplateItem } from './whatsapp-templates';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ITEMS: TemplateItem[] = [
  { id: 't1', code: 'recordatorio', label: 'Recordatorio de pago', metadata: { body: 'Hola {{cliente}}, debe {{saldo}}' } },
];

function renderIt(items = ITEMS, permissions = ['catalog:read', 'catalog:write']) {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <WhatsappTemplates items={items} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

describe('WhatsappTemplates', () => {
  it('crear manda label y el cuerpo en metadata.body — el contrato que el móvil ya lee', async () => {
    let enviado: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/catalogs/WHATSAPP_TEMPLATE', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 't2' } });
      }),
    );

    renderIt();
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Promesa vencida');
    // Sin llaves acá: `{{` es sintaxis especial de userEvent.type. El cuerpo con variables lo
    // cubre el test del ejemplo precargado.
    await userEvent.type(screen.getByLabelText(/^Mensaje/), 'Le escribimos por su cuota pendiente.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(enviado).toMatchObject({
      label: 'Promesa vencida',
      metadata: { body: 'Le escribimos por su cuota pendiente.' },
    });
    expect(enviado!.code).toBeTruthy();
    expect(await screen.findByText('Plantilla guardada')).toBeInTheDocument();
  });

  it('editar PATCHea el ítem con el cuerpo nuevo', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/catalogs/WHATSAPP_TEMPLATE/t1', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 't1' } });
      }),
    );

    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const body = screen.getByLabelText(/^Mensaje/);
    await userEvent.clear(body);
    await userEvent.type(body, 'Nuevo cuerpo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(enviado).toMatchObject({ label: 'Recordatorio de pago', metadata: { body: 'Nuevo cuerpo' } });
  });

  it('quitar pide confirmación y recién ahí manda el DELETE', async () => {
    let borrado = false;
    server.use(
      http.delete('*/api/catalogs/WHATSAPP_TEMPLATE/t1', () => {
        borrado = true;
        return HttpResponse.json({ data: null });
      }),
    );

    renderIt();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(borrado).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText('Plantilla quitada')).toBeInTheDocument();
    expect(borrado).toBe(true);
  });

  it('sin plantillas, tocar un ejemplo abre el modal PRECARGADO — y guarda recién al confirmar', async () => {
    let enviado: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/catalogs/WHATSAPP_TEMPLATE', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: 't2' } });
      }),
    );

    renderIt([]);
    await userEvent.click(screen.getByRole('button', { name: /Recordatorio amable/ }));
    expect(enviado).toBeUndefined();
    // El cuerpo ya viene puesto: el tono se ajusta, no se tipea de cero.
    expect((screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement).value).toContain('{{cliente}}');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(enviado).toMatchObject({ label: 'Recordatorio amable' });
  });

  it('sin catalog:write se lee y no se toca: ni agregar, ni editar, ni quitar', () => {
    renderIt(ITEMS, ['catalog:read']);
    expect(screen.getByText('Recordatorio de pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Agregar plantilla' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });
});
