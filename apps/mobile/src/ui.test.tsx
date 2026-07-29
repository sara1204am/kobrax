// ui.tsx importa el net store (NetInfo nativo) para OfflineIndicator; acá no lo renderizamos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
// Los íconos cargan expo-font, que toca módulos nativos y revienta en jest ("__fbBatchedBridgeConfig
// is not set"). Acá sólo importan las etiquetas y los tonos, no el glifo.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { render } from '@testing-library/react-native';
import { AgendaItemStatus, AgendaItemType, AgendaOutcome, CasePriority, CaseStatus, RouteStatus, RouteStopStatus } from '@kobrax/shared';
import { AgendaCard, AGENDA_OUTCOME_META, AGENDA_STATUS_LABEL, AGENDA_TYPE_META, CaseCard, CASE_PRIORITY_LABEL, CASE_STATUS_LABEL, caseStatusTone, ROUTE_STATUS_LABEL, StatTile, STOP_STATUS_META } from './ui';

describe('caseStatusTone', () => {
  it('mapea estados a tonos coherentes', () => {
    expect(caseStatusTone(CaseStatus.PAID)).toBe('success');
    expect(caseStatusTone(CaseStatus.WRITTEN_OFF)).toBe('danger');
    expect(caseStatusTone(CaseStatus.IN_NEGOTIATION)).toBe('warning');
    expect(caseStatusTone(CaseStatus.PENDING)).toBe('neutral');
  });

  it('tiene etiqueta en español para todos los estados', () => {
    for (const s of Object.values(CaseStatus)) {
      expect(CASE_STATUS_LABEL[s]).toBeTruthy();
    }
  });

  it('tiene etiqueta en español para todas las prioridades', () => {
    for (const p of Object.values(CasePriority)) {
      expect(CASE_PRIORITY_LABEL[p]).toBeTruthy();
    }
  });

  it('tiene etiqueta + tono para todos los desenlaces de gestión (S4)', () => {
    for (const o of Object.values(AgendaOutcome)) {
      expect(AGENDA_OUTCOME_META[o]?.label).toBeTruthy();
    }
    expect(AGENDA_OUTCOME_META[AgendaOutcome.PROMISE_BROKEN].tone).toBe('danger');
    expect(AGENDA_OUTCOME_META[AgendaOutcome.PROMISE_KEPT].tone).toBe('success');
  });
});

describe('Rutas meta (S1)', () => {
  it('hay etiqueta para todo estado de ruta y etiqueta + tono para toda parada', () => {
    for (const s of Object.values(RouteStatus)) expect(ROUTE_STATUS_LABEL[s]).toBeTruthy();
    for (const s of Object.values(RouteStopStatus)) expect(STOP_STATUS_META[s].label).toBeTruthy();
    expect(STOP_STATUS_META[RouteStopStatus.VISITED].tone).toBe('success');
    expect(STOP_STATUS_META[RouteStopStatus.SKIPPED].tone).toBe('warning');
  });
});

describe('StatTile', () => {
  it('muestra valor y label', () => {
    const { getByText } = render(<StatTile label="En mora" value="7" tone="danger" />);
    expect(getByText('7')).toBeTruthy();
    expect(getByText('En mora')).toBeTruthy();
  });
});

describe('CaseCard', () => {
  it('renderiza nombre, subtítulo, monto y el badge de estado', () => {
    const { getByText } = render(
      <CaseCard name="García López, Roberto" subtitle="Alta · 3 días de mora" amount="Bs 5.000" status={CaseStatus.ACTIVE} />,
    );
    expect(getByText('García López, Roberto')).toBeTruthy();
    expect(getByText('Alta · 3 días de mora')).toBeTruthy();
    expect(getByText('Bs 5.000')).toBeTruthy();
    expect(getByText(CASE_STATUS_LABEL[CaseStatus.ACTIVE])).toBeTruthy();
  });

  it('un caso vencido muestra la pill "Vencida"', () => {
    const { getByText } = render(<CaseCard name="Deudor X" status={CaseStatus.ACTIVE} overdue />);
    expect(getByText('Vencida')).toBeTruthy();
  });
});

describe('Agenda meta + AgendaCard', () => {
  it('hay ícono/label/tono para cada tipo y etiqueta para cada estado', () => {
    for (const t of Object.values(AgendaItemType)) expect(AGENDA_TYPE_META[t].label).toBeTruthy();
    for (const s of Object.values(AgendaItemStatus)) expect(AGENDA_STATUS_LABEL[s]).toBeTruthy();
  });

  it('AgendaCard renderiza nombre, hora + tipo, y estado', () => {
    const { getByText } = render(
      <AgendaCard name="Ana Ruiz" icon="📞" typeLabel="Llamada" time="09:30" statusLabel="Agendada" tone="info" />,
    );
    expect(getByText('Ana Ruiz')).toBeTruthy();
    expect(getByText('09:30 · Llamada')).toBeTruthy();
    expect(getByText('Agendada')).toBeTruthy();
  });
});
