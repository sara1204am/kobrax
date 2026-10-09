import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AgendaTodaySummary } from '@kobrax/shared';
import { AgendaToday } from './agenda-today';

// Un componente de servidor pide sus textos a `next-intl/server`: se ata al diccionario real en español.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const es = (await import('@/messages/es.json')).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: 'es', messages: es, namespace }) };
});

const item = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, type: 'CALL', status: 'SCHEDULED', timeMode: 'FIXED', scheduledTime: '09:00', clientName: 'Pedro Ticona', ...over }) as never;

async function draw(summary: Partial<AgendaTodaySummary>) {
  const ui = await AgendaToday({ summary: { date: '2026-10-07', pending: 0, overdue: 0, items: [], ...summary } });
  return render(ui);
}

describe('AgendaToday (F4/11 · «¿qué tengo que hacer hoy?»)', () => {
  it('dice cuántas vencidas y cuántas pendientes hay hoy, y cada fila lleva su estado', async () => {
    await draw({ pending: 5, overdue: 3, items: [item('g1', { isOverdue: true }), item('g2', { type: 'VISIT', scheduledTime: '14:00', clientName: 'Juan Pérez' })] });
    expect(screen.getByText('Vencidas').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Pendientes hoy').nextElementSibling).toHaveTextContent('5');
    const rows = screen.getAllByRole('link', { name: /Pedro Ticona|Juan Pérez/ });
    expect(rows[0]).toHaveAttribute('href', '/agenda/g1');
    expect(within(rows[0]!).getByText('Vencida')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Pendiente')).toBeInTheDocument();
  });

  it('resume lo que no cabe en «N actividades más» y lleva a la Agenda', async () => {
    await draw({ pending: 6, items: [item('g1'), item('g2'), item('g3'), item('g4'), item('g5')] });
    // Caben 4 filas: de 6 pendientes quedan 2 por ver.
    expect(screen.getAllByRole('link', { name: /Pedro Ticona/ })).toHaveLength(4);
    expect(screen.getByRole('link', { name: /2 actividades más/ })).toHaveAttribute('href', '/agenda');
  });

  it('los atajos por tipo abren la Agenda filtrada', async () => {
    await draw({ pending: 1, items: [item('g1')] });
    expect(screen.getByRole('link', { name: 'Visitas' })).toHaveAttribute('href', '/agenda?tipo=VISIT');
    expect(screen.getByRole('link', { name: 'Promesas' })).toHaveAttribute('href', '/agenda?tipo=PROMISE_TO_PAY');
  });

  it('las vencidas van en rojo; sin vencidas, no', async () => {
    const { unmount } = await draw({ overdue: 2 });
    expect(screen.getByText('Vencidas').parentElement!.className).toContain('bg-k-danger-bg');
    unmount();
    await draw({ overdue: 0 });
    expect(screen.getByText('Vencidas').parentElement!.className).not.toContain('bg-k-danger-bg');
  });

  it('sin nada pendiente lo dice; con solo vencidas manda a revisarlas', async () => {
    const { unmount } = await draw({});
    expect(screen.getByText('No tienes nada pendiente para hoy.')).toBeInTheDocument();
    unmount();
    await draw({ overdue: 4 });
    expect(screen.getByText(/revisa las vencidas/)).toBeInTheDocument();
  });

  it('con la carga del equipo (agenda:assign) lista a cada persona y lleva a su agenda', async () => {
    await draw({ pending: 2, load: [{ assigneeId: 'u3', name: 'Rosa Aliaga', pending: 1, overdue: 5 }, { assigneeId: 'u2', name: 'Marco Villca', pending: 4, overdue: 0 }] });
    expect(screen.getByText('Carga del equipo')).toBeInTheDocument();
    const rosa = screen.getByRole('link', { name: /Rosa Aliaga/ });
    expect(rosa).toHaveAttribute('href', '/agenda?gestor=u3');
    expect(rosa).toHaveTextContent('5 vencidas');
    expect(screen.getByRole('link', { name: /Marco Villca/ })).toHaveTextContent('Sin vencidas');
  });

  it('sin carga (cobrador) no hay sección de equipo', async () => {
    await draw({ pending: 1 });
    expect(screen.queryByText('Carga del equipo')).toBeNull();
  });
});
