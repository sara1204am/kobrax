import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: el proceso responde. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: dependencias (DB + Redis) operativas. */
  @Get()
  async ready(): Promise<{ db: 'up' | 'down'; redis: 'up' | 'down' }> {
    const db = await this.prisma
      .$queryRaw`SELECT 1`.then(() => 'up' as const)
      .catch(() => 'down' as const);
    const redis = await this.redis
      .ping()
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    return { db, redis };
  }
}
