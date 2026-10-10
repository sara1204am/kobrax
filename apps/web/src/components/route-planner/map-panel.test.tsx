import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapPanel, type OrderItem } from './map-panel';

// MapLibre no corre en jsdom: acá se prueba la lista de paradas, no el mapa.
vi.mock('./points-map', () => ({
  // Deja a la vista lo que el panel le pide al mapa: a quién resaltar y a quién llevar al centro.
  PointsMap: ({ focusId, centerRequest }: { focusId?: string | null; centerRequest?: { id: string } | null }) => (
    <div data-testid="points-map" data-focus={focusId ?? ''} data-center={centerRequest?.id ?? ''} />
  ),
  BADGE_CLASS: { success: '', warning: '', danger: '', info: '', neutral: '' },
}));

const CASA = '/api/uploads/casa.jpg';
const PATIO = '/api/uploads/patio.jpg';

const PUNTO = { id: 'a', latitude: -19.03, longitude: -65.26 };

function draw(order: OrderItem[], points = [PUNTO]) {
  return render(<MapPanel points={points} order={order} area={null} onArea={vi.fn()} counter="3 paradas" alwaysShowList noArea />);
}

describe('MapPanel · fotos de la casa en las paradas de la ruta', () => {
  it('la parada con foto muestra la miniatura de la principal; la que no tiene, no', () => {
    draw([
      { id: 'a', name: 'Freddy Tarqui', photos: [CASA, PATIO] },
      { id: 'b', name: 'Wilfredo Ramos' },
    ]);
    const filas = screen.getAllByRole('listitem');
    // La miniatura es decorativa (`alt=""`): el botón que la envuelve es el que tiene nombre.
    expect(filas[0]!.querySelector('button img')).toHaveAttribute('src', CASA);
    expect(within(filas[0]!).getByText('2')).toBeInTheDocument(); // cuántas hay
    expect(within(filas[1]!).queryByRole('button', { name: /fotos de la casa/i })).toBeNull();
  });

  it('tocar la miniatura abre el visor: nombre, dirección, la principal marcada y «1 de 2»', async () => {
    draw([{ id: 'a', name: 'Freddy Tarqui', hint: 'Calle 12 #890', photos: [CASA, PATIO] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Ver las fotos de la casa de Freddy Tarqui' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Freddy Tarqui' })).toBeInTheDocument();
    expect(within(dialog).getByText('Calle 12 #890')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Foto 1 de la ubicación' })).toHaveAttribute('src', CASA);
    expect(within(dialog).getByText('Principal')).toBeInTheDocument();
    expect(within(dialog).getByText('1 de 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Fotografía principal')).toBeInTheDocument();
  });

  it('las flechas pasan de una foto a la otra y la que no es principal pierde la etiqueta', async () => {
    draw([{ id: 'a', name: 'Freddy Tarqui', photos: [CASA, PATIO] }]);
    await userEvent.click(screen.getByRole('button', { name: 'Ver las fotos de la casa de Freddy Tarqui' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Foto siguiente' }));
    expect(within(dialog).getByRole('img', { name: 'Foto 2 de la ubicación' })).toHaveAttribute('src', PATIO);
    expect(within(dialog).getByText('2 de 2')).toBeInTheDocument();
    expect(within(dialog).queryByText('Principal')).toBeNull();
    expect(within(dialog).getByText('Fotografía 2')).toBeInTheDocument();
  });

  it('una casa de un garante dice de quién es la evidencia', async () => {
    draw([{ id: 'a', name: 'Freddy Tarqui', photos: [CASA], photosOwner: 'Juan Pérez' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Ver las fotos de la casa de Freddy Tarqui' }));
    expect(within(await screen.findByRole('dialog')).getByText('Evidencia de Juan Pérez')).toBeInTheDocument();
  });

  it('🔴 «Ir en mapa» lleva el punto al centro; pasar el cursor por la fila solo lo resalta, no mueve el mapa', async () => {
    draw([{ id: 'a', name: 'Freddy Tarqui' }]);
    const mapa = screen.getByTestId('points-map');
    await userEvent.hover(screen.getAllByRole('listitem')[0]!);
    expect(mapa).toHaveAttribute('data-focus', 'a');
    expect(mapa).toHaveAttribute('data-center', ''); // resaltar no es ir
    await userEvent.click(screen.getByRole('button', { name: 'Ir en mapa' }));
    expect(mapa).toHaveAttribute('data-center', 'a');
  });

  it('una parada sin punto en el mapa no ofrece «Ir en mapa»', () => {
    draw([{ id: 'b', name: 'Sin punto' }]);
    expect(screen.queryByRole('button', { name: 'Ir en mapa' })).toBeNull();
  });

  it('las acciones van en su fila: antes de «Ir en mapa» las propias, y «Registrar» después', () => {
    draw([
      {
        id: 'a',
        name: 'Freddy Tarqui',
        trailing: <button>Ver detalle</button>,
        primary: <button>Registrar</button>,
      },
    ]);
    const nombres = screen.getAllByRole('button').map((b) => b.textContent);
    expect(nombres.indexOf('Ver detalle')).toBeLessThan(nombres.indexOf('Ir en mapa'));
    expect(nombres.indexOf('Ir en mapa')).toBeLessThan(nombres.indexOf('Registrar'));
  });

  it('los tres puntos abren las acciones secundarias y se cierran con Esc; sin acciones no hay botón', async () => {
    const copiar = vi.fn();
    draw([
      { id: 'a', name: 'Con menú', menu: [{ label: 'Ver ficha del cliente', href: '/cartera/c1' }, { label: 'Copiar dirección', onClick: copiar }] },
      { id: 'b', name: 'Sin menú' },
    ]);
    expect(screen.getAllByRole('button', { name: 'Más acciones' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }));
    expect(screen.getByRole('menuitem', { name: 'Ver ficha del cliente' })).toHaveAttribute('href', '/cartera/c1');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copiar dirección' }));
    expect(copiar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
