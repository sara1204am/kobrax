import { PrismaClient } from '@prisma/client';

/**
 * Instancia única de PrismaClient por proceso, con guard de hot-reload en dev.
 * La API setea el contexto de tenant para RLS antes de cada query:
 *   SET LOCAL app.current_account_id = '<uuid>'
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Ejecuta un callback dentro del contexto RLS de un tenant. */
export async function withTenant<T>(
  accountId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_account_id = '${accountId}'`);
    return fn(tx as unknown as PrismaClient);
  });
}

export * from '@prisma/client';
