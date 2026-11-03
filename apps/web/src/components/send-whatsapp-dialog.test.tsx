import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { AccountBrandProvider } from '@/components/account-brand';
import { SendWhatsappDialog, type WhatsappTemplateOption } from './send-whatsapp-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TEMPLATES: WhatsappTemplateOption[] = [
  { code: 'REM', label: 'Recordatorio', metadata: { body: 'Hola {{cliente}}, debe {{saldo}}. {{negocio}}' } },
  { code: 'RARA', label: 'Con dato que no hay', metadata: { body: 'Hola {{cliente}}, llame al {{telefono_negocio}}' } },
];

const CTX = {
  client: { id: 'c1', displayName: 'Ana Pérez' },
  credits: [{ creditId: '11111111-1111-4111-8111-111111111111', code: 'CR-1', outstandingBalance: 500, currency: 'BOB' }],
  contacts: [{ id: 'k1', contactType: 'WHATSAPP', value: '+591 780-12345', isPrimary: true }],
};

function draw(props: Partial<Parameters<typeof SendWhatsappDialog>[0]> = {}) {
  server.use(http.get('*/api/agenda/context/c1', () => HttpResponse.json(CTX)));
  return render(
    <AccountBrandProvider brand={{ name: 'Kobrax SA', phone: null, logoUrl: null }}>
      <ToastProvider>
        <SendWhatsappDialog open onClose={vi.fn()} templates={TEMPLATES} clientId="c1" {...props} />
      </ToastProvider>
    </AccountBrandProvider>,
  );
}

describe('SendWhatsappDialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  });

  it('arma el mensaje con los datos reales del deudor y lo copia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    draw();
    const msg = (await screen.findByLabelText(/^Mensaje/)) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(msg.value).toContain('Hola Ana Pérez, debe'));
    expect(msg.value).toContain('Kobrax SA');
    await userEvent.click(screen.getByRole('button', { name: 'Copiar texto' }));
    expect(writeText).toHaveBeenCalledWith(msg.value);
  });

  it('con una variable sin dato (el negocio no tiene teléfono) avisa y no copia ni abre', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    draw({ templateCode: 'RARA' });
    await vi.waitFor(() => expect((screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement).value).toContain('Ana Pérez'));
    await userEvent.click(screen.getByRole('button', { name: 'Copiar texto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/le faltan datos: \{\{telefono_negocio\}\}/)).length).toBeGreaterThan(0);
  });

  it('abrir WhatsApp usa wa.me con el número y el texto, y deja UNA gestión de WhatsApp pendiente (sin pedir resultado)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const enviados: Record<string, unknown>[] = [];
    server.use(
      http.post('*/api/agenda', async ({ request }) => {
        enviados.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'item-1' });
      }),
    );
    draw();
    const msg = (await screen.findByLabelText(/^Mensaje/)) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(msg.value).toContain('Ana Pérez'));
    expect(screen.queryByLabelText(/^Resultado/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith('https://wa.me/59178012345?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe(msg.value);

    expect(await screen.findByRole('link', { name: 'Registrar resultado' })).toHaveAttribute('href', '/agenda/item-1');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      creditId: '11111111-1111-4111-8111-111111111111',
      type: 'WHATSAPP',
      details: { contactId: 'k1', message: msg.value, templateCode: 'REM' },
    });

    // Volver a abrir la conversación no agenda otra gestión.
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(enviados).toHaveLength(1);
  });

  it('sin deudor fijo, se busca y se elige de la lista', async () => {
    server.use(
      http.get('*/api/clients', () =>
        HttpResponse.json({ data: [{ id: 'c1', clientType: 'PERSON', firstName: 'Ana', lastName: 'Pérez', nationalId: null, status: 'ACTIVE', totalDebt: 500, maxDaysPastDue: 3, creditCount: 1 }] }),
      ),
    );
    draw({ clientId: undefined });
    await userEvent.type(screen.getByLabelText(/^Buscar deudor/), 'Ana');
    await userEvent.selectOptions(await screen.findByLabelText(/^Deudor/), await screen.findByRole('option', { name: /Ana/ }));
    expect(await screen.findByLabelText(/^Plantilla/)).toBeInTheDocument();
  });
});
