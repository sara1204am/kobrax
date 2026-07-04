import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

/**
 * Adapter de Socket.io con **CORS restringido** (`SOCKET_CORS_ORIGIN`). El gateway
 * declara solo el namespace; el origen permitido se inyecta aquí desde la config
 * validada para no depender de `process.env` en tiempo de decoración.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    });
  }
}
