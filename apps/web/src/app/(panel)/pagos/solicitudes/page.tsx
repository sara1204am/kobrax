import { redirect } from 'next/navigation';

/**
 * `/pagos/solicitudes` no es una pantalla: **la API no lista solicitudes**, sólo devuelve una por
 * id. Existe porque el rastro de navegación enlaza el tramo intermedio, y sin este archivo esa miga
 * caía en `/pagos/[id]` con `id='solicitudes'`.
 *
 * ponytail: un `redirect` y no un listado. El día que la API tenga `GET /payment-requests`, acá va.
 */
export default function SolicitudesPage() {
  redirect('/pagos');
}
