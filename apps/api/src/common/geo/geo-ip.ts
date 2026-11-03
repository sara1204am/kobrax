import geoip from 'geoip-lite';

export interface GeoPlace {
  city: string | null;
  country: string | null;
}

/**
 * Ciudad y país de una IP, **sin salir de la máquina**: `geoip-lite` trae su base y no consulta a
 * nadie, así que la IP del usuario no viaja a un tercero. Es una aproximación: el país es fiable, la
 * ciudad a veces viene vacía y una IP de operadora móvil puede caer en otra ciudad.
 *
 * Devuelve `null` si no hay dato (IP privada, loopback, inválida). Nunca lanza: un login no se cae
 * porque no se pudo ubicar a quien entra.
 */
export function lookupPlace(ip: string | undefined): GeoPlace | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  try {
    const hit = geoip.lookup(clean);
    if (!hit?.country) return null;
    return { city: hit.city || null, country: hit.country };
  } catch {
    return null;
  }
}
