import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { EDITABLE_CATALOGS, type CatalogRow, type EditableCatalog } from '@/lib/catalog-editor';
import { CatalogEditor } from './catalog-editor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/cuenta/catalogos',
}));

const ROWS: CatalogRow[] = [
  { id: 'i1', code: 'CASH', label: 'Efectivo', sortOrder: 1, isActive: true, metadata: { description: 'Dinero en mano' } },
  { id: 'i2', code: 'QR', label: 'Transferencia QR', sortOrder: 2, isActive: true },
  { id: 'i3', code: 'CHEQUE', label: 'Cheque', sortOrder: 3, isActive: false },
];

const PAYMENTS: CatalogRow[] = [
  { id: 'p1', code: 'DEPOSIT', label: 'Depósito', sortOrder: 1, isActive: true, metadata: { requiresBank: true } },
  { id: 'p2', code: 'GIRO_RARO', label: 'Giro raro', sortOrder: 2, isActive: true },
];

function listsWith(overrides: Partial<Record<EditableCatalog, CatalogRow[]>> = {}) {
  return Object.fromEntries(EDITABLE_CATALOGS.map((c) => [c, overrides[c] ?? []])) as Record<EditableCatalog, CatalogRow[]>;
}

function renderIt(permissions = ['catalog:read', 'catalog:write'], catalog: EditableCatalog = 'BANK') {
  return render(
    <PermissionsProvider permissions={permissions}>
      <ToastProvider>
        <CatalogEditor catalog={catalog} lists={listsWith({ BANK: ROWS, PAYMENT_METHOD: PAYMENTS })} />
      </ToastProvider>
    </PermissionsProvider>,
  );
}

/** Captura el cuerpo de un PATCH a una opción y responde con la opción cambiada. */
function capturePatch(catalog: string, id: string, sink: unknown[], base: CatalogRow) {
  return http.patch(`*/api/catalogs/${catalog}/${id}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    sink.push(body);
    return HttpResponse.json({ data: { ...base, ...body } });
  });
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

describe('CatalogEditor · lista y búsqueda', () => {
  it('lista los catálogos con su cantidad y las opciones del abierto, con código y descripción', () => {
    renderIt();
    expect(screen.getByRole('button', { name: /Bancos/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Bancos/ })).toHaveTextContent('2 opciones');
    expect(screen.getByRole('heading', { name: 'Bancos' })).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('Dinero en mano')).toBeInTheDocument();
    expect(screen.getByText('CHEQUE')).toBeInTheDocument();
    expect(screen.getByText('10 catálogos')).toBeInTheDocument();
  });

  it('elegir otro catálogo cambia el panel sin pedir nada al servidor', async () => {
    renderIt();
    await userEvent.click(screen.getByRole('button', { name: /Medios de pago/ }));
    expect(screen.getByRole('heading', { name: 'Medios de pago' })).toBeInTheDocument();
    expect(screen.getByText('Depósito')).toBeInTheDocument();
    expect(screen.queryByText('Efectivo')).not.toBeInTheDocument();
  });

  it('buscar un catálogo filtra la lista de la izquierda', async () => {
    renderIt();
    await userEvent.type(screen.getByLabelText('Buscar catálogo…'), 'canc');
    expect(screen.getByRole('button', { name: /Motivos de cancelación/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bancos/ })).not.toBeInTheDocument();
  });

  it('buscar una opción y filtrar por estado recorta la tabla y apaga el reordenamiento', async () => {
    renderIt();
    await userEvent.type(screen.getByLabelText('Buscar opción…'), 'cheq');
    expect(screen.getByText('Cheque')).toBeInTheDocument();
    expect(screen.queryByText('Efectivo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Arrastrar/ })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Buscar opción…'));
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'inactive');
    expect(screen.getByText('Cheque')).toBeInTheDocument();
    expect(screen.queryByText('Efectivo')).not.toBeInTheDocument();
  });
});

describe('CatalogEditor · estado, edición y orden', () => {
  it('desactivar manda isActive:false y NO borra', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('BANK', 'i1', enviados, ROWS[0]!));
    renderIt();
    await userEvent.click(screen.getByRole('switch', { name: 'Activo: Efectivo' }));
    expect(enviados).toEqual([{ isActive: false }]);
    expect(await screen.findByRole('switch', { name: 'Activo: Efectivo' })).toHaveAttribute('aria-checked', 'false');
  });

  it('editar desde el menú: el código queda fijo y se conserva el resto de metadata', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('BANK', 'i1', enviados, ROWS[0]!));
    renderIt();
    await userEvent.click(within(rowOf('Efectivo')).getByText('Editar'));

    const modal = within(screen.getByRole('dialog', { name: 'Editar opción' }));
    expect(modal.getByLabelText(/^Código/)).toBeDisabled();
    expect(modal.getByLabelText(/^Código/)).toHaveValue('CASH');
    const name = modal.getByLabelText(/^Nombre/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Efectivo en caja');
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));

    expect(enviados).toEqual([{ label: 'Efectivo en caja', isActive: true, metadata: { description: 'Dinero en mano' } }]);
    expect(await screen.findByText('Efectivo en caja')).toBeInTheDocument();
  });

  it('el agarre se mueve con las flechas y manda sólo los órdenes que cambian', async () => {
    const enviados: { url: string; body: unknown }[] = [];
    server.use(
      http.patch('*/api/catalogs/BANK/:id', async ({ request, params }) => {
        enviados.push({ url: String(params.id), body: await request.json() });
        return HttpResponse.json({ data: {} });
      }),
    );
    renderIt();
    screen.getByRole('button', { name: /^Arrastrar Efectivo/ }).focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(enviados).toEqual(
      expect.arrayContaining([
        { url: 'i1', body: { sortOrder: 2 } },
        { url: 'i2', body: { sortOrder: 1 } },
      ]),
    );
    const names = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(names.findIndex((n) => n.includes('Transferencia QR'))).toBeLessThan(names.findIndex((n) => n.includes('Efectivo')));
  });

  it('arrastrar una fila sobre otra la reordena', async () => {
    const enviados: unknown[] = [];
    server.use(
      http.patch('*/api/catalogs/BANK/:id', async ({ request }) => {
        enviados.push(await request.json());
        return HttpResponse.json({ data: {} });
      }),
    );
    renderIt();
    fireEvent.dragStart(rowOf('Cheque'));
    fireEvent.dragOver(rowOf('Efectivo'));
    fireEvent.drop(rowOf('Efectivo'));

    await vi.waitFor(() => expect(enviados).toHaveLength(3));
    expect(enviados).toEqual(expect.arrayContaining([{ sortOrder: 1 }, { sortOrder: 2 }, { sortOrder: 3 }]));
  });

  it('si el servidor rechaza el reordenamiento, se vuelve al orden de antes y se avisa', async () => {
    server.use(http.patch('*/api/catalogs/BANK/:id', () => HttpResponse.json({ error: { code: 'X', message: 'no' } }, { status: 500 })));
    renderIt();
    screen.getByRole('button', { name: /^Arrastrar Efectivo/ }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo reordenar');
    const names = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(names.findIndex((n) => n.includes('Efectivo'))).toBeLessThan(names.findIndex((n) => n.includes('Transferencia QR')));
  });

  it('muestra el mensaje del servidor si rechaza el cambio', async () => {
    server.use(http.patch('*/api/catalogs/BANK/i1', () => HttpResponse.json({ error: { code: 'X', message: 'No tienes permiso' } }, { status: 403 })));
    renderIt();
    await userEvent.click(screen.getByRole('switch', { name: 'Activo: Efectivo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
  });
});

describe('CatalogEditor · agregar opción', () => {
  async function openAdd() {
    await userEvent.click(screen.getByRole('button', { name: 'Agregar opción' }));
    return within(screen.getByRole('dialog', { name: 'Agregar opción' }));
  }

  it('muestra el catálogo, genera el código del nombre y crea la opción al final', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/catalogs/BANK', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'i4', code: 'PAGO_MOVIL', label: 'Pago móvil', sortOrder: 4, isActive: true } });
      }),
    );
    renderIt();
    const modal = await openAdd();

    expect(modal.getByText('Bancos')).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Pago móvil');
    expect(modal.getByLabelText(/^Código/)).toHaveValue('PAGO_MOVIL');
    expect(modal.getByText('10/120')).toBeInTheDocument();
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));

    expect(enviado).toEqual({ code: 'PAGO_MOVIL', label: 'Pago móvil', isActive: true, sortOrder: 4 });
    expect(await screen.findByText('Pago móvil')).toBeInTheDocument();
  });

  it('un código repetido o mal escrito bloquea Guardar y lo dice junto al campo', async () => {
    renderIt();
    const modal = await openAdd();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Otro');

    const code = modal.getByLabelText(/^Código/);
    await userEvent.clear(code);
    await userEvent.type(code, 'cash');
    expect(code).toHaveValue('CASH');
    expect(modal.getByText('Ya existe una opción con ese código en este catálogo.')).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();

    await userEvent.clear(code);
    await userEvent.type(code, 'A-B');
    expect(modal.getByText(/Usa solo mayúsculas/)).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('si la API responde 409 por el código, el error queda en el campo', async () => {
    server.use(http.post('*/api/catalogs/BANK', () => HttpResponse.json({ error: { code: 'CATALOG_CODE_DUPLICATE', message: 'dup' } }, { status: 409 })));
    renderIt();
    const modal = await openAdd();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Pago móvil');
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));
    expect(await modal.findByText('Ya existe una opción con ese código en este catálogo.')).toBeInTheDocument();
  });

  it('manda la descripción en metadata y el estado inactivo', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/catalogs/BANK', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'i4', code: 'GIRO', label: 'Giro', sortOrder: 4, isActive: false, metadata: { description: 'Por agencia' } } });
      }),
    );
    renderIt();
    const modal = await openAdd();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Giro');
    await userEvent.type(modal.getByLabelText(/^Descripción/), 'Por agencia');
    await userEvent.click(modal.getByRole('switch', { name: 'Activo' }));
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));

    expect(enviado).toEqual({ code: 'GIRO', label: 'Giro', isActive: false, sortOrder: 4, metadata: { description: 'Por agencia' } });
    expect(await screen.findByText('Por agencia')).toBeInTheDocument();
  });

  it('Cancelar cierra sin crear nada', async () => {
    let llamado = false;
    server.use(
      http.post('*/api/catalogs/BANK', () => {
        llamado = true;
        return HttpResponse.json({});
      }),
    );
    renderIt();
    const modal = await openAdd();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Algo');
    await userEvent.click(modal.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Agregar opción' })).not.toBeInTheDocument();
    expect(llamado).toBe(false);
  });
});

describe('CatalogEditor · medios de pago (se registra como)', () => {
  async function openAdd() {
    await userEvent.click(screen.getByRole('button', { name: 'Agregar opción' }));
    return within(screen.getByRole('dialog', { name: 'Agregar opción' }));
  }

  it('cada medio dice con qué método se registra, o avisa que falta', () => {
    renderIt(['catalog:read', 'catalog:write'], 'PAYMENT_METHOD');
    expect(within(rowOf('Depósito')).getByText('Se registra como: Transferencia')).toBeInTheDocument();
    expect(within(rowOf('Giro raro')).getByText(/Sin método del libro/)).toBeInTheDocument();
  });

  it('Guardar exige el método del libro', async () => {
    let enviado: unknown;
    server.use(
      http.post('*/api/catalogs/PAYMENT_METHOD', async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ data: { id: 'p3', code: 'GIRO', label: 'Giro', sortOrder: 3, isActive: true } });
      }),
    );
    renderIt(['catalog:read', 'catalog:write'], 'PAYMENT_METHOD');
    const modal = await openAdd();

    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Giro');
    expect(modal.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    await userEvent.selectOptions(modal.getByLabelText(/^Se registra como/), 'TRANSFER');
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));

    expect(enviado).toEqual({ code: 'GIRO', label: 'Giro', isActive: true, sortOrder: 3, metadata: { ledgerMethod: 'TRANSFER' } });
  });

  it('un código sembrado propone su método (MOBILE → pago móvil)', async () => {
    renderIt(['catalog:read', 'catalog:write'], 'PAYMENT_METHOD');
    const modal = await openAdd();
    await userEvent.type(modal.getByLabelText(/^Nombre/), 'Mobile');
    expect(modal.getByLabelText(/^Se registra como/)).toHaveValue('MOBILE_PAYMENT');
    expect(modal.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('editar uno sin método lo obliga a elegirlo y conserva el resto de metadata', async () => {
    const enviados: unknown[] = [];
    server.use(capturePatch('PAYMENT_METHOD', 'p1', enviados, PAYMENTS[0]!));
    renderIt(['catalog:read', 'catalog:write'], 'PAYMENT_METHOD');
    await userEvent.click(within(rowOf('Depósito')).getByText('Editar'));
    const modal = within(screen.getByRole('dialog', { name: 'Editar opción' }));
    expect(modal.getByLabelText(/^Se registra como/)).toHaveValue('TRANSFER');
    await userEvent.selectOptions(modal.getByLabelText(/^Se registra como/), 'QR');
    await userEvent.click(modal.getByRole('button', { name: 'Guardar' }));
    expect(enviados).toEqual([{ label: 'Depósito', isActive: true, metadata: { requiresBank: true, ledgerMethod: 'QR' } }]);
  });
});

describe('CatalogEditor · permisos', () => {
  it('sin catalog:write es de lectura: no hay agregar, ni acciones, ni agarre, ni interruptor activo', () => {
    renderIt(['catalog:read']);
    expect(screen.queryByRole('button', { name: 'Agregar opción' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Arrastrar/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Editar')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Activo: Efectivo' })).toBeDisabled();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('Sólo un administrador puede cambiar estas listas.')).toBeInTheDocument();
  });
});
