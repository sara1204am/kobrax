import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  LegalConsentPurpose,
  LegalConsentStatus,
  LegalAcceptanceSource,
  LegalDocumentType,
  SIGNUP_REQUIRED_DOCUMENTS,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { legalAcceptanceRequired, legalDocumentNotFound, legalVersionStale } from './legal.errors';
import { cleanEvidence, pickCurrent, sha256Hex } from './legal.logic';

export interface Evidence {
  ip?: string;
  userAgent?: string;
  appVersion?: string;
}

/** Un documento que la persona dice haber visto: el servidor **no confía** en el hash ni en el texto que mande el cliente. */
export interface SeenDocument {
  type: LegalDocumentType;
  versionId: string;
}

/** Lo que la pantalla envía al aceptar (ver `LegalAcceptanceDto`). */
export interface LegalAcceptanceInput {
  termsVersionId?: string;
  privacyVersionId?: string;
  marketingOptIn?: boolean;
  analyticsOptIn?: boolean;
}

const DEFAULT_LOCALE = 'es';

/**
 * Documentos legales versionados y la evidencia de su aceptación (privacidad y consentimiento, etapa B1).
 *
 * 🔴 La evidencia solo se INSERTA. `accepted_at` lo pone la base; el hash que se guarda es el de la versión que tiene el
 * servidor, nunca el que declare el cliente; y se rechaza cualquier versión que no sea la vigente (`LEGAL_VERSION_STALE`).
 * Las tablas son globales (por persona, como `users`): sin RLS; la base impide UPDATE/DELETE/TRUNCATE (trigger + REVOKE).
 */
@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  /** La versión vigente de un documento (la última cuya fecha de vigencia ya llegó). */
  async getCurrent(type: LegalDocumentType, locale = DEFAULT_LOCALE, client: PrismaClient = this.prisma) {
    const rows = await client.legalDocumentVersion.findMany({
      where: { type, locale, effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: 'desc' }, { publishedAt: 'desc' }],
      take: 5,
    });
    const current = pickCurrent(rows);
    if (!current) throw legalDocumentNotFound();
    return current;
  }

  /** Una versión concreta, siempre disponible aunque ya no sea la vigente (se conserva el historial). */
  async getVersion(type: LegalDocumentType, version: string, locale = DEFAULT_LOCALE) {
    const row = await this.prisma.legalDocumentVersion.findUnique({
      where: { type_locale_version: { type, locale, version } },
    });
    if (!row) throw legalDocumentNotFound();
    return row;
  }

  /** El historial de versiones de un documento, sin el texto (liviano). */
  listVersions(type: LegalDocumentType, locale = DEFAULT_LOCALE) {
    return this.prisma.legalDocumentVersion.findMany({
      where: { type, locale },
      orderBy: [{ effectiveAt: 'desc' }, { publishedAt: 'desc' }],
      select: {
        id: true,
        type: true,
        locale: true,
        version: true,
        title: true,
        contentSha256: true,
        isMaterial: true,
        changeSummary: true,
        publishedAt: true,
        effectiveAt: true,
      },
    });
  }

  /** Las versiones vigentes de los documentos que se exigen al registrarse (para que la pantalla sepa qué mostrar y enviar). */
  async currentSignupDocuments(locale = DEFAULT_LOCALE) {
    return Promise.all(
      SIGNUP_REQUIRED_DOCUMENTS.map(async ({ type, action }) => {
        const v = await this.getCurrent(type, locale);
        return {
          type,
          action,
          versionId: v.id,
          version: v.version,
          title: v.title,
          contentSha256: v.contentSha256,
        };
      }),
    );
  }

  /**
   * Publica una versión nueva. El hash lo calcula el servidor sobre el texto recibido. Una versión publicada no se edita ni se borra
   * (lo garantiza la base): para corregir algo se publica otra con número mayor.
   */
  publishVersion(input: {
    type: LegalDocumentType;
    locale?: string;
    version: string;
    title: string;
    content: string;
    isMaterial: boolean;
    changeSummary?: string;
    effectiveAt?: Date;
    publishedBy?: string;
  }) {
    return this.prisma.legalDocumentVersion.create({
      data: {
        type: input.type,
        locale: input.locale ?? DEFAULT_LOCALE,
        version: input.version,
        title: input.title,
        content: input.content,
        contentSha256: sha256Hex(input.content),
        isMaterial: input.isMaterial,
        changeSummary: input.changeSummary ?? null,
        effectiveAt: input.effectiveAt ?? new Date(),
        publishedBy: input.publishedBy ?? null,
      },
    });
  }

  /**
   * Registra, **dentro de la transacción del llamador**, que la persona aceptó los Términos y reconoció la Política. Si falta alguno
   * o la versión ya no es la vigente, lanza y la transacción entera (la creación de la cuenta) se revierte.
   */
  async recordSignupAcceptances(
    tx: PrismaClient,
    input: {
      userId: string;
      accountId?: string;
      source: LegalAcceptanceSource;
      evidence: Evidence;
      seen: readonly SeenDocument[];
      locale?: string;
      /** Re-aceptación: si ya existe la constancia de esa versión y acción, no se duplica (la tabla tiene unicidad). */
      skipExisting?: boolean;
      /**
       * Re-aceptación parcial: si cambió UN solo documento, se acepta solo ese. Sin esto se exigen los dos (alta de cuenta). Con `partial`
       * hay que mandar al menos uno, y solo se registra lo que se mandó (nunca una constancia de un texto que la persona no vio).
       */
      partial?: boolean;
    },
  ): Promise<void> {
    const seenByType = new Map(input.seen.map((s) => [s.type, s.versionId]));
    const wanted = input.partial ? SIGNUP_REQUIRED_DOCUMENTS.filter((d) => seenByType.has(d.type)) : SIGNUP_REQUIRED_DOCUMENTS;
    const missing = SIGNUP_REQUIRED_DOCUMENTS.filter((d) => !seenByType.has(d.type)).map((d) => d.type);
    if (input.partial ? wanted.length === 0 : missing.length > 0) throw legalAcceptanceRequired(input.partial ? SIGNUP_REQUIRED_DOCUMENTS.map((d) => d.type) : missing);

    const evidence = cleanEvidence(input.evidence);
    for (const { type, action } of wanted) {
      const current = await this.getCurrent(type, input.locale ?? DEFAULT_LOCALE, tx);
      if (seenByType.get(type) !== current.id) throw legalVersionStale(type);
      if (input.skipExisting) {
        const already = await tx.userLegalAcceptance.findUnique({
          where: { userId_documentVersionId_action: { userId: input.userId, documentVersionId: current.id, action } },
        });
        if (already) continue;
      }
      await tx.userLegalAcceptance.create({
        data: {
          userId: input.userId,
          accountId: input.accountId ?? null,
          documentVersionId: current.id,
          // Hash de la versión que tiene el servidor: la prueba no depende de lo que diga el cliente.
          contentSha256: current.contentSha256,
          action,
          source: input.source,
          ...evidence,
        },
      });
    }
  }

  /**
   * Todo lo que se registra al crear un acceso (registro o invitación), en la transacción del llamador: las dos constancias
   * obligatorias y, solo si la persona los marcó, los consentimientos opcionales (cada uno con su propia fila de evidencia).
   * `termsVersionId`/`privacyVersionId` ausentes = `LEGAL_ACCEPTANCE_REQUIRED`: no hay alta sin aceptación.
   */
  async recordOnboarding(
    tx: PrismaClient,
    input: {
      userId: string;
      accountId?: string;
      source: LegalAcceptanceSource;
      evidence: Evidence;
      termsVersionId?: string;
      privacyVersionId?: string;
      marketingOptIn?: boolean;
      analyticsOptIn?: boolean;
    },
  ): Promise<void> {
    const seen: SeenDocument[] = [];
    if (input.termsVersionId) seen.push({ type: LegalDocumentType.TERMS, versionId: input.termsVersionId });
    if (input.privacyVersionId) seen.push({ type: LegalDocumentType.PRIVACY, versionId: input.privacyVersionId });
    await this.recordSignupAcceptances(tx, {
      userId: input.userId,
      accountId: input.accountId,
      source: input.source,
      evidence: input.evidence,
      seen,
    });
    const optIns: [boolean | undefined, LegalConsentPurpose][] = [
      [input.marketingOptIn, LegalConsentPurpose.MARKETING],
      [input.analyticsOptIn, LegalConsentPurpose.ANALYTICS],
    ];
    for (const [on, purpose] of optIns) {
      if (on !== true) continue;
      await this.recordConsent(tx, {
        userId: input.userId,
        purpose,
        status: LegalConsentStatus.GRANTED,
        source: input.source,
        evidence: input.evidence,
      });
    }
  }

  /**
   * Registra una decisión sobre un consentimiento **opcional** (otorgar o retirar). Siempre inserta una fila nueva: el historial no
   * se reescribe. Rechazar al registrarse NO inserta nada (no consentir no es un acto que haya que probar) y nunca bloquea el alta.
   */
  recordConsent(
    tx: PrismaClient,
    input: {
      userId: string;
      purpose: LegalConsentPurpose;
      status: LegalConsentStatus;
      source: LegalAcceptanceSource;
      evidence: Evidence;
      documentVersionId?: string;
    },
  ) {
    return tx.consentRecord.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        status: input.status,
        source: input.source,
        documentVersionId: input.documentVersionId ?? null,
        ...cleanEvidence(input.evidence),
      },
    });
  }
}
