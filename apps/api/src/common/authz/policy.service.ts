import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service';
import { throwIfDenied } from './authorization.service';
import type { Actor, Decision, PolicyDefinition } from './authz.types';
import { FactsLoader } from './facts-loader';
import { POLICIES } from './policies';

/**
 * Evalúa políticas contextuales (para quién, sobre qué fila): pide los hechos al `FactsLoader` y llama a la función pura.
 * `credit.assign`, `client.create`, `member.invite`… (F2) se registran en `policies/index.ts` y se usan desde acá.
 */
@Injectable()
export class PolicyService {
  constructor(
    private readonly facts: FactsLoader,
    private readonly tenant: TenantContextService,
  ) {}

  has(name: string): boolean {
    return POLICIES.some((p) => p.name === name);
  }

  async check(name: string, input?: unknown): Promise<Decision> {
    const def = POLICIES.find((p) => p.name === name) as unknown as PolicyDefinition<unknown, unknown> | undefined;
    if (!def) throw new Error(`Política desconocida: ${name}`);
    const actor: Actor = { userId: this.tenant.userId, accountId: this.tenant.accountId, can: (p) => this.tenant.can(p) };
    const facts = def.loadFacts ? await def.loadFacts(this.facts, input) : undefined;
    return def.decide(actor, facts, input);
  }

  async assert(name: string, input?: unknown): Promise<void> {
    throwIfDenied(await this.check(name, input));
  }
}
