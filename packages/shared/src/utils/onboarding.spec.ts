import { describe, it, expect } from 'vitest';
import {
  GUIDE_STATE_MAX_SCREENS,
  mergeGuideState,
  sanitizeGuidePatch,
  emptyGuideState,
  newAccountOnboarding,
  parseGuideState,
  parseOnboarding,
  resolveOnboarding,
  shouldOfferWizard,
  validateGuideStateInput,
} from './onboarding.js';

const by = { userId: 'u1', at: '2026-11-14T10:00:00.000Z' };

describe('parseOnboarding', () => {
  it('cuenta anterior (sin estado) → null', () => {
    expect(parseOnboarding({})).toBeNull();
    expect(parseOnboarding(null)).toBeNull();
    expect(parseOnboarding({ onboarding: 'x' })).toBeNull();
    expect(parseOnboarding({ onboarding: { status: 'raro' } })).toBeNull();
  });
  it('lee el estado y descarta lo que no reconoce', () => {
    expect(
      parseOnboarding({
        onboarding: {
          v: 1,
          status: 'done',
          decidedBy: 'u',
          decidedAt: 'z',
          preset: 'team',
          extra: 1,
        },
      }),
    ).toEqual({
      v: 1,
      status: 'done',
      decidedBy: 'u',
      decidedAt: 'z',
      preset: 'team',
    });
  });
  it('la cuenta nueva nace pendiente y solo ahí se ofrece el asistente', () => {
    expect(newAccountOnboarding().status).toBe('pending');
    expect(shouldOfferWizard('pending')).toBe(true);
    for (const s of ['done', 'skipped', null, undefined] as const)
      expect(shouldOfferWizard(s)).toBe(false);
  });
});

describe('resolveOnboarding (D-14: el primero que resuelve gana)', () => {
  it('pendiente → hecho, con quién y cuándo (los pone el servidor)', () => {
    const r = resolveOnboarding(
      newAccountOnboarding(),
      { status: 'done', preset: 'independent' },
      by,
    );
    expect(r.changed).toBe(true);
    expect(r.state).toEqual({
      v: 1,
      status: 'done',
      decidedBy: 'u1',
      decidedAt: by.at,
      preset: 'independent',
    });
  });
  it('pendiente → omitido', () => {
    expect(resolveOnboarding(newAccountOnboarding(), { status: 'skipped' }, by).state.status).toBe(
      'skipped',
    );
  });
  it('una cuenta anterior (sin estado) puede resolverlo voluntariamente', () => {
    expect(resolveOnboarding(null, { status: 'done' }, by).changed).toBe(true);
  });
  it('ya resuelto: se conserva el primero y no cambia nada', () => {
    const first = resolveOnboarding(newAccountOnboarding(), { status: 'done' }, by).state;
    const second = resolveOnboarding(first, { status: 'skipped' }, { userId: 'u2', at: 'otra' });
    expect(second.changed).toBe(false);
    expect(second.state).toBe(first);
  });
});

describe('estado de guías por persona', () => {
  it('lectura tolerante: lo ilegible da el estado vacío y nunca lanza', () => {
    for (const bad of [undefined, null, 5, 'x', [], { tour: 3 }])
      expect(parseGuideState(bad)).toEqual(emptyGuideState());
  });
  it('descarta claves y valores no reconocidos', () => {
    const s = parseGuideState({
      tour: { status: 'inProgress', step: 3, catalogVersion: 1 },
      screens: { 'screen.portfolio': 'seen', 'a b': 'seen', 'screen.mora': 'raro' },
      welcomeSeen: true,
    });
    expect(s.tour).toEqual({ status: 'inProgress', step: 3, catalogVersion: 1 });
    expect(s.screens).toEqual({ 'screen.portfolio': 'seen' });
    expect(s.welcomeSeen).toBe(true);
    expect(s.firstStepsClosed).toBe(false);
  });
  it('la escritura estricta acepta un estado válido', () => {
    const ok = validateGuideStateInput({
      ...emptyGuideState(),
      screens: { 'screen.agenda': 'dismissed' },
    });
    expect(ok.ok).toBe(true);
  });
  it.each([
    ['no es objeto', 5, 'SHAPE'],
    ['versión distinta', { ...emptyGuideState(), v: 9 }, 'VERSION'],
    [
      'estado de recorrido inválido',
      { ...emptyGuideState(), tour: { status: 'x', step: 0, catalogVersion: 0 } },
      'TOUR',
    ],
    [
      'paso negativo',
      { ...emptyGuideState(), tour: { status: 'none', step: -1, catalogVersion: 0 } },
      'TOUR',
    ],
    [
      'clave de pantalla inválida',
      { ...emptyGuideState(), screens: { 'a b': 'seen' } },
      'SCREEN_KEY',
    ],
    [
      'valor de pantalla inválido',
      { ...emptyGuideState(), screens: { ok: 'raro' } },
      'SCREEN_VALUE',
    ],
    ['bandera no booleana', { ...emptyGuideState(), welcomeSeen: 'si' }, 'FLAGS'],
  ])('rechaza: %s', (_n, input, code) => {
    const r = validateGuideStateInput(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain(code);
  });
  it('la escritura estricta rechaza una clave que no existe, arriba o dentro de `tour` (no la descarta en silencio)', () => {
    const top = validateGuideStateInput({ ...emptyGuideState(), evil: 1 });
    expect(top.ok).toBe(false);
    const inner = validateGuideStateInput({
      ...emptyGuideState(),
      tour: { ...emptyGuideState().tour, extra: 1 },
    });
    expect(inner.ok).toBe(false);
  });
  it('un `preset` corrupto guardado a mano no llega al tipo: se ignora', () => {
    expect(
      parseOnboarding({ onboarding: { status: 'done', preset: '__raro__' } })?.preset,
    ).toBeUndefined();
    expect(parseOnboarding({ onboarding: { status: 'done', preset: 'custom' } })?.preset).toBe(
      'custom',
    );
  });
  it('rechaza más pantallas que el tope y un documento enorme, sin recorrerlo', () => {
    const many = Object.fromEntries(
      Array.from({ length: GUIDE_STATE_MAX_SCREENS + 1 }, (_, i) => [`s${i}`, 'seen']),
    );
    expect(validateGuideStateInput({ ...emptyGuideState(), screens: many }).ok).toBe(false);
    const huge = validateGuideStateInput({ ...emptyGuideState(), pad: 'x'.repeat(5000) });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.errors[0]?.code).toBe('TOO_LARGE');
  });
});

describe('mergeGuideState (parche parcial)', () => {
  const base = {
    ...emptyGuideState(),
    screens: { 'screen.portfolio': 'seen' as const },
    welcomeSeen: true,
  };
  it('lo que el parche no menciona se conserva', () => {
    const next = mergeGuideState(base, { firstStepsClosed: true });
    expect(next.welcomeSeen).toBe(true);
    expect(next.firstStepsClosed).toBe(true);
    expect(next.screens).toEqual({ 'screen.portfolio': 'seen' });
  });
  it('las pantallas se mezclan, no se reemplazan', () => {
    expect(mergeGuideState(base, { screens: { 'screen.mora': 'dismissed' } }).screens).toEqual({
      'screen.portfolio': 'seen',
      'screen.mora': 'dismissed',
    });
  });
  it('el recorrido se actualiza campo a campo', () => {
    const t = mergeGuideState(base, { tour: { status: 'inProgress', step: 3 } }).tour;
    expect(t).toEqual({ status: 'inProgress', step: 3, catalogVersion: 0 });
  });
  it('el resultado siempre es un estado válido para el servidor', () => {
    expect(
      validateGuideStateInput(mergeGuideState(base, { welcomeSeen: false, screens: { x: 'seen' } }))
        .ok,
    ).toBe(true);
  });
  it('no modifica el estado original', () => {
    const copy = JSON.parse(JSON.stringify(base));
    mergeGuideState(base, { screens: { z: 'seen' }, welcomeSeen: false });
    expect(base).toEqual(copy);
  });
});

describe('sanitizeGuidePatch (lo que el navegador puede pedir)', () => {
  it('nunca lanza: null, texto, números o listas dan un parche vacío', () => {
    for (const bad of [null, undefined, 'x', 5, [], true])
      expect(sanitizeGuidePatch(bad)).toEqual({});
  });
  it('conserva solo lo que está bien tipado y descarta el resto', () => {
    expect(
      sanitizeGuidePatch({
        welcomeSeen: true,
        firstStepsClosed: 'si',
        tour: { status: 'inProgress', step: 'a', catalogVersion: 2, extra: 1 },
        screens: { 'screen.portfolio': 'seen', 'a b': 'seen', 'screen.mora': 'raro' },
        evil: 1,
      }),
    ).toEqual({
      welcomeSeen: true,
      tour: { status: 'inProgress', catalogVersion: 2 },
      screens: { 'screen.portfolio': 'seen' },
    });
  });
  it('una propiedad `undefined` del parche no pisa lo guardado', () => {
    const base = {
      ...emptyGuideState(),
      tour: { status: 'inProgress' as const, step: 4, catalogVersion: 1 },
    };
    const next = mergeGuideState(base, { tour: { status: undefined, step: 5 } });
    expect(next.tour).toEqual({ status: 'inProgress', step: 5, catalogVersion: 1 });
  });
});
