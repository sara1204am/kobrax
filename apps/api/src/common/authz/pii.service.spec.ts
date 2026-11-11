import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import type { AppConfigService } from '../../config/app-config.service';
import type { TenantContextService } from '../context/tenant-context.service';
import { PiiService } from './pii.service';

/** F14 · F4: la política de PII con los permisos REALES de cada rol (`ROLE_PERMISSIONS`), no con listas escritas a mano. */
function piiFor(role: RoleType, opts: { channel?: 'web' | 'mobile' | 'api'; mask?: boolean } = {}): PiiService {
  const permissions = [...ROLE_PERMISSIONS[role]] as string[];
  const tenant = {
    permissions,
    can: (p: string) => permissions.includes(p),
    get: () => ({ channel: opts.channel }),
  } as unknown as TenantContextService;
  return new PiiService(tenant, { piiMobileMask: opts.mask === true } as AppConfigService);
}

describe('PiiService · política pii.reveal (F14 · F4)', () => {
  it('🔴 VIEWER no puede revelar: el pedido explícito da 403 PII_REVEAL_DENIED y no ve contacto ni económicos', () => {
    const pii = piiFor(RoleType.VIEWER);
    assert.equal(pii.canReveal(), false);
    assert.equal(pii.canSeeContact(), false);
    assert.equal(pii.canSeeEconomic(), false);
    assert.throws(
      () => pii.assertCanRevealContacts(),
      (e: { getResponse?: () => { code?: string } }) => e.getResponse?.().code === 'PII_REVEAL_DENIED',
    );
  });

  it('administrador, gerente, supervisor, cobrador y auditor pueden revelar y ven contacto', () => {
    for (const r of [RoleType.ACCOUNT_ADMIN, RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR]) {
      const pii = piiFor(r);
      assert.equal(pii.canReveal(), true, r);
      assert.equal(pii.canSeeContact(), true, r);
      assert.doesNotThrow(() => pii.assertCanRevealContacts(), r);
    }
  });

  it('🔴 D-3: el documento va en claro por defecto para administrador, gerente, auditor y cobrador; el supervisor lo ve enmascarado', () => {
    assert.equal(piiFor(RoleType.ACCOUNT_ADMIN).documentInClearByDefault(), true);
    assert.equal(piiFor(RoleType.MANAGER).documentInClearByDefault(), true);
    assert.equal(piiFor(RoleType.AUDITOR).documentInClearByDefault(), true);
    assert.equal(piiFor(RoleType.COLLECTOR).documentInClearByDefault(), true);
    assert.equal(piiFor(RoleType.SUPERVISOR).documentInClearByDefault(), false);
  });

  it('D-2: PII_MOBILE_MASK apagado no cambia nada en móvil; encendido, el móvil no revela (el contacto de su cartera sí)', () => {
    assert.equal(piiFor(RoleType.COLLECTOR, { channel: 'mobile', mask: false }).canReveal(), true);
    const on = piiFor(RoleType.COLLECTOR, { channel: 'mobile', mask: true });
    assert.equal(on.canReveal(), false);
    assert.equal(on.documentInClearByDefault(), false);
    assert.equal(on.canSeeContact(), true);
    assert.equal(piiFor(RoleType.COLLECTOR, { channel: 'web', mask: true }).canReveal(), true);
  });

  it('la auditoría lleva categorías y canal, nunca valores', () => {
    const pii = piiFor(RoleType.MANAGER, { channel: 'web' });
    assert.deepEqual(pii.auditAfter('client', pii.revealedCategories(true)), { entity: 'client', categories: ['DOCUMENT', 'CONTACT', 'ECONOMIC'], channel: 'web' });
    assert.deepEqual(pii.revealedCategories(false), ['CONTACT', 'ECONOMIC']); // el supervisor en una pantalla de trabajo: sin documento
    assert.deepEqual(pii.revealedCategories(true, false), ['DOCUMENT']); // móvil con la máscara: el documento aparte de los contactos
  });
});


describe('PiiService · revelado de CONTACTOS en el móvil (F14 · F8, D-4)', () => {
  it('🔴 con la máscara encendida el canal móvil NO revela el documento, pero SÍ los contactos (el cobrador los necesita para cobrar y editar)', () => {
    const pii = piiFor(RoleType.COLLECTOR, { channel: 'mobile', mask: true });
    assert.equal(pii.canReveal(), false, 'el documento sigue tapado');
    assert.equal(pii.canRevealContacts(), true);
    assert.doesNotThrow(() => pii.assertCanRevealContacts());
  });

  it('el mismo cobrador por la web, o con la máscara apagada, revela todo como antes', () => {
    for (const opts of [{ channel: 'web' as const, mask: true }, { channel: 'mobile' as const, mask: false }]) {
      const pii = piiFor(RoleType.COLLECTOR, opts);
      assert.equal(pii.canReveal(), true);
      assert.equal(pii.canRevealContacts(), true);
    }
  });

  it('🔴 la persona de consulta (VIEWER) no revela contactos en ningún canal: 403 PII_REVEAL_DENIED', () => {
    for (const channel of ['web', 'mobile'] as const) {
      const pii = piiFor(RoleType.VIEWER, { channel, mask: true });
      assert.equal(pii.canRevealContacts(), false);
      assert.throws(() => pii.assertCanRevealContacts(), (e: { getResponse?: () => { code?: string } }) => e.getResponse?.().code === 'PII_REVEAL_DENIED');
    }
  });
});
