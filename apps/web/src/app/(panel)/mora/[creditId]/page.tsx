import { FichaGestion } from './ficha-gestion';

/**
 * La ficha de **gestión de un crédito** (`/mora/:creditId`). Todo el contenido vive en `FichaGestion`: la parada de una
 * ruta (`/rutas/:id/parada/:sid`) pinta **la misma ficha** en su pestaña «Ficha», para que el mismo crédito no tenga dos vistas.
 */
export default function CreditoMoraPage({ params }: { params: { creditId: string } }) {
  return <FichaGestion creditId={params.creditId} />;
}
