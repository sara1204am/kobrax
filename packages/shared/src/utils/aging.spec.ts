import { describe, expect, it } from 'vitest';
import { AGING_BUCKETS, agingBucket } from './aging.js';

describe('agingBucket', () => {
  it('🔴 los bordes caen donde tienen que caer', () => {
    // 450 y 451 son el par que importa: es el tramo que la cartera sembrada llega a tocar.
    expect(agingBucket(450)).toBe('D361_450');
    expect(agingBucket(451)).toBe('D450_PLUS');
    expect(agingBucket(1)).toBe('D1_30');
    expect(agingBucket(30)).toBe('D1_30');
    expect(agingBucket(31)).toBe('D31_90');
    expect(agingBucket(9999)).toBe('D450_PLUS');
  });

  it('🔴 un crédito al día NO es el primer tramo', () => {
    // Contarlo en «1-30 días» llena el tramo más chico con la cartera sana y el gráfico deja de
    // decir nada.
    expect(agingBucket(0)).toBeNull();
    expect(agingBucket(-3)).toBeNull();
    expect(agingBucket(Number.NaN)).toBeNull();
  });

  it('los tramos no dejan huecos ni se pisan', () => {
    // Un hueco pierde créditos del gráfico sin avisar; un solape los cuenta dos veces.
    for (let i = 1; i < AGING_BUCKETS.length; i++) {
      expect(AGING_BUCKETS[i]!.min).toBe(AGING_BUCKETS[i - 1]!.max! + 1);
    }
    expect(AGING_BUCKETS[AGING_BUCKETS.length - 1]!.max).toBeNull();
  });
});
