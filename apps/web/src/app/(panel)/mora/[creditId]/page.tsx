import { Permission } from '@kobrax/shared';
import { requirePermission } from '@/lib/authz';
import { FichaGestion } from './ficha-gestion';

/**
 * La ficha de **gestión de un crédito** (`/mora/:creditId`). Todo el contenido vive en `FichaGestion`: la parada de una
 * ruta (`/rutas/:id/parada/:sid`) pinta **la misma ficha** en su pestaña «Ficha», para que el mismo crédito no tenga dos vistas.
 */
export default async function CreditoMoraPage({ params }: { params: { creditId: string } }) {
  const blocked = await requirePermission(Permission.COLLECTION_READ);
  if (blocked) return blocked;
  return <FichaGestion creditId={params.creditId} />;
}
