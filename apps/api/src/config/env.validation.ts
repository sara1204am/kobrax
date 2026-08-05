import { z } from 'zod';

/** Esquema de entorno. Si algo falta o es inválido → la app NO arranca (fail-fast). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Runtime de la API: rol kobrax_app (NOBYPASSRLS) — nunca el superuser.
  APP_DATABASE_URL: z.string().url(),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener ≥ 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener ≥ 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SOCKET_CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Requerido cuando se implemente el cifrado AES-256 (MFA secret); opcional al boot.
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Blind index (HMAC) para documentos cifrados (F4). El BlindIndexService valida 32 bytes al boot.
  APP_BLIND_INDEX_KEY: z.string().optional(),
  // SMTP de Gmail (CUENTA · S2). Opcionales a propósito: sin ellas el MailService
  // loguea el correo en vez de enviarlo, así que el módulo corre sin credenciales.
  // SMTP_PASS es una **contraseña de aplicación** de Google, no la del correo.
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Validador usado por ConfigModule.forRoot({ validate }). Lanza → fail-fast. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`❌ Configuración de entorno inválida:\n${detail}`);
  }
  return parsed.data;
}
