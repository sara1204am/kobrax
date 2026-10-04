import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MoraCreditListItem } from '@kobrax/shared';
import { ArrearsTable } from './arrears-table';

const { push, replace, search } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => '/mora',
  useSearchParams: () => new URLSearchParams(search.value),
}));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
// `PriorityCell` y `BulkActions` hablan con el BFF: acá sólo importa qué reciben, no lo que hacen.
vi.mock('./priority-cell', () => ({
  PriorityCell: (p: { creditId: string; priority: string; pinned?: boolean }) => (
    <span data-testid="prio">{`${p.creditId}:${p.priority}${p.pinned ? ':pinned' : ''}`}</span>
  ),
}));
vi.mock('./bulk-actions', () => ({
  BulkActions: (p: { ids: string[] }) => <span data-testid="bulk">{p.ids.join(',')}</span>,
}));
vi.mock('@/components/situation-badge', () => ({
  SituationBadge: (p: { situation: string; category?: { code: string }; writtenOff: boolean }) => (
    <span data-testid="situation">{[p.situation, p.category?.code, p.writtenOff ? 'WRITTEN_OFF' : ''].filter(Boolean).join('|')}</span>
  ),
}));

const META = { total: 3, page: 1, limit: 25, pages: 1 };

function credit(over: Partial<MoraCreditListItem> = {}): MoraCreditListItem {
  return {
    creditId: 'cr-1',
    code: '302-222-9734',
    clientId: 'cl-1',
    clientName: 'Juan Pérez',
    currency: 'BOB',
    balance: 7011.42,
    daysPastDue: 45,
    arrearsSource: 'CALCULATED',
    hasActivePromise: false,
    situation: 'IN_ARREARS',
    writtenOff: false,
    priorityPinned: false,
    ...over,
  };
}

function renderTable(rows: MoraCreditListItem[], props: Partial<React.ComponentProps<typeof ArrearsTable>> = {}) {
  return render(
    <ArrearsTable
      rows={rows}
      meta={META}
      members={[{ userId: 'u1', firstName: 'Carlos', lastName: 'Mamani' } as never]}
      currency="BOB"
      filtered={false}
      userId="me"
      showAssignee
      canWrite
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  search.value = '';
  localStorage.clear();
  toast.mockClear();
});

describe('ArrearsTable — una fila por crédito', () => {
  it('🔴 un cliente con varios créditos en mora sale como registros independientes', () => {
    renderTable([
      credit({ creditId: 'cr-2', code: 'C-002', daysPastDue: 45 }),
      credit({ creditId: 'cr-3', code: 'C-003', daysPastDue: 120 }),
    ]);
    expect(screen.getByText('C-002')).toBeInTheDocument();
    expect(screen.getByText('C-003')).toBeInTheDocument();
    // El mismo deudor, dos filas.
    expect(screen.getAllByText('Juan Pérez')).toHaveLength(2);
  });

  it('la primera columna es el Nº de crédito y lleva a su ficha por id de crédito', () => {
    renderTable([credit()]);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[headers.length > 1 && /Nº de crédito/.test(headers[0]!.textContent ?? '') ? 0 : 1]!.textContent).toMatch(/Nº de crédito/);
    const link = screen.getByRole('link', { name: '302-222-9734' });
    expect(link).toHaveAttribute('href', '/mora/cr-1');
  });

  it('un crédito sin código muestra «sin código» pero igual lleva a su ficha', () => {
    renderTable([credit({ code: undefined })]);
    expect(screen.getByRole('link', { name: /sin código/i })).toHaveAttribute('href', '/mora/cr-1');
  });
});

describe('ArrearsTable — ausente no es cero', () => {
  it('🔴 sin monto vencido muestra «—», no Bs 0', () => {
    renderTable([credit({ overdueAmount: undefined })]);
    const row = screen.getByRole('link', { name: '302-222-9734' }).closest('tr')!;
    expect(within(row).queryByText(/0,00/)).toBeNull();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('un monto vencido conocido se muestra', () => {
    renderTable([credit({ overdueAmount: 820.5, overdueSource: 'REPORTED' })]);
    expect(screen.getByTitle('Lo que reportó el archivo')).toHaveTextContent(/820/);
  });

  it('un importado que no trajo el saldo muestra «—» en el saldo', () => {
    renderTable([credit({ balance: undefined })]);
    const row = screen.getByRole('link', { name: '302-222-9734' }).closest('tr')!;
    expect(within(row).queryByText(/Bs/)).toBeNull();
  });
});

describe('ArrearsTable — situación, prioridad y responsable (sin caso)', () => {
  it('🔴 la situación y la categoría salen de la API, y castigado va aparte', () => {
    renderTable([credit({ category: { code: 'B', name: 'B' }, writtenOff: true })]);
    expect(screen.getByTestId('situation')).toHaveTextContent('IN_ARREARS|B|WRITTEN_OFF');
  });

  it('un crédito al día se ve con «Al día» y sin prioridad que cambiar', () => {
    renderTable([credit({ situation: 'CURRENT', daysPastDue: 0, priority: undefined })], { filtered: true });
    expect(screen.getByTestId('situation')).toHaveTextContent('CURRENT');
    expect(screen.queryByTestId('prio')).toBeNull();
  });

  it('la prioridad es la del episodio, se cambia por crédito y muestra el pin', () => {
    renderTable([credit({ priority: 'CRITICAL', priorityPinned: true })]);
    expect(screen.getByTestId('prio')).toHaveTextContent('cr-1:CRITICAL:pinned');
  });

  it('el responsable sale de responsibleId; sin nombre dice «Asignado», no el id', () => {
    renderTable([credit({ responsibleId: 'u1' }), credit({ creditId: 'cr-2', code: 'C-2', responsibleId: 'desconocido' })]);
    expect(screen.getByText('Carlos Mamani')).toBeInTheDocument();
    expect(screen.getByText('Asignado')).toBeInTheDocument();
    expect(screen.queryByText('desconocido')).toBeNull();
  });

  it('la última gestión es la fecha, sin etiquetas de estado; ya no hay columnas de caso ni de SLA', () => {
    renderTable([credit({ lastActionAt: '2026-10-03T15:00:00.000Z', hasActivePromise: true })]);
    expect(screen.getByRole('columnheader', { name: /Última gestión/ })).toBeInTheDocument();
    for (const name of [/Estado de gestión/, /Vence/, /Sin caso/]) expect(screen.queryByRole('columnheader', { name })).toBeNull();
    expect(screen.queryByText(/En gestión|Promesa incumplida|Sin gestión|Sin caso/)).toBeNull();
  });
});

describe('ArrearsTable — columnas opcionales apagadas por defecto', () => {
  it('el estado en origen y la oficina no se ven hasta prenderlos', () => {
    renderTable([credit({ reportedStatus: 'Ejecución' })]);
    expect(screen.queryByText('Ejecución')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Estado en origen/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Oficina/ })).toBeNull();
  });
});

describe('ArrearsTable — acciones en lote por crédito', () => {
  it('pasa los ids de crédito elegidos, sin traducir a casos ni dejar a nadie afuera', async () => {
    renderTable([credit({ creditId: 'a', code: 'A' }), credit({ creditId: 'b', code: 'B', situation: 'CURRENT', daysPastDue: 0 })]);
    await userEvent.click(screen.getByLabelText(/Elegir todos los de esta página/i));
    expect(screen.getByTestId('bulk')).toHaveTextContent('a,b');
    expect(screen.queryByText(/sin caso|no tiene caso/i)).toBeNull();
  });
});

describe('ArrearsTable — filtros', () => {
  const CATEGORIES = [
    { id: '1', code: 'A', name: 'Temprana', fromDays: 1, toDays: 30, color: '#0a0', sortOrder: 1 },
    { id: '2', code: 'B', name: 'B', fromDays: 31, toDays: null, color: null, sortOrder: 2 },
  ];

  it('quien reparte ve responsable y sin responsable; ya no hay filtros del caso ni de SLA', async () => {
    renderTable([credit()], { showAssignee: true });
    await userEvent.click(screen.getByRole('button', { name: /Filtros/i }));
    expect(screen.getByText('Créditos sin responsable')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Responsable' })).toBeInTheDocument();
    for (const gone of ['Caso', 'Tiempo de gestión', 'Estado']) expect(screen.queryByText(gone)).toBeNull();
  });

  it('el cobrador no ve los de reparto: la API ya lo acota a lo suyo', async () => {
    renderTable([credit()], { showAssignee: false });
    await userEvent.click(screen.getByRole('button', { name: /Filtros/i }));
    expect(screen.queryByText('Créditos sin responsable')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Responsable' })).toBeNull();
  });

  it('🔴 la categoría se ofrece con lo que configuró la cuenta, no con una lista fija; sin categorías no hay filtro', async () => {
    renderTable([credit()], { categories: CATEGORIES });
    await userEvent.click(screen.getByRole('button', { name: /Filtros/i }));
    const combo = screen.getByRole('combobox', { name: 'Categoría de mora' });
    expect(within(combo).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', 'A · Temprana', 'B']);
  });

  it('sin categorías configuradas no se dibuja el filtro de categoría', async () => {
    renderTable([credit()], { categories: [] });
    await userEvent.click(screen.getByRole('button', { name: /Filtros/i }));
    expect(screen.queryByRole('combobox', { name: 'Categoría de mora' })).toBeNull();
  });

  it('castigo, prioridad, fuente y «incluir los que están al día» siguen', async () => {
    renderTable([credit()]);
    await userEvent.click(screen.getByRole('button', { name: /Filtros/i }));
    const castigo = screen.getByRole('combobox', { name: 'Castigo' });
    expect(within(castigo).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', 'Sólo castigados', 'Sin castigados']);
    expect(screen.getByRole('combobox', { name: 'Prioridad' })).toBeInTheDocument();
    expect(screen.getByText('Incluir los que están al día')).toBeInTheDocument();
  });
});

describe('ArrearsTable — exportar', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // jsdom no navega: el clic del enlace de descarga sólo hace ruido.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('sin collection:export no se dibujan los botones', () => {
    renderTable([credit()], { canExport: false });
    expect(screen.queryByRole('button', { name: /Exportar CSV/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).toBeNull();
  });

  it('🔴 baja exactamente lo que se ve: filtros y orden de la URL, sin la página', async () => {
    search.value = 'priority=CRITICAL&dpdMin=90&sort=balance&dir=asc&page=3&pageSize=100';
    fetchMock.mockResolvedValue(new Response('a,b', { status: 200, headers: { 'content-disposition': 'attachment; filename="creditos-en-mora-2026-10-01.csv"' } }));
    renderTable([credit()], { canExport: true });
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://x');
    expect(url.pathname).toBe('/api/mora/export');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('priority')).toBe('CRITICAL');
    expect(url.searchParams.get('dpdMin')).toBe('90');
    expect(url.searchParams.get('sort')).toBe('balance');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('limit')).toBe(false);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('el PDF pide format=pdf', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF', { status: 200 }));
    renderTable([credit()], { canExport: true });
    await userEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(new URL(String(fetchMock.mock.calls[0]![0]), 'http://x').searchParams.get('format')).toBe('pdf');
  });

  it('si el filtro pasa el tope, muestra el mensaje de la API en vez de bajar un archivo roto', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'MORA_001', message: 'Este filtro devuelve 60.000 créditos y el CSV admite hasta 50.000.' } }), { status: 422 }),
    );
    renderTable([credit()], { canExport: true });
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('60.000'), 'danger'));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('sin red avisa, y los botones vuelven a estar disponibles', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    renderTable([credit()], { canExport: true });
    await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('No se pudo exportar.', 'danger'));
    expect(screen.getByRole('button', { name: /Exportar PDF/ })).toBeEnabled();
  });
});
