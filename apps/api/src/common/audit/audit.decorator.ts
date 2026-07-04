import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from './audit.service';

export const AUDIT_KEY = 'audit:meta';

export interface AuditMeta {
  entity: string;
  /** Si se omite, se deriva del método HTTP (POST→CREATE, PATCH/PUT→UPDATE, DELETE→DELETE). */
  action?: AuditAction;
}

/**
 * Marca un handler para auditoría automática (lo recoge el `AuditInterceptor`).
 * Para auditar con `before/after` ricos (p.ej. un UPDATE que necesita el estado previo),
 * el servicio llama directamente a `AuditService.record(...)`.
 *
 *   @Audit('client')
 *   @Post() create(...) { ... }
 */
export const Audit = (entity: string, action?: AuditAction) =>
  SetMetadata(AUDIT_KEY, { entity, action } satisfies AuditMeta);
