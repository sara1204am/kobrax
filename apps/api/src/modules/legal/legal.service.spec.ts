import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LegalAcceptanceAction,
  LegalAcceptanceSource,
  LegalConsentPurpose,
  LegalConsentStatus,
  LegalDocumentType,
} from '@kobrax/shared';
import { LegalService } from './legal.service';
import { sha256Hex } from './legal.logic';
import { rejectsWithCode } from '../auth/auth-test-utils';

interface Version {
  id: string;
  type: LegalDocumentType;
  locale: string;
  version: string;
  contentSha256: string;
  effectiveAt: Date;
  publishedAt: Date;
}

const ver = (id: string, type: LegalDocumentType, effective = '2026-01-01'): Version => ({
  id,
  type,
  locale: 'es',
  version: '1.0.0',
  contentSha256: sha256Hex(`texto-${id}`),
  effectiveAt: new Date(effective),
  publishedAt: new Date(effective),
});

/** Un fake de las tres tablas legales: guarda lo que se inserta para poder afirmar sobre la evidencia. */
function make(versions: Version[]) {
  const acceptances: Record<string, unknown>[] = [];
  const consents: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const tx = {
    legalDocumentVersion: {
      findMany: async (a: { where: { type: LegalDocumentType; locale: string } }) =>
        versions.filter((v) => v.type === a.where.type && v.locale === a.where.locale),
      create: async (a: { data: Record<string, unknown> }) => {
        created.push(a.data);
        return a.data;
      },
    },
    userLegalAcceptance: {
      create: async (a: { data: Record<string, unknown> }) => {
        acceptances.push(a.data);
        return a.data;
      },
    },
    consentRecord: {
      create: async (a: { data: Record<string, unknown> }) => {
        consents.push(a.data);
        return a.data;
      },
    },
  };
  return { service: new LegalService(tx as never), tx, acceptances, consents, created };
}

const terms = ver('t1', LegalDocumentType.TERMS);
const privacy = ver('p1', LegalDocumentType.PRIVACY);
const evidence = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0', appVersion: '0.1.0' };

describe('LegalService · aceptación al registrarse', () => {
  it('🔴 sin aceptar los Términos no se registra nada (lanza LEGAL_ACCEPTANCE_REQUIRED)', async () => {
    const { service, tx, acceptances } = make([terms, privacy]);
    await rejectsWithCode(
      service.recordSignupAcceptances(tx as never, {
        userId: 'u1',
        source: LegalAcceptanceSource.SIGNUP_WEB,
        evidence,
        seen: [{ type: LegalDocumentType.PRIVACY, versionId: 'p1' }],
      }),
      'LEGAL_ACCEPTANCE_REQUIRED',
    );
    assert.equal(acceptances.length, 0);
  });

  it('🔴 sin reconocer la Privacidad tampoco', async () => {
    const { service, tx, acceptances } = make([terms, privacy]);
    await rejectsWithCode(
      service.recordSignupAcceptances(tx as never, {
        userId: 'u1',
        source: LegalAcceptanceSource.SIGNUP_WEB,
        evidence,
        seen: [{ type: LegalDocumentType.TERMS, versionId: 't1' }],
      }),
      'LEGAL_ACCEPTANCE_REQUIRED',
    );
    assert.equal(acceptances.length, 0);
  });

  it('guarda UNA evidencia por documento, con la versión, el hash del servidor, el origen y la evidencia del request', async () => {
    const { service, tx, acceptances } = make([terms, privacy]);
    await service.recordSignupAcceptances(tx as never, {
      userId: 'u1',
      accountId: 'acc-1',
      source: LegalAcceptanceSource.SIGNUP_WEB,
      evidence,
      seen: [
        { type: LegalDocumentType.TERMS, versionId: 't1' },
        { type: LegalDocumentType.PRIVACY, versionId: 'p1' },
      ],
    });
    assert.equal(acceptances.length, 2);
    const t = acceptances.find((a) => a.documentVersionId === 't1')!;
    const p = acceptances.find((a) => a.documentVersionId === 'p1')!;
    // Términos = aceptación contractual; Privacidad = constancia de conocimiento (no consentimiento general).
    assert.equal(t.action, LegalAcceptanceAction.ACCEPTED);
    assert.equal(p.action, LegalAcceptanceAction.ACKNOWLEDGED);
    assert.equal(t.contentSha256, terms.contentSha256);
    assert.equal(t.userId, 'u1');
    assert.equal(t.accountId, 'acc-1');
    assert.equal(t.source, LegalAcceptanceSource.SIGNUP_WEB);
    assert.equal(t.ip, '203.0.113.9');
    assert.equal(t.appVersion, '0.1.0');
    // La hora la pone la base (default now()): el servicio no manda `acceptedAt`.
    assert.equal('acceptedAt' in t, false);
  });

  it('🔴 una versión que ya no es la vigente se rechaza (LEGAL_VERSION_STALE) y no registra nada', async () => {
    const nueva = { ...ver('t2', LegalDocumentType.TERMS, '2026-06-01'), version: '1.1.0' };
    const { service, tx, acceptances } = make([terms, nueva, privacy]);
    await rejectsWithCode(
      service.recordSignupAcceptances(tx as never, {
        userId: 'u1',
        source: LegalAcceptanceSource.SIGNUP_WEB,
        evidence,
        seen: [
          { type: LegalDocumentType.TERMS, versionId: 't1' },
          { type: LegalDocumentType.PRIVACY, versionId: 'p1' },
        ],
      }),
      'LEGAL_VERSION_STALE',
    );
    // Los Términos fallaron antes de insertar: ninguna fila a medias.
    assert.equal(acceptances.length, 0);
  });

  it('sin versión publicada del documento falla con LEGAL_DOCUMENT_NOT_FOUND', async () => {
    const { service, tx } = make([terms]);
    await rejectsWithCode(
      service.recordSignupAcceptances(tx as never, {
        userId: 'u1',
        source: LegalAcceptanceSource.SIGNUP_WEB,
        evidence,
        seen: [
          { type: LegalDocumentType.TERMS, versionId: 't1' },
          { type: LegalDocumentType.PRIVACY, versionId: 'p1' },
        ],
      }),
      'LEGAL_DOCUMENT_NOT_FOUND',
    );
  });
});

describe('LegalService · consentimientos opcionales y publicación', () => {
  it('🔴 retirar un consentimiento INSERTA una fila nueva (no actualiza la anterior)', async () => {
    const { service, tx, consents } = make([]);
    const base = { userId: 'u1', purpose: LegalConsentPurpose.MARKETING, source: LegalAcceptanceSource.PROFILE, evidence };
    await service.recordConsent(tx as never, { ...base, status: LegalConsentStatus.GRANTED });
    await service.recordConsent(tx as never, { ...base, status: LegalConsentStatus.WITHDRAWN });
    assert.equal(consents.length, 2);
    assert.deepEqual(
      consents.map((c) => c.status),
      [LegalConsentStatus.GRANTED, LegalConsentStatus.WITHDRAWN],
    );
  });

  it('cada consentimiento deja su propia evidencia (finalidad, origen, IP y versión de la app)', async () => {
    const { service, tx, consents } = make([]);
    await service.recordConsent(tx as never, {
      userId: 'u1',
      purpose: LegalConsentPurpose.ANALYTICS,
      status: LegalConsentStatus.GRANTED,
      source: LegalAcceptanceSource.SIGNUP_WEB,
      evidence,
    });
    assert.equal(consents[0]!.purpose, LegalConsentPurpose.ANALYTICS);
    assert.equal(consents[0]!.ip, '203.0.113.9');
    assert.equal(consents[0]!.appVersion, '0.1.0');
  });

  it('publishVersion calcula el hash en el servidor sobre el texto recibido', async () => {
    const { service, created } = make([]);
    await service.publishVersion({
      type: LegalDocumentType.TERMS,
      version: '1.0.0',
      title: 'Términos y Condiciones',
      content: 'Texto de prueba',
      isMaterial: false,
    });
    assert.equal(created[0]!.contentSha256, sha256Hex('Texto de prueba'));
    assert.equal(created[0]!.locale, 'es');
  });
});
