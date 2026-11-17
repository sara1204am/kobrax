import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { PrivacyRequests } from './privacy-requests';
import type { PrivacyRequestView } from '@/lib/legal';

const req = (over: Partial<PrivacyRequestView> = {}): PrivacyRequestView => ({
  id: '11111111-1111-1111-1111-111111111111',
  subjectKind: 'APP_USER',
  type: 'ACCESS',
  status: 'RECEIVED',
  subjectLabel: null,
  description: 'Quiero saber qué datos tienen de mí.',
  rejectionReason: null,
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  closedAt: null,
  events: [{ status: 'RECEIVED', note: null, actorKind: 'REQUESTER', createdAt: '2026-11-16T12:00:00.000Z' }],
  allowedNext: ['IN_REVIEW', 'REJECTED'],
  ...over,
});

const draw = (mode: 'self' | 'org', initial: PrivacyRequestView[] = []) =>
  render(
    <ToastProvider>
      <PrivacyRequests mode={mode} initial={initial} />
    </ToastProvider>,
  );

describe('PrivacyRequests · la persona (self)', () => {
  it('sin solicitudes lo dice, y deja claro que esto registra y da seguimiento pero no borra nada solo', () => {
    draw('self');
    expect(screen.getByText('Todavía no hay solicitudes.')).toBeInTheDocument();
    expect(screen.getByText(/no elimina ni exporta datos por sí solo/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Solicitudes sobre tus datos' })).toBeInTheDocument();
  });

  it('🔴 «Enviar solicitud» exige una descripción de al menos 10 caracteres', async () => {
    draw('self');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
    const enviar = screen.getByRole('button', { name: 'Enviar solicitud' });
    expect(enviar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Describe la solicitud/), 'corta');
    expect(enviar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Describe la solicitud/), ' pero ya es larga');
    expect(enviar).toBeEnabled();
  });

  it('envía el tipo y la descripción a la ruta PROPIA (sin titular), agrega la solicitud como «Recibida» y avisa', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/privacy/requests', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(req({ type: 'ERASURE', description: 'Quiero que eliminen mis datos de usuario.' }), { status: 201 });
      }),
    );
    draw('self');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
    await userEvent.selectOptions(screen.getByLabelText('Tipo de solicitud'), 'ERASURE');
    await userEvent.type(screen.getByLabelText(/Describe la solicitud/), 'Quiero que eliminen mis datos de usuario.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByText('Solicitud registrada')).toBeInTheDocument();
    expect(body).toEqual({ type: 'ERASURE', description: 'Quiero que eliminen mis datos de usuario.' });
    expect(screen.getByText('Eliminación')).toBeInTheDocument();
    expect(screen.getAllByText('Recibida').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/^Titular/)).toBeNull();
  });

  it('si ya tiene demasiadas abiertas lo explica', async () => {
    server.use(http.post('*/api/privacy/requests', () => HttpResponse.json({ error: { code: 'PRIVACY_REQUEST_TOO_MANY_OPEN' } }, { status: 409 })));
    draw('self');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
    await userEvent.type(screen.getByLabelText(/Describe la solicitud/), 'Una solicitud con descripción larga.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByText(/varias solicitudes abiertas/i)).toBeInTheDocument();
  });

  it('🔴 la persona NO ve botones para cambiar el estado (eso lo hace quien atiende), y ve el seguimiento con quién hizo cada paso', () => {
    draw('self', [
      req({
        status: 'IN_REVIEW',
        events: [
          { status: 'RECEIVED', note: null, actorKind: 'REQUESTER', createdAt: '2026-11-16T12:00:00.000Z' },
          { status: 'IN_REVIEW', note: 'Estamos revisando tu pedido.', actorKind: 'PLATFORM', createdAt: '2026-11-16T13:00:00.000Z' },
        ],
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Pasar a revisión' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    expect(screen.getByText(/Equipo de Kobrax/)).toBeInTheDocument();
    expect(screen.getByText('“Estamos revisando tu pedido.”')).toBeInTheDocument();
  });

  it('una solicitud rechazada muestra el motivo', () => {
    draw('self', [req({ status: 'REJECTED', rejectionReason: 'Hay una obligación legal de conservar el registro.', allowedNext: [] })]);
    expect(screen.getByText(/Motivo del rechazo: Hay una obligación legal/)).toBeInTheDocument();
  });
});

describe('PrivacyRequests · la organización (org)', () => {
  const orgReq = (over: Partial<PrivacyRequestView> = {}) =>
    req({ subjectKind: 'DEBTOR_VIA_ORG', subjectLabel: 'Juan Pérez · CI 1234567', events: [{ status: 'RECEIVED', note: null, actorKind: 'ORG', createdAt: '2026-11-16T12:00:00.000Z' }], ...over });

  it('deja claro que la organización es la responsable de atenderlas', () => {
    draw('org');
    expect(screen.getByRole('heading', { name: 'Solicitudes de titulares de cobranza' })).toBeInTheDocument();
    expect(screen.getByText(/tu organización es la responsable/i)).toBeInTheDocument();
  });

  it('🔴 pide la identificación del titular y la manda a la ruta de la ORGANIZACIÓN', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/privacy/requests/org', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(orgReq(), { status: 201 });
      }),
    );
    draw('org');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
    const registrar = screen.getByRole('button', { name: 'Registrar solicitud' });
    await userEvent.type(screen.getByLabelText(/Describe la solicitud/), 'El titular pide acceso a su información.');
    expect(registrar).toBeDisabled(); // falta el titular
    await userEvent.type(screen.getByLabelText(/^Titular/), 'Juan Pérez · CI 1234567');
    expect(registrar).toBeEnabled();
    await userEvent.click(registrar);
    expect(await screen.findByText('Solicitud registrada')).toBeInTheDocument();
    expect(body).toEqual({ type: 'ACCESS', subjectLabel: 'Juan Pérez · CI 1234567', description: 'El titular pide acceso a su información.' });
    expect(screen.getByText(/Juan Pérez · CI 1234567/)).toBeInTheDocument();
  });

  it('🔴 solo ofrece los estados a los que el servidor permite pasar (allowedNext)', () => {
    draw('org', [orgReq({ allowedNext: ['IN_REVIEW', 'REJECTED'] })]);
    expect(screen.getByRole('button', { name: 'Pasar a revisión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como completada' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });

  it('un estado final no ofrece ningún cambio', () => {
    draw('org', [orgReq({ status: 'COMPLETED', allowedNext: [], closedAt: '2026-11-17T00:00:00.000Z' })]);
    expect(screen.queryByRole('button', { name: /pasar|aprobar|rechazar|completada|pedir/i })).toBeNull();
  });

  it('pasar a revisión no pide texto: envía solo el estado y actualiza la tarjeta', async () => {
    let body: Record<string, unknown> | undefined;
    let url = '';
    server.use(
      http.patch('*/api/privacy/requests/org/:id/status', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        url = new URL(request.url).pathname;
        return HttpResponse.json(orgReq({ status: 'IN_REVIEW', allowedNext: ['NEEDS_INFO', 'APPROVED', 'REJECTED'] }));
      }),
    );
    draw('org', [orgReq()]);
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a revisión' }));
    expect(await screen.findByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(body).toEqual({ status: 'IN_REVIEW' });
    expect(url).toBe('/api/privacy/requests/org/11111111-1111-1111-1111-111111111111/status');
  });

  it('🔴 rechazar exige una justificación (mínimo 5 caracteres) y la envía como rejectionReason', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch('*/api/privacy/requests/org/:id/status', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(orgReq({ status: 'REJECTED', rejectionReason: 'Obligación legal de conservar.', allowedNext: [] }));
      }),
    );
    draw('org', [orgReq()]);
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmar).toBeDisabled();
    const razon = screen.getByLabelText('Justificación del rechazo');
    await userEvent.type(razon, 'no');
    expect(confirmar).toBeDisabled();
    await userEvent.clear(razon);
    await userEvent.type(razon, 'Obligación legal de conservar.');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);
    expect(await screen.findByText(/Motivo del rechazo: Obligación legal/)).toBeInTheDocument();
    expect(body).toEqual({ status: 'REJECTED', rejectionReason: 'Obligación legal de conservar.' });
  });

  it('pedir información exige decir qué falta', async () => {
    draw('org', [orgReq({ status: 'IN_REVIEW', allowedNext: ['NEEDS_INFO', 'APPROVED', 'REJECTED'] })]);
    await userEvent.click(screen.getByRole('button', { name: 'Pedir información' }));
    expect(screen.getByLabelText('¿Qué información falta?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });

  it('si el cambio falla lo dice y deja la tarjeta como estaba', async () => {
    server.use(http.patch('*/api/privacy/requests/org/:id/status', () => HttpResponse.json({ error: { code: 'X' } }, { status: 409 })));
    draw('org', [orgReq()]);
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a revisión' }));
    expect(await screen.findByText(/no se pudo completar la acción/i)).toBeInTheDocument();
    // La tarjeta sigue igual: el mismo botón disponible, sin el estado nuevo.
    expect(screen.getByRole('button', { name: 'Pasar a revisión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });
});
