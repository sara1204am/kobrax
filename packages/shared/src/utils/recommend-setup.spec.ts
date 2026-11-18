import { describe, it, expect } from 'vitest';
import { recommendSetup } from './recommend-setup.js';
import { WORKSPACE_PRESETS } from './workspace.js';

describe('recommendSetup (D-12)', () => {
  it.each([
    ['FREE', 'independent'],
    ['STARTER', 'independent'], // el FREE se llama así en la base
    ['PROFESSIONAL', 'team'],
    ['BUSINESS', 'complete'],
    ['ENTERPRISE', 'independent'], // no es elegible al registrarse: cae a lo simple
    ['PLAN_INVENTADO', 'independent'],
    ['', 'independent'],
  ])('%s → %s', (planCode, preset) => {
    expect(recommendSetup({ planCode }).preset).toBe(preset);
  });

  it('sin datos → Independiente, con su razón de respaldo', () => {
    expect(recommendSetup()).toEqual({
      preset: 'independent',
      reason: 'onboarding.recommend.fallback',
    });
    expect(recommendSetup({ planCode: null }).preset).toBe('independent');
    expect(recommendSetup({ planCode: undefined }).preset).toBe('independent');
  });

  it('siempre devuelve un preset que existe', () => {
    for (const planCode of ['FREE', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE', 'x']) {
      expect(WORKSPACE_PRESETS[recommendSetup({ planCode }).preset]).toBeDefined();
    }
  });

  it('Free nunca recibe Equipo ni Completo: no se le promete lo que no puede usar', () => {
    expect(['team', 'complete']).not.toContain(recommendSetup({ planCode: 'FREE' }).preset);
  });

  it('cada plan trae su propia razón (texto distinto que explica la sugerencia)', () => {
    const reasons = ['FREE', 'PROFESSIONAL', 'BUSINESS', 'zzz'].map(
      (p) => recommendSetup({ planCode: p }).reason,
    );
    expect(new Set(reasons).size).toBe(4);
    for (const r of reasons) expect(r).toMatch(/^onboarding\.recommend\.[a-z]+$/);
  });
});
