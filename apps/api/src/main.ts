import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createValidationPipe } from './common/validation/validation-pipe';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { SocketIoAdapter } from './common/ws/socket-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // La IP del cliente llega en `X-Forwarded-For`, y sólo se le cree a quien está en el mismo equipo (el proxy y el BFF de la
  // web viven en loopback; 3000 y 4010 están cerrados a internet). Sin esto `req.ip` era siempre 127.0.0.1: el historial de
  // conexiones y el límite de intentos de login veían a todo el mundo como la misma persona.
  app.set('trust proxy', 'loopback');
  const config = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  // Request-id para correlación de logs (header x-request-id).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', id);
    next();
  });

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  // WebSocket (F8): Socket.io con CORS restringido a SOCKET_CORS_ORIGIN/APP_URL.
  app.useWebSocketAdapter(new SocketIoAdapter(app, config.corsOrigins));
  // Shutdown hooks para apagado graceful (SIGTERM de Docker). En Windows se emulan
  // por stdin y rompen al correr detached (kill ENOSYS) → solo fuera de win32.
  if (process.platform !== 'win32') app.enableShutdownHooks();

  await app.listen(config.port);
  logger.log(`Kobrax API escuchando en http://localhost:${config.port}/api`);
}

void bootstrap();
