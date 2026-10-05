import type { MoraCreditListItem } from '@kobrax/shared';
import { PortfolioStatus } from '@kobrax/shared';
import { toRouteCandidates } from './route-candidates';

const row = (over: Partial<MoraCreditListItem>): MoraCreditListItem =>
  ({ creditId: 'cr1', clientId: 'cl1', clientName: 'Ana', currency: 'BOB', daysPastDue: 5, ...over }) as MoraCreditListItem;

describe('toRouteCandidates', () => {
  it('una candidata por crédito, aunque el cliente tenga varios', () => {
    const c = toRouteCandidates([row({ creditId: 'cr1', code: 'A-1' }), row({ creditId: 'cr2', code: 'A-2' }), row({ creditId: 'cr3', clientId: 'cl2', clientName: 'Beto' })]);
    expect(c.map((x) => x.creditId)).toEqual(['cr1', 'cr2', 'cr3']);
    expect(c[0]!.name).toBe('Ana · A-1'); // se distinguen por el código
    expect(c[2]!.name).toBe('Beto');
  });

  it('toma zona, ubicaciones, saldo y estado del crédito', () => {
    const loc = { id: 'l1', locationType: 'HOME', latitude: 1, longitude: 2 };
    const [c] = toRouteCandidates([row({ zone: 'Norte', locations: [loc], balance: 800 })]);
    expect(c).toMatchObject({ zone: 'Norte', locations: [loc], balance: 800, status: PortfolioStatus.OVERDUE, secondaryLine: '5 días de mora' });
  });

  it('sin saldo ni ubicaciones no rompe; al día es CURRENT', () => {
    const [c] = toRouteCandidates([row({ daysPastDue: 0 })]);
    expect(c).toMatchObject({ balance: 0, locations: [], status: PortfolioStatus.CURRENT, secondaryLine: 'Al día' });
  });
});
