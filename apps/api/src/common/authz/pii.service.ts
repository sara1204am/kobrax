import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  canReveal,
  canRevealContacts,
  canSeeContact,
  canSeeEconomic,
  documentInClearByDefault,
  Permission,
  PiiCategory,
  type PiiActor,
} from '@kobrax/shared';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContextService } from '../context/tenant-context.service';

/** Los permisos que la regla de PII mira (para armar la lista a partir de `can()` cuando no hay lista completa). */
const PII_PERMISSIONS = [
  Permission.CLIENT_READ,
  Permission.CLIENT_CONTACT_READ,
  Permission.CLIENT_PII_READ,
  Permission.DATA_SCOPE_ALL,
  Permission.DATA_SCOPE_SUBTREE,
  Permission.DATA_SCOPE_BRANCH,
];

/**
 * F14 · F4 (ADR-F14-06, H-5/H-6): qué categorías de dato personal de un cliente ve quien hace la petición. Es una capa fina sobre las
 * funciones puras de `@kobrax/shared` (`pii-fields.ts`), que son la regla; acá sólo se arma el «quién» (permisos del request, canal y el
 * interruptor `PII_MOBILE_MASK`). La política `pii.reveal` es `canReveal()` (el DOCUMENTO) y `canRevealContacts()`/`assertCanRevealContacts()` (los contactos, F14 · F8).
 *
 * Toda pantalla o exporte que devuelva datos de un cliente pasa por acá, para que la regla sea una sola.
 */
@Injectable()
export class PiiService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  actor(): PiiActor {
    // `tenant.get` y `tenant.permissions` existen en el servicio real; los dobles de prueba antiguos sólo traen `can`, así que los
    // permisos que importan se consultan uno por uno por esa vía (mismo resultado).
    const can = (p: string) => this.tenant.can(p);
    const permissions = Array.isArray(this.tenant.permissions) ? this.tenant.permissions : PII_PERMISSIONS.filter(can);
    return { permissions, channel: this.tenant.get?.()?.channel, mobileMask: this.config.piiMobileMask };
  }

  /** Política `pii.reveal`: ¿puede pedir el documento y los contactos en claro? (el alcance —¿ve a ese cliente?— lo resuelve el llamador). */
  canReveal(): boolean {
    return canReveal(this.actor());
  }

  /** F14 · F8 (D-4): ¿puede pedir los CONTACTOS en claro? El canal móvil con la máscara SÍ (el documento sigue tapado: `canReveal`). */
  canRevealContacts(): boolean {
    return canRevealContacts(this.actor());
  }

  /** Lanza 403 `PII_REVEAL_DENIED` si no puede revelar los contactos. Para el pedido EXPLÍCITO (`?reveal=true`). */
  assertCanRevealContacts(): void {
    if (!this.canRevealContacts()) throw new ForbiddenException({ code: 'PII_REVEAL_DENIED', message: 'No tienes permiso para ver estos datos en claro' });
  }

  /** ¿Ve teléfonos, direcciones, GPS, zona, notas, fotos de ubicación y personas relacionadas? */
  canSeeContact(): boolean {
    return canSeeContact(this.actor());
  }

  canSeeEconomic(): boolean {
    return canSeeEconomic(this.actor());
  }

  /** D-3: en Agenda, Mora y Rutas ¿el documento va en claro sin que lo pida? (administrador, gerente, auditor; el cobrador sobre su cartera). */
  documentInClearByDefault(): boolean {
    return documentInClearByDefault(this.actor());
  }

  /** Lo que se escribe en la auditoría de un revelado: las categorías que SALIERON en claro, nunca valores. */
  revealedCategories(documentToo = true, contactsToo = true): PiiCategory[] {
    const out: PiiCategory[] = [];
    if (documentToo) out.push(PiiCategory.DOCUMENT);
    if (contactsToo && this.canSeeContact()) out.push(PiiCategory.CONTACT);
    if (contactsToo && this.canSeeEconomic()) out.push(PiiCategory.ECONOMIC);
    return out;
  }

  /** Auditoría estándar de un revelado/lectura de PII: quién, qué entidad, qué categorías, por qué canal. Sin valores (B5 + redact). */
  auditAfter(entity: string, categories: PiiCategory[]): Record<string, unknown> {
    return { entity, categories, channel: this.tenant.get?.()?.channel ?? 'api' };
  }
}
