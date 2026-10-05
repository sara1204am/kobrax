// ui.tsx importa el net store (NetInfo nativo) para OfflineIndicator; acá no lo renderizamos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));
// Los íconos cargan expo-font, que toca módulos nativos y revienta en jest ("__fbBatchedBridgeConfig
// is not set"). Acá sólo importan las etiquetas y los tonos, no el glifo.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { render } from '@testing-library/react-native';
import { AgendaItemStatus, AgendaItemType, AgendaOutcome, COLLECTION_PRIORITIES, MORA_SITUATIONS, RouteStatus, RouteStopStatus } from '@kobrax/shared';
import { AgendaCard, AGENDA_OUTCOME_META, AGENDA_STATUS_LABEL, AGENDA_TYPE_META, CreditCard, PRIORITY_LABEL, priorityTone, ROUTE_STATUS_LABEL, SITUATION_META, situationBadge, StatTile, STOP_STATUS_META } from './ui';

describe('situación y prioridad del crédito (F4/08)', () => {
  it('hay etiqueta y tono para las dos situaciones: Al día / En mora', () => {
    for (const s of MORA_SITUATIONS) expect(SITUATION_META[s].label).toBeTruthy();
    expect(SITUATION_META.CURRENT).toEqual({ label: 'Al día', tone: 'success' });
    expect(SITUATION_META.IN_ARREARS).toEqual({ label: 'En mora', tone: 'danger' });
  });

  it('castigado es una condición aparte y gana sobre la situación (puede estar en mora y castigado)', () => {
    expect(situationBadge('IN_ARREARS', true)).toEqual({ label: 'Castigado', tone: 'neutral' });
    expect(situationBadge('CURRENT', false).label).toBe('Al día');
  });

  it('tiene etiqueta en español para todas las prioridades', () => {
    for (const p of COLLECTION_PRIORITIES) expect(PRIORITY_LABEL[p]).toBeTruthy();
  });

  it('el tono de la prioridad: crítica roja, alta ámbar, el resto neutro', () => {
    expect(priorityTone('CRITICAL')).toBe('danger');
    expect(priorityTone('HIGH')).toBe('warning');
    expect(priorityTone('LOW')).toBe('neutral');
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

describe('CreditCard', () => {
  it('renderiza nombre, subtítulo, monto y el badge de situación', () => {
    const { getByText } = render(
      <CreditCard name="García López, Roberto" subtitle="Última gestión: hoy" amount="Bs 5.000" situation="IN_ARREARS" />,
    );
    expect(getByText('García López, Roberto')).toBeTruthy();
    expect(getByText('Última gestión: hoy')).toBeTruthy();
    expect(getByText('Bs 5.000')).toBeTruthy();
    expect(getByText('En mora')).toBeTruthy();
  });

  it('un crédito sin situación indicada es «Al día»', () => {
    const { getByText } = render(<CreditCard name="Deudor X" />);
    expect(getByText('Al día')).toBeTruthy();
  });

  it('castigado muestra su pill aparte, y la categoría sale como etiqueta junto al badge', () => {
    const { getByText, queryByText } = render(<CreditCard name="Deudor Y" situation="IN_ARREARS" writtenOff tag="Cat. C" />);
    expect(getByText('Castigado')).toBeTruthy();
    expect(getByText('Cat. C')).toBeTruthy();
    expect(queryByText('En mora')).toBeNull();
  });

  it('un badge explícito gana sobre la situación', () => {
    const { getByText } = render(<CreditCard name="Z" situation="CURRENT" badge={{ label: 'Por vencer', tone: 'warning' }} />);
    expect(getByText('Por vencer')).toBeTruthy();
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
