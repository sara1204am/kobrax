import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientDetail, CreditNote, Member, MoraPromise, PaymentItem } from '@kobrax/shared';
import { NotesSection } from './notes-section';
import { PaymentsSection } from './payments-section';
import { PersonSections } from './person-sections';
import { PromisesSection } from './promises-section';

const { refresh, toast, post, send } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), post: vi.fn(), send: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/mora/x',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), postJson: post, sendJson: send }));

const MEMBERS = [{ userId: 'u1', firstName: 'Carlos', lastName: 'Mamani', roleName: 'COLLECTOR' } as unknown as Member];

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  post.mockReset();
  send.mockReset();
});

// ── Notas ───────────────────────────────────────────────────────────────────────────────────────
const note = (over: Partial<CreditNote> = {}): CreditNote => ({
  id: 'n1',
  creditId: 'c1',
  kind: 'INFO',
  body: 'Visitar al padre para negociar pago',
  color: 'YELLOW',
  anchor: 'PAGE',
  x: 40,
  y: 40,
  w: 240,
  h: 180,
  zIndex: 1,
  authorId: 'u1',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  ...over,
});

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

describe('NotesSection', () => {
  it('sin notas lo dice', () => {
    render(<NotesSection creditId="c1" notes={[]} members={MEMBERS} canWrite />);
    expect(screen.getByText('Todavía no hay notas.')).toBeInTheDocument();
  });

  it('si no se pudieron leer, lo dice y no rompe', () => {
    render(<NotesSection creditId="c1" notes={null} members={MEMBERS} canWrite />);
    expect(screen.getByText('No se pudieron cargar las notas.')).toBeInTheDocument();
    expect(screen.queryByText('Agregar nota')).toBeNull();
  });

  it('🔴 las importantes primero, aunque sean más viejas', () => {
    render(
      <NotesSection
        creditId="c1"
        members={MEMBERS}
        canWrite={false}
        notes={[note({ id: 'a', body: 'info nueva', createdAt: '2026-10-01T10:00:00Z' }), note({ id: 'b', kind: 'IMPORTANT', body: 'importante vieja', createdAt: '2026-08-01T10:00:00Z' })]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('importante vieja');
    expect(items[1]).toHaveTextContent('info nueva');
  });

  it('cada nota es un post-it de su color, con el tipo, el texto completo y su autor', () => {
    render(<NotesSection creditId="c1" members={MEMBERS} canWrite={false} notes={[note({ color: 'PINK', kind: 'WARNING', body: 'Primera línea\nSegunda línea con más detalle' })]} />);
    const card = screen.getByRole('listitem');
    expect(card).toHaveStyle({ background: 'rgb(252, 231, 243)' });
    expect(card).toHaveTextContent('Atención');
    expect(card).toHaveTextContent('Segunda línea con más detalle');
    expect(card).toHaveTextContent('Carlos Mamani');
  });

  it('un autor que no está en el equipo no muestra su id', () => {
    render(<NotesSection creditId="c1" members={[]} canWrite={false} notes={[note({ authorId: 'u-desconocido' })]} />);
    expect(screen.getByText(/alguien del equipo/)).toBeInTheDocument();
    expect(screen.queryByText(/u-desconocido/)).toBeNull();
  });

  it('sin collection:write no se ofrece escribir, editar ni borrar', () => {
    render(<NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite={false} userId="u1" />);
    expect(screen.queryByText('Agregar nota')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Borrar' })).toBeNull();
  });

  it('🔴 editar y borrar sólo en las notas propias; quien reparte cartera, en todas', () => {
    const notes = [note({ id: 'mia', authorId: 'u1', body: 'mía' }), note({ id: 'ajena', authorId: 'u2', body: 'ajena' })];
    const { unmount } = render(<NotesSection creditId="c1" notes={notes} members={MEMBERS} canWrite userId="u1" />);
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Borrar' })).toHaveLength(1);
    unmount();
    render(<NotesSection creditId="c1" notes={notes} members={MEMBERS} canWrite userId="u1" canAssign />);
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Borrar' })).toHaveLength(2);
  });

  it('escribe una nota: manda tipo, texto recortado, color y un id, avisa y refresca', async () => {
    send.mockResolvedValue(ok(note({ id: 'nueva' }), 201));
    render(<NotesSection creditId="c1" notes={[]} members={MEMBERS} canWrite />);
    await userEvent.click(screen.getByText('Agregar nota'));
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Escribí la nota…'), '  Llamar el viernes  ');
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'WARNING');
    await userEvent.click(screen.getByRole('button', { name: 'Verde' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    const [path, body, method] = send.mock.calls[0]!;
    expect(path).toBe('/api/mora/c1/notes');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ kind: 'WARNING', body: 'Llamar el viernes', color: 'GREEN' });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Nota guardada'));
    expect(refresh).toHaveBeenCalled();
  });

  it('🔴 si el envío falla y se reintenta, viaja el MISMO id (la API no duplica)', async () => {
    send.mockResolvedValueOnce({ ok: false, status: 500, data: { error: { code: 'X', message: 'Falló' } } });
    send.mockResolvedValueOnce(ok(note({ id: 'nueva' }), 201));
    render(<NotesSection creditId="c1" notes={[]} members={MEMBERS} canWrite />);
    await userEvent.click(screen.getByText('Agregar nota'));
    await userEvent.type(screen.getByPlaceholderText('Escribí la nota…'), 'hola');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![1].id).toBe(send.mock.calls[0]![1].id);
  });

  it('corrige una nota propia: manda texto, tipo y color en un solo PATCH', async () => {
    send.mockImplementation(async (_p: string, body: object) => ok(note({ ...body })));
    render(<NotesSection creditId="c1" notes={[note({ body: 'vieja' })]} members={MEMBERS} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const box = screen.getByPlaceholderText('Escribí la nota…');
    expect(box).toHaveValue('vieja');
    await userEvent.clear(box);
    await userEvent.type(box, 'nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Azul' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [path, body, method] = send.mock.calls[0]!;
    expect(path).toBe('/api/mora/c1/notes/n1');
    expect(method).toBe('PATCH');
    expect(body).toEqual({ body: 'nueva', kind: 'INFO', color: 'BLUE' });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Nota actualizada'));
  });

  it('🔴 si la API rechaza la corrección, la nota vuelve a como estaba y se avisa', async () => {
    send.mockResolvedValue({ ok: false, status: 403, data: { error: { code: 'MORA_005', message: 'Sólo quien escribió la nota' } } });
    render(<NotesSection creditId="c1" notes={[note({ body: 'original' })]} members={MEMBERS} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const box = screen.getByPlaceholderText('Escribí la nota…');
    await userEvent.clear(box);
    await userEvent.type(box, 'cambiada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'danger'));
    expect(screen.getByRole('listitem')).toHaveTextContent('original');
    expect(screen.getByRole('listitem')).not.toHaveTextContent('cambiada');
  });

  it('borra con confirmación: manda DELETE, la nota desaparece y se avisa', async () => {
    send.mockResolvedValue(ok({ id: 'n1' }));
    render(<NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText('¿Borrar la nota?')).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Borrar' }).at(-1)!;
    await userEvent.click(confirm);
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]![0]).toBe('/api/mora/c1/notes/n1');
    expect(send.mock.calls[0]![2]).toBe('DELETE');
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
    expect(toast).toHaveBeenCalledWith('Nota borrada');
  });
});

/** Las notas se dibujan dentro de la sección a la que están ancladas: en la ficha real es la ficha entera. */
const Page = ({ children }: { children: React.ReactNode }) => (
  <div data-note-anchor="PAGE" className="relative">
    {children}
  </div>
);

describe('NotesSection — tablero de post-its', () => {
  it('«Mostrar en pantalla» abre el tablero con las notas y «Ocultar» lo cierra', async () => {
    render(<Page><NotesSection creditId="c1" notes={[note({ body: 'en el tablero' })]} members={MEMBERS} canWrite={false} /></Page>);
    expect(screen.queryByRole('region', { name: 'Tablero de notas' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en pantalla' }));
    const board = screen.getByRole('region', { name: 'Tablero de notas' });
    expect(document.querySelector('[data-note-id="n1"]')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Tablero de notas' })).toBeInTheDocument();
    await userEvent.click(within(board).getByRole('button', { name: 'Ocultar' }));
    expect(screen.queryByRole('region', { name: 'Tablero de notas' })).toBeNull();
  });

  it('sin notas no se ofrece el tablero', () => {
    render(<Page><NotesSection creditId="c1" notes={[]} members={MEMBERS} canWrite /></Page>);
    expect(screen.queryByRole('button', { name: 'Mostrar en pantalla' })).toBeNull();
  });

  it('«Ubicar en pantalla» abre el tablero', async () => {
    render(<Page><NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite={false} /></Page>);
    await userEvent.click(screen.getByRole('button', { name: 'Ubicar en pantalla' }));
    expect(screen.getByRole('region', { name: 'Tablero de notas' })).toBeInTheDocument();
  });

  it('sólo quien puede escribir ve «Nueva nota» y el cambio de color en el tablero', async () => {
    const { unmount } = render(<Page><NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite={false} /></Page>);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en pantalla' }));
    const board = screen.getByRole('region', { name: 'Tablero de notas' });
    expect(within(document.body).queryByRole('button', { name: /Nueva nota/ })).toBeNull();
    expect(within(document.body).queryByRole('button', { name: 'Color' })).toBeNull();
    unmount();
    render(<Page><NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite userId="u1" /></Page>);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en pantalla' }));
    const board2 = screen.getByRole('region', { name: 'Tablero de notas' });
    expect(within(document.body).getByRole('button', { name: /Nueva nota/ })).toBeInTheDocument();
    expect(within(document.body).getByRole('button', { name: 'Color' })).toBeInTheDocument();
  });

  it('pintar una nota desde el tablero manda sólo el color', async () => {
    send.mockImplementation(async (_p: string, body: object) => ok(note({ ...body })));
    render(<Page><NotesSection creditId="c1" notes={[note()]} members={MEMBERS} canWrite userId="u1" /></Page>);
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar en pantalla' }));
    const board = screen.getByRole('region', { name: 'Tablero de notas' });
    await userEvent.click(within(document.body).getByRole('button', { name: 'Color' }));
    await userEvent.click(within(document.body).getByRole('button', { name: 'Rosa' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1]).toEqual({ color: 'PINK' });
    expect(send.mock.calls[0]![2]).toBe('PATCH');
  });
});

// ── Promesas ────────────────────────────────────────────────────────────────────────────────────
const promise = (over: Partial<MoraPromise> = {}): MoraPromise => ({
  id: 'p1',
  amount: 500,
  promiseDate: '2026-10-10',
  status: 'ACTIVE',
  assigneeId: 'u1',
  createdAt: '2026-09-28T10:00:00Z',
  ...over,
});

describe('PromisesSection', () => {
  it('sin promesas lo dice; sin lectura también', () => {
    const { unmount } = render(<PromisesSection promises={[]} members={MEMBERS} currency="BOB" />);
    expect(screen.getByText('No hay promesas de pago registradas.')).toBeInTheDocument();
    unmount();
    render(<PromisesSection promises={null} members={MEMBERS} currency="BOB" />);
    expect(screen.getByText('No se pudieron cargar las promesas.')).toBeInTheDocument();
  });

  it('el ejemplo del pedido: monto, fecha y estado; y el cumplimiento sólo de las cerradas', () => {
    render(
      <PromisesSection
        currency="BOB"
        members={MEMBERS}
        promises={[
          promise({ id: 'a', status: 'KEPT', promiseDate: '2026-09-01' }),
          promise({ id: 'b', status: 'KEPT', promiseDate: '2026-09-10' }),
          promise({ id: 'c', status: 'BROKEN', promiseDate: '2026-09-20' }),
          promise({ id: 'd', status: 'ACTIVE' }),
        ]}
      />,
    );
    expect(screen.getByText(/4 promesas · 2 cumplidas · 1 incumplidas/)).toBeInTheDocument();
    expect(screen.getByText('Cumplimiento 67 %')).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
  });

  it('🔴 una vencida sin cerrar NO baja el cumplimiento: se avisa aparte', () => {
    render(<PromisesSection currency="BOB" members={MEMBERS} promises={[promise({ id: 'a', status: 'KEPT' }), promise({ id: 'b', status: 'OVERDUE', promiseDate: '2026-09-20' })]} />);
    expect(screen.getByText('Cumplimiento 100 %')).toBeInTheDocument();
    expect(screen.getByText(/1 promesa venció sin que nadie registrara qué pasó/)).toBeInTheDocument();
    expect(screen.getByText('Vencida sin cerrar').closest('[title]')).toHaveAttribute('title', expect.stringContaining('no se cuenta como incumplida'));
  });

  it('🔴 sin ninguna cerrada no hay porcentaje: no muestra 0 %', () => {
    render(<PromisesSection currency="BOB" members={MEMBERS} promises={[promise()]} />);
    expect(screen.getByText('Cumplimiento: todavía no hay promesas cerradas')).toBeInTheDocument();
    expect(screen.queryByText(/0 %/)).toBeNull();
  });

  it('una promesa sin monto muestra «—», no 0', () => {
    render(<PromisesSection currency="BOB" members={MEMBERS} promises={[promise({ amount: undefined })]} />);
    expect(screen.getAllByRole('listitem')[0]!.textContent).toMatch(/^—/);
  });

  it('un día civil no se corre un día en hora de Bolivia', () => {
    const TZ = process.env.TZ;
    process.env.TZ = 'America/La_Paz';
    render(<PromisesSection currency="BOB" members={MEMBERS} promises={[promise({ promiseDate: '2026-10-10' })]} />);
    expect(screen.getByText(/para el 10 oct 2026/)).toBeInTheDocument();
    if (TZ === undefined) delete process.env.TZ;
    else process.env.TZ = TZ;
  });
});

// ── Pagos ───────────────────────────────────────────────────────────────────────────────────────
const payment = (over: Partial<PaymentItem> = {}): PaymentItem => ({
  id: 'pay1',
  creditId: 'c1',
  amount: 500,
  method: 'CASH',
  paymentDate: '2026-09-15T14:00:00Z',
  createdAt: '2026-09-15T14:00:00Z',
  registeredBy: 'u1',
  ...over,
});

describe('PaymentsSection', () => {
  it('sin pagos lo dice; sin permiso de lectura también', () => {
    const { unmount } = render(<PaymentsSection creditId="c1" payments={[]} members={MEMBERS} currency="BOB" external={false} />);
    expect(screen.getByText('Todavía no hay pagos registrados.')).toBeInTheDocument();
    unmount();
    render(<PaymentsSection creditId="c1" payments={null} members={MEMBERS} currency="BOB" external={false} />);
    expect(screen.getByText(/No tenés permiso para ver los pagos/)).toBeInTheDocument();
  });

  it('lista los pagos con medio, comprobante y quién los registró', () => {
    render(<PaymentsSection creditId="c1" members={MEMBERS} currency="BOB" external={false} payments={[payment({ receiptNumber: 42, method: 'QR' })]} />);
    const item = screen.getByRole('listitem');
    // el medio sale dos veces, como en la tarjeta: en la línea de detalle y en la etiqueta de la derecha
    expect(within(item).getAllByText('QR')).toHaveLength(2);
    expect(within(item).getByText('Comprobante Nº 42')).toBeInTheDocument();
    expect(within(item).getByText('Registró Carlos Mamani')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en Pagos' })).toHaveAttribute('href', '/pagos?creditId=c1');
  });

  it('🔴 «cobrado por Kobrax» no suma lo que pagó por un canal de la entidad', () => {
    render(
      <PaymentsSection
        creditId="c1"
        members={MEMBERS}
        currency="BOB"
        external={false}
        payments={[payment({ id: 'a', amount: 500 }), payment({ id: 'b', amount: 300, channel: 'KOBRAX_COLLECTED' }), payment({ id: 'c', amount: 9999, channel: 'EXTERNAL_CONFIRMED' })]}
      />,
    );
    expect(screen.getByText(/Cobrado por Kobrax: Bs\s?800,00/)).toBeInTheDocument();
    expect(screen.getByText('Pagó por un canal de la entidad')).toBeInTheDocument();
  });

  it('🔴 en un crédito de PSF avisa que el pago no cambia el saldo reportado; en uno propio, no', () => {
    const { unmount } = render(<PaymentsSection creditId="c1" payments={[payment()]} members={MEMBERS} currency="BOB" external />);
    expect(screen.getByText(/no cambia el saldo ni la mora que reportó el archivo/)).toBeInTheDocument();
    unmount();
    render(<PaymentsSection creditId="c1" payments={[payment()]} members={MEMBERS} currency="BOB" external={false} />);
    expect(screen.queryByText(/no cambia el saldo ni la mora/)).toBeNull();
  });
});

// ── La persona ──────────────────────────────────────────────────────────────────────────────────
function client(): ClientDetail {
  return {
    id: 'cl1',
    clientType: 'PERSON',
    firstName: 'Fernando',
    lastName: 'Blanco',
    nationalId: '1234***',
    status: 'ACTIVE',
    contacts: [{ id: 'k1', contactType: 'PHONE', value: '791****', isPrimary: true }],
    locations: [{ id: 'l1', locationType: 'HOME', address: 'Av. *** 123', zone: 'Centro' }],
    relations: [
      { id: 'r1', relatedName: 'Garante De Este Crédito', relationshipType: 'GUARANTOR', isContactable: true, creditIds: ['c1'] },
      { id: 'r2', relatedName: 'Garante De Otro Crédito', relationshipType: 'GUARANTOR', isContactable: true, creditIds: ['c2'] },
      { id: 'r3', relatedName: 'Sin Ningún Crédito', relationshipType: 'GUARANTOR', isContactable: true, creditIds: [] },
    ],
    collaterals: [
      { id: 'g1', description: 'Moto de este crédito', creditIds: ['c1'] },
      { id: 'g2', description: 'Casa de otro crédito', creditIds: ['c2'] },
    ],
    attachments: [],
  } as unknown as ClientDetail;
}

describe('PersonSections — la persona al servicio de la recuperación', () => {
  it('🔴 muestra sólo los garantes y garantías de ESTE crédito', () => {
    render(<PersonSections creditId="c1" client={client()} currency="BOB" collateralTypes={[]} />);
    expect(screen.getByText('Garante De Este Crédito')).toBeInTheDocument();
    expect(screen.queryByText('Garante De Otro Crédito')).toBeNull();
    expect(screen.queryByText('Sin Ningún Crédito')).toBeNull();
    expect(screen.getByText('Moto de este crédito')).toBeInTheDocument();
    expect(screen.queryByText('Casa de otro crédito')).toBeNull();
  });

  it('muestra los contactos y la dirección del cliente, enmascarados', () => {
    render(<PersonSections creditId="c1" client={client()} currency="BOB" collateralTypes={[]} />);
    expect(screen.getByText('791****')).toBeInTheDocument();
    expect(screen.getByText(/Av\. \*\*\* 123/)).toBeInTheDocument();
  });

  it('🔴 es sólo lectura: ninguna sección ofrece «Editar»', () => {
    render(<PersonSections creditId="c1" client={client()} currency="BOB" collateralTypes={[]} />);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByText('Editar')).toBeNull();
  });

  it('«Mostrar» revela la ficha entera por la ruta auditada y deja los datos en claro', async () => {
    const revealed = { ...client(), contacts: [{ id: 'k1', contactType: 'PHONE', value: '79123456', isPrimary: true }] };
    post.mockResolvedValue({ ok: true, status: 200, data: revealed });
    render(<PersonSections creditId="c1" client={client()} currency="BOB" collateralTypes={[]} />);
    await userEvent.click(screen.getAllByRole('button', { name: /Mostrar/ })[0]!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/clients/cl1/reveal', {}));
    expect(await screen.findByText('79123456')).toBeInTheDocument();
  });
});
