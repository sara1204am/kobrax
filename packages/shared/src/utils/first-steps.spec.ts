import { describe, it, expect } from 'vitest';
import { FIRST_STEP_DEFS, firstSteps } from './first-steps.js';
import { Permission } from '../enums/permission.enum.js';
import { WORKSPACE_MODULES, type WorkspaceNavKey } from './workspace.js';

const ALL_NAV = WORKSPACE_MODULES.map((m) => m.key);
const ALL_PERMS = [Permission.CLIENT_CREATE, Permission.CREDIT_CREATE, Permission.PAYMENT_WRITE];
const keys = (v: ReturnType<typeof firstSteps>) => v.steps.map((s) => s.key);

describe('firstSteps (derivado de datos reales)', () => {
  it('con todo el acceso y una cuenta vacía: tres tareas pendientes, en el orden en que se hacen', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: ALL_PERMS,
      counts: { clients: 0, credits: 0, payments: 0 },
    });
    expect(keys(v)).toEqual(['createClient', 'createCredit', 'registerPayment']);
    expect(v.steps.every((s) => !s.done)).toBe(true);
    expect(v.complete).toBe(false);
  });

  it('una tarea está hecha cuando ya hay datos, no cuando se vio la pantalla', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: ALL_PERMS,
      counts: { clients: 3, credits: 0, payments: 0 },
    });
    expect(v.steps.map((s) => s.done)).toEqual([true, false, false]);
  });

  it('con todo hecho la tarjeta se completa sola', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: ALL_PERMS,
      counts: { clients: 1, credits: 1, payments: 1 },
    });
    expect(v.complete).toBe(true);
  });

  it('🔴 R1: sin el permiso no se sugiere la tarea', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: [Permission.CLIENT_CREATE],
      counts: { clients: 0, credits: 0, payments: 0 },
    });
    expect(keys(v)).toEqual(['createClient']);
  });

  it('un módulo que la persona no ve no aporta tareas aunque tenga el permiso', () => {
    const noPayments = ALL_NAV.filter((k) => k !== 'payments') as WorkspaceNavKey[];
    const v = firstSteps({
      visibleNavKeys: noPayments,
      permissions: ALL_PERMS,
      counts: { clients: 0, credits: 0, payments: 0 },
    });
    expect(keys(v)).not.toContain('registerPayment');
  });

  it('no se afirma lo que no se sabe: un conteo que no se pudo leer quita esa tarea', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: ALL_PERMS,
      counts: { clients: 0 },
    });
    expect(keys(v)).toEqual(['createClient']);
  });

  it('sin ninguna tarea aplicable no hay tarjeta ni «completo» (nada que celebrar)', () => {
    const v = firstSteps({
      visibleNavKeys: ALL_NAV,
      permissions: [],
      counts: { clients: 0, credits: 0, payments: 0 },
    });
    expect(v).toEqual({ steps: [], complete: false });
  });

  it('cada tarea apunta a una ruta del módulo donde se hace', () => {
    for (const d of FIRST_STEP_DEFS) {
      const mod = WORKSPACE_MODULES.find((m) => m.key === d.module)!;
      expect(mod.routes.some((r) => d.href === r || d.href.startsWith(`${r}/`))).toBe(true);
    }
  });
});
