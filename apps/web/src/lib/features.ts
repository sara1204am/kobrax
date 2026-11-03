/**
 * Funciones apagadas en la primera versión.
 *
 * 🔴 **Cobros pedidos (QR y link por monto): apagados.** Generar un QR con el monto exige la API de un banco
 * que todavía no existe: hoy el link es `https://pay.kobrax.demo/…` —no resuelve a nada— y el QR no es
 * un QR bancario. Mostrarlo le daría al cobrador algo que mandarle al deudor y que no funciona. El móvil ya
 * cobra con el QR fijo de la cuenta del cobrador o de la empresa.
 *
 * El código y la API siguen: se enciende con `NEXT_PUBLIC_PAYMENT_REQUESTS=on` el día que haya banco.
 * `NEXT_PUBLIC_` porque lo lee también un componente de cliente (el botón del formulario).
 */
export const PAYMENT_REQUESTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENT_REQUESTS === 'on';
