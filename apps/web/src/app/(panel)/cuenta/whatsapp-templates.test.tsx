import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
    await userEvent.click(screen.getByRole('button', { name: /^Editar/ }));
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
    await userEvent.click(screen.getByRole('button', { name: /^Quitar/ }));
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

  it('elegir una plantilla muestra su vista previa con datos de ejemplo, sin abrir el modal', async () => {
    renderIt();
    expect(screen.getByText('Elegí una plantilla para ver su vista previa.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Recordatorio de pago/ , pressed: false }));
    expect(screen.getByText(/Hola Juan Pérez, debe/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Mensaje/)).not.toBeInTheDocument();
  });

  it('buscar y filtrar por categoría reducen la lista', async () => {
    const items: TemplateItem[] = [
      { id: 'a', code: 'a', label: 'Cobro inicial', metadata: { body: 'Hola', category: 'INITIAL' } },
      { id: 'b', code: 'b', label: 'Último aviso', metadata: { body: 'Pague', category: 'LAST_NOTICE' } },
    ];
    renderIt(items);
    await userEvent.click(screen.getByRole('button', { name: 'Último aviso (1)' }));
    expect(screen.queryByText('Cobro inicial')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Todas (2)' }));
    await userEvent.type(screen.getByRole('searchbox'), 'cobro');
    expect(screen.queryByText('Último aviso')).not.toBeInTheDocument();
    expect(screen.getByText('Cobro inicial')).toBeInTheDocument();
  });

  it('los botones insertan la variable al principio, en medio y al final, y dejan el cursor después', async () => {
    renderIt([]);
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
    const body = screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement;
    const boton = (n: RegExp) => screen.getByRole('button', { name: n });

    // Sin foco previo: al final.
    await userEvent.click(boton(/Saldo pendiente/));
    expect(body.value).toBe('{{saldo}}');

    // Al principio.
    body.focus();
    body.setSelectionRange(0, 0);
    await userEvent.click(boton(/Nombre del deudor/));
    expect(body.value).toBe('{{cliente}}{{saldo}}');
    expect(body.selectionStart).toBe('{{cliente}}'.length);

    // En medio, y la misma variable otra vez (no se deduplica).
    await userEvent.click(boton(/Nombre del deudor/));
    expect(body.value).toBe('{{cliente}}{{cliente}}{{saldo}}');
  });

  it('con categoría, el modal sugiere mensajes en español y «Usar» los carga con su nombre', async () => {
    renderIt([]);
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
    expect(screen.getByText('Elegí una categoría para ver mensajes sugeridos.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Categoría/), 'PROMISE');
    expect(screen.getByText('Sugerencias para «Promesa»')).toBeInTheDocument();
    // El tono cambia el mensaje sugerido.
    expect(screen.getByRole('button', { name: 'Usar Recordar promesa' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Formal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usar Confirmar promesa' }));
    expect((screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement).value).toContain('confirmar su promesa de pago');
    expect((screen.getByLabelText(/Nombre/) as HTMLInputElement).value).toBe('Confirmar promesa');
    // Las sugerencias solo usan variables que el sistema llena.
    expect(screen.queryByText(/Variable desconocida/)).not.toBeInTheDocument();
  });

  it('dictar inserta el texto reconocido en el cursor; sin soporte del navegador no hay botón', async () => {
    const sinSoporte = renderIt([]);
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
    expect(screen.queryByRole('button', { name: 'Dictar' })).not.toBeInTheDocument();
    sinSoporte.unmount();

    let instancia: { onresult: (e: unknown) => void; onend: () => void } | undefined;
    class FakeRecognition {
      onresult: (e: unknown) => void = () => {};
      onend: () => void = () => {};
      start = vi.fn();
      stop = vi.fn(() => this.onend());
      constructor() {
        instancia = this;
      }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    try {
      renderIt([]);
      await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
      await userEvent.type(screen.getByLabelText(/^Mensaje/), 'Hola');
      await userEvent.click(screen.getByRole('button', { name: 'Dictar' }));
      act(() => instancia!.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: ' le escribimos hoy ' } }] }));
      expect((screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement).value).toBe('Hola le escribimos hoy');
      await userEvent.click(screen.getByRole('button', { name: 'Detener' }));
      expect(screen.getByRole('button', { name: 'Dictar' })).toBeInTheDocument();
    } finally {
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    }
  });

  it('una variable desconocida se avisa y no deja guardar', async () => {
    let enviado = false;
    server.use(
      http.post('*/api/catalogs/WHATSAPP_TEMPLATE', () => {
        enviado = true;
        return HttpResponse.json({ data: { id: 't2' } });
      }),
    );
    renderIt([]);
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar plantilla' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'X');
    await userEvent.click(screen.getByRole('button', { name: /Saldo pendiente/ }));
    await userEvent.type(screen.getByLabelText(/^Mensaje/), ' {{{{clinte}}');
    expect(screen.getAllByText(/Variable desconocida: \{\{clinte\}\}/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(enviado).toBe(false);
    expect(screen.getByText(/Corregí o quitá las variables desconocidas/)).toBeInTheDocument();
  });

  it('la categoría viaja en metadata y se conserva lo que otra plataforma haya guardado', async () => {
    let enviado: unknown;
    server.use(
      http.patch('*/api/catalogs/WHATSAPP_TEMPLATE/t1', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 't1' } });
      }),
    );
    renderIt([{ ...ITEMS[0]!, metadata: { body: 'Hola', otro: 1 } as TemplateItem['metadata'] }]);
    await userEvent.click(screen.getByRole('button', { name: /^Editar/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Categoría/), 'PROMISE');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(enviado).toMatchObject({ metadata: { body: 'Hola', category: 'PROMISE', otro: 1 } });
  });

  it('sin catalog:write se lee y no se toca: ni agregar, ni editar, ni quitar', () => {
    renderIt(ITEMS, ['catalog:read']);
    expect(screen.getByText('Recordatorio de pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Agregar plantilla' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Quitar/ })).not.toBeInTheDocument();
  });
});
