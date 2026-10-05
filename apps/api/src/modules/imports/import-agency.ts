import type { PrismaClient } from '@prisma/client';
import type { AssignmentService } from '../assignments/assignment.service';

/**
 * El límite de agencia del supervisor (D8) sobre lo que reparte una importación.
 *
 *  · **Reasignaciones de créditos existentes**: el crédito y el destinatario tienen que ser de su agencia
 *    (`assertAssignable` con los ids).
 *  · **Créditos nuevos**: todavía no existen, así que sólo se mira que los destinatarios sean de su agencia.
 *
 * Sólo corre cuando quien importa **elige** el reparto (`assignment:write`): el cobrador que importa su propia
 * cartera se asigna a sí mismo y no reparte nada. Gerente y administrador no tienen límite. Lanza
 * `ASSIGNMENT_OUT_OF_AGENCY` (403); como se llama dentro de la transacción de la corrida, ésta se deshace entera.
 */
export async function assertImportAgency(
  assignment: Pick<AssignmentService, 'assertAssignable' | 'assertAssigneesInAgency'>,
  tx: PrismaClient,
  p: { canAssign: boolean; createAssignees: string[]; reassign: { creditId: string; to: string }[] },
): Promise<void> {
  if (!p.canAssign) return;
  if (p.reassign.length > 0) {
    await assignment.assertAssignable(
      tx,
      p.reassign.map((r) => r.to),
      p.reassign.map((r) => r.creditId),
    );
  }
  await assignment.assertAssigneesInAgency(tx, p.createAssignees);
}
