import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Dashboard, DashboardWidget, PrismaClient } from '@prisma/client';
import { Permission, type DashboardDefinition } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateDashboardDto, UpdateDashboardDto, WidgetDto } from './dto/dashboard.dto';

const notFound = () => new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Tablero no encontrado' });
const notYours = () =>
  new ForbiddenException({ code: 'AUTH_002', message: 'Sólo quien creó el tablero puede modificarlo' });

type WithWidgets = Dashboard & { widgets: DashboardWidget[] };

function serialize(d: WithWidgets): DashboardDefinition {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? undefined,
    isDefault: d.isDefault,
    createdBy: d.createdBy ?? undefined,
    widgets: d.widgets.map((w) => ({
      id: w.id,
      type: w.type as DashboardDefinition['widgets'][number]['type'],
      title: w.title ?? '',
      layout: { x: w.x, y: w.y, w: w.w, h: w.h },
      config: (w.config ?? {}) as Record<string, unknown>,
    })),
  };
}

/**
 * Los tableros del tenant.
 *
 * 🔴 **Un tablero se edita por quien lo creó**, o por el admin de la cuenta (`account:write`). Sin
 * esto, cualquiera con `report:read` —y eso incluye a VIEWER y AUDITOR, que son roles de sólo
 * lectura— podría borrar el tablero que abre toda la empresa. Leerlo lo puede leer todo el mundo
 * que entra al dashboard: es información de la cuenta, no de una persona.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  private assertCanWrite(d: Dashboard): void {
    const mine = d.createdBy && d.createdBy === this.tenant.userId;
    if (!mine && !this.tenant.can(Permission.ACCOUNT_WRITE)) throw notYours();
  }

  /**
   * 🔴 **Marcar un tablero como predeterminado le cambia la pantalla de entrada a TODA la empresa.**
   *
   * Crear un tablero propio lo puede hacer cualquiera que entre al dashboard —para eso está—, pero
   * `isDefault` no es una preferencia personal: apaga el anterior y todo el mundo aterriza en el
   * nuevo. Sin esta guarda, un VIEWER —un rol de sólo lectura— creaba uno con `isDefault: true` y se
   * quedaba con la portada del tenant.
   *
   * La excepción es el arranque: mientras **no haya ninguno**, el primero que se guarde puede serlo.
   * Es el camino normal del panel, donde el tablero por defecto vive en el código hasta que alguien
   * mueve algo.
   */
  private async assertCanSetDefault(tx: PrismaClient): Promise<void> {
    if (this.tenant.can(Permission.ACCOUNT_WRITE)) return;
    const existing = await tx.dashboard.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (existing) throw notYours();
  }

  /**
   * Los widgets, listos para `createMany`. El orden de la grilla lo dan `x/y`, no el del array.
   *
   * 🔴 **`x` se recorta contra el ancho.** El DTO valida `x ≤ 11` y `w ≤ 12` por separado, así que
   * `{ x: 11, w: 12 }` pasa y deja el widget colgando fuera de las doce columnas — y ahí **no hay
   * forma de volver a agarrarlo** para moverlo. Dos rangos correctos no hacen una posición válida.
   */
  private widgetRows(dashboardId: string, widgets: WidgetDto[] = []) {
    return widgets.map((w) => ({
      accountId: this.tenant.accountId,
      dashboardId,
      type: w.type,
      title: w.title ?? null,
      x: Math.max(0, Math.min(w.x, 12 - w.w)),
      y: w.y,
      w: w.w,
      h: w.h,
      config: (w.config ?? {}) as object,
    }));
  }

  async list(): Promise<DashboardDefinition[]> {
    const rows = await this.tx((tx) =>
      tx.dashboard.findMany({
        where: { deletedAt: null },
        include: { widgets: true },
        // El predeterminado primero: es el que abre, y en una lista corta se busca con la vista.
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    );
    return rows.map(serialize);
  }

  async findOne(id: string): Promise<DashboardDefinition> {
    const row = await this.tx((tx) => tx.dashboard.findFirst({ where: { id, deletedAt: null }, include: { widgets: true } }));
    if (!row) throw notFound();
    return serialize(row);
  }

  async create(dto: CreateDashboardDto): Promise<DashboardDefinition> {
    const row = await this.tx(async (tx) => {
      if (dto.isDefault) {
        await this.assertCanSetDefault(tx);
        await this.clearDefault(tx);
      }
      const dashboard = await tx.dashboard.create({
        data: {
          accountId: this.tenant.accountId,
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault ?? false,
          createdBy: this.tenant.userId,
        },
      });
      await tx.dashboardWidget.createMany({ data: this.widgetRows(dashboard.id, dto.widgets) });
      return tx.dashboard.findFirstOrThrow({ where: { id: dashboard.id }, include: { widgets: true } });
    });

    await this.audit.record({ entity: 'dashboard', entityId: row.id, action: 'CREATE', after: { name: row.name } });
    return serialize(row);
  }

  async update(id: string, dto: UpdateDashboardDto): Promise<DashboardDefinition> {
    const row = await this.tx(async (tx) => {
      const current = await tx.dashboard.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw notFound();
      this.assertCanWrite(current);

      if (dto.isDefault) {
        await this.assertCanSetDefault(tx);
        await this.clearDefault(tx, id);
      }
      await tx.dashboard.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });

      /*
       * El layout se reemplaza entero: borrar y volver a crear.
       *
       * Es lo que hace que un arrastre que movió cinco widgets a la vez se guarde de una sola forma
       * posible. Actualizar uno por uno obligaría a resolver posiciones intermedias —dos widgets
       * pisándose mientras se aplica la mitad del cambio— y a decidir qué hacer con los que ya no
       * están. Los ids de widget son internos: nadie los guarda afuera.
       */
      if (dto.widgets) {
        await tx.dashboardWidget.deleteMany({ where: { dashboardId: id } });
        await tx.dashboardWidget.createMany({ data: this.widgetRows(id, dto.widgets) });
      }

      return tx.dashboard.findFirstOrThrow({ where: { id }, include: { widgets: true } });
    });

    await this.audit.record({
      entity: 'dashboard',
      entityId: id,
      action: 'UPDATE',
      after: { name: row.name, widgets: row.widgets.length },
    });
    return serialize(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.tx(async (tx) => {
      const current = await tx.dashboard.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw notFound();
      this.assertCanWrite(current);
      // Borrado suave: los widgets quedan colgando del tablero y vuelven con él si se restaura.
      await tx.dashboard.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    });

    await this.audit.record({ entity: 'dashboard', entityId: id, action: 'DELETE' });
    return { id };
  }

  /** Duplicar: la forma barata de partir de uno que ya sirve en vez de armar otro desde cero. */
  async duplicate(id: string): Promise<DashboardDefinition> {
    const row = await this.tx(async (tx) => {
      const source = await tx.dashboard.findFirst({ where: { id, deletedAt: null }, include: { widgets: true } });
      if (!source) throw notFound();

      const copy = await tx.dashboard.create({
        data: {
          accountId: this.tenant.accountId,
          name: `${source.name} (copia)`,
          description: source.description,
          // La copia **nunca** nace como predeterminada: duplicar no es cambiarle el tablero a todos.
          isDefault: false,
          createdBy: this.tenant.userId,
        },
      });
      await tx.dashboardWidget.createMany({
        data: source.widgets.map((w) => ({
          accountId: this.tenant.accountId,
          dashboardId: copy.id,
          type: w.type,
          title: w.title,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          config: w.config as object,
        })),
      });
      return tx.dashboard.findFirstOrThrow({ where: { id: copy.id }, include: { widgets: true } });
    });

    await this.audit.record({ entity: 'dashboard', entityId: row.id, action: 'CREATE', after: { copyOf: id } });
    return serialize(row);
  }

  /** Uno solo predeterminado por cuenta: marcar uno apaga al anterior, en la misma transacción. */
  private clearDefault(tx: PrismaClient, except?: string): Promise<unknown> {
    return tx.dashboard.updateMany({
      where: { isDefault: true, ...(except ? { id: { not: except } } : {}) },
      data: { isDefault: false },
    });
  }
}
