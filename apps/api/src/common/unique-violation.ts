import { Prisma } from '@prisma/client';

/** Violación de unicidad de Prisma (P2002): otro envío escribió esa fila primero. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code === 'P2002' : (err as { code?: string } | null)?.code === 'P2002';
}
