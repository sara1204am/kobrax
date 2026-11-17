import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LegalAcceptanceSource, LegalConsentPurpose, LegalConsentStatus, LegalDocumentType } from '@kobrax/shared';
import { LegalSelfService } from './legal-self.service';
import { LegalService } from './legal.service';
import { sha256Hex } from './legal.logic';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface V {
  id: string;
  type: LegalDocumentType;
  locale: string;
  version: string;
  title: string;
  contentSha256: string;
  effectiveAt: Date;
  publishedAt: Date;
  isMaterial: boolean;
}
const ver = (id: string, type: LegalDocumentType, eff: string, isMaterial = false): V => ({
  id,
  type,
  locale: 'es',
  version: id,
  title: id,
  contentSha256: sha256Hex(id),
  effectiveAt: new Date(eff),
  publishedAt: new Date(eff),
  isMaterial,
});

interface Acc {
  userId: string;
  documentVersionId: string;
  action: string;
  source: string;
  accountId: string | null;
}
interface Con {
  userId: string;
  purpose: string;
  status: string;
  source: string;
  recordedAt: Date;
}

function make(opts: { versions: V[]; accepted?: V[]; consents?: Con[]; userId?: string | null }) {
  const accRows: Acc[] = (opts.accepted ?? []).map((v) => ({ userId: 'u1', documentVersionId: v.id, action: 'X', source: 'SIGNUP_WEB', accountId: null }));
  const conRows: Con[] = [...(opts.consents ?? [])];
  const byId = new Map(opts.versions.map((v) => [v.id, v]));
  const tx = {
    legalDocumentVersion: {
      findMany: async (a: { where: { type?: unknown; locale: string } }) => {
        const types = (a.where.type as { in?: string[] } | string | undefined);
        return opts.versions.filter((v) => v.locale === a.where.locale && (typeof types === 'string' ? v.type === types : types?.in ? types.in.includes(v.type) : true));
      },
    },
    userLegalAcceptance: {
      findMany: async (a: { where: { userId: string } }) =>
        accRows
          .filter((r) => r.userId === a.where.userId)
          .map((r) => ({ ...r, id: 'a', acceptedAt: new Date(), contentSha256: 'h', documentVersion: byId.get(r.documentVersionId)! })),
      findUnique: async (a: { where: { userId_documentVersionId_action: { userId: string; documentVersionId: string; action: string } } }) => {
        const k = a.where.userId_documentVersionId_action;
        return accRows.find((r) => r.userId === k.userId && r.documentVersionId === k.documentVersionId && r.action === k.action) ?? null;
      },
      create: async (a: { data: Acc }) => void accRows.push({ ...a.data }),
    },
    consentRecord: {
      findMany: async (a: { where: { userId: string; purpose?: string }; take?: number }) =>
        conRows
          .filter((r) => r.userId === a.where.userId && (!a.where.purpose || r.purpose === a.where.purpose))
          .sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime())
          .slice(0, a.take ?? 999),
      create: async (a: { data: Con }) => void conRows.push({ ...a.data, recordedAt: new Date(Date.now() + conRows.length) }),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  const tenant = { userId: opts.userId === undefined ? 'u1' : opts.userId ?? undefined, accountId: 'acc-1' };
  const legal = new LegalService(tx as never);
  return { service: new LegalSelfService(tx as never, tenant as never, legal), accRows, conRows };
}

const T = LegalDocumentType.TERMS;
const P = LegalDocumentType.PRIVACY;
const evidence = { ip: '203.0.113.9', userAgent: 'ua', source: LegalAcceptanceSource.PROFILE };

describe('LegalSelfService · pendientes (re-aceptación)', () => {
  it('🔴 quien nunca aceptó nada tiene los dos documentos pendientes, con la versión vigente a aceptar', async () => {
    const { service } = make({ versions: [ver('t1', T, '2026-01-01'), ver('p1', P, '2026-01-01')] });
    const p = await service.pending();
    assert.deepEqual(p.map((x) => x.type).sort(), [P, T].sort());
    assert.equal(p.find((x) => x.type === T)!.versionId, 't1');
  });

  it('quien aceptó la vigente no tiene nada pendiente', async () => {
    const t1 = ver('t1', T, '2026-01-01');
    const p1 = ver('p1', P, '2026-01-01');
    const { service } = make({ versions: [t1, p1], accepted: [t1, p1] });
    assert.deepEqual(await service.pending(), []);
  });

  it('🔴 un cambio editorial no pide nada; uno material sí, y solo del documento que cambió', async () => {
    const t1 = ver('t1', T, '2026-01-01', true);
    const p1 = ver('p1', P, '2026-01-01', true);
    const editorial = ver('t1.1', T, '2026-05-01', false);
    const a = make({ versions: [t1, p1, editorial], accepted: [t1, p1] });
    assert.deepEqual(await a.service.pending(), []);

    const material = ver('t2', T, '2026-08-01', true);
    const b = make({ versions: [t1, p1, editorial, material], accepted: [t1, p1] });
    const pend = await b.service.pending();
    assert.deepEqual(pend.map((x) => x.type), [T]);
    assert.equal(pend[0]!.versionId, 't2');
  });

  it('sin documento publicado no se exige nada (no se bloquea a nadie por un texto que no existe)', async () => {
    const { service } = make({ versions: [] });
    assert.deepEqual(await service.pending(), []);
  });

  it('🔴 sin persona en la sesión no hay historial propio (nunca una fila comodín)', async () => {
    const { service } = make({ versions: [], userId: null });
    await rejectsWithCode(service.overview(), 'LEGAL_NO_USER');
  });

  it('re-aceptar guarda las constancias con el origen RE_ACCEPT y es idempotente', async () => {
    const t1 = ver('t1', T, '2026-01-01');
    const p1 = ver('p1', P, '2026-01-01');
    const { service, accRows } = make({ versions: [t1, p1] });
    const ev = { ...evidence, source: LegalAcceptanceSource.RE_ACCEPT };
    const res = await service.reaccept({ termsVersionId: 't1', privacyVersionId: 'p1' }, ev);
    assert.equal(accRows.length, 2);
    assert.ok(accRows.every((r) => r.source === 'RE_ACCEPT' && r.accountId === 'acc-1'));
    assert.deepEqual(res.pending, []);
    await service.reaccept({ termsVersionId: 't1', privacyVersionId: 'p1' }, ev);
    assert.equal(accRows.length, 2); // no se duplica
  });

  it('🔴 re-aceptar con una versión que ya no es la vigente se rechaza', async () => {
    const { service, accRows } = make({ versions: [ver('t1', T, '2026-01-01'), ver('t2', T, '2026-06-01', true), ver('p1', P, '2026-01-01')] });
    await rejectsWithCode(service.reaccept({ termsVersionId: 't1', privacyVersionId: 'p1' }, { ...evidence, source: LegalAcceptanceSource.RE_ACCEPT }), 'LEGAL_VERSION_STALE');
    assert.equal(accRows.length, 0);
  });
});

describe('LegalSelfService · consentimientos opcionales', () => {
  it('🔴 sin decisión previa NO consintió (estado por omisión) y no aparece como decidido', async () => {
    const { service } = make({ versions: [] });
    const o = await service.overview();
    const m = o.consents.find((c) => c.purpose === LegalConsentPurpose.MARKETING)!;
    assert.equal(m.status, LegalConsentStatus.WITHDRAWN);
    assert.equal(m.decided, false);
  });

  it('otorgar y luego retirar inserta DOS filas: el historial no se reescribe', async () => {
    const { service, conRows } = make({ versions: [] });
    await service.setConsent(LegalConsentPurpose.MARKETING, true, evidence);
    let o = await service.overview();
    assert.equal(o.consents.find((c) => c.purpose === 'MARKETING')!.status, LegalConsentStatus.GRANTED);
    await service.setConsent(LegalConsentPurpose.MARKETING, false, evidence);
    o = await service.overview();
    assert.equal(o.consents.find((c) => c.purpose === 'MARKETING')!.status, LegalConsentStatus.WITHDRAWN);
    assert.equal(conRows.length, 2);
    assert.deepEqual(conRows.map((r) => r.status), ['GRANTED', 'WITHDRAWN']);
    assert.equal(o.history.length, 2);
  });

  it('pedir el estado que ya tiene no inserta nada (idempotente), y retirar sin haber otorgado tampoco', async () => {
    const { service, conRows } = make({ versions: [] });
    await service.setConsent(LegalConsentPurpose.MARKETING, false, evidence);
    assert.equal(conRows.length, 0);
    await service.setConsent(LegalConsentPurpose.MARKETING, true, evidence);
    await service.setConsent(LegalConsentPurpose.MARKETING, true, evidence);
    assert.equal(conRows.length, 1);
  });

  it('cada finalidad es independiente de las otras', async () => {
    const { service } = make({ versions: [] });
    await service.setConsent(LegalConsentPurpose.MARKETING, true, evidence);
    const o = await service.overview();
    assert.equal(o.consents.find((c) => c.purpose === 'ANALYTICS')!.status, LegalConsentStatus.WITHDRAWN);
  });

  it('cada persona ve solo lo suyo: los consentimientos de otra no aparecen', async () => {
    const other: Con = { userId: 'u2', purpose: 'MARKETING', status: 'GRANTED', source: 'PROFILE', recordedAt: new Date() };
    const { service } = make({ versions: [], consents: [other] });
    const o = await service.overview();
    assert.equal(o.consents.find((c) => c.purpose === 'MARKETING')!.decided, false);
    assert.equal(o.history.length, 0);
  });
});
