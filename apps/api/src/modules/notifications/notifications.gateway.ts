import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  REALTIME_NAMESPACE,
  RealtimeEvent,
  type ClientToServerEvents,
  type CollectorLocationInput,
  type CollectorLocationPayload,
  type ServerToClientEvents,
} from '@kobrax/shared';
import { TokenService } from '../auth/token.service';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../../database/prisma.service';
import {
  canSendLocation,
  deriveRooms,
  isValidCoord,
  shouldAcceptLocation,
  supervisorsRoom,
  tenantRoom,
  userRoom,
  type SocketIdentity,
} from './realtime.helpers';

/** Estado por socket: identidad derivada del token + instante del último location aceptado. */
interface SocketState {
  identity?: SocketIdentity;
  lastLocationAt?: number;
}

type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketState>;

/**
 * Canal de realtime (F8). Socket.io, namespace `/events`. El handshake se autentica
 * con el **access token** (+ denylist de sesión); las rooms se **derivan server-side**
 * de la identidad (nunca las declara el cliente) → aislamiento estricto por tenant (M1/M3).
 * CORS lo restringe el `SocketIoAdapter` con `SOCKET_CORS_ORIGIN`.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: AppServer;

  constructor(
    private readonly token: TokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Handshake ──────────────────────────────────────────────────────────────────
  async handleConnection(client: AppSocket): Promise<void> {
    const identity = await this.authenticate(client);
    if (!identity) {
      client.disconnect(true); // sin token válido → no se une a ninguna room
      return;
    }
    client.data.identity = identity;
    for (const room of deriveRooms(identity)) await client.join(room);
    this.logger.debug(`socket conectado user=${identity.userId} tenant=${identity.accountId}`);
  }

  /** Valida el access token del handshake y consulta la denylist. `null` si no es válido. */
  private async authenticate(client: AppSocket): Promise<SocketIdentity | null> {
    const auth = client.handshake.auth as { token?: string } | undefined;
    const header = client.handshake.headers['authorization'];
    const raw = auth?.token ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!raw) return null;

    let claims;
    try {
      claims = this.token.verifyAccess(raw);
    } catch {
      return null;
    }
    if (await this.sessions.isRevoked(claims.sessionId)) return null;

    return { userId: claims.sub, accountId: claims.accountId, permissions: claims.permissions };
  }

  // ── collector.location (client→server) ──────────────────────────────────────────
  @SubscribeMessage(RealtimeEvent.COLLECTOR_LOCATION)
  async onCollectorLocation(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: CollectorLocationInput,
  ): Promise<void> {
    const identity = client.data.identity;
    if (!identity || !canSendLocation(identity)) return; // solo cobradores autenticados
    if (!body || !isValidCoord(body.lat, body.lng)) return;

    const now = Date.now();
    if (!shouldAcceptLocation(client.data.lastLocationAt, now)) return; // throttle
    client.data.lastLocationAt = now;

    await this.persistLocation(identity.userId, body).catch((err) =>
      this.logger.warn(`No se pudo persistir ubicación: ${err?.message ?? err}`),
    );

    const payload: CollectorLocationPayload = {
      collectorId: identity.userId,
      lat: body.lat,
      lng: body.lng,
      accountId: identity.accountId,
      at: new Date(now).toISOString(),
    };
    // Solo a supervisores del MISMO tenant (nunca cruza de empresa).
    this.server.to(supervisorsRoom(identity.accountId)).emit(RealtimeEvent.COLLECTOR_LOCATION, payload);
  }

  /** Persiste `last_known_*` del cobrador (tabla global `users`, sin RLS por tenant). */
  private async persistLocation(userId: string, body: CollectorLocationInput): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastKnownLat: body.lat, lastKnownLng: body.lng, lastLocationAt: new Date() },
    });
  }

  // ── API interna para el traductor de eventos (NotificationsService) ──────────────
  /** Emite a una room saltando el tipado de acks de socket.io (event/payload ya validados por el contrato). */
  private room(name: string): { emit: (event: string, payload: unknown) => void } {
    return this.server.to(name) as unknown as { emit: (event: string, payload: unknown) => void };
  }

  emitToTenant<E extends keyof ServerToClientEvents>(
    accountId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void {
    this.room(tenantRoom(accountId)).emit(event as string, payload);
  }

  emitToSupervisors<E extends keyof ServerToClientEvents>(
    accountId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void {
    this.room(supervisorsRoom(accountId)).emit(event as string, payload);
  }

  emitToUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void {
    this.room(userRoom(userId)).emit(event as string, payload);
  }
}
