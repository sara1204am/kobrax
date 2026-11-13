import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { parseGuideState, validateGuideStateInput, type GuideState } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';

/** El estado enviado no cumple el contrato (clave desconocida, valor fuera de catálogo, tamaño…). Nada se guarda. */
const guideStateInvalid = (errors: { code: string; field: string }[]) =>
  new UnprocessableEntityException({
    code: 'GUIDE_STATE_INVALID',
    message: 'El estado de las guías no es válido',
    details: { errors },
  });

/**
 * Estado de las guías de **la persona que pregunta**, en la organización activa (F15 · P6, D-13/D-17).
 *
 * 🔴 Cada persona solo toca SU fila: la clave sale siempre de la sesión (`tenant.userId`), nunca del cuerpo ni de la URL, y
 * el aislamiento entre organizaciones lo da la política RLS de `user_guide_states`. No guarda progreso de negocio (se
 * deriva de datos) y no es una operación del negocio: por eso no deja huella en la bitácora de auditoría (un paso del
 * recorrido por cada clic la inundaría).
 */
@Injectable()
export class GuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get userId(): string {
    const id = this.tenant.userId;
    // Sin persona en la sesión no hay fila propia: nunca se comparte una fila comodín entre sesiones.
    if (!id)
      throw new ForbiddenException({
        code: 'GUIDE_STATE_NO_USER',
        message: 'Las guías son de una persona',
      });
    return id;
  }

  async get(): Promise<GuideState> {
    const row = await this.prisma.withTenant(this.tenant.accountId, (tx) =>
      tx.userGuideState.findUnique({
        where: { accountId_userId: { accountId: this.tenant.accountId, userId: this.userId } },
      }),
    );
    return parseGuideState(row?.state);
  }

  async put(body: unknown): Promise<GuideState> {
    const checked = validateGuideStateInput(body);
    if (!checked.ok) throw guideStateInvalid(checked.errors);
    const state = checked.state as unknown as object;
    await this.prisma.withTenant(this.tenant.accountId, (tx) =>
      tx.userGuideState.upsert({
        where: { accountId_userId: { accountId: this.tenant.accountId, userId: this.userId } },
        create: { accountId: this.tenant.accountId, userId: this.userId, state },
        update: { state },
      }),
    );
    return checked.state;
  }
}
