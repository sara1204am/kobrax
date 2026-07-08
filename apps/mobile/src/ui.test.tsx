// ui.tsx importa el net store (NetInfo nativo) para OfflineIndicator; acá no lo renderizamos.
jest.mock('./store/net', () => ({ useNetStore: (sel: (s: unknown) => unknown) => sel({ isConnected: true, pendingCount: 0 }) }));

import { render } from '@testing-library/react-native';
import { CasePriority, CaseStatus } from '@kobrax/shared';
import { CaseCard, CASE_PRIORITY_LABEL, CASE_STATUS_LABEL, caseStatusTone, StatTile } from './ui';

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
});

describe('StatTile', () => {
  it('muestra valor y label', () => {
    const { getByText } = render(<StatTile label="En mora" value="7" tone="danger" />);
    expect(getByText('7')).toBeTruthy();
    expect(getByText('En mora')).toBeTruthy();
  });
});

describe('CaseCard', () => {
  it('renderiza título, subtítulo y el badge de estado', () => {
    const { getByText } = render(
      <CaseCard title="Caso abc12345" subtitle="HIGH · 3 días de mora" status={CaseStatus.ACTIVE} />,
    );
    expect(getByText('Caso abc12345')).toBeTruthy();
    expect(getByText('HIGH · 3 días de mora')).toBeTruthy();
    expect(getByText(CASE_STATUS_LABEL[CaseStatus.ACTIVE])).toBeTruthy();
  });
});
