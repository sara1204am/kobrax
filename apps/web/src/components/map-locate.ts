import { GeolocateControl, type Map as MapLibreMap } from 'maplibre-gl';

export interface Here {
  latitude: number;
  longitude: number;
}

/**
 * El botón «Dónde estoy» de todos los mapas del panel: pide la ubicación al navegador, dibuja el punto azul con su margen
 * de error y, mientras se deja activo, lo sigue moviendo.
 *
 * 🔴 Es el control del propio MapLibre y no uno dibujado: ya maneja los permisos denegados, el «buscando…», el seguimiento
 * y el apagado, y reescribirlo sería mantener una segunda copia de algo que cambia con cada navegador.
 *
 * El navegador sólo da la ubicación en **https o localhost**; en otro origen el botón queda apagado solo.
 */
export function addLocateControl(map: MapLibreMap, onLocate?: (here: Here) => void): GeolocateControl {
  const control = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
    trackUserLocation: true,
    showUserLocation: true,
    showAccuracyCircle: true,
    // Al ubicarse se acerca a la manzana, pero sin pasar de eso: si ya miraba más de cerca, no se aleja.
    fitBoundsOptions: { maxZoom: 16 },
  });
  map.addControl(control, 'top-right');
  if (onLocate) {
    control.on('geolocate', (e) => onLocate({ latitude: e.coords.latitude, longitude: e.coords.longitude }));
  }
  return control;
}

/** La última ubicación del navegador en esta sesión: el segundo mapa que se abre no vuelve a esperar al GPS. */
let lastHere: Here | null = null;

/**
 * Lleva un mapa **recién abierto y sin nada que mostrar** a donde está la persona, sin que tenga que pulsar «Dónde estoy».
 *
 * Es el centro cuando no hay punto, ni dirección cercana, ni paradas: antes caía en Santa Cruz, y quien trabaja en otra ciudad
 * tenía que ubicarse a mano cada vez. Sólo mueve el mapa (no dibuja el punto azul ni sigue a la persona: eso es el botón).
 *
 * - `stillEmpty` se consulta al llegar la posición: si mientras tanto apareció un punto o paradas, esas mandan y no se mueve nada.
 * - Si el permiso se niega o no hay GPS (http fuera de localhost), no pasa nada: el mapa queda donde estaba.
 */
export function centerOnUser(map: MapLibreMap, stillEmpty: () => boolean = () => true, zoom = 15): void {
  const go = (h: Here) => {
    lastHere = h;
    if (stillEmpty()) map.jumpTo({ center: [h.longitude, h.latitude], zoom });
  };
  if (lastHere) return go(lastHere);
  if (typeof navigator === 'undefined' || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => go({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    () => undefined,
    { enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60_000 },
  );
}
