// ui.tsx importa el net store (NetInfo nativo) y los íconos (expo-font): acá sólo importan textos y tonos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CreditNote, MoraEpisode, MoraPromise } from '@kobrax/shared';
import { nameResolver } from './mora-ficha';
import { ActivityTimeline, EpisodesSection, NotesSection, PromisesSection, PsfNotice } from './mora-sections';

const names = (id?: string) => (id === 'me' ? 'Yo' : id ? 'Ana' : 'alguien del equipo');

const note = (over: Partial<CreditNote>): CreditNote => ({
  id: 'n1',
  creditId: 'c1',
  kind: 'INFO',
  body: 'Sólo contesta de noche',
  color: 'PINK',
  anchor: 'PAGE',
  x: 0,
  y: 0,
  w: 240,
  h: 180,
  zIndex: 1,
  authorId: 'me',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  ...over,
});

describe('NotesSection', () => {
  it('muestra tipo, autor y fecha; editar/borrar sólo en las notas propias', () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(
      <NotesSection
        notes={[note({ id: 'mine' }), note({ id: 'other', authorId: 'u2', body: 'De otra persona' })]}
        nameOf={names}
        userId="me"
        canAssign={false}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('Sólo contesta de noche')).toBeTruthy();
    expect(screen.getByText('De otra persona')).toBeTruthy();
    expect(screen.getAllByText('Informativa')).toHaveLength(2);
    expect(screen.getAllByLabelText('Editar nota')).toHaveLength(1);
    fireEvent.press(screen.getByLabelText('Editar nota'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' }));
    fireEvent.press(screen.getByLabelText('Borrar nota'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' }));
  });

  it('quien reparte cartera puede editar y borrar todas', () => {
    render(
      <NotesSection notes={[note({ id: 'a', authorId: 'u2' }), note({ id: 'b', authorId: 'u3' })]} nameOf={names} userId="me" canAssign onEdit={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(screen.getAllByLabelText('Editar nota')).toHaveLength(2);
  });

  it('null = no se pudo leer, y lo dice', () => {
    render(<NotesSection notes={null} nameOf={names} canAssign={false} onEdit={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('No se pudo cargar las notas.')).toBeTruthy();
  });
});

describe('PromisesSection', () => {
  const p = (status: MoraPromise['status'], extra: Partial<MoraPromise> = {}): MoraPromise => ({
    id: status,
    status,
    promiseDate: '2026-10-10',
    amount: 300,
    createdAt: '2026-10-01T00:00:00Z',
    ...extra,
  });

  it('resumen de summarizePromises, estado «Vencida sin cerrar» y asignado', () => {
    render(<PromisesSection promises={[p('KEPT'), p('BROKEN'), p('OVERDUE', { assigneeId: 'u2', observations: 'Llamar de tarde' })]} currency="BOB" nameOf={names} />);
    expect(screen.getByText(/3 promesas · 1 cumplidas · 1 incumplidas/)).toBeTruthy();
    expect(screen.getByText('Cumplimiento 50 %')).toBeTruthy();
    expect(screen.getByText('Vencida sin cerrar')).toBeTruthy();
    expect(screen.getByText('Ana · Llamar de tarde')).toBeTruthy();
    expect(screen.getByText('1 promesa venció sin que nadie registrara qué pasó.')).toBeTruthy();
  });
});

describe('ActivityTimeline', () => {
  it('«Resultado:» con la etiqueta del mapa único y la nota', () => {
    render(
      <ActivityTimeline activities={[{ id: 'a1', type: 'CALL', result: 'NO_ANSWER', notes: 'Sonó apagado', createdAt: '2026-10-02T10:00:00Z' }]} />,
    );
    expect(screen.getByText('Llamada')).toBeTruthy();
    expect(screen.getByText('Resultado:')).toBeTruthy();
    expect(screen.getByText(/No respondió/)).toBeTruthy();
    expect(screen.getByText('Sonó apagado')).toBeTruthy();
  });

  it('una asignación muestra a quién se asignó (nombre del servidor), no se oculta ni enseña el id', () => {
    render(
      <ActivityTimeline
        activities={[{ id: 'a3', type: 'ASSIGNMENT', notes: 'bf2e039c-1111-2222-3333-444455556666', assignedToId: 'bf2e039c-1111-2222-3333-444455556666', assignedToName: 'Luis Rojas', userId: 'u2', authorName: 'Ana Paz', createdAt: '2026-10-02T10:00:00Z' }]}
      />,
    );
    expect(screen.getByText(/Luis Rojas/)).toBeTruthy();
    expect(screen.getByText('Registró Ana Paz')).toBeTruthy();
    expect(screen.queryByText(/bf2e039c/)).toBeNull();
  });

  it('una asignación sin nombre dice «alguien del equipo», no el id', () => {
    render(<ActivityTimeline activities={[{ id: 'a4', type: 'ASSIGNMENT', notes: 'bf2e039c-1111-2222-3333-444455556666', assignedToId: 'bf2e039c-1111-2222-3333-444455556666', createdAt: '2026-10-02T10:00:00Z' }]} />);
    expect(screen.getByText(/alguien del equipo/)).toBeTruthy();
    expect(screen.queryByText(/bf2e039c/)).toBeNull();
  });

  it('no muestra el id crudo de una asignación', () => {
    render(<ActivityTimeline activities={[{ id: 'a2', type: 'ASSIGNMENT', notes: 'bf2e039c-1111-2222-3333-444455556666', createdAt: '2026-10-02T10:00:00Z' }]} />);
    expect(screen.queryByText(/bf2e039c/)).toBeNull();
  });
});

describe('EpisodesSection', () => {
  const e: MoraEpisode = {
    id: 'e1',
    number: 1,
    startedAt: '2026-09-29',
    startedAtEstimated: true,
    source: 'IMPORTED',
    reconstructed: false,
    current: true,
    durationDays: 5,
    maxDaysPastDue: 9,
  };

  it('número, Actual, (aprox.), pico y origen', () => {
    render(<EpisodesSection episodes={[e]} currency="BOB" />);
    expect(screen.getByText('Mora #1')).toBeTruthy();
    expect(screen.getByText('Actual')).toBeTruthy();
    expect(screen.getByText('29/09/2026 (aprox.) → en curso')).toBeTruthy();
    expect(screen.getByText('9 días')).toBeTruthy();
    expect(screen.getByText('Del archivo')).toBeTruthy();
  });

  it('sin episodios y sin lectura se dicen distinto', () => {
    const { rerender } = render(<EpisodesSection episodes={[]} currency="BOB" />);
    expect(screen.getByText(/no tiene periodos de mora/)).toBeTruthy();
    rerender(<EpisodesSection episodes={null} currency="BOB" />);
    expect(screen.getByText('No se pudo cargar el historial de mora.')).toBeTruthy();
  });
});

describe('PsfNotice', () => {
  it('ausente: el texto exacto', () => {
    render(<PsfNotice externalSource="PSF" syncStatus="ABSENT" absentSince="2026-10-03" />);
    expect(screen.getByText('Ya no aparece en el reporte del 03/10. Puede haberse puesto al día o cancelado; el reporte no lo dice.')).toBeTruthy();
  });

  it('un crédito de Kobrax o al día no muestra aviso', () => {
    render(<PsfNotice syncStatus="ABSENT" />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe('nombres del servidor en notas y promesas', () => {
  const real = nameResolver([], 'me');
  it('la nota firma con authorName; sin él, el respaldo', () => {
    render(<NotesSection notes={[note({ id: 'a', authorId: 'u2', authorName: 'Ana Paz' }), note({ id: 'b', authorId: 'u3' })]} nameOf={real} canAssign={false} onEdit={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText(/Ana Paz ·/)).toBeTruthy();
    expect(screen.getByText(/alguien del equipo ·/)).toBeTruthy();
  });

  it('la promesa muestra assigneeName', () => {
    const p = { id: 'p1', amount: 100, promiseDate: '2026-10-10', status: 'ACTIVE', assigneeId: 'u2', assigneeName: 'Luis Rojas', createdAt: '2026-10-01T00:00:00Z' } as never;
    render(<PromisesSection promises={[p]} currency="BOB" nameOf={real} />);
    expect(screen.getByText('Luis Rojas')).toBeTruthy();
  });
});
