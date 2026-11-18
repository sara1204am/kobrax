import { describe, expect, it } from 'vitest';
import { WORKSPACE_PRESETS, emptyWorkspace, presetOf } from '@kobrax/shared';
import {
  SKIP_BODY,
  gatedModules,
  isUntouched,
  skipBody,
  startDraft,
  blockedModules,
  changesFromComplete,
  creditDefinitionOf,
  draftOf,
  failureOf,
  isModuleShown,
  isOptionShown,
  presetDraft,
  saveBody,
  setAdvancedCredit,
  setCreditDefinition,
  setModuleShown,
  setOptionShown,
  setTeamWork,
} from './onboarding-wizard';

const none = new Set<never>();
const empty = () => draftOf(emptyWorkspace());

describe('blockedModules (salvaguardas del servidor)', () => {
  it('una cuenta nueva (1 persona, 1 oficina) no bloquea nada', () => {
    expect(blockedModules({ users: 1, branches: 1 }).size).toBe(0);
    expect(blockedModules(undefined).size).toBe(0);
  });
  it('con más de una persona no se oculta Equipo ni Actividad; con más de una oficina, Organización', () => {
    expect([...blockedModules({ users: 3, branches: 1 })].sort()).toEqual(['activity', 'team']);
    expect([...blockedModules({ users: 1, branches: 2 })]).toEqual(['organization']);
  });
});

describe('borrador', () => {
  it('«Completo» no oculta nada; cada preset coincide con el del catálogo', () => {
    expect(presetOf(empty())).toBe('complete');
    for (const k of ['independent', 'team', 'complete'] as const)
      expect(presetOf(presetDraft(k, none))).toBe(k);
  });
  it('un preset no incluye lo que el servidor rechazaría hoy', () => {
    const d = presetDraft('independent', blockedModules({ users: 2, branches: 1 }));
    expect(d.hiddenModules).not.toContain('team');
    expect(d.hiddenModules).not.toContain('activity');
    expect(d.hiddenModules).toContain('routes');
  });
  it('ocultar y mostrar un módulo; un troncal o uno bloqueado no se oculta', () => {
    let d = setModuleShown(empty(), 'routes', false, none);
    expect(isModuleShown(d, 'routes')).toBe(false);
    d = setModuleShown(d, 'routes', true, none);
    expect(isModuleShown(d, 'routes')).toBe(true);
    expect(setModuleShown(empty(), 'portfolio' as never, false, none)).toEqual(empty());
    expect(isModuleShown(setModuleShown(empty(), 'team', false, new Set(['team'])), 'team')).toBe(
      true,
    );
  });
  it('«¿Trabajas con equipo?: no» oculta Equipo y Actividad juntos; «sí» los vuelve a mostrar', () => {
    const off = setTeamWork(empty(), false, none);
    expect(off.hiddenModules.sort()).toEqual(['activity', 'team']);
    expect(setTeamWork(off, true, none).hiddenModules).toEqual([]);
  });
  it('secciones del cliente: ocultar pone `false`, mostrar quita la clave (ausente = visible)', () => {
    const d = setOptionShown(empty(), 'client.income', false);
    expect(d.options['client.income']).toBe(false);
    expect(isOptionShown(d, 'client.income')).toBe(false);
    expect(setOptionShown(d, 'client.income', true).options).toEqual({});
  });
  it('la modalidad del crédito se fija o se libera', () => {
    const d = setCreditDefinition(empty(), 'agreed_total');
    expect(creditDefinitionOf(d)).toBe('agreed_total');
    expect(creditDefinitionOf(setCreditDefinition(d, null))).toBeNull();
  });
  it('«Opciones avanzadas» mueve junto el método de mora (vive dentro, C-4)', () => {
    const off = setAdvancedCredit(empty(), false);
    expect(off.options).toEqual({ 'credit.advanced': false, 'credit.arrearsMethod': false });
    expect(setAdvancedCredit(off, true).options).toEqual({});
  });
  it('cambios frente a «Completo» para la vista previa', () => {
    const d = setCreditDefinition(
      setOptionShown(setModuleShown(empty(), 'routes', false, none), 'client.gender', false),
      'agreed_installment',
    );
    expect(changesFromComplete(d)).toEqual({
      modules: ['routes'],
      options: ['client.gender'],
      definition: 'agreed_installment',
    });
    expect(changesFromComplete(empty())).toEqual({ modules: [], options: [], definition: null });
  });
});

describe('saveBody: una sola escritura', () => {
  it('sin cambios no manda workspace, solo la resolución del asistente', () => {
    const body = saveBody(emptyWorkspace(), empty());
    expect(body).toEqual({ onboarding: { status: 'done', preset: 'complete' } });
  });
  it('con cambios manda el workspace con el `rev` leído y el preset informativo, en la misma llamada', () => {
    const base = { ...emptyWorkspace(), rev: 4 };
    const body = saveBody(base, presetDraft('independent', none));
    expect(body.workspace).toEqual({
      version: 1,
      rev: 4,
      hiddenModules: WORKSPACE_PRESETS.independent.hiddenModules,
      options: WORKSPACE_PRESETS.independent.options,
    });
    expect(body.onboarding).toEqual({ status: 'done', preset: 'independent' });
  });
  it('una mezcla propia se informa como `custom`', () => {
    expect(
      saveBody(emptyWorkspace(), setModuleShown(empty(), 'export', false, none)).onboarding.preset,
    ).toBe('custom');
  });
  it('«Hacerlo después» solo marca el asistente como omitido: no toca el espacio de trabajo', () => {
    expect(SKIP_BODY).toEqual({ onboarding: { status: 'skipped' } });
  });
});

describe('failureOf', () => {
  it.each([
    [{ error: { code: 'WORKSPACE_CONFLICT' } }, 'conflict'],
    [{ error: { code: 'WORKSPACE_BLOCKED' } }, 'blocked'],
    [{ error: { code: 'WORKSPACE_INVALID' } }, 'invalid'],
    [{ error: { code: 'OTRO' } }, 'generic'],
    [null, 'generic'],
    [{}, 'generic'],
  ])('%j → %s', (data, expected) => {
    expect(failureOf(data)).toBe(expected);
  });
});

describe('topes del plan y arranque del asistente', () => {
  const FREE = { users: 1, branches: 1 };
  const PRO = { users: 25, branches: 3 };

  it('un solo asiento bloquea Equipo y Actividad; una sola oficina, Organización', () => {
    expect([...gatedModules(FREE)].sort()).toEqual(['activity', 'organization', 'team']);
    expect([...gatedModules({ users: 25, branches: 1 })]).toEqual(['organization']);
    expect(gatedModules(PRO).size).toBe(0);
    expect(gatedModules({ users: null, branches: null }).size).toBe(0);
    expect(gatedModules(undefined).size).toBe(0);
  });

  it('lo que la cuenta ya usa manda: no se bloquea lo que no se puede ocultar', () => {
    expect(gatedModules(FREE, new Set(['team', 'activity'] as const)).has('team')).toBe(false);
  });

  it('no se puede volver a mostrar lo que el plan no permite', () => {
    const gated = gatedModules(FREE);
    const hidden = setTeamWork(empty(), false, none, gated);
    expect(isModuleShown(hidden, 'team')).toBe(false);
    expect(isModuleShown(hidden, 'activity')).toBe(false);
    const again = setTeamWork(hidden, true, none, gated);
    expect(isModuleShown(again, 'team')).toBe(false);
    expect(isModuleShown(again, 'activity')).toBe(false);
  });

  it('el arranque sale del plan (no se pregunta) y lleva Género apagado', () => {
    const free = startDraft('FREE', none, gatedModules(FREE));
    expect(free.hiddenModules).toEqual(
      expect.arrayContaining(['team', 'activity', 'organization', 'routes', 'import', 'export']),
    );
    expect(free.options['client.gender']).toBe(false);
    const pro = startDraft('PROFESSIONAL', none, gatedModules(PRO));
    expect(pro.hiddenModules).toEqual(['import', 'export', 'organization']);
    expect(pro.options['client.gender']).toBe(false);
    expect(pro.options['client.preferredChannel']).toBeUndefined();
    expect(startDraft('BUSINESS', none, gatedModules(PRO)).hiddenModules).toEqual([]);
  });

  it('saveBody nunca deja visible lo que el plan no permite', () => {
    const body = saveBody(emptyWorkspace(), empty(), gatedModules(FREE));
    expect([...body.workspace!.hiddenModules].sort()).toEqual(['activity', 'organization', 'team']);
  });

  it('isUntouched: solo una cuenta que nunca guardó nada arranca de lo recomendado', () => {
    expect(isUntouched(emptyWorkspace())).toBe(true);
    expect(isUntouched({ ...emptyWorkspace(), rev: 2 })).toBe(false);
    expect(isUntouched({ ...emptyWorkspace(), hiddenModules: ['export'] })).toBe(false);
    expect(isUntouched({ ...emptyWorkspace(), options: { 'client.gender': false } })).toBe(false);
  });

  it('skipBody: sin nada que ocultar es SKIP_BODY; con plan individual oculta lo que no se usa', () => {
    expect(skipBody(emptyWorkspace(), gatedModules(PRO))).toBe(SKIP_BODY);
    const body = skipBody({ ...emptyWorkspace(), rev: 0 }, gatedModules(FREE));
    expect(body.onboarding).toEqual({ status: 'skipped' });
    expect([...body.workspace!.hiddenModules].sort()).toEqual(['activity', 'organization', 'team']);
    const already = {
      ...emptyWorkspace(),
      hiddenModules: ['team', 'activity', 'organization'] as never,
    };
    expect(skipBody(already, gatedModules(FREE))).toBe(SKIP_BODY);
  });

  it('failureOf reconoce que el plan no lo permite', () => {
    expect(failureOf({ error: { code: 'WORKSPACE_PLAN_GATED' } })).toBe('plan');
  });
});
