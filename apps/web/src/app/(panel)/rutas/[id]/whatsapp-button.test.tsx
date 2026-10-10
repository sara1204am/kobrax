import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatsAppButton } from './whatsapp-button';

const CONTEXT = { contacts: [{ id: 'c1', contactType: 'PHONE', value: '+591 71234567', isPrimary: true }] };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(CONTEXT), { status: 200 }));
});

describe('WhatsAppButton', () => {
  it('🔴 abre WhatsApp en OTRA pestaña, sin tocar la ventana de la ruta', async () => {
    const tab = { location: { href: '' }, opener: 'x', close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render(<WhatsAppButton clientId="cl1" clientName="Ana Ruiz" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(tab.location.href).toContain('wa.me/'));
    // Sin `'noopener'` como feature: con él `window.open` devuelve null y se perdía la pestaña.
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
  });
});
