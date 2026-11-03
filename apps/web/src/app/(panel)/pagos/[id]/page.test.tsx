import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PagoPage from './page';

const { calls, state } = vi.hoisted(() => ({
  calls: [] as string[],
  state: { payment: {} as Record<string, unknown>, permissions: ['route:read'] as string[], credit: {} as Record<string, unknown> },
}));

// Un componente de servidor pide sus textos a `next-intl/server`: se ata al diccionario real en español.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const es = (await import('@/messages/es.json')).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: 'es', messages: es, namespace }),
    getLocale: async () => 'es',
  };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/bff', () => ({
  apiCall: async (path: string) => {
    calls.push(path);
    const ok = (data: unknown) => ({ status: 200, body: { data, error: null, meta: {} } });
    if (path.startsWith('/payments/')) return ok(state.payment);
    if (path === '/accounts/me') return ok({ currencyCode: 'BOB' });
    if (path === '/auth/me') return ok({ permissions: state.permissions });
    if (path.startsWith('/credits/')) return ok(state.credit);
    if (path.startsWith('/clients/')) return ok({ firstName: 'Lidia', lastName: 'Mamani Vargas' });
    return { status: 404, body: { data: null, error: { message: 'x' }, meta: {} } };
  },
}));

const PAYMENT_ID = '3f2a6c1e-9b4d-4e57-8a10-6d2b7c9e4f11';
const VISIT_ID = 'c0ffee00-1111-4222-8333-444455556666';

const base = {
  id: PAYMENT_ID,
  creditId: 'cr1',
  amount: 102,
  method: 'CASH',
  paymentDate: '2026-10-16T03:00:00.000Z', // 23:00 del 15 en La Paz
  createdAt: '2026-10-16T03:00:00.000Z',
  receiptNumber: 104,
  registeredBy: 'u1',
  registeredByName: 'Mónica Manager',
};

async function draw() {
  const ui = await PagoPage({ params: { id: PAYMENT_ID } });
  return render(ui);
}

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['route:read'];
  state.credit = { id: 'cr1', clientId: 'cl1', code: 'CRD-DEMO-0001', currency: 'BOB' };
  state.payment = { ...base };
});

describe('Detalle de un pago', () => {
  it('encabezado: número, deudor y crédito, fecha en la zona de la empresa y quién lo registró', async () => {
    await draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Pago #104' })).toBeInTheDocument();
    expect(screen.getByText('Lidia Mamani Vargas · Crédito CRD-DEMO-0001')).toBeInTheDocument();
    expect(screen.getByText(/15\/10\/26, 23:00 · Registrado por Mónica Manager/)).toBeInTheDocument();
  });

  it('la tarjeta del monto: importe, medio y N° de recibo o factura', async () => {
    state.payment = { ...base, receiptReference: 'R-004512' };
    await draw();
    expect(screen.getByText('Monto del pago').nextElementSibling).toHaveTextContent(/102,00/);
    expect(screen.getByText('Medio de pago').nextElementSibling).toHaveTextContent('Efectivo');
    expect(screen.getByText('N° de recibo o factura').nextElementSibling).toHaveTextContent('R-004512');
  });

  it('sin N° de recibo escrito dice «—», no lo inventa', async () => {
    await draw();
    expect(screen.getByText('N° de recibo o factura').nextElementSibling).toHaveTextContent('—');
  });

  it('muestra las nueve celdas de datos con lo que hay y «—» donde no hay', async () => {
    await draw();
    const celda = (rotulo: string) => screen.getByText(rotulo).nextElementSibling!;
    expect(celda('Fecha efectiva')).toHaveTextContent(/15 oct\.? 2026,? 23:00/);
    expect(celda('N° de comprobante')).toHaveTextContent('#104');
    expect(celda('Registrado por')).toHaveTextContent('Mónica Manager');
    expect(celda('Oficial que realizó la cobranza')).toHaveTextContent('Mónica Manager');
    expect(celda('Fuente')).toHaveTextContent('Kobrax');
    expect(celda('Proveedor')).toHaveTextContent('—');
    expect(celda('Id externo')).toHaveTextContent('—');
    expect(celda('Visita relacionada')).toHaveTextContent('—');
    expect(celda('Método de registro')).toHaveTextContent('—');
  });

  it('🔴 «Método de registro» sólo dice Web o Móvil cuando se guardó; un pago anterior no lo inventa', async () => {
    state.payment = { ...base, registeredVia: 'WEB' };
    const { unmount } = await draw();
    expect(screen.getByText('Método de registro').nextElementSibling).toHaveTextContent('Web');
    unmount();

    state.payment = { ...base, registeredVia: 'MOBILE' };
    await draw();
    expect(screen.getByText('Método de registro').nextElementSibling).toHaveTextContent('Móvil');
  });

  it('un crédito PSF se dice en la fuente', async () => {
    state.credit = { id: 'cr1', clientId: 'cl1', code: 'X', currency: 'BOB', externalSource: 'PSF' };
    await draw();
    expect(screen.getByText('Fuente').nextElementSibling).toHaveTextContent('PSF');
  });

  it('con visita: el oficial es el que cobró en ella (no quien cargó el pago) y hay enlace a la parada', async () => {
    state.payment = { ...base, visitId: VISIT_ID, visit: { collectorId: 'u2', collectorName: 'Carlos Collector', routeId: 'r1', stopId: 's1' } };
    await draw();
    expect(screen.getByText('Oficial que realizó la cobranza').nextElementSibling).toHaveTextContent('Carlos Collector');
    expect(screen.getByText('Registrado por').nextElementSibling).toHaveTextContent('Mónica Manager');
    expect(screen.getByText('Visita relacionada').nextElementSibling).toHaveTextContent('#C0FFEE00');
    expect(screen.getByRole('link', { name: 'Ver la visita relacionada' })).toHaveAttribute('href', '/rutas/r1/parada/s1');
  });

  it('🔴 sin permiso de rutas el enlace a la visita no se ofrece (sería un 403 detrás de un clic)', async () => {
    state.permissions = [];
    state.payment = { ...base, visitId: VISIT_ID, visit: { collectorId: 'u2', routeId: 'r1', stopId: 's1' } };
    await draw();
    expect(screen.queryByRole('link', { name: 'Ver la visita relacionada' })).not.toBeInTheDocument();
    expect(screen.getByText('Ver la visita relacionada')).toBeInTheDocument();
  });

  it('sin visita, el enlace a la visita queda apagado y los otros dos llevan al crédito y a la gestión', async () => {
    await draw();
    expect(screen.queryByRole('link', { name: 'Ver la visita relacionada' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el crédito relacionado' })).toHaveAttribute('href', '/cartera/cl1/credito/cr1');
    expect(screen.getByRole('link', { name: 'Ver la gestión de cobranza' })).toHaveAttribute('href', '/mora/cr1');
  });

  it('recuerda que el ledger no se edita ni se borra', async () => {
    await draw();
    expect(screen.getByRole('note')).toHaveTextContent('Los pagos no se editan ni se borran: el ledger es la fuente de la plata.');
  });

  it('🔴 no pide la lista del equipo: los nombres vienen en el pago (sin `user:read` daría 403)', async () => {
    await draw();
    expect(calls).not.toContain('/users');
  });

  it('un id que no es uuid es un 404, sin pedirle nada a la API', async () => {
    await expect(PagoPage({ params: { id: 'loquesea' } })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls).toHaveLength(0);
  });
});

describe('Detalle de un pago — «Ver comprobante»', () => {
  it('sin foto no hay botón', async () => {
    await draw();
    expect(screen.queryByRole('button', { name: 'Ver comprobante' })).not.toBeInTheDocument();
  });

  it('abre la foto en el mismo visor que las fotos de las rutas, sin «Principal» ni «Foto 1 de 1»', async () => {
    state.payment = { ...base, receiptUrl: '/api/uploads/abc.jpg' };
    await draw();
    await userEvent.click(screen.getByRole('button', { name: 'Ver comprobante' }));

    const visor = await screen.findByRole('dialog', { name: 'Pago #104' });
    expect(within(visor).getByRole('img')).toHaveAttribute('src', '/api/uploads/abc.jpg');
    expect(within(visor).getByText('Comprobante de pago')).toBeInTheDocument();
    expect(within(visor).getByText('Foto subida al registrar el pago')).toBeInTheDocument();
    // El visor de las casas marca la primera foto como «Principal»: acá no tiene sentido.
    expect(within(visor).queryByText('Principal')).not.toBeInTheDocument();
    expect(within(visor).queryByText('Foto principal')).not.toBeInTheDocument();
    // Y conserva lo suyo: zoom y abrir en otra pestaña.
    expect(within(visor).getByRole('button', { name: /Acercar|Zoom/i })).toBeInTheDocument();
  });

  it('una URL externa es un enlace que abre aparte (no se puede autenticar ni embeber)', async () => {
    state.payment = { ...base, receiptUrl: 'https://example.com/recibo.png' };
    await draw();
    const enlace = screen.getByRole('link', { name: 'Ver comprobante' });
    expect(enlace).toHaveAttribute('href', 'https://example.com/recibo.png');
    expect(enlace).toHaveAttribute('target', '_blank');
  });

  it('🔴 un `javascript:` guardado a mano no se vuelve un enlace ejecutable', async () => {
    state.payment = { ...base, receiptUrl: 'javascript:alert(1)' };
    await draw();
    expect(screen.queryByRole('link', { name: 'Ver comprobante' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver comprobante' })).not.toBeInTheDocument();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });
});
