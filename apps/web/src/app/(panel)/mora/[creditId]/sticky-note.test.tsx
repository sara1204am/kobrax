import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreditNote, Member } from '@kobrax/shared';
import { NotesSection } from './notes-section';

const { refresh, toast, send } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/mora/x',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), sendJson: send }));

const MEMBERS = [{ userId: 'u1', firstName: 'Carlos', lastName: 'Mamani', roleName: 'COLLECTOR' } as unknown as Member];

const note = (over: Partial<CreditNote> = {}): CreditNote => ({
  id: 'n1',
  creditId: 'c1',
  kind: 'INFO',
  body: 'Visitar al padre',
  color: 'YELLOW',
  anchor: 'PAGE',
  x: 100,
  y: 100,
  w: 240,
  h: 180,
  zIndex: 1,
  authorId: 'u1',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  ...over,
});

const down = (el: Element, x: number, y: number) => fireEvent(el, new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
const move = (type: 'pointermove' | 'pointerup', x: number, y: number) => fireEvent(document, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

/**
 * El tablero con las notas ya dibujadas. Devuelve la ficha (`PAGE`), que es donde viven las notas ancladas: la
 * barra «Nueva nota / Ocultar» es otra cosa, fija en pantalla.
 */
async function openBoard(notes: CreditNote[], canWrite = true) {
  const { container } = render(
    <div data-note-anchor="PAGE" className="relative">
      <NotesSection creditId="c1" notes={notes} members={MEMBERS} canWrite={canWrite} userId="u1" />
      <div data-note-anchor="PAYMENTS" data-testid="payments" />
    </div>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Mostrar en pantalla' }));
  return container.querySelector('[data-note-anchor="PAGE"]') as HTMLElement;
}

const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  send.mockReset();
  // Un tablero de 1000 × 800: en jsdom todo mide 0 y acotaría cualquier movimiento a la esquina.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // La sección de Pagos está más abajo en la ficha: empieza 400 px más abajo y mide 1000 × 300.
    if (this.getAttribute('data-note-anchor') === 'PAYMENTS') {
      return { x: 0, y: 400, top: 400, left: 0, right: 1000, bottom: 700, width: 1000, height: 300, toJSON: () => ({}) } as DOMRect;
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

describe('Tablero — arrastrar y redimensionar', () => {
  it('🔴 arrastrar guarda UNA vez, al soltar, con el lugar nuevo y «al frente»', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const board = await openBoard([note()]);
    const header = within(board).getByTitle(/Arrastrá el encabezado/);
    down(header, 150, 120);
    move('pointermove', 200, 160);
    move('pointermove', 250, 220);
    expect(send).not.toHaveBeenCalled(); // mientras se arrastra sólo se mueve en pantalla
    move('pointerup', 250, 220);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [path, body, method] = send.mock.calls[0]!;
    expect(path).toBe('/api/mora/c1/notes/n1');
    expect(method).toBe('PATCH');
    expect(body).toEqual({ x: 200, y: 200, w: 240, h: 180, front: true });
  });

  it('una nota no sale del tablero', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const board = await openBoard([note()]);
    down(within(board).getByTitle(/Arrastrá el encabezado/), 150, 120);
    move('pointermove', 5000, 5000);
    move('pointerup', 5000, 5000);
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![1]).toMatchObject({ x: 760, y: 620 });
  });

  it('un clic sin mover sólo la trae al frente: no manda posición', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const board = await openBoard([note()]);
    down(within(board).getByTitle(/Arrastrá el encabezado/), 150, 120);
    move('pointerup', 150, 120);
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![1]).toEqual({ front: true });
  });

  it('redimensionar manda el tamaño nuevo, acotado al máximo', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const board = await openBoard([note({ x: 10, y: 10 })]);
    const handle = board.querySelector('[style*="nwse"], .cursor-nwse-resize')!;
    down(handle, 250, 190);
    move('pointermove', 2000, 2000);
    move('pointerup', 2000, 2000);
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![1]).toMatchObject({ w: 520, h: 440, front: true });
  });

  it('🔴 si la API rechaza el movimiento, la nota vuelve a su lugar y se avisa', async () => {
    send.mockResolvedValue({ ok: false, status: 500, data: { error: { code: 'X', message: 'Falló' } } });
    const board = await openBoard([note()]);
    const sticky = () => board.querySelector('[data-note-id="n1"]') as HTMLElement;
    down(within(board).getByTitle(/Arrastrá el encabezado/), 150, 120);
    move('pointermove', 350, 320);
    move('pointerup', 350, 320);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'danger'));
    expect(sticky().style.left).toBe('100px');
    expect(sticky().style.top).toBe('100px');
  });

  it('sin collection:write no se puede arrastrar: ni encabezado ni esquina', async () => {
    const board = await openBoard([note()], false);
    expect(within(board).queryByTitle(/Arrastrá el encabezado/)).toBeNull();
    expect(board.querySelector('.cursor-nwse-resize')).toBeNull();
  });
});

describe('Tablero — anclado a las secciones', () => {
  it('🔴 la nota se dibuja DENTRO de su sección (viaja con ella), no sobre la pantalla', async () => {
    const page = await openBoard([note(), note({ id: 'n2', anchor: 'PAYMENTS', body: 'en pagos' })]);
    expect(page.querySelector('[data-note-id="n1"]')).not.toBeNull();
    const payments = screen.getByTestId('payments');
    expect(payments.querySelector('[data-note-id="n2"]')).not.toBeNull();
    expect(page.querySelector('[data-note-id="n2"]')?.closest('[data-note-anchor]')).toBe(payments);
    // no hay una capa fija con las notas: lo único fijo es la barra
    expect(document.body.querySelector('.fixed [data-note-id]')).toBeNull();
  });

  it('🔴 soltarla sobre otra sección la re-ancla, con coordenadas medidas desde esa sección', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const page = await openBoard([note()]);
    const spy = vi.fn(() => [screen.getByTestId('payments')]);
    (document as unknown as { elementsFromPoint: unknown }).elementsFromPoint = spy;
    down(within(page).getByTitle(/Arrastrá el encabezado/), 150, 120);
    move('pointermove', 150, 520); // 400 px más abajo
    move('pointerup', 150, 520);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // y: 100 + 400 de arrastre, menos los 400 donde empieza Pagos = 100
    expect(send.mock.calls[0]![1]).toEqual({ x: 100, y: 100, w: 240, h: 180, anchor: 'PAYMENTS', front: true });
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  it('soltarla sobre la misma sección no manda ancla', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const page = await openBoard([note()]);
    down(within(page).getByTitle(/Arrastrá el encabezado/), 150, 120);
    move('pointermove', 200, 160);
    move('pointerup', 200, 160);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1]).not.toHaveProperty('anchor');
  });

  it('una nota de una sección que no está en la ficha cae en la ficha entera en vez de perderse', async () => {
    const page = await openBoard([note({ anchor: 'HISTORY' })]);
    expect(page.querySelector('[data-note-id="n1"]')).not.toBeNull();
  });
});

describe('Tablero — texto de la nota', () => {
  it('editar el texto en la nota propia guarda al salir del campo', async () => {
    send.mockImplementation(async (_p: string, body: object) => ({ ok: true, status: 200, data: note({ ...body }) }));
    const board = await openBoard([note()]);
    const box = within(board).getByRole('textbox', { name: 'Editar' });
    box.innerText = 'texto corregido';
    fireEvent.blur(box);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1]).toEqual({ body: 'texto corregido' });
  });

  it('una nota ajena no es editable en el tablero (sin campo ni papelera)', async () => {
    const board = await openBoard([note({ authorId: 'u2' })]);
    expect(within(board).queryByRole('textbox')).toBeNull();
    expect(within(board).queryByRole('button', { name: 'Borrar' })).toBeNull();
    // pero sí se puede mover y pintar: es ordenar el tablero
    expect(within(board).getByTitle(/Arrastrá el encabezado/)).toBeInTheDocument();
    expect(within(board).getByRole('button', { name: 'Color' })).toBeInTheDocument();
  });

  it('dejar la nota vacía no manda nada: vuelve el texto de antes', async () => {
    const board = await openBoard([note()]);
    const box = within(board).getByRole('textbox', { name: 'Editar' });
    box.innerText = '   ';
    fireEvent.blur(box);
    expect(send).not.toHaveBeenCalled();
    expect(box.innerText).toBe('Visitar al padre');
  });
});
