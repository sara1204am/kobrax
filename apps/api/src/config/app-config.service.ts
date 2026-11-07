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
  /** El rol dueño del esquema (bypassa RLS) — sólo para migraciones y el backup completo. */
  get databaseUrl() {
    return this.get('DATABASE_URL');
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
  /** F14 · F3 (D-1): `true` = un handler sin contrato de acceso se niega. */
  get authzDenyByDefault(): boolean {
    return this.get('AUTHZ_DENY_BY_DEFAULT') !== 'log';
  }

  /**
   * F14 · F2b (D-1): la segunda barrera de RLS por alcance. `off` (por omisión) = las policies no evalúan nada; `log` = registran lo que
   * habrían negado; `enforce` = niegan. Cualquier otro valor cuenta como `off` (falla hacia lo que ya funcionaba).
   */
  get scopeRlsMode(): 'off' | 'log' | 'enforce' {
    const v = this.get('SCOPE_RLS_MODE');
    return v === 'log' || v === 'enforce' ? v : 'off';
  }

  /** F14 · F4 (D-2): regla «documento enmascarado y sin revelar en móvil». Apagada por omisión (la edición de cliente del móvil aún revela). */
  get piiMobileMask(): boolean {
    return this.get('PII_MOBILE_MASK') === 'on';
  }

  get authzVersionCheck(): boolean {
    return this.get('AUTHZ_VERSION_CHECK') !== 'off';
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
  get fcmServiceAccountB64() {
    return this.get('FCM_SERVICE_ACCOUNT_JSON_B64');
  }
  get fcmServiceAccountFile() {
    return this.get('FCM_SERVICE_ACCOUNT_FILE');
  }
  get corsOrigins(): string[] {
    return [...new Set([this.get('APP_URL'), this.get('SOCKET_CORS_ORIGIN')])];
  }
}
