import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentSummary, type PaymentTotals } from './payment-summary';

// Un componente de servidor pide sus textos a `next-intl/server`: se ata al diccionario real en español.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const es = (await import('@/messages/es.json')).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: 'es', messages: es, namespace }),
    getLocale: async () => 'es',
  };
});

async function draw(totals: PaymentTotals) {
  const ui = await PaymentSummary({ totals, currency: 'BOB', period: { from: '2026-10-01', to: '2026-10-15' } });
  return render(ui);
}

/** El importe (o la cuenta) de una tarjeta, por su rótulo. */
const valueOf = (label: string) => screen.getByText(label).previousElementSibling?.textContent;

describe('PaymentSummary — las cuatro tarjetas del ledger', () => {
  it('muestra el importe primero y el rótulo debajo, con las cifras que mandó la API', async () => {
    await draw({ today: 120, month: 4500.5, period: 3000, count: 17 });
    expect(valueOf('Cobrado hoy')).toMatch(/120/);
    expect(valueOf('Recuperado este mes')).toMatch(/4\.500,50|4500,50/);
    expect(valueOf('Total del período')).toMatch(/3\.000|3000/);
    // La cuenta es un número, no plata.
    expect(valueOf('Pagos registrados')).toBe('17');
  });

  it('🔴 una cifra que la API no mandó se dice «—», no se inventa un cero', async () => {
    await draw({ period: 0, count: 0 });
    expect(valueOf('Cobrado hoy')).toBe('—');
    expect(valueOf('Recuperado este mes')).toBe('—');
    // Cero real (un período sin cobros) sí es cero.
    expect(valueOf('Total del período')).toMatch(/0,00|0\.00/);
  });

  it('el total del período dice de qué rango es', async () => {
    await draw({ today: 0, month: 0, period: 0, count: 0 });
    expect(screen.getByText(/oct.*2026.*–.*oct.*2026|01.*–.*15/i)).toBeInTheDocument();
  });

  it('cada tarjeta explica qué filtros la mueven', async () => {
    await draw({ today: 1, month: 1, period: 1, count: 1 });
    expect(screen.getByText('Cobrado hoy').closest('div')).toHaveAttribute('title', expect.stringMatching(/ignora el rango/));
    expect(screen.getByText('Recuperado este mes').closest('div')).toHaveAttribute('title', expect.stringMatching(/ignora el rango/));
    expect(screen.getByText('Total del período').closest('div')).toHaveAttribute('title', expect.stringMatching(/rango de fechas y a todos los filtros/));
  });
});
