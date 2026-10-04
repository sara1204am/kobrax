import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { MoraEpisode } from '@kobrax/shared';
import { ArrearsHistory } from './arrears-history';

function ep(over: Partial<MoraEpisode> = {}): MoraEpisode {
  return {
    id: 'e1',
    number: 1,
    startedAt: '2026-06-22',
    startedAtEstimated: false,
    source: 'CALCULATED',
    reconstructed: false,
    current: false,
    durationDays: 40,
    ...over,
  };
}

describe('ArrearsHistory — el historial de mora de la ficha', () => {
  // 🔴 Bolivia es UTC−4: con `date()` un día civil llegaba un día atrás. La prueba fija esa zona para que
  // el error se vea aunque quien corre las pruebas esté en UTC.
  const TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/La_Paz';
  });
  afterAll(() => {
    if (TZ === undefined) delete process.env.TZ;
    else process.env.TZ = TZ;
  });

  it('🔴 un día civil no se corre un día en hora de Bolivia', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ startedAt: '2026-09-29', endedAt: '2026-10-02', endReason: 'CURRENT' })]} />);
    expect(screen.getByText(/29 sept 2026/)).toBeInTheDocument();
    expect(screen.getByText(/02 oct 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/28 sept/)).toBeNull();
  });

  it('sin episodios dice que no hay historial, sin inventar uno', () => {
    render(<ArrearsHistory episodes={[]} currency="BOB" />);
    expect(screen.getByText('Sin historial de mora')).toBeInTheDocument();
  });

  it('si no se pudo leer, lo dice y no rompe la ficha', () => {
    render(<ArrearsHistory episodes={null} currency="BOB" />);
    expect(screen.getByText('No se pudo cargar el historial de mora.')).toBeInTheDocument();
  });

  it('el ejemplo del pedido: Mora #1 y #2 terminadas, y la actual en curso', () => {
    render(
      <ArrearsHistory
        currency="BOB"
        episodes={[
          ep({ id: 'c', number: 3, startedAt: '2026-08-01', current: true, durationDays: 61, maxDaysPastDue: 61, startDaysPastDue: 1, balanceAtStart: 7011.42 }),
          ep({ id: 'b', number: 2, startedAt: '2026-04-05', endedAt: '2026-05-01', endReason: 'PAID', durationDays: 26, maxDaysPastDue: 26, balanceAtStart: 900, balanceAtEnd: 0 }),
          ep({ id: 'a', number: 1, startedAt: '2026-01-10', endedAt: '2026-02-01', endReason: 'CURRENT', durationDays: 22 }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // El más reciente primero.
    expect(within(items[0]!).getByText('Mora #3')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Actual')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/en curso/)).toBeInTheDocument();
    expect(within(items[1]!).getByText('Saldó la deuda')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Se puso al día')).toBeInTheDocument();
  });

  it('🔴 un inicio estimado se dice aproximado', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ startedAtEstimated: true, current: true })]} />);
    expect(screen.getByText(/\(aprox\.\)/)).toBeInTheDocument();
  });

  it('un inicio declarado no lleva «aprox.»', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ startedAtEstimated: false, current: true })]} />);
    expect(screen.queryByText(/\(aprox\.\)/)).toBeNull();
  });

  it('🔴 un episodio reconstruido se marca y no muestra números que nadie midió', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ reconstructed: true, endedAt: '2026-02-01', endReason: 'CURRENT' })]} />);
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Reconstruido')).toBeInTheDocument();
    // Pico, saldos y días de entrada: «—», no 0.
    expect(within(item).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(item).queryByText(/0,00/)).toBeNull();
  });

  it('🔴 ausente de la fuente no se pinta como recuperación: dice que no se sabe', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ endedAt: '2026-09-30', endReason: 'SOURCE_ABSENT' })]} />);
    const badge = screen.getByText('Dejó de venir en el reporte');
    expect(badge.closest('[title]')).toHaveAttribute('title', expect.stringContaining('no se sabe si pagó'));
    expect(screen.queryByText('Saldó la deuda')).toBeNull();
  });

  it('el saldo al salir de un episodio abierto es «—» (todavía no salió)', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ current: true, balanceAtStart: 500, balanceAtEnd: 123 })]} />);
    const item = screen.getByRole('listitem');
    const salida = within(item).getByText('Saldo al salir').parentElement!;
    expect(within(salida).getByText('—')).toBeInTheDocument();
  });

  it('muestra el origen de la mora', () => {
    render(<ArrearsHistory currency="BOB" episodes={[ep({ source: 'IMPORTED' })]} />);
    // aparece bajo las fechas y en el recuadro «Origen de la mora» de la derecha, como en la tarjeta
    expect(screen.getAllByText('Del archivo')).toHaveLength(2);
  });
});
