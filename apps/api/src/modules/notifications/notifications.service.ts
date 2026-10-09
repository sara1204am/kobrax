import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Notification, PrismaClient } from '@prisma/client';
import { NotificationType } from '@prisma/client';
import {
  RealtimeEvent,
  ResponseDto,
  resolvePagination,
  type ApiResponse,
  type NotificationPayload,
  type PaymentRegisteredPayload,
  type RouteCompletedPayload,
} from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { DomainEvent, EventBusService, type AgendaEventPayload } from '../../common/events/event-bus.service';
import { RealtimeGateway } from './notifications.gateway';
import { SUPERVISORY_ROLES } from './realtime.helpers';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from './notification-channel';
import { serializeNotification } from './notifications.serializer';
import { ListNotificationsQueryDto } from './dto/notification.dto';
import { resourceNotFound } from './notifications.errors';

/** Campos para crear una notificación (el destinatario y el tenant van aparte). */
interface NotifyData {
  type: NotificationType;
  title: string;
  body?: string;
  clientId?: string;
  creditId?: string;
  /** La gestión de agenda de la que habla el aviso. */
  agendaItemId?: string;
}

/**
 * Traductor de eventos de dominio → notificaciones persistidas + realtime (F8).
 * Suscribe el `EventBusService` (que F5/F6/F7 alimentan), **persiste siempre** la
 * notificación (M4) y la emite por WebSocket; si el destinatario está offline queda
 * para el fetch REST. También expone el REST de notificaciones (scope `own`).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBusService,
    private readonly gateway: RealtimeGateway,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  onModuleInit(): void {
    this.events.on(DomainEvent.PAYMENT_REGISTERED, (p) => this.safe(() => this.onPaymentRegistered(p as PaymentRegisteredPayload)));
    this.events.on(DomainEvent.ROUTE_COMPLETED, (p) => this.safe(() => this.onRouteCompleted(p as RouteCompletedPayload)));
    this.events.on(DomainEvent.AGENDA_ASSIGNED, (p) => this.safe(() => this.onAgendaAssigned(p as AgendaEventPayload)));
    this.events.on(DomainEvent.AGENDA_CHANGED, (p) => this.safe(() => this.onAgendaChanged(p as AgendaEventPayload)));
  }

  /** Aísla un handler de evento: un fallo se loguea pero nunca tumba el emisor. */
  private safe(fn: () => Promise<void>): void {
    void fn().catch((err) => this.logger.error(`Fallo procesando evento de dominio: ${err?.message ?? err}`));
  }

  // ── Traductores por evento ───────────────────────────────────────────────────────
  /** Pago registrado → feed en vivo + aviso persistido a supervisores. */
  async onPaymentRegistered(p: PaymentRegisteredPayload): Promise<void> {
    this.gateway.emitToSupervisors(p.accountId, RealtimeEvent.PAYMENT_REGISTERED, p);
    await this.fanOutToSupervisors(p.accountId, {
      type: NotificationType.PAYMENT_REGISTERED,
      title: 'Pago registrado',
      body: `Se registró un pago por ${p.amount}.`,
      creditId: p.creditId,
    });
  }

  /** Ruta completada → feed en vivo + aviso persistido a supervisores. */
  async onRouteCompleted(p: RouteCompletedPayload): Promise<void> {
    this.gateway.emitToSupervisors(p.accountId, RealtimeEvent.ROUTE_COMPLETED, p);
    await this.fanOutToSupervisors(p.accountId, {
      type: NotificationType.SYSTEM,
      title: 'Ruta completada',
      body: `Un cobrador completó su ruta.`,
    });
  }

  /** Una gestión de agenda te la asignó otra persona → aviso persistido al responsable, con enlace a la gestión. */
  async onAgendaAssigned(p: AgendaEventPayload): Promise<void> {
    await this.notifyUser(p.accountId, p.recipientId, {
      type: NotificationType.AGENDA_ASSIGNED,
      title: 'Nueva gestión asignada',
      body: `${p.actorName ?? 'Alguien'} te asignó ${agendaPhrase(p)}.`,
      clientId: p.clientId,
      creditId: p.creditId,
      agendaItemId: p.itemId,
    });
  }

  /** Otra persona cambió una gestión tuya → aviso persistido al responsable. */
  async onAgendaChanged(p: AgendaEventPayload): Promise<void> {
    const verb = { RESCHEDULED: 'reagendó', CANCELLED: 'canceló', DELETED: 'eliminó', UPDATED: 'modificó', ASSIGNED: 'te asignó', REASSIGNED: 'reasignó' }[p.kind];
    const title = { RESCHEDULED: 'Gestión reagendada', CANCELLED: 'Gestión cancelada', DELETED: 'Gestión eliminada', UPDATED: 'Gestión modificada', ASSIGNED: 'Nueva gestión asignada', REASSIGNED: 'Gestión reasignada' }[p.kind];
    await this.notifyUser(p.accountId, p.recipientId, {
      type: NotificationType.AGENDA_CHANGED,
      title,
      body: `${p.actorName ?? 'Alguien'} ${verb} ${agendaPhrase(p)}${p.kind === 'REASSIGNED' ? ' a otra persona' : ''}.`,
      clientId: p.clientId,
      creditId: p.creditId,
      // Una eliminada ya no existe, y una reasignada ya no es tuya (no podrías abrirla): el enlace llevaría a un 404.
      ...(p.kind === 'DELETED' || p.kind === 'REASSIGNED' ? {} : { agendaItemId: p.itemId }),
    });
  }

  // ── Persistencia + entrega ───────────────────────────────────────────────────────
  /** Crea, persiste y entrega una notificación a un usuario concreto. Reutilizable por jobs. */
  async notifyUser(accountId: string, userId: string, data: NotifyData): Promise<Notification> {
    const notif = await this.create(accountId, userId, data);
    this.deliver(notif);
    return notif;
  }

  /** Crea una notificación para un destinatario (siempre persiste — M4). */
  private async create(accountId: string, userId: string, data: NotifyData): Promise<Notification> {
    return this.prisma.withTenant(accountId, (tx) =>
      tx.notification.create({
        data: {
          accountId,
          userId,
          type: data.type,
          title: data.title,
          body: data.body ?? null,
          clientId: data.clientId ?? null,
          creditId: data.creditId ?? null,
          agendaItemId: data.agendaItemId ?? null,
        },
      }),
    );
  }

  /** Crea y entrega la misma notificación a todos los supervisores del tenant. */
  private async fanOutToSupervisors(accountId: string, data: NotifyData): Promise<void> {
    const userIds = await this.supervisorUserIds(accountId);
    for (const userId of userIds) {
      const notif = await this.create(accountId, userId, data);
      this.deliver(notif);
    }
  }

  /** Entrega en vivo por WS (si está conectado) + canales externos (stubs). */
  private deliver(notif: Notification): void {
    this.gateway.emitToUser(notif.userId, RealtimeEvent.NOTIFICATION, serializeNotification(notif));
    for (const ch of this.channels) {
      void ch
        .deliver({ userId: notif.userId, accountId: notif.accountId, type: notif.type, title: notif.title, body: notif.body })
        .catch((err) => this.logger.warn(`Canal ${ch.name} falló: ${err?.message ?? err}`));
    }
  }

  /** Ids de usuarios con rol supervisor activos en el tenant (RLS scope al tenant). */
  private async supervisorUserIds(accountId: string): Promise<string[]> {
    return this.prisma.withTenant(accountId, async (tx) => {
      const rows = await tx.userAccount.findMany({
        where: { accountId, isActive: true, role: { name: { in: SUPERVISORY_ROLES } } },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    });
  }

  // ── REST (scope `own`) ─────────────────────────────────────────────────────────────
  async list(query: ListNotificationsQueryDto): Promise<ApiResponse<NotificationPayload[]>> {
    const userId = this.requireUserId();
    const { page, limit, skip } = resolvePagination(query);
    const where = { userId, ...(query.unread ? { readAt: null } : {}) };
    return this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        tx.notification.count({ where }),
      ]);
      return ResponseDto.paginated(rows.map(serializeNotification), total, page, limit);
    });
  }

  /** Marca una notificación propia como leída (idempotente; 404 si no es del usuario). */
  async markRead(id: string): Promise<void> {
    const userId = this.requireUserId();
    await this.prisma.withTenant(this.tenant.accountId, async (tx) => {
      const res = await tx.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
      if (res.count === 0) {
        const exists = await tx.notification.findFirst({ where: { id, userId }, select: { id: true } });
        if (!exists) throw resourceNotFound(); // no existe o no es suya → no se filtra
      }
    });
  }

  async markAllRead(): Promise<void> {
    const userId = this.requireUserId();
    await this.prisma.withTenant(this.tenant.accountId, (tx) =>
      tx.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }),
    );
  }

  private requireUserId(): string {
    const userId = this.tenant.userId;
    if (!userId) throw resourceNotFound();
    return userId;
  }
}

const AGENDA_TYPE_PHRASE: Record<string, string> = {
  CALL: 'una llamada',
  VISIT: 'una visita',
  WHATSAPP: 'un WhatsApp',
  REMINDER: 'un recordatorio',
  PROMISE_TO_PAY: 'una promesa de pago',
};

/** «una visita con Ana Ruiz para el 10/10»: la gestión en una frase, para el cuerpo de un aviso. */
function agendaPhrase(p: AgendaEventPayload): string {
  const what = AGENDA_TYPE_PHRASE[p.itemType] ?? 'una gestión';
  const who = p.clientName ? ` con ${p.clientName}` : '';
  const day = `${p.scheduledDate.slice(8, 10)}/${p.scheduledDate.slice(5, 7)}`;
  return `${what}${who} para el ${day}`;
}
