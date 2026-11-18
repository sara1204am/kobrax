import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrivacyRequestStatus as S, PrivacySubjectKind } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { MailService, publicReportNotifyBody, publicReportVerifyBody } from '../../common/mail/mail.service';
import { AppConfigService } from '../../config/app-config.service';
import { CreateOrgPrivacyRequestDto, CreateOwnPrivacyRequestDto, TransitionPrivacyRequestDto } from './dto/privacy-requests.dto';
import { CreatePublicReportDto } from './dto/public-report.dto';
import {
  privacyInvalidTransition,
  privacyNoteRequired,
  privacyReasonRequired,
  privacyRequestNotFound,
  privacyTooManyOpen,
  privacyUnverified,
  privacyVerifyInvalid,
} from './privacy-requests.errors';
import {
  MAX_OPEN_PER_CONTACT,
  MAX_OPEN_PER_USER,
  OPEN_STATUSES,
  VERIFY_TTL_MS,
  allowedNext,
  checkTransition,
  isTerminal,
  needsContactVerification,
} from './privacy-requests.logic';

type ActorKind = 'REQUESTER' | 'ORG' | 'PLATFORM';

const INCLUDE = { events: { orderBy: { createdAt: 'asc' as const } } };

interface RequestRow {
  id: string;
  subjectKind: string;
  type: string;
  status: string;
  subjectLabel: string | null;
  contactEmail?: string | null;
  contactName?: string | null;
  reportedSubject?: string | null;
  contactVerifiedAt?: Date | null;
  description: string;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  events: { status: string; note: string | null; actorKind: string; createdAt: Date }[];
}

/**
 * Solicitudes de derechos de las personas (privacidad · B6): acceso, rectificación, supresión, limitación, oposición, portabilidad.
 *
 * Tres caminos que NO se mezclan:
 *  - **Propias** (`APP_USER`): una persona usuaria sobre SUS datos. Sin cuenta; la persona sale siempre de la sesión.
 *  - **De la organización** (`DEBTOR_VIA_ORG`): el personal de una organización registra la solicitud de un titular de cobranza. La
 *    organización es la RESPONSABLE: Kobrax solo da la herramienta de registro y seguimiento. Vive en su cuenta (RLS).
 *  - **De plataforma**: Kobrax atiende las solicitudes `APP_USER`.
 *
 * Cada cambio de estado queda como un evento inmutable. Nada se borra ni se ejecuta solo: «Aprobada» y «Completada» las marca una
 * persona después de hacer el trabajo; este módulo no elimina ni exporta datos por sí mismo.
 */
@Injectable()
export class PrivacyRequestsService {
  private readonly logger = new Logger(PrivacyRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  private get userId(): string {
    const id = this.tenant.userId;
    if (!id) throw new ForbiddenException({ code: 'PRIVACY_NO_USER', message: 'Esto es de una persona' });
    return id;
  }

  /** Lo que se devuelve: nunca ids de personas ni de cuentas, solo lo necesario para dar seguimiento. */
  private view(r: RequestRow) {
    return {
      id: r.id,
      subjectKind: r.subjectKind,
      type: r.type,
      status: r.status,
      subjectLabel: r.subjectLabel,
      reportedSubject: r.reportedSubject ?? null,
      // Solo los pedidos públicos: ¿hace falta que la persona confirme su correo, y ya lo hizo?
      needsVerification: r.subjectKind === PrivacySubjectKind.THIRD_PARTY && needsContactVerification(r.type),
      contactVerified: r.contactVerifiedAt != null,
      description: r.description,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      events: r.events.map((e) => ({ status: e.status, note: e.note, actorKind: e.actorKind, createdAt: e.createdAt })),
      allowedNext: allowedNext(r.status as S),
    };
  }

  // ── Propias (APP_USER) ────────────────────────────────────────────────────────────────────────────────────────────────

  async fileOwn(dto: CreateOwnPrivacyRequestDto) {
    const userId = this.userId;
    const open = await this.prisma.privacyRequest.count({
      where: { requesterUserId: userId, subjectKind: PrivacySubjectKind.APP_USER, status: { in: [...OPEN_STATUSES] } },
    });
    if (open >= MAX_OPEN_PER_USER) throw privacyTooManyOpen();
    const row = await this.prisma.privacyRequest.create({
      data: {
        subjectKind: PrivacySubjectKind.APP_USER,
        type: dto.type,
        description: dto.description.trim(),
        requesterUserId: userId,
        events: { create: { status: S.RECEIVED, actorKind: 'REQUESTER', actorUserId: userId } },
      },
      include: INCLUDE,
    });
    return this.view(row);
  }

  async listOwn() {
    const rows = await this.prisma.privacyRequest.findMany({
      where: { requesterUserId: this.userId, subjectKind: PrivacySubjectKind.APP_USER },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.view(r));
  }

  // ── Públicas (THIRD_PARTY): una persona SIN cuenta, por el formulario de la web ─────────────────────────────────────

  /**
   * Recibe un reporte o un pedido de una persona sin cuenta. Sin sesión: lo protegen el límite de peticiones del controlador, la trampa
   * `website` (un robot la llena) y un tope de pedidos abiertos por correo. Devuelve solo un código de seguimiento, nunca datos de nadie.
   * Una trampa llena responde igual de bien pero NO guarda nada (para que el robot no sepa que fue detectado).
   */
  async filePublic(dto: CreatePublicReportDto) {
    if (dto.website && dto.website.trim() !== '') return { reference: 'recibido' };
    const email = dto.contactEmail.trim().toLowerCase();
    const verify = needsContactVerification(dto.type);
    const token = verify ? randomBytes(32).toString('base64url') : null;
    const row = await this.prisma.withSurface('public', async (tx) => {
      const open = await tx.privacyRequest.count({
        where: { subjectKind: PrivacySubjectKind.THIRD_PARTY, contactEmail: email, status: { in: [...OPEN_STATUSES] } },
      });
      if (open >= MAX_OPEN_PER_CONTACT) throw privacyTooManyOpen();
      return tx.privacyRequest.create({
        data: {
          subjectKind: PrivacySubjectKind.THIRD_PARTY,
          type: dto.type,
          contactEmail: email,
          contactName: dto.contactName?.trim() || null,
          reportedSubject: dto.reportedSubject?.trim() || null,
          description: dto.description.trim(),
          ...(token ? { contactVerifyHash: this.hash(token), contactVerifyExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) } : {}),
          events: { create: { status: S.RECEIVED, actorKind: 'REQUESTER' } },
        },
        select: { id: true },
      });
    });
    const reference = row.id.slice(0, 8).toUpperCase();
    // Los correos no pueden hacer fallar el registro: la solicitud ya quedó guardada y la plataforma la ve en la consola.
    if (token) {
      const link = `${this.config.appUrl.replace(/\/$/, '')}/verificar-reporte?token=${token}`;
      await this.safeSend(email, publicReportVerifyBody({ link, kind: dto.type }));
    }
    await this.safeSend(
      this.config.reportsNotifyEmail,
      publicReportNotifyBody({
        reference,
        kind: dto.type,
        contactEmail: email,
        contactName: dto.contactName?.trim() || null,
        reportedSubject: dto.reportedSubject?.trim() || null,
        description: dto.description.trim(),
        needsVerification: verify,
        event: 'received',
      }),
    );
    return { reference };
  }

  /**
   * La persona abrió el enlace que le llegó al correo y confirmó. El enlace sirve una sola vez y vence; se guarda solo su huella (SHA-256),
   * y se borra al usarlo. Responde igual de genérico si no existe, venció o ya se usó (no se confirma qué enlaces existen).
   */
  async confirmPublic(token: string) {
    const hash = this.hash(token);
    const row = await this.prisma.withSurface('public', async (tx) => {
      const found = await tx.privacyRequest.findFirst({
        where: { subjectKind: PrivacySubjectKind.THIRD_PARTY, contactVerifyHash: hash, contactVerifiedAt: null, contactVerifyExpiresAt: { gt: new Date() } },
      });
      if (!found) throw privacyVerifyInvalid();
      const claimed = await tx.privacyRequest.updateMany({
        where: { id: found.id, contactVerifyHash: hash, contactVerifiedAt: null },
        data: { contactVerifiedAt: new Date(), contactVerifyHash: null, contactVerifyExpiresAt: null },
      });
      if (claimed.count === 0) throw privacyVerifyInvalid();
      await tx.privacyRequestEvent.create({ data: { requestId: found.id, status: found.status, note: 'La persona confirmó su correo', actorKind: 'REQUESTER' } });
      return found;
    });
    const reference = row.id.slice(0, 8).toUpperCase();
    await this.safeSend(
      this.config.reportsNotifyEmail,
      publicReportNotifyBody({
        reference,
        kind: row.type,
        contactEmail: row.contactEmail ?? '',
        contactName: row.contactName,
        reportedSubject: row.reportedSubject,
        description: row.description,
        needsVerification: true,
        event: 'verified',
      }),
    );
    return { reference };
  }

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async safeSend(to: string, mail: { subject: string; text: string }): Promise<void> {
    try {
      await this.mail.send(to, mail.subject, mail.text);
    } catch (e) {
      this.logger.error(`No se pudo enviar el correo a ${to}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── De la organización (DEBTOR_VIA_ORG) ───────────────────────────────────────────────────────────────────────────────

  async fileOrg(dto: CreateOrgPrivacyRequestDto) {
    const userId = this.userId;
    const accountId = this.tenant.accountId;
    const row = await this.prisma.withTenant(accountId, (tx) =>
      tx.privacyRequest.create({
        data: {
          subjectKind: PrivacySubjectKind.DEBTOR_VIA_ORG,
          type: dto.type,
          subjectLabel: dto.subjectLabel.trim(),
          description: dto.description.trim(),
          requesterUserId: userId,
          accountId,
          events: { create: { status: S.RECEIVED, actorKind: 'ORG', actorUserId: userId } },
        },
        include: INCLUDE,
      }),
    );
    return this.view(row);
  }

  async listOrg() {
    const accountId = this.tenant.accountId;
    const rows = await this.prisma.withTenant(accountId, (tx) =>
      tx.privacyRequest.findMany({
        where: { accountId, subjectKind: PrivacySubjectKind.DEBTOR_VIA_ORG },
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((r) => this.view(r));
  }

  async transitionOrg(id: string, dto: TransitionPrivacyRequestDto) {
    const accountId = this.tenant.accountId;
    const userId = this.userId;
    const row = await this.prisma.withTenant(accountId, (tx) =>
      this.transition(tx, { id, accountId, subjectKind: PrivacySubjectKind.DEBTOR_VIA_ORG }, dto, { kind: 'ORG', userId }),
    );
    return this.view(row);
  }

  // ── De plataforma (Kobrax atiende las APP_USER) ───────────────────────────────────────────────────────────────────────

  async listPlatform(status?: S) {
    const rows = await this.prisma.withSurface('platform', (tx) =>
      tx.privacyRequest.findMany({
        where: { subjectKind: { in: [PrivacySubjectKind.APP_USER, PrivacySubjectKind.THIRD_PARTY] }, ...(status ? { status } : {}) },
        include: { ...INCLUDE, requester: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    );
    return rows.map((r) => ({
      ...this.view(r),
      // THIRD_PARTY no tiene usuario: quien escribió es el contacto del formulario público.
      requester: r.requester
        ? { email: r.requester.email, name: r.requester.profile ? `${r.requester.profile.firstName} ${r.requester.profile.lastName}` : null }
        : { email: r.contactEmail ?? '', name: r.contactName ?? null },
    }));
  }

  async transitionPlatform(id: string, dto: TransitionPrivacyRequestDto, platformUserId: string) {
    const row = await this.prisma.withSurface('platform', async (tx) => {
      // Aprobar un pedido que actúa sobre datos o cuenta exige que la persona haya confirmado su correo.
      if (dto.status === S.APPROVED) {
        const found = await tx.privacyRequest.findFirst({ where: { id, subjectKind: PrivacySubjectKind.THIRD_PARTY } });
        if (found && needsContactVerification(found.type) && found.contactVerifiedAt == null) throw privacyUnverified();
      }
      return this.transition(tx, { id, subjectKind: { in: [PrivacySubjectKind.APP_USER, PrivacySubjectKind.THIRD_PARTY] } }, dto, { kind: 'PLATFORM', userId: platformUserId });
    });
    return this.view(row);
  }

  // ── Núcleo: un cambio de estado con su evento ─────────────────────────────────────────────────────────────────────────

  /**
   * Cambia el estado validando la máquina de estados, y deja el evento. El `updateMany` condicionado al estado leído evita que dos
   * personas cambien la misma solicitud a la vez (la segunda recibe un conflicto en vez de pisar a la primera).
   */
  private async transition(
    tx: PrismaClient,
    where: { id: string; accountId?: string; subjectKind: PrivacySubjectKind | { in: PrivacySubjectKind[] } },
    input: TransitionPrivacyRequestDto,
    actor: { kind: ActorKind; userId: string },
  ): Promise<RequestRow> {
    const found = await tx.privacyRequest.findFirst({ where });
    if (!found) throw privacyRequestNotFound();
    const from = found.status as S;
    const check = checkTransition(from, input.status, input);
    if (!check.ok) {
      if (check.code === 'REASON_REQUIRED') throw privacyReasonRequired();
      if (check.code === 'NOTE_REQUIRED') throw privacyNoteRequired();
      throw privacyInvalidTransition(from, input.status);
    }
    const rejected = input.status === S.REJECTED;
    const note = (rejected ? input.rejectionReason : input.note)?.trim() || null;
    const moved = await tx.privacyRequest.updateMany({
      where: { id: found.id, status: from },
      data: {
        status: input.status,
        rejectionReason: rejected ? note : found.rejectionReason,
        closedAt: isTerminal(input.status) ? new Date() : null,
      },
    });
    if (moved.count === 0) throw privacyInvalidTransition(from, input.status);
    await tx.privacyRequestEvent.create({
      data: { requestId: found.id, status: input.status, note, actorKind: actor.kind, actorUserId: actor.userId },
    });
    return tx.privacyRequest.findUniqueOrThrow({ where: { id: found.id }, include: INCLUDE });
  }
}
