/**
 * La ubicación actual del cobrador. Un solo camino para toda la app.
 *
 * Antes esto vivía copiado en dos pantallas (`agenda/crear.tsx` y `cliente-form-view.tsx`), las dos
 * con el mismo `requestForegroundPermissions` + `getCurrentPositionAsync` y ninguna devolvía
 * `accuracy` —que `POST /visits` sí acepta— ni distinguía *sin permiso* de *sin señal*.
 *
 * **Nunca tira.** Devuelve el motivo y quien llama decide: el copy del respaldo es distinto en cada
 * pantalla (marcar el punto en el mapa, cargar lat/long a mano, usar la dirección de la parada), así
 * que el mensaje se queda en la pantalla y acá sólo viaja el motivo.
 */
import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
  /** Radio de error en metros, si el dispositivo lo informa. */
  accuracy?: number;
}

export type LocationResult =
  | { status: 'ok'; coords: Coords }
  /** El usuario no dio permiso de ubicación. Reintentar no sirve hasta que lo cambie. */
  | { status: 'denied' }
  /** Hay permiso pero no se pudo fijar la posición (bajo techo, GPS apagado, se agotó el tiempo). */
  | { status: 'unavailable' };

/**
 * `Balanced` y no `High` a propósito: en la calle alcanza, tarda bastante menos y come menos batería
 * —y el cobrador está registrando parado en una puerta, no midiendo un terreno.
 */
export async function currentLocation(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };

    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      status: 'ok',
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      },
    };
  } catch {
    // `getCurrentPositionAsync` tira si el GPS está apagado o no fija a tiempo. Para quien llama es
    // lo mismo que no tener señal: hay permiso, pero no hay punto.
    return { status: 'unavailable' };
  }
}
