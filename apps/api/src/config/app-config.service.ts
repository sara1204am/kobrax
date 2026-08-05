import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/** Acceso tipado a la configuración validada. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv() {
    return this.get('NODE_ENV');
  }
  get isProduction() {
    return this.nodeEnv === 'production';
  }
  get port() {
    return this.get('API_PORT');
  }
  get appDatabaseUrl() {
    return this.get('APP_DATABASE_URL');
  }
  get redisUrl() {
    return this.get('REDIS_URL');
  }
  get jwtSecret() {
    return this.get('JWT_SECRET');
  }
  get jwtRefreshSecret() {
    return this.get('JWT_REFRESH_SECRET');
  }
  get jwtExpiresIn() {
    return this.get('JWT_EXPIRES_IN');
  }
  get jwtRefreshExpiresIn() {
    return this.get('JWT_REFRESH_EXPIRES_IN');
  }
  get encryptionKey() {
    return this.get('APP_ENCRYPTION_KEY');
  }
  get blindIndexKey() {
    return this.get('APP_BLIND_INDEX_KEY');
  }
  get smtpUser() {
    return this.get('SMTP_USER');
  }
  get smtpPass() {
    return this.get('SMTP_PASS');
  }
  get mailFrom() {
    return this.get('MAIL_FROM');
  }
  get corsOrigins(): string[] {
    return [...new Set([this.get('APP_URL'), this.get('SOCKET_CORS_ORIGIN')])];
  }
}
