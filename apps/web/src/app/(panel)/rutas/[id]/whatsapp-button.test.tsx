import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import { WhatsAppButton } from './whatsapp-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('WhatsAppButton', () => {
  it('🔴 no pide el teléfono hasta que se hace clic, y entonces ofrece las plantillas de la cuenta', async () => {
    let contextPedido = false;
    server.use(
      http.get('*/api/agenda/context/cl1', () => {
        contextPedido = true;
        return HttpResponse.json({
          client: { id: 'cl1', displayName: 'Ana Ruiz' },
          credits: [{ creditId: '11111111-1111-4111-8111-111111111111', code: 'CR-1', outstandingBalance: 500, currency: 'BOB' }],
          contacts: [{ id: 'k1', contactType: 'PHONE', value: '+591 71234567', isPrimary: true }],
        });
      }),
      http.get('*/api/catalogs/WHATSAPP_TEMPLATE', () =>
        HttpResponse.json({ data: [{ code: 'REM', label: 'Recordatorio', metadata: { body: 'Hola {{cliente}}' } }] }),
      ),
    );
    render(
      <ToastProvider>
        <WhatsAppButton clientId="cl1" clientName="Ana Ruiz" />
      </ToastProvider>,
    );
    expect(contextPedido).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(await screen.findByRole('option', { name: 'Recordatorio' })).toBeInTheDocument();
    await vi.waitFor(() => expect((screen.getByLabelText(/^Mensaje/) as HTMLTextAreaElement).value).toBe('Hola Ana Ruiz'));
    expect(contextPedido).toBe(true);
  });
});
