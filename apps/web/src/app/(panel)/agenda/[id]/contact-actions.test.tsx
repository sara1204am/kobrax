import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgendaItemType } from '@kobrax/shared';
import { ToastProvider } from '@/components/toast';
import { ContactActions } from './contact-actions';

const draw = (props: Parameters<typeof ContactActions>[0]) =>
  render(
    <ToastProvider>
      <ContactActions {...props} />
    </ToastProvider>,
  );

describe('ContactActions (F4/11)', () => {
  it('WhatsApp abre la conversación con el teléfono y el mensaje, en otra pestaña', () => {
    draw({ type: AgendaItemType.WHATSAPP, phone: '+591 780-12345', message: 'Hola' });
    const link = screen.getByRole('link', { name: 'Abrir WhatsApp' });
    expect(link).toHaveAttribute('href', 'https://wa.me/59178012345?text=Hola');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('Llamada copia el teléfono: no registra nada ni abre `tel:`', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    draw({ type: AgendaItemType.CALL, phone: '78012345' });
    await userEvent.click(screen.getByRole('button', { name: 'Copiar teléfono' }));
    expect(writeText).toHaveBeenCalledWith('78012345');
  });

  it('Visita ofrece ver la ubicación solo si hay coordenadas', () => {
    const { unmount } = draw({ type: AgendaItemType.VISIT, latitude: -16.5, longitude: -68.15 });
    expect(screen.getByRole('link', { name: 'Ver ubicación' })).toHaveAttribute('href', expect.stringContaining('mlat=-16.5'));
    unmount();
    draw({ type: AgendaItemType.VISIT });
    expect(screen.queryByRole('link', { name: 'Ver ubicación' })).toBeNull();
  });

  it('un recordatorio o una promesa no tienen acción de contacto', () => {
    draw({ type: AgendaItemType.REMINDER, phone: '78012345' });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
