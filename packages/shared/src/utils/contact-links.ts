/**
 * Enlaces para actuar sobre un dato de contacto. Los comparten la web y el móvil: la regla de armarlos vive acá una
 * sola vez, no copiada en cada plataforma.
 */

/**
 * Abre WhatsApp con el mensaje ya escrito (`wa.me` es el enlace universal: si la app no está, cae al navegador).
 * Abrirlo NO significa que el mensaje se envió: quien lo manda decide, y la ejecución se registra aparte.
 */
export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

/** La ubicación en un mapa abierto (OpenStreetMap, la misma familia de tiles que usa el panel). */
export function mapLink(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}
