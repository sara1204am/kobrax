import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, type Workspace } from '@kobrax/shared';

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

const getMe = vi.fn();
vi.mock('@/lib/authz', () => ({ getMe: () => getMe() }));

import { requireModuleVisible } from './workspace-guard';

const me = (workspace?: Workspace | null, status = 200) => ({
  status,
  body: { data: status === 200 ? { account: workspace === undefined ? {} : { workspace } } : null },
});

describe('requireModuleVisible (F15 · A-4)', () => {
  beforeEach(() => {
    redirect.mockClear();
    getMe.mockReset();
  });

  it('un módulo oculto vuelve a Inicio con el aviso', async () => {
    getMe.mockResolvedValue(me({ ...emptyWorkspace(), hiddenModules: ['routes'] }));
    await expect(requireModuleVisible('routes')).rejects.toThrow('NEXT_REDIRECT:/dashboard?oculto=routes');
  });

  it('un módulo visible deja pasar', async () => {
    getMe.mockResolvedValue(me({ ...emptyWorkspace(), hiddenModules: ['routes'] }));
    await expect(requireModuleVisible('team')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('🔴 A-1: sin workspace (cliente viejo, cuenta que nunca lo configuró) deja pasar todo', async () => {
    for (const w of [undefined, null, emptyWorkspace()]) {
      getMe.mockResolvedValue(me(w));
      await expect(requireModuleVisible('export')).resolves.toBeUndefined();
    }
  });

  it('si no se pudo leer la identidad no bloquea: de eso se ocupa el layout del panel', async () => {
    getMe.mockResolvedValue(me(undefined, 0));
    await expect(requireModuleVisible('routes')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });
});
