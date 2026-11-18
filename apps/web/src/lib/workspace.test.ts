import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '@kobrax/shared';
import { workspaceOfMe } from './workspace';

describe('workspaceOfMe', () => {
  it('sin identidad, sin cuenta o sin workspace es «Completo»', () => {
    for (const me of [undefined, null, {}, { account: null }, { account: {} }, { account: { workspace: null } }]) {
      expect(workspaceOfMe(me).showsModule('routes')).toBe(true);
    }
  });

  it('respeta lo que la organización ocultó y no toca los troncales', () => {
    const w = workspaceOfMe({ account: { workspace: { ...emptyWorkspace(), hiddenModules: ['routes'] } } });
    expect(w.showsModule('routes')).toBe(false);
    expect(w.showsModule('portfolio')).toBe(true);
  });
});
