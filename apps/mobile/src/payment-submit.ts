/**
 * Registrar un cobro desde una hoja de pago: con señal va directo; sin ella queda en el teléfono y sube solo.
 * Salió de `cliente/[id].tsx` para que la ficha del deudor y la de mora cobren **igual**.
 *
 * La clave de idempotencia es la que ya generó la hoja y viaja igual en el intento y en la cola: cuando el
 * pago suba no puede cobrarle dos veces al deudor. Si la foto del comprobante quedó sin subir, viaja con el
 * pago y la sube la cola.
 */
import type { Comprobante } from './pay-sheet';
import { createPayment, type NewPayment } from './payments.service';
import { queueForLater } from './sync/sync.service';

/** `null` = cobrado o guardado para subir; un texto = lo que hay que decirle al cobrador. */
export async function submitPayment(input: NewPayment, idemKey: string, receipt: Comprobante | null): Promise<string | null> {
  const res = await createPayment(input, idemKey);
  if (res.status === 'ok') return null;
  if (res.status === 'offline') {
    const guardado = await queueForLater({ kind: 'payment', input, idempotencyKey: idemKey, photo: receipt?.local });
    return guardado ? null : 'Sin conexión y no se pudo guardar en el teléfono. Reintentá.';
  }
  if (res.status === 'unauthenticated') return 'Tu sesión venció.';
  return res.message;
}
