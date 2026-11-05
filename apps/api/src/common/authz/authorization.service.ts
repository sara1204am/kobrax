import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service';
import type { Actor, Decision } from './authz.types';
import { POLICIES } from './policies';

/**
 * F14 · F3: la API ÚNICA de autorización para los servicios. Reemplaza al `tenant.can(...)` repartido por la aplicación:
 * mismo resultado, un solo lugar. `can/canAny/canAll` responden por permisos; `decide/assertPolicy` evalúan políticas puras
 * (las que necesitan datos de la DB van por `PolicyService`). Nunca toca Prisma.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly tenant: TenantContextService) {}

  can(permission: string): boolean {
    return this.tenant.can(permission);
  }

  canAny(...permissions: string[]): boolean {
    return permissions.some((p) => this.tenant.can(p));
  }

  canAll(...permissions: string[]): boolean {
    // Lista vacía = denegar (nunca abrir por defecto ante un arreglo armado dinámicamente).
    return permissions.length > 0 && permissions.every((p) => this.tenant.can(p));
  }

  /** Lanza 403 `AUTH_002` si falta alguno. Para los casos que no tienen un error de dominio propio. */
  assert(...permissions: string[]): void {
    if (!this.canAll(...permissions)) throw new ForbiddenException({ code: 'AUTH_002', message: 'No tienes permisos para esta acción' });
  }

  actor(): Actor {
    return { userId: this.tenant.userId, accountId: this.tenant.accountId, can: (p) => this.tenant.can(p) };
  }

  /** Evalúa una política que no necesita hechos de la DB. Una política desconocida es un error de programación. */
  decide(name: string, input?: unknown): Decision {
    const def = POLICIES.find((p) => p.name === name);
    if (!def) throw new Error(`Política desconocida: ${name}`);
    if (def.loadFacts) throw new Error(`La política ${name} necesita hechos de la DB: usar PolicyService.check`);
    return (def.decide as (a: Actor, f: undefined, i: unknown) => Decision)(this.actor(), undefined, input);
  }

  assertPolicy(name: string, input?: unknown): void {
    throwIfDenied(this.decide(name, input));
  }
}

export function throwIfDenied(d: Decision): void {
  if (d.allow) return;
  const body = { code: d.code, message: d.message };
  throw d.status === 404 ? new NotFoundException(body) : new ForbiddenException(body);
}
