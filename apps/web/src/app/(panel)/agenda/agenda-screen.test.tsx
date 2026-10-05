import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgendaListItem, Member } from '@kobrax/shared';
import { AgendaScreen, type AgendaEvents } from './agenda-screen';

const push = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/agenda',
  useSearchParams: () => new URLSearchParams(search),
}));

function item(over: Partial<AgendaListItem>): AgendaListItem {
  return {
    id: 'i1', clientId: 'c1', creditId: 'cr1', assigneeId: 'u1', type: 'CALL' as never, status: 'SCHEDULED' as never,
    scheduledDate: '2026-10-04', timeMode: 'FIXED' as never, scheduledTime: '09:00', details: {},
    clientName: 'María López', creditCode: 'C-12345', creditSituation: 'IN_ARREARS', daysPastDue: 45,
    category: { code: 'B', name: 'Cat B' }, balance: 2450, currency: 'BOB', assigneeName: 'Carlos Rojas',
    isOverdue: false, createdAt: '', updatedAt: '', ...over,
  };
}

const ITEMS: AgendaListItem[] = [
  item({ id: 'i1' }),
  item({ id: 'i2', scheduledTime: '09:30', clientName: 'Juan Pérez', creditCode: 'C-67890', type: 'VISIT' as never }),
  item({ id: 'i3', scheduledTime: '11:00', clientName: 'Ana Torres', creditCode: 'C-98765', status: 'EXECUTED' as never, assigneeId: 'u2', assigneeName: 'Ana Martínez' }),
  item({ id: 'i4', timeMode: 'LAPSE' as never, scheduledTime: undefined, timeSlot: 'MORNING', clientName: 'Luis Mendoza', creditCode: 'C-11111', creditSituation: 'CURRENT', daysPastDue: 0, category: undefined }),
  item({ id: 'i5', scheduledTime: '14:00', clientName: 'Rosa Gómez', creditCode: 'C-22222', status: 'CANCELLED' as never }),
];

const MEMBERS = [
  { userId: 'u1', firstName: 'Carlos', lastName: 'Rojas', email: 'c@x.com' },
  { userId: 'u2', firstName: 'Ana', lastName: 'Martínez', email: 'a@x.com' },
] as unknown as Member[];

const events: AgendaEvents = {
  onCreateRequest: vi.fn(),
  onViewRequest: vi.fn(),
  onCompleteRequest: vi.fn(),
  onRescheduleRequest: vi.fn(),
  onCancelRequest: vi.fn(),
};

function renderScreen(over: Partial<Parameters<typeof AgendaScreen>[0]> = {}) {
  return render(
    <AgendaScreen
      day="2026-10-04"
      today="2026-10-04"
      items={ITEMS}
      monthItems={[...ITEMS, item({ id: 'm1', scheduledDate: '2026-10-06' })]}
      overdue={[]}
      overdueTotal={0}
      members={MEMBERS}
      supervises
      events={events}
      {...over}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  search = '';
  vi.clearAllMocks();
});

describe('AgendaScreen (día)', () => {
  it('cabecera: título, subtítulo de equipo, Día/Mes, selector de equipo y Nueva tarea', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Agenda', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Lo agendado por tu equipo, día por día.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Día' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mes' })).not.toBeChecked();
    expect(screen.getByText('Mi equipo')).toBeInTheDocument();
    expect(screen.getByText('2 cobradores')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nueva tarea' })).toBeInTheDocument();
  });

  it('sin permiso de equipo: subtítulo propio y sin selector de cobrador', () => {
    renderScreen({ supervises: false, members: [] });
    expect(screen.getByText('Lo agendado para vos.')).toBeInTheDocument();
    expect(screen.getByText('Mis gestiones')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cobrador')).toBeNull();
  });

  it('agrupa por hora con la cuenta de actividades, y las de franja en su propia banda', () => {
    renderScreen();
    const g9 = screen.getByRole('region', { name: '09:00' });
    expect(within(g9).getByText('2 actividades')).toBeInTheDocument();
    expect(within(g9).getAllByTestId('agenda-row')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: '11:00' })).getByText('1 actividad')).toBeInTheDocument();
    const manana = screen.getByRole('region', { name: 'Mañana' });
    expect(within(manana).getByText('Luis Mendoza · Crédito #C-11111')).toBeInTheDocument();
    // Orden de las bandas: horas, luego franjas.
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toEqual(['09:00', '11:00', '14:00', 'Mañana']);
  });

  it('la fila muestra título por tipo, situación, categoría, días, saldo y cobrador', () => {
    renderScreen();
    const row = within(screen.getByRole('region', { name: '09:00' })).getAllByTestId('agenda-row')[0]!;
    expect(within(row).getByText('Llamada')).toBeInTheDocument();
    expect(within(row).getByText('María López · Crédito #C-12345')).toBeInTheDocument();
    expect(within(row).getByText('En mora')).toBeInTheDocument();
    expect(within(row).getByText('Categoría B · 45 días de mora')).toBeInTheDocument();
    expect(row.textContent).toMatch(/Bs\s?2\.?450,00/);
    expect(within(row).getByText('Carlos Rojas')).toBeInTheDocument();
    expect(within(row).getByText('09:00')).toBeInTheDocument();
  });

  it('un crédito al día se rotula «Al día»', () => {
    renderScreen();
    expect(within(screen.getByRole('region', { name: 'Mañana' })).getByText('Al día')).toBeInTheDocument();
  });

  it('resumen del día: pendientes, completadas y reagendadas o canceladas (sin «en proceso»)', () => {
    renderScreen();
    const card = screen.getByRole('region', { name: 'Resumen del día' });
    expect(within(card).getByText('5 actividades')).toBeInTheDocument();
    expect(within(card).getByText('Pendientes').previousSibling).toHaveTextContent('3');
    expect(within(card).getByText('Completadas').previousSibling).toHaveTextContent('1');
    expect(within(card).getByText('Reprogramadas o canceladas').previousSibling).toHaveTextContent('1');
    expect(screen.queryByText(/en proceso/i)).toBeNull();
  });

  it('el mini calendario pinta un punto bajo los días con gestiones y marca el elegido', () => {
    renderScreen();
    const cal = screen.getByRole('region', { name: 'Calendario del mes' });
    const sel = within(cal).getByRole('button', { name: 'domingo, 4 de octubre', pressed: true });
    expect(within(sel).getByTestId('day-dot')).toBeInTheDocument();
    const d6 = within(cal).getByRole('button', { name: 'martes, 6 de octubre' });
    expect(within(d6).getByTestId('day-dot')).toBeInTheDocument();
    const d7 = within(cal).getByRole('button', { name: 'miércoles, 7 de octubre' });
    expect(within(d7).queryByTestId('day-dot')).toBeNull();
  });

  it('elegir un día del mini calendario cambia el parámetro date', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'martes, 6 de octubre' }));
    expect(push).toHaveBeenCalledWith('/agenda?date=2026-10-06');
  });

  it('el botón Hoy y las flechas navegan por días', async () => {
    renderScreen({ day: '2026-10-07' });
    await userEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    expect(push).toHaveBeenLastCalledWith('/agenda?date=2026-10-06');
    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(push).toHaveBeenLastCalledWith('/agenda?date=2026-10-04');
  });
});

describe('AgendaScreen (filtros y orden)', () => {
  it('la búsqueda filtra en el navegador por deudor o código y actualiza el resumen', async () => {
    renderScreen();
    await userEvent.type(screen.getByRole('searchbox'), 'c-67890');
    expect(screen.getAllByTestId('agenda-row')).toHaveLength(1);
    expect(screen.getByText('Juan Pérez · Crédito #C-67890')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resumen del día' })).getByText('1 actividad')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); // el texto no viaja a la URL
  });

  it('el filtro de estado se aplica sobre lo que llegó', async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText('Todos los estados'), 'EXECUTED');
    // El estado vive en la URL: el router recibe el parámetro.
    expect(push).toHaveBeenCalledWith('/agenda?estado=EXECUTED');
  });

  it('con ?estado y ?tipo en la URL sólo quedan las que coinciden, y Limpiar los quita', async () => {
    search = 'tipo=VISIT';
    renderScreen();
    expect(screen.getAllByTestId('agenda-row')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(push).toHaveBeenCalledWith('/agenda?');
  });

  it('un filtro sin resultados lo dice, no ofrece agendar', async () => {
    renderScreen();
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Ninguna gestión coincide con los filtros.')).toBeInTheDocument();
  });

  it('ordenar por tipo agrupa en bandas por tipo de gestión', async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText('Ordenar'), 'type');
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toEqual(['Llamada', 'Visita']);
  });

  it('ordenar por cobrador agrupa por nombre', async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText('Ordenar'), 'assignee');
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toEqual(['Ana Martínez', 'Carlos Rojas']);
  });

  it('el selector de equipo escribe el cobrador en la URL', async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getAllByLabelText('Equipo')[0]!, 'u2');
    expect(push).toHaveBeenCalledWith('/agenda?gestor=u2');
  });
});

describe('AgendaScreen (menú de la fila)', () => {
  async function openMenu(rowIndex: number) {
    const row = screen.getAllByTestId('agenda-row')[rowIndex]!;
    await userEvent.click(within(row).getByRole('button', { name: 'Acciones de la gestión' }));
    return screen.getByRole('menu');
  }

  it('una pendiente ofrece ver, registrar la ejecución, reagendar y cancelar', async () => {
    renderScreen();
    const menu = await openMenu(0);
    const names = within(menu).getAllByRole('menuitem').map((m) => m.textContent);
    expect(names).toEqual(['Ver la gestión', 'Registrar la ejecución', 'Reagendar', 'Cancelar']);
  });

  it('cada opción pide lo suyo', async () => {
    renderScreen();
    await userEvent.click(within(await openMenu(0)).getByRole('menuitem', { name: 'Reagendar' }));
    expect(events.onRescheduleRequest).toHaveBeenCalledWith('i1');
    await userEvent.click(within(await openMenu(0)).getByRole('menuitem', { name: 'Cancelar' }));
    expect(events.onCancelRequest).toHaveBeenCalledWith('i1');
    await userEvent.click(within(await openMenu(0)).getByRole('menuitem', { name: 'Registrar la ejecución' }));
    expect(events.onCompleteRequest).toHaveBeenCalledWith('i1');
    await userEvent.click(within(await openMenu(0)).getByRole('menuitem', { name: 'Ver la gestión' }));
    expect(events.onViewRequest).toHaveBeenCalledWith('i1');
  });

  it('una ejecutada sólo se puede abrir', async () => {
    renderScreen();
    // Orden por hora: 09:00, 09:30, 11:00 (ejecutada).
    const names = within(await openMenu(2)).getAllByRole('menuitem').map((m) => m.textContent);
    expect(names).toEqual(['Ver la gestión']);
  });

  it('Esc cierra el menú', async () => {
    renderScreen();
    await openMenu(0);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('AgendaScreen (vencidas y mes)', () => {
  it('las vencidas usan la misma fila, arriba del día, con su fecha', () => {
    renderScreen({
      overdue: [item({ id: 'o1', scheduledDate: '2026-09-28', isOverdue: true, clientName: 'Pedro Vargas', creditCode: 'C-44444' })],
      overdueTotal: 1,
    });
    const panel = screen.getByRole('region', { name: 'Vencidas' });
    expect(within(panel).getByText('Pedro Vargas · Crédito #C-44444')).toBeInTheDocument();
    expect(within(panel).getByText('Vencida')).toBeInTheDocument();
  });

  it('Día/Mes: pasar a Mes escribe view=calendar y conserva lo demás', async () => {
    search = 'date=2026-10-04&gestor=u1';
    renderScreen();
    await userEvent.click(screen.getByRole('radio', { name: 'Mes' }));
    expect(push).toHaveBeenCalledWith('/agenda?date=2026-10-04&gestor=u1&view=calendar');
  });

  it('en vista Mes se dibuja el calendario grande y no la lista del día', () => {
    search = 'view=calendar';
    renderScreen();
    expect(screen.getByRole('radio', { name: 'Mes' })).toBeChecked();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });
});
