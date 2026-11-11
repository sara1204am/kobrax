import { Injectable, NotFoundException } from '@nestjs/common';
import type { Dashboard, DashboardWidget, PrismaClient } from '@prisma/client';
import { DASHBOARD_SAMPLES, type DashboardDefinition } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateDashboardDto, UpdateDashboardDto, WidgetDto } from './dto/dashboard.dto';

const notFound = () => new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Tablero no encontrado' });

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
 * Los tableros **de cada persona**.
 *
 * 🔴 **Un tablero es de quien lo creó y sólo esa persona lo ve y lo edita.** Cada cobrador o gerente arma sus pestañas con los
 * indicadores que le sirven; lo que es importante para uno no lo es para otro. Por eso todas las consultas filtran por dueño
 * (`ownerUserId`) y el tablero de otra persona responde 404, no 403: ni siquiera se confirma que existe.
 *
 * La primera vez que alguien abre el dashboard se le crean tres tableros de ejemplo (Indicadores, Gráficos, Agenda) que desde
 * ahí son suyos. «Predeterminado» también es por persona: el que abre primero.
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

  /** El filtro de dueño: toda consulta de tableros lo lleva. */
  private get mine() {
    return { ownerUserId: this.tenant.userId ?? '__nadie__' };
  }

  /**
   * Los widgets, listos para `createMany`. El orden de la grilla lo dan `x/y`, no el del array.
   *
   * 🔴 **`x` se recorta contra el ancho.** El DTO valida `x ≤ 11` y `w ≤ 12` por separado, así que
   * `{ x: 11, w: 12 }` pasa y deja el widget colgando fuera de las doce columnas — y ahí **no hay
   * forma de volver a agarrarlo** para moverlo. Dos rangos correctos no hacen una posición válida.
   *
   * `keep` son los ids que hoy tiene este tablero: los que vuelvan en el pedido conservan el suyo.
   * Un id que no esté ahí —uno nuevo, una copia, o el de otro tablero— se descarta y la fila nace
   * con uno propio, así que **no hay forma de chocar la clave primaria desde afuera**.
   */
  private widgetRows(dashboardId: string, widgets: WidgetDto[] = [], keep: ReadonlySet<string> = new Set()) {
    return widgets.map((w) => ({
      ...(w.id && keep.has(w.id) ? { id: w.id } : {}),
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
    const rows = await this.tx(async (tx) => {
      await this.ensureSamples(tx);
      return tx.dashboard.findMany({
        where: { deletedAt: null, ...this.mine },
        include: { widgets: true },
        // El orden de las pestañas es el de creación: no se reordenan solas al renombrar o marcar el predeterminado.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
    return rows.map(serialize);
  }

  /**
   * La primera vez que una persona abre el dashboard se le crean los tres tableros de ejemplo.
   *
   * «Primera vez» = no tiene NINGUNO, **contando los que borró**: quien eliminó todos sus tableros no los ve reaparecer. La
   * traba por persona evita que dos pedidos simultáneos (la pantalla pide la lista dos veces al montar) los creen por duplicado.
   */
  private async ensureSamples(tx: PrismaClient): Promise<void> {
    const userId = this.tenant.userId;
    if (!userId) return;
    // `$executeRaw` y no `$queryRaw`: `pg_advisory_xact_lock` devuelve `void` y Prisma no sabe leer esa columna.
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`dashboards:${this.tenant.accountId}:${userId}`}))`;
    if ((await tx.dashboard.count({ where: this.mine })) > 0) return;

    const base = Date.now();
    for (const [i, sample] of DASHBOARD_SAMPLES.entries()) {
      const dashboard = await tx.dashboard.create({
        data: {
          accountId: this.tenant.accountId,
          name: sample.name,
          isDefault: i === 0,
          createdBy: userId,
          ownerUserId: userId,
          // Ms de diferencia a propósito: el orden de las pestañas es el de creación.
          createdAt: new Date(base + i),
        },
      });
      await tx.dashboardWidget.createMany({
        data: this.widgetRows(dashboard.id, sample.widgets.map((w) => ({ ...w, title: '' }))),
      });
    }
  }

  async findOne(id: string): Promise<DashboardDefinition> {
    const row = await this.tx((tx) =>
      tx.dashboard.findFirst({ where: { id, deletedAt: null, ...this.mine }, include: { widgets: true } }),
    );
    if (!row) throw notFound();
    return serialize(row);
  }

  async create(dto: CreateDashboardDto): Promise<DashboardDefinition> {
    const row = await this.tx(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx);
      const dashboard = await tx.dashboard.create({
        data: {
          accountId: this.tenant.accountId,
          name: dto.name,
          description: dto.description,
          isDefault: dto.isDefault ?? false,
          createdBy: this.tenant.userId,
          ownerUserId: this.tenant.userId,
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
      /*
       * 🔴 **El tablero se traba antes de tocarlo.** El layout se reemplaza entero (borrar + crear),
       * y dos parches del mismo tablero a la vez se pisan de la peor forma posible: el segundo
       * arranca su `deleteMany` antes de que el primero confirme, así que borra las filas viejas y no
       * ve las nuevas — y las dos tandas quedan. El panel manda dos guardados seguidos todo el
       * tiempo (el botón guarda al toque, el arrastre 600 ms después), y el tablero aparecía
       * DUPLICADO: cada KPI y cada gráfico dos veces.
       *
       * `for update` serializa: el segundo espera, y recién ahí borra lo que el primero escribió.
       * Gana el último, que es lo que la persona espera.
       */
      // `id` es `text` en el esquema, no `uuid`: castear el parámetro tira «operator does not exist».
      await tx.$queryRaw`select id from dashboards where id = ${id} for update`;

      const current = await tx.dashboard.findFirst({ where: { id, deletedAt: null, ...this.mine } });
      if (!current) throw notFound();

      if (dto.isDefault) await this.clearDefault(tx, id);
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
        const before = await tx.dashboardWidget.findMany({ where: { dashboardId: id }, select: { id: true } });
        await tx.dashboardWidget.deleteMany({ where: { dashboardId: id } });
        await tx.dashboardWidget.createMany({
          data: this.widgetRows(id, dto.widgets, new Set(before.map((w) => w.id))),
        });
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
      const current = await tx.dashboard.findFirst({ where: { id, deletedAt: null, ...this.mine } });
      if (!current) throw notFound();
      // Borrado suave: los widgets quedan colgando del tablero y vuelven con él si se restaura.
      await tx.dashboard.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    });

    await this.audit.record({ entity: 'dashboard', entityId: id, action: 'DELETE' });
    return { id };
  }

  /** Duplicar: la forma barata de partir de uno que ya sirve en vez de armar otro desde cero. */
  async duplicate(id: string): Promise<DashboardDefinition> {
    const row = await this.tx(async (tx) => {
      const source = await tx.dashboard.findFirst({ where: { id, deletedAt: null, ...this.mine }, include: { widgets: true } });
      if (!source) throw notFound();

      const copy = await tx.dashboard.create({
        data: {
          accountId: this.tenant.accountId,
          name: `${source.name} (copia)`,
          description: source.description,
          // La copia **nunca** nace como predeterminada: duplicar no es cambiarle el tablero a todos.
          isDefault: false,
          createdBy: this.tenant.userId,
          ownerUserId: this.tenant.userId,
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

  /** Uno solo predeterminado POR PERSONA: marcar uno apaga al anterior de esa persona, en la misma transacción. */
  private clearDefault(tx: PrismaClient, except?: string): Promise<unknown> {
    return tx.dashboard.updateMany({
      where: { isDefault: true, ...this.mine, ...(except ? { id: { not: except } } : {}) },
      data: { isDefault: false },
    });
  }
}
