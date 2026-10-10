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
