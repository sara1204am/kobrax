import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { computeRecoveryMetrics, type RecoveryMetrics } from '@kobrax/shared';
import { RecoveryMetricsSection } from './recovery-metrics';

function metrics(over: Partial<RecoveryMetrics> = {}): RecoveryMetrics {
  return {
    window: 'EPISODE',
    since: '2026-10-01',
    sinceEstimated: false,
    balanceAtStart: 1000,
    recoveredAmount: 0,
    paymentsCount: 0,
    recoveredAllTime: 0,
    activities: { total: 0, calls: 0, visits: 0, messages: 0 },
    notes: 0,
    contacts: 0,
    promises: { made: 0, active: 0, unresolved: 0, kept: 0, broken: 0 },
    ...over,
  };
}
const row = (label: string) => screen.getByText(label).closest('div')!;

describe('RecoveryMetricsSection — la recuperación de un crédito', () => {
  it('si no se pudo leer, lo dice y no rompe la ficha', () => {
    render(<RecoveryMetricsSection metrics={null} currency="BOB" />);
    expect(screen.getByText('No se pudieron cargar las métricas de recuperación.')).toBeInTheDocument();
  });

  it('dice desde cuándo se mide: la mora actual', () => {
    render(<RecoveryMetricsSection metrics={metrics()} currency="BOB" />);
    expect(screen.getByText(/Desde que empezó esta mora, el 01 oct 2026/)).toBeInTheDocument();
  });

  it('🔴 un día civil no se corre un día en hora de Bolivia', () => {
    const TZ = process.env.TZ;
    process.env.TZ = 'America/La_Paz';
    render(<RecoveryMetricsSection metrics={metrics({ since: '2026-10-01' })} currency="BOB" />);
    expect(screen.getByText(/el 01 oct 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/30 sept/)).toBeNull();
    if (TZ === undefined) delete process.env.TZ;
    else process.env.TZ = TZ;
  });

  it('🔴 una mora que ya venía de antes de registrarse lo avisa: lo anterior pudo pasar fuera de Kobrax', () => {
    render(<RecoveryMetricsSection metrics={metrics({ untrackedDays: 395, daysToFirstContact: 397 })} currency="BOB" />);
    expect(screen.getByText(/ya llevaba 395 días cuando se empezó a registrar en Kobrax/)).toBeInTheDocument();
  });

  it('🔴 en una mora que ya venía de antes, cada hito trae también los días desde que Kobrax la gestiona', () => {
    render(
      <RecoveryMetricsSection
        currency="BOB"
        metrics={metrics({
          untrackedDays: 395,
          daysToFirstContact: 397,
          daysToFirstVisit: 396,
          daysToFirstPayment: 395,
          sinceTracking: { daysToFirstContact: 2, daysToFirstVisit: 1, daysToFirstPayment: 0 },
        })}
      />,
    );
    expect(within(row('Primer contacto')).getByText('A los 397 días')).toBeInTheDocument();
    expect(within(row('Primer contacto')).getByText('Desde que Kobrax lo gestiona: a los 2 días')).toBeInTheDocument();
    expect(within(row('Primera visita')).getByText('Desde que Kobrax lo gestiona: a los 1 día')).toBeInTheDocument();
    expect(within(row('Primer pago')).getByText('Desde que Kobrax lo gestiona: el mismo día')).toBeInTheDocument();
  });

  it('una mora registrada desde el principio no repite el número', () => {
    render(<RecoveryMetricsSection metrics={metrics({ daysToFirstContact: 3 })} currency="BOB" />);
    expect(screen.queryByText(/Desde que Kobrax lo gestiona/)).toBeNull();
  });

  it('una mora registrada desde el principio no lleva ese aviso', () => {
    render(<RecoveryMetricsSection metrics={metrics()} currency="BOB" />);
    expect(screen.queryByText(/se empezó a registrar/)).toBeNull();
  });

  it('un inicio estimado se avisa', () => {
    render(<RecoveryMetricsSection metrics={metrics({ sinceEstimated: true })} currency="BOB" />);
    expect(screen.getByText('(inicio aproximado)')).toBeInTheDocument();
  });

  it('🔴 sin contacto, visita ni pago dice «todavía sin…», no «0 días»', () => {
    render(<RecoveryMetricsSection metrics={metrics()} currency="BOB" />);
    expect(within(row('Primer contacto')).getByText('Todavía sin contacto')).toBeInTheDocument();
    expect(within(row('Primera visita')).getByText('Todavía sin visita')).toBeInTheDocument();
    expect(within(row('Primer pago')).getByText('Todavía sin pagos')).toBeInTheDocument();
    expect(screen.queryByText(/A los 0/)).toBeNull();
  });

  it('muestra los días hasta cada hito, y el mismo día como «el mismo día»', () => {
    render(<RecoveryMetricsSection metrics={metrics({ daysToFirstContact: 4, daysToFirstVisit: 1, daysToFirstPayment: 0 })} currency="BOB" />);
    expect(within(row('Primer contacto')).getByText('A los 4 días')).toBeInTheDocument();
    expect(within(row('Primera visita')).getByText('A los 1 día')).toBeInTheDocument();
    expect(within(row('Primer pago')).getByText('El mismo día')).toBeInTheDocument();
  });

  it('el ejemplo del pedido: gestiones desglosadas, plata recuperada y saldo de entrada', () => {
    render(
      <RecoveryMetricsSection
        currency="BOB"
        metrics={metrics({ activities: { total: 7, calls: 3, visits: 2, messages: 2 }, contacts: 2, recoveredAmount: 500, paymentsCount: 1, balanceAtStart: 7011.42 })}
      />,
    );
    expect(within(row('Gestiones')).getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3 llamadas · 2 visitas · 2 mensajes')).toBeInTheDocument();
    expect(screen.getByText('veces')).toBeInTheDocument();
    expect(within(row('Recuperado')).getByText(/Bs\s?500,00/)).toBeInTheDocument();
    expect(screen.getByText(/1 pago · de Bs\s?7\.011,42 al entrar/)).toBeInTheDocument();
  });

  it('singular y plural bien dichos, y sin promesas cerradas no dice «0 de 0»', () => {
    render(<RecoveryMetricsSection metrics={metrics({ activities: { total: 3, calls: 1, visits: 1, messages: 1 }, contacts: 1 })} currency="BOB" />);
    expect(screen.getByText('1 llamada · 1 visita · 1 mensaje')).toBeInTheDocument();
    expect(screen.getByText('vez')).toBeInTheDocument();
    expect(within(row('Promesas cumplidas')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 de 0')).toBeNull();
  });

  it('sin pagos, «Recuperado» es un cero medido y lo explica', () => {
    render(<RecoveryMetricsSection metrics={metrics()} currency="BOB" />);
    expect(within(row('Recuperado')).getByText(/Bs\s?0,00/)).toBeInTheDocument();
    expect(screen.getByText(/Sin pagos/)).toBeInTheDocument();
  });

  it('un saldo de entrada que no se midió no se muestra', () => {
    render(<RecoveryMetricsSection metrics={metrics({ balanceAtStart: undefined, recoveredAmount: 10, paymentsCount: 1 })} currency="BOB" />);
    expect(screen.queryByText(/al entrar/)).toBeNull();
  });

  it('🔴 sin promesas cerradas no hay porcentaje de cumplimiento', () => {
    render(<RecoveryMetricsSection metrics={metrics({ promises: { made: 1, active: 1, unresolved: 0, kept: 0, broken: 0 } })} currency="BOB" />);
    expect(screen.getByText(/Todavía no hay promesas cerradas/)).toBeInTheDocument();
    expect(screen.getByText(/1 vigente/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('con promesas cerradas muestra cuántas se cumplieron y el porcentaje', () => {
    render(
      <RecoveryMetricsSection
        currency="BOB"
        metrics={metrics({ promises: { made: 4, active: 0, unresolved: 1, kept: 2, broken: 1, complianceRate: 2 / 3 } })}
      />,
    );
    expect(within(row('Promesas cumplidas')).getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByText(/Cumplimiento 67 %/)).toBeInTheDocument();
  });

  it('la última mora recuperada sólo aparece si hubo una', () => {
    const { rerender } = render(<RecoveryMetricsSection metrics={metrics()} currency="BOB" />);
    expect(screen.queryByText('Última mora recuperada en')).toBeNull();
    rerender(<RecoveryMetricsSection metrics={metrics({ lastRecoveredDays: 22 })} currency="BOB" />);
    expect(within(row('Última mora recuperada en')).getByText('A los 22 días')).toBeInTheDocument();
  });

  it('lo recuperado en toda la vida sólo aparece si difiere de lo de esta mora', () => {
    const { rerender } = render(<RecoveryMetricsSection metrics={metrics({ recoveredAmount: 100, recoveredAllTime: 100 })} currency="BOB" />);
    expect(screen.queryByText('Recuperado en toda la vida del crédito')).toBeNull();
    rerender(<RecoveryMetricsSection metrics={metrics({ recoveredAmount: 100, recoveredAllTime: 450 })} currency="BOB" />);
    expect(within(row('Recuperado en toda la vida del crédito')).getByText(/Bs\s?450,00/)).toBeInTheDocument();
  });

  it('sin mora abierta es el histórico y los «días hasta…» no se inventan', () => {
    render(<RecoveryMetricsSection metrics={metrics({ window: 'ALL', since: undefined, sinceEstimated: undefined, balanceAtStart: undefined })} currency="BOB" />);
    expect(screen.getByText('Histórico del crédito: ahora no está en mora.')).toBeInTheDocument();
    expect(screen.queryByText('Todavía sin contacto')).toBeNull();
    expect(within(row('Primer contacto')).getByText('—')).toBeInTheDocument();
  });

  it('integra con el cálculo real de shared (de punta a punta)', () => {
    const m = computeRecoveryMetrics({
      now: '2026-10-10T15:00:00Z',
      episode: { startedAt: '2026-10-01', startedAtEstimated: false, balanceAtStart: 1000 },
      activities: [
        { type: 'CALL', result: 'NO_ANSWER', createdAt: '2026-10-02T10:00:00Z' },
        { type: 'VISIT', result: 'CONTACTED', createdAt: '2026-10-05T10:00:00Z' },
      ],
      payments: [{ amount: 250, paymentDate: '2026-10-06T10:00:00Z' }],
      promises: [],
    });
    render(<RecoveryMetricsSection metrics={m} currency="BOB" />);
    expect(within(row('Primer contacto')).getByText('A los 4 días')).toBeInTheDocument();
    expect(within(row('Primera visita')).getByText('A los 4 días')).toBeInTheDocument();
    expect(within(row('Primer pago')).getByText('A los 5 días')).toBeInTheDocument();
    expect(within(row('Recuperado')).getByText(/Bs\s?250,00/)).toBeInTheDocument();
  });
});

