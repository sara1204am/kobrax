import { describe, expect, it } from 'vitest';
import { RoleType } from '../enums/role.enum.js';
import { ROLE_PERMISSIONS } from '../constants/permissions.js';
import {
  canReveal,
  canSeeContact,
  canSeeEconomic,
  documentInClearByDefault,
  hasOwnScopeOnly,
  piiChannelOf,
  PiiCategory,
  visiblePiiCategories,
  type PiiActor,
} from './pii-fields.js';

const actorOf = (role: RoleType, extra: Partial<PiiActor> = {}): PiiActor => ({ permissions: ROLE_PERMISSIONS[role], ...extra });

describe('pii-fields · matriz por rol (F14 · F4)', () => {
  it('administrador, gerente, supervisor, cobrador y auditor ven contacto y económicos; VIEWER no', () => {
    for (const r of [RoleType.ACCOUNT_ADMIN, RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR]) {
      expect(canSeeContact(actorOf(r)), r).toBe(true);
      expect(canSeeEconomic(actorOf(r)), r).toBe(true);
    }
    expect(canSeeContact(actorOf(RoleType.VIEWER))).toBe(false);
    expect(canSeeEconomic(actorOf(RoleType.VIEWER))).toBe(false);
  });

  it('🔴 VIEWER no puede revelar el documento (antes bastaba client:read)', () => {
    expect(canReveal(actorOf(RoleType.VIEWER))).toBe(false);
    expect(visiblePiiCategories(actorOf(RoleType.VIEWER))).toEqual([]);
    for (const r of [RoleType.ACCOUNT_ADMIN, RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR]) {
      expect(canReveal(actorOf(r)), r).toBe(true);
      expect(visiblePiiCategories(actorOf(r)), r).toEqual([PiiCategory.DOCUMENT, PiiCategory.CONTACT, PiiCategory.ECONOMIC]);
    }
  });

  it('🔴 D-3: el documento va en claro por defecto para administrador, gerente, auditor y cobrador; el supervisor lo ve enmascarado', () => {
    expect(documentInClearByDefault(actorOf(RoleType.ACCOUNT_ADMIN))).toBe(true);
    expect(documentInClearByDefault(actorOf(RoleType.MANAGER))).toBe(true);
    expect(documentInClearByDefault(actorOf(RoleType.AUDITOR))).toBe(true);
    expect(documentInClearByDefault(actorOf(RoleType.COLLECTOR))).toBe(true);
    expect(documentInClearByDefault(actorOf(RoleType.SUPERVISOR))).toBe(false);
    expect(documentInClearByDefault(actorOf(RoleType.VIEWER))).toBe(false);
  });

  it('el alcance «propio» es la ausencia de las tres capacidades de alcance mayor', () => {
    expect(hasOwnScopeOnly(actorOf(RoleType.COLLECTOR))).toBe(true);
    expect(hasOwnScopeOnly(actorOf(RoleType.SUPERVISOR))).toBe(false);
    expect(hasOwnScopeOnly(actorOf(RoleType.MANAGER))).toBe(false);
  });
});

describe('pii-fields · canal móvil (D-2, apagado por omisión)', () => {
  it('con el interruptor apagado el móvil se comporta como la web (la edición de cliente del móvil todavía revela)', () => {
    expect(canReveal(actorOf(RoleType.COLLECTOR, { channel: 'mobile' }))).toBe(true);
    expect(canReveal(actorOf(RoleType.COLLECTOR, { channel: 'mobile', mobileMask: false }))).toBe(true);
  });

  it('con el interruptor encendido, el móvil no revela ni muestra el documento por defecto, ni siquiera el cobrador', () => {
    const mobile = actorOf(RoleType.COLLECTOR, { channel: 'mobile', mobileMask: true });
    expect(canReveal(mobile)).toBe(false);
    expect(documentInClearByDefault(mobile)).toBe(false);
    expect(canSeeContact(mobile)).toBe(true); // el contacto de su cartera sí (excepción estrecha de la matriz)
    // y la web / api no cambian
    expect(canReveal(actorOf(RoleType.COLLECTOR, { channel: 'web', mobileMask: true }))).toBe(true);
    expect(canReveal(actorOf(RoleType.COLLECTOR, { channel: 'api', mobileMask: true }))).toBe(true);
  });

  it('el encabezado x-client-type se normaliza; lo desconocido es api', () => {
    expect(piiChannelOf('mobile')).toBe('mobile');
    expect(piiChannelOf('MOBILE')).toBe('mobile');
    expect(piiChannelOf('web')).toBe('web');
    expect(piiChannelOf(undefined)).toBe('api');
    expect(piiChannelOf('curl')).toBe('api');
  });
});
