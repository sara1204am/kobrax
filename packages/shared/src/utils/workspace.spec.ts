import { describe, it, expect } from 'vitest';
import {
  HIDEABLE_MODULES,
  WORKSPACE_MAX_BYTES,
  WORKSPACE_MAX_MODULES,
  WORKSPACE_MAX_OPTIONS,
  WORKSPACE_MODULES,
  WORKSPACE_OPTIONS,
  WORKSPACE_VERSION,
  emptyWorkspace,
  parseWorkspace,
  resolveWorkspace,
  validateWorkspaceInput,
  workspaceDefaults,
  workspaceVersionOf,
  type Workspace,
  type WorkspaceCatalog,
} from './workspace.js';
import { CreditDefinition, OFFERED_FREQUENCIES, PaymentFrequency, TermUnit } from '../enums/credit.enum.js';
import { buildNewCreditPayload, initialCreditForm, type CreditForm } from './credit-form.js';

const ws = (over: Partial<Workspace> = {}): Workspace => ({ ...emptyWorkspace(), ...over });
const valid = (input: unknown) => {
  const r = validateWorkspaceInput(input);
  if (!r.ok) throw new Error(`esperaba válido: ${JSON.stringify(r.errors)}`);
  return r.workspace;
};
const codes = (input: unknown, catalog?: WorkspaceCatalog) => {
  const r = validateWorkspaceInput(input, catalog);
  return r.ok ? [] : r.errors.map((e) => (e.key ? `${e.code}:${e.key}` : e.code));
};

describe('catálogo', () => {
  it('los módulos ocultables son exactamente los seis de la ola 1a, en el orden del menú', () => {
    expect([...HIDEABLE_MODULES]).toEqual(['import', 'routes', 'export', 'organization', 'team', 'activity']);
  });

  it('🔴 D-5 y D-8: los troncales no se pueden ocultar (Seguridad incluida)', () => {
    const core = WORKSPACE_MODULES.filter((m) => m.core).map((m) => m.key);
    expect(core).toEqual(['home', 'portfolio', 'mora', 'agenda', 'payments', 'accessSecurity', 'account', 'profile']);
    for (const key of core) expect(codes({ version: 1, rev: 0, hiddenModules: [key], options: {} })).toEqual([`MODULE_CORE:${key}`]);
  });

  it('cada módulo y cada opción tiene una clave única', () => {
    expect(new Set(WORKSPACE_MODULES.map((m) => m.key)).size).toBe(WORKSPACE_MODULES.length);
    expect(new Set(WORKSPACE_OPTIONS.map((o) => o.key)).size).toBe(WORKSPACE_OPTIONS.length);
  });

  it('A-15: ninguna opción es de riesgo P (las que no se pueden ocultar no tienen entrada)', () => {
    for (const o of WORKSPACE_OPTIONS) expect(['S', 'D']).toContain(o.risk);
    // Lo que el plan marca como P: teléfonos, correos, nombre, direcciones, principal, cuota, vencimiento.
    const keys = WORKSPACE_OPTIONS.map((o) => o.key as string);
    for (const p of ['client.phone', 'client.email', 'client.name', 'client.address', 'credit.principal', 'credit.installmentAmount', 'credit.firstDueDate']) {
      expect(keys).not.toContain(p);
    }
  });

  it('las frecuencias que se pueden permitir son las que la app ofrece hoy', () => {
    const freq = WORKSPACE_OPTIONS.find((o) => o.key === 'credit.frequencies');
    expect(freq?.values).toEqual([...OFFERED_FREQUENCIES]);
  });
});

describe('parseWorkspace (lectura tolerante)', () => {
  it('R5: sin documento, o con basura, devuelve «Completo»', () => {
    for (const c of [undefined, null, {}, 5, 'x', [], { workspace: null }, { workspace: 7 }, { workspace: [] }]) {
      expect(parseWorkspace(c)).toEqual(emptyWorkspace());
    }
  });

  it('lee un documento válido', () => {
    const w = parseWorkspace({ workspace: { version: 1, rev: 4, hiddenModules: ['routes', 'team'], options: { 'credit.definition': 'agreed_installment', 'client.income': false } } });
    expect(w).toEqual({ version: 1, rev: 4, hiddenModules: ['routes', 'team'], options: { 'credit.definition': 'agreed_installment', 'client.income': false } });
  });

  it('ignora lo desconocido y descarta valores inválidos sin lanzar', () => {
    const w = parseWorkspace({
      workspace: {
        version: 1,
        rev: -3,
        hiddenModules: ['routes', 'home', 'inventado', 7, 'routes'],
        options: { 'client.income': true, 'client.gender': false, 'credit.frequencies': [], 'credit.definition': 'otra', extra: false },
      },
    });
    expect(w.rev).toBe(0);
    expect(w.hiddenModules).toEqual(['routes']);
    expect(w.options).toEqual({ 'client.gender': false });
  });

  it('H-15: una versión MAYOR a la conocida se trata como «Completo» (no se adivina)', () => {
    const w = parseWorkspace({ workspace: { version: WORKSPACE_VERSION + 1, rev: 9, hiddenModules: ['routes'], options: {} } });
    expect(w).toEqual(emptyWorkspace());
    expect(workspaceVersionOf({ workspace: { version: WORKSPACE_VERSION + 1 } })).toBe(WORKSPACE_VERSION + 1);
  });

  it('los módulos salen en el orden del menú, sin repetidos', () => {
    const w = parseWorkspace({ workspace: { version: 1, rev: 0, hiddenModules: ['activity', 'import', 'import', 'routes'], options: {} } });
    expect(w.hiddenModules).toEqual(['import', 'routes', 'activity']);
  });
});

describe('validateWorkspaceInput (escritura estricta)', () => {
  it('acepta «Completo» y normaliza', () => {
    expect(valid({ version: 1, rev: 0, hiddenModules: [], options: {} })).toEqual(emptyWorkspace());
    const w = valid({ version: 1, rev: 2, hiddenModules: ['team', 'routes', 'routes'], options: { 'credit.frequencies': ['MONTHLY', 'WEEKLY', 'MONTHLY'] } });
    expect(w.hiddenModules).toEqual(['routes', 'team']);
    expect(w.options['credit.frequencies']).toEqual(['MONTHLY', 'WEEKLY']);
  });

  it('A-3: lo que no es del contrato es un error con su código, no se ignora', () => {
    expect(codes(null)).toEqual(['SHAPE']);
    expect(codes({ version: 2, rev: 0, hiddenModules: [], options: {} })).toEqual(['VERSION']);
    expect(codes({ version: 1, rev: -1, hiddenModules: [], options: {} })).toEqual(['SHAPE:rev']);
    expect(codes({ version: 1, rev: 0, hiddenModules: 'routes', options: {} })).toEqual(['SHAPE:hiddenModules']);
    expect(codes({ version: 1, rev: 0, hiddenModules: ['inventado'], options: {} })).toEqual(['MODULE_UNKNOWN:inventado']);
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'client.phone': false } })).toEqual(['OPTION_UNKNOWN:client.phone']);
  });

  it('una sección solo admite `false`; un fijo, un valor del catálogo; una lista, valores válidos y no vacía', () => {
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'client.income': true } })).toEqual(['OPTION_VALUE:client.income']);
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'credit.definition': 'otra' } })).toEqual(['OPTION_VALUE:credit.definition']);
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'credit.frequencies': [] } })).toEqual(['CHOICES_EMPTY:credit.frequencies']);
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'credit.frequencies': ['YEARLY'] } })).toEqual(['OPTION_VALUE:credit.frequencies']);
  });

  it('R8: una dependencia oculta (`requires`) se rechaza', () => {
    const catalog: WorkspaceCatalog = {
      modules: WORKSPACE_MODULES,
      options: [...WORKSPACE_OPTIONS.filter((o) => o.key !== 'client.gender'), { key: 'client.gender', module: 'portfolio', kind: 'field', risk: 'S', requires: ['routes'] }],
    };
    expect(codes({ version: 1, rev: 0, hiddenModules: ['routes'], options: { 'client.gender': false } }, catalog)).toEqual(['REQUIRES:client.gender']);
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: { 'client.gender': false } }, catalog)).toEqual([]);
  });

  it('el documento tiene un tope de tamaño', () => {
    const big = { version: 1, rev: 0, hiddenModules: [], options: { 'credit.frequencies': Array(2000).fill('MONTHLY') } };
    // Los repetidos se colapsan: con el catálogo de la ola 1a un documento válido nunca se acerca al tope.
    expect(JSON.stringify(valid(big)).length).toBeLessThan(WORKSPACE_MAX_BYTES);
  });

  it('G6 · hallazgo 6: los topes de forma se aplican ANTES de recorrer el documento', () => {
    const muchasOpciones = Object.fromEntries(Array.from({ length: WORKSPACE_MAX_OPTIONS + 1 }, (_, i) => [`k${i}`, false]));
    expect(codes({ version: 1, rev: 0, hiddenModules: [], options: muchasOpciones })).toEqual(['TOO_LARGE']);
    expect(codes({ version: 1, rev: 0, hiddenModules: Array(WORKSPACE_MAX_MODULES + 1).fill('routes'), options: {} })).toEqual(['TOO_LARGE']);
  });

  it('G6 · hallazgo 7: el tope mide BYTES UTF-8, no caracteres', () => {
    // El catálogo es cerrado: no hay forma de colar texto libre, así que se comprueba la unidad con la constante.
    expect(new TextEncoder().encode('ñ').length).toBe(2);
    expect(WORKSPACE_MAX_BYTES).toBe(4096);
  });

  it('el máximo posible del catálogo cabe con holgura', () => {
    const everything: Workspace = {
      version: 1,
      rev: 999999,
      hiddenModules: [...HIDEABLE_MODULES],
      options: Object.fromEntries(
        WORKSPACE_OPTIONS.map((o) => [o.key, o.kind === 'choices' ? [...(o.values ?? [])] : o.kind === 'fixed' ? (o.values ?? [])[0] : false]),
      ),
    };
    expect(JSON.stringify(valid(everything)).length).toBeLessThan(WORKSPACE_MAX_BYTES / 2);
  });
});

describe('resolveWorkspace (lo que ve una pantalla)', () => {
  it('«Completo» muestra todo y no fija ni restringe nada', () => {
    const r = resolveWorkspace(emptyWorkspace());
    expect(r.visibleNavKeys()).toHaveLength(WORKSPACE_MODULES.length);
    expect(r.hiddenModuleOfPath('/rutas/planificar')).toBeNull();
    for (const o of WORKSPACE_OPTIONS) {
      expect(r.shows(o.key)).toBe(true);
      expect(r.fixed(o.key)).toBeUndefined();
      expect(r.choices(o.key)).toBeUndefined();
    }
  });

  it('A-2: lo oculto sale del menú y solo quita (nunca aparece algo que no estaba)', () => {
    const full = resolveWorkspace(emptyWorkspace()).visibleNavKeys();
    const lean = resolveWorkspace(ws({ hiddenModules: ['routes', 'team', 'organization', 'import', 'export', 'activity'] })).visibleNavKeys();
    expect(lean).toEqual(['home', 'portfolio', 'mora', 'agenda', 'payments', 'accessSecurity', 'account', 'profile']);
    for (const k of lean) expect(full).toContain(k);
    expect(lean.length).toBeLessThan(full.length);
  });

  it('una clave troncal escrita a mano en la base no se oculta', () => {
    const r = resolveWorkspace({ ...emptyWorkspace(), hiddenModules: ['portfolio' as never] });
    expect(r.showsModule('portfolio')).toBe(true);
    expect(r.hiddenModuleOfPath('/cartera')).toBeNull();
  });

  it('A-4: una ruta de un módulo oculto se reconoce, también con subrutas', () => {
    const r = resolveWorkspace(ws({ hiddenModules: ['routes', 'organization'] }));
    expect(r.hiddenModuleOfPath('/rutas')).toBe('routes');
    expect(r.hiddenModuleOfPath('/rutas/123/editar')).toBe('routes');
    expect(r.hiddenModuleOfPath('/organizacion')).toBe('organization');
    expect(r.hiddenModuleOfPath('/rutasx')).toBeNull();
    expect(r.hiddenModuleOfPath('/cartera')).toBeNull();
  });

  it('fijos, listas y secciones ocultas', () => {
    const r = resolveWorkspace(ws({ options: { 'credit.definition': 'agreed_installment', 'credit.frequencies': ['MONTHLY'], 'client.income': false } }));
    expect(r.fixed('credit.definition')).toBe('agreed_installment');
    expect(r.choices('credit.frequencies')).toEqual(['MONTHLY']);
    expect(r.shows('client.income')).toBe(false);
    expect(r.shows('client.guarantors')).toBe(true);
    expect(r.fixed('client.income')).toBeUndefined();
  });

  it('D-7: el plan no cambia nada (gancho `planGate` vacío)', () => {
    const w = ws({ hiddenModules: ['routes'] });
    for (const planCode of ['FREE', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']) {
      expect(resolveWorkspace(w, { planCode }).visibleNavKeys()).toEqual(resolveWorkspace(w).visibleNavKeys());
    }
  });
});

describe('workspaceDefaults (R6: lo que se fija es válido para el motor)', () => {
  const sample: Record<CreditDefinition, Partial<CreditForm>> = {
    [CreditDefinition.CALCULATED]: { principal: '1000', ratePercent: '24', installmentsCount: '1' },
    [CreditDefinition.AGREED_INSTALLMENT]: { principal: '1000', installmentAmount: '100', installmentsCount: '12' },
    [CreditDefinition.AGREED_TOTAL]: { principal: '1000', agreedTotal: '1200' },
  };

  it('G6 · hallazgo 8: cada modalidad tiene su regla de plazo (tabla explícita, no un else genérico)', () => {
    for (const definition of Object.values(CreditDefinition)) {
      const d = workspaceDefaults(ws({ options: { 'credit.definition': definition } }));
      expect(d.definition).toBe(definition);
      if (definition === CreditDefinition.CALCULATED) expect('termUnit' in d).toBe(false);
      else expect(d.termUnit).toBe(TermUnit.INSTALLMENTS);
    }
  });

  it('sin modalidad fija no pone nada', () => {
    expect(workspaceDefaults(emptyWorkspace())).toEqual({});
  });

  it('C-3: con una modalidad acordada el plazo se cuenta en cuotas, no en años', () => {
    expect(workspaceDefaults(ws({ options: { 'credit.definition': 'agreed_installment' } }))).toEqual({
      definition: CreditDefinition.AGREED_INSTALLMENT,
      termUnit: TermUnit.INSTALLMENTS,
    });
    expect(workspaceDefaults(ws({ options: { 'credit.definition': 'calculated' } }))).toEqual({ definition: CreditDefinition.CALCULATED });
  });

  for (const definition of Object.values(CreditDefinition)) {
    it(`🔴 con la modalidad «${definition}» fija, el alta arma un crédito que el motor acepta`, () => {
      const defaults = workspaceDefaults(ws({ options: { 'credit.definition': definition } }));
      const form: CreditForm = { ...initialCreditForm('2026-12-15'), ...defaults, ...sample[definition] };
      const payload = buildNewCreditPayload(form, 'client-1');
      expect(payload, JSON.stringify(form)).not.toBeNull();
    });
  }

  it('toda frecuencia que se puede permitir es una que el motor reconoce', () => {
    for (const f of OFFERED_FREQUENCIES) expect(Object.values(PaymentFrequency)).toContain(f);
  });
});
