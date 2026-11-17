import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrivacyRequestStatus as S, PrivacySubjectKind } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { CreateOrgPrivacyRequestDto, CreateOwnPrivacyRequestDto, TransitionPrivacyRequestDto } from './dto/privacy-requests.dto';
import {
  privacyInvalidTransition,
  privacyNoteRequired,
  privacyReasonRequired,
  privacyRequestNotFound,
  privacyTooManyOpen,
} from './privacy-requests.errors';
import { MAX_OPEN_PER_USER, OPEN_STATUSES, allowedNext, checkTransition, isTerminal } from './privacy-requests.logic';

type ActorKind = 'REQUESTER' | 'ORG' | 'PLATFORM';

const INCLUDE = { events: { orderBy: { createdAt: 'asc' as const } } };

interface RequestRow {
  id: string;
  subjectKind: string;
  type: string;
  status: string;
  subjectLabel: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
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
    const rows = await this.prisma.privacyRequest.findMany({
      where: { subjectKind: PrivacySubjectKind.APP_USER, ...(status ? { status } : {}) },
      include: { ...INCLUDE, requester: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({
      ...this.view(r),
      requester: { email: r.requester.email, name: r.requester.profile ? `${r.requester.profile.firstName} ${r.requester.profile.lastName}` : null },
    }));
  }

  async transitionPlatform(id: string, dto: TransitionPrivacyRequestDto, platformUserId: string) {
    const row = await this.prisma.$transaction((tx) =>
      this.transition(tx as unknown as PrismaClient, { id, subjectKind: PrivacySubjectKind.APP_USER }, dto, { kind: 'PLATFORM', userId: platformUserId }),
    );
    return this.view(row);
  }

  // ── Núcleo: un cambio de estado con su evento ─────────────────────────────────────────────────────────────────────────

  /**
   * Cambia el estado validando la máquina de estados, y deja el evento. El `updateMany` condicionado al estado leído evita que dos
   * personas cambien la misma solicitud a la vez (la segunda recibe un conflicto en vez de pisar a la primera).
   */
  private async transition(
    tx: PrismaClient,
    where: { id: string; accountId?: string; subjectKind: PrivacySubjectKind },
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
