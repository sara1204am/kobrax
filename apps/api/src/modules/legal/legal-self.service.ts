import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  LegalAcceptanceSource,
  LegalConsentPurpose,
  LegalConsentStatus,
  LegalDocumentType,
  SIGNUP_REQUIRED_DOCUMENTS,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { LegalService, type Evidence } from './legal.service';
import { isCovered, latestByPurpose, pickCurrent, requiredFloor } from './legal.logic';

const LOCALE = 'es';

/**
 * Lo legal de **la persona que pregunta** (privacidad y consentimiento · B4/B5): su historial de aceptaciones, sus consentimientos
 * opcionales y qué documentos debe volver a aceptar.
 *
 * 🔴 Cada persona solo ve y toca lo suyo: el `userId` sale SIEMPRE de la sesión, nunca del cuerpo ni de la URL. La evidencia solo se
 * inserta (retirar un consentimiento es una fila nueva `WITHDRAWN`), y quien no consintió nunca queda bloqueado por eso.
 */
@Injectable()
export class LegalSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly legal: LegalService,
  ) {}

  private get userId(): string {
    const id = this.tenant.userId;
    // Sin persona en la sesión no hay historial propio: nunca se comparte una fila comodín entre sesiones.
    if (!id) throw new ForbiddenException({ code: 'LEGAL_NO_USER', message: 'Esto es de una persona' });
    return id;
  }

  /** Qué documentos debe volver a aceptar: la versión vigente de cada tipo exigido cuyo piso material no cubre ninguna aceptación suya. */
  async pending(userId: string = this.userId) {
    const types = SIGNUP_REQUIRED_DOCUMENTS.map((d) => d.type);
    const [versions, accepted] = await Promise.all([
      this.prisma.legalDocumentVersion.findMany({ where: { type: { in: types }, locale: LOCALE } }),
      this.prisma.userLegalAcceptance.findMany({
        where: { userId },
        select: { documentVersion: { select: { type: true, effectiveAt: true } } },
      }),
    ]);
    const out: { type: LegalDocumentType; versionId: string; version: string; title: string; isMaterial: boolean }[] = [];
    for (const { type } of SIGNUP_REQUIRED_DOCUMENTS) {
      const ofType = versions.filter((v) => v.type === type);
      const floor = requiredFloor(ofType);
      const current = pickCurrent(ofType);
      // Sin documento publicado no hay nada que exigir (no se bloquea a nadie por un texto que no existe).
      if (!floor || !current) continue;
      const mine = accepted.filter((a) => a.documentVersion.type === type).map((a) => a.documentVersion);
      if (!isCovered(floor, mine))
        out.push({ type, versionId: current.id, version: current.version, title: current.title, isMaterial: current.isMaterial });
    }
    return out;
  }

  /** Todo lo de Mi perfil › Privacidad en una llamada: pendientes, historial de aceptaciones y estado de cada consentimiento. */
  async overview() {
    const userId = this.userId;
    const [pending, acceptances, consents] = await Promise.all([
      this.pending(userId),
      this.prisma.userLegalAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: 'desc' },
        select: {
          id: true,
          action: true,
          source: true,
          acceptedAt: true,
          contentSha256: true,
          documentVersion: { select: { type: true, version: true, title: true, locale: true } },
        },
      }),
      this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { recordedAt: 'desc' } }),
    ]);
    const latest = latestByPurpose(consents);
    return {
      pending,
      acceptances: acceptances.map((a) => ({
        id: a.id,
        type: a.documentVersion.type,
        version: a.documentVersion.version,
        title: a.documentVersion.title,
        locale: a.documentVersion.locale,
        action: a.action,
        source: a.source,
        acceptedAt: a.acceptedAt,
        contentSha256: a.contentSha256,
      })),
      consents: Object.values(LegalConsentPurpose).map((purpose) => {
        const row = latest.get(purpose);
        // Sin fila = nunca decidió = NO consintió (el valor por omisión de todo consentimiento).
        return { purpose, status: row?.status ?? LegalConsentStatus.WITHDRAWN, decided: !!row, recordedAt: row?.recordedAt ?? null };
      }),
      history: consents.map((c) => ({ id: c.id, purpose: c.purpose, status: c.status, source: c.source, recordedAt: c.recordedAt })),
    };
  }

  /** Re-aceptación: acepta los Términos y reconoce la Política vigentes. Idempotente (no duplica constancias ya existentes). */
  async reaccept(input: { termsVersionId?: string; privacyVersionId?: string }, evidence: Evidence & { source: LegalAcceptanceSource }) {
    const userId = this.userId;
    await this.prisma.$transaction(async (tx) => {
      await this.legal.recordSignupAcceptances(tx as unknown as PrismaClient, {
        userId,
        accountId: this.tenant.accountId,
        source: evidence.source,
        evidence,
        seen: [
          ...(input.termsVersionId ? [{ type: LegalDocumentType.TERMS, versionId: input.termsVersionId }] : []),
          ...(input.privacyVersionId ? [{ type: LegalDocumentType.PRIVACY, versionId: input.privacyVersionId }] : []),
        ],
        skipExisting: true,
        partial: true,
      });
    });
    return { pending: await this.pending(userId) };
  }

  /**
   * Otorga o retira un consentimiento opcional. Siempre deja constancia **nueva** (el historial no se reescribe) y es idempotente:
   * pedir el estado que ya tiene no inserta nada. Retirar es tan fácil como otorgar: una sola llamada, sin condiciones.
   */
  async setConsent(purpose: LegalConsentPurpose, granted: boolean, evidence: Evidence & { source: LegalAcceptanceSource }) {
    const userId = this.userId;
    const rows = await this.prisma.consentRecord.findMany({ where: { userId, purpose }, orderBy: { recordedAt: 'desc' }, take: 1 });
    const status = granted ? LegalConsentStatus.GRANTED : LegalConsentStatus.WITHDRAWN;
    const current = rows[0]?.status ?? LegalConsentStatus.WITHDRAWN; // sin fila = no consintió
    if (current !== status) {
      await this.prisma.$transaction(async (tx) => {
        await this.legal.recordConsent(tx as unknown as PrismaClient, { userId, purpose, status, source: evidence.source, evidence });
      });
    }
    return this.overview();
  }
}
