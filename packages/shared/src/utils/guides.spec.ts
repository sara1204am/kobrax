import { describe, it, expect } from 'vitest';
import {
  GUIDE_CATALOG_VERSION,
  SCREEN_GUIDES,
  TOUR_STEPS,
  guideSteps,
  helpEntries,
  screenGuideSteps,
  type ScreenGuideModule,
} from './guides.js';
import {
  WORKSPACE_MODULES,
  WORKSPACE_PRESETS,
  resolveWorkspace,
  emptyWorkspace,
  type WorkspaceNavKey,
} from './workspace.js';

const navKeys = WORKSPACE_MODULES.map((m) => m.key);
const keysOf = (preset: keyof typeof WORKSPACE_PRESETS): WorkspaceNavKey[] =>
  resolveWorkspace({
    ...emptyWorkspace(),
    hiddenModules: WORKSPACE_PRESETS[preset].hiddenModules,
  }).visibleNavKeys();

describe('catálogo de recorrido', () => {
  it('tiene versión', () => {
    expect(GUIDE_CATALOG_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('una entrada por cada clave del menú, en el orden del menú, y después la barra superior', () => {
    const nav = TOUR_STEPS.filter((s) => s.kind === 'nav').map((s) => s.key);
    expect(nav).toEqual(navKeys);
    const firstTopbar = TOUR_STEPS.findIndex((s) => s.kind === 'topbar');
    expect(TOUR_STEPS.slice(firstTopbar).every((s) => s.kind === 'topbar')).toBe(true);
  });

  it('ids, anclas y claves de texto únicos y con formato válido', () => {
    for (const field of ['id', 'target', 'textKey'] as const) {
      const values = TOUR_STEPS.map((s) => s[field]);
      expect(new Set(values).size).toBe(values.length);
    }
    for (const s of TOUR_STEPS) {
      expect(s.id).toMatch(/^tour\.(nav|topbar)\.[A-Za-z]+$/);
      expect(s.target).toMatch(/^(nav|topbar)\.[A-Za-z]+$/);
      expect(s.textKey).toMatch(/^guides\.tour\.(nav|topbar)\.[A-Za-z]+$/);
    }
  });
});

describe('guideSteps (D-18: solo lo que existe para esa persona)', () => {
  it('con todo visible y una sola organización: 14 del menú + 4 de la barra = 18', () => {
    const steps = guideSteps({ visibleNavKeys: keysOf('complete') });
    expect(steps).toHaveLength(18);
    expect(steps.some((s) => s.key === 'accountSwitcher')).toBe(false);
  });

  it('el cambio de organización solo sale con más de una', () => {
    const steps = guideSteps({ visibleNavKeys: keysOf('complete'), multipleAccounts: true });
    expect(steps).toHaveLength(19);
    expect(steps.at(-1)?.key).toBe('accountSwitcher');
  });

  it('con «Independiente» (8 módulos visibles + 4 de la barra) salen 12 pasos', () => {
    const steps = guideSteps({ visibleNavKeys: keysOf('independent') });
    expect(steps).toHaveLength(12);
  });

  it('un módulo oculto o sin permiso se salta; un troncal con permiso siempre está', () => {
    const steps = guideSteps({ visibleNavKeys: keysOf('independent') });
    const keys = steps.map((s) => s.key);
    for (const hidden of WORKSPACE_PRESETS.independent.hiddenModules)
      expect(keys).not.toContain(hidden);
    for (const core of [
      'home',
      'portfolio',
      'mora',
      'agenda',
      'payments',
      'accessSecurity',
      'account',
      'profile',
    ]) {
      expect(keys).toContain(core);
    }
  });

  it('criterio de aceptación (Q-2): un paso por cada módulo visible y por cada elemento fijo de la barra', () => {
    for (const preset of ['independent', 'team', 'complete'] as const) {
      const visible = keysOf(preset);
      const steps = guideSteps({ visibleNavKeys: visible });
      expect(steps.filter((s) => s.kind === 'nav').map((s) => s.key)).toEqual(visible);
      expect(steps.filter((s) => s.kind === 'topbar').map((s) => s.key)).toEqual([
        'language',
        'help',
        'notifications',
        'sessionMenu',
      ]);
    }
  });

  it('R1 solo quita: nunca devuelve un paso que no esté en el catálogo ni uno de un módulo no visible', () => {
    const steps = guideSteps({ visibleNavKeys: ['home', 'account'] });
    expect(steps.filter((s) => s.kind === 'nav').map((s) => s.key)).toEqual(['home', 'account']);
    for (const s of steps) expect(TOUR_STEPS).toContain(s);
  });

  it('sin ningún módulo visible solo queda la barra superior y no truena', () => {
    const steps = guideSteps({ visibleNavKeys: [] });
    expect(steps.every((s) => s.kind === 'topbar')).toBe(true);
  });

  it('es estable: el mismo contexto da el mismo orden', () => {
    const ctx = { visibleNavKeys: keysOf('team') };
    expect(guideSteps(ctx).map((s) => s.id)).toEqual(guideSteps(ctx).map((s) => s.id));
  });
});

describe('guías de pantalla', () => {
  const modules = Object.keys(SCREEN_GUIDES) as ScreenGuideModule[];

  it('cada módulo con guía es un módulo del menú y tiene de 2 a 4 pasos', () => {
    for (const m of modules) {
      expect(navKeys).toContain(m);
      expect(SCREEN_GUIDES[m].length).toBeGreaterThanOrEqual(2);
      expect(SCREEN_GUIDES[m].length).toBeLessThanOrEqual(4);
    }
  });

  it('ids, anclas y claves únicos con formato válido', () => {
    const all = modules.flatMap((m) => SCREEN_GUIDES[m]);
    for (const field of ['id', 'target', 'textKey'] as const) {
      expect(new Set(all.map((s) => s[field])).size).toBe(all.length);
    }
    for (const s of all) {
      expect(s.id).toBe(`screen.${s.module}.${s.action}`);
      expect(s.textKey).toBe(`guides.screen.${s.module}.${s.action}`);
    }
  });

  it('solo se ofrece la guía de un módulo que la persona ve', () => {
    expect(screenGuideSteps('routes', { visibleNavKeys: keysOf('independent') })).toEqual([]);
    expect(screenGuideSteps('portfolio', { visibleNavKeys: keysOf('independent') })).toHaveLength(
      SCREEN_GUIDES.portfolio.length,
    );
  });

  it('el módulo de la guía y las guías del recorrido no se contradicen: los de D-16 están', () => {
    for (const m of [
      'portfolio',
      'mora',
      'agenda',
      'payments',
      'routes',
      'team',
      'organization',
    ] as const) {
      expect(modules).toContain(m);
    }
  });
});

describe('centro de ayuda (misma fuente)', () => {
  it('una entrada por módulo visible, en el orden del menú, con las acciones de su guía de pantalla', () => {
    const visible = keysOf('independent');
    const entries = helpEntries({ visibleNavKeys: visible });
    expect(entries.map((e) => e.module)).toEqual(visible);
    const portfolio = entries.find((e) => e.module === 'portfolio');
    expect(portfolio?.actions).toEqual(SCREEN_GUIDES.portfolio);
    expect(entries.find((e) => e.module === 'home')?.actions).toEqual([]);
  });

  it('claves únicas con formato válido', () => {
    const entries = helpEntries({ visibleNavKeys: keysOf('complete') });
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) {
      expect(e.id).toBe(`help.${e.module}`);
      expect(e.textKey).toBe(`guides.help.${e.module}`);
    }
  });

  it('no ofrece ayuda de un módulo oculto', () => {
    const keys = helpEntries({ visibleNavKeys: keysOf('independent') }).map((e) => e.module);
    expect(keys).not.toContain('routes');
  });
});
