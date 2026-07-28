/**
 * Mapa full con pines numerados + polyline de ruta + controles (zoom/recenter). Envuelve MapLibre
 * detrás de props neutrales (`{latitude,longitude}`, no `[lng,lat]`) para que un cambio de motor no
 * toque las screens. Usado por S2 (selección), S3 (preview) y S4 (mapa activo).
 *
 * ponytail: pines con `PointAnnotation` (una native view c/u) — bien hasta ~30 paradas; si una ruta
 * trae cientos, migrar a `ShapeSource`+`SymbolLayer`. Cámara controlada por estado (pan manual no la
 * re-sincroniza; "recenter" vuelve al centro de props): suficiente para el uso de campo.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera, LineLayer, MapView, PointAnnotation, ShapeSource } from '@maplibre/maplibre-react-native';
import { COLORS, RADIUS } from '@/theme';
import { DEFAULT_ZOOM, FALLBACK_CENTER, fromLngLat, MAP_STYLE, toLngLat, type LngLat } from './tiles';

export type MarkerTone = 'default' | 'active' | 'done';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Etiqueta corta dentro del pin (ej. orden de la parada). */
  label?: string;
  selected?: boolean;
  tone?: MarkerTone;
}

export interface MapCanvasProps {
  markers?: MapMarker[];
  /** Puntos de la polyline en orden. Se dibuja si hay ≥2. */
  routeLine?: LngLat[];
  center?: LngLat;
  zoom?: number;
  onMarkerPress?: (id: string) => void;
  /** Toque en el mapa donde no hay ningún pin (S2: dar de alta un cliente ahí). */
  onMapPress?: (point: LngLat) => void;
  /** Muestra +/− y recenter (RT-4). */
  controls?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const TONE_COLOR: Record<MarkerTone, string> = {
  default: COLORS.navy,
  active: COLORS.purple,
  done: COLORS.success,
};

export function MapCanvas({
  markers = [],
  routeLine,
  center,
  zoom = DEFAULT_ZOOM,
  onMarkerPress,
  onMapPress,
  controls = false,
  style,
  children,
}: MapCanvasProps) {
  const base = center ?? markers[0] ?? FALLBACK_CENTER;
  const [camCenter, setCamCenter] = useState<LngLat>(base);
  const [camZoom, setCamZoom] = useState(zoom);

  // Re-sincroniza la cámara cuando cambia el centro/zoom pedido por props (no en cada pan manual).
  useEffect(() => {
    if (center) setCamCenter(center);
  }, [center?.latitude, center?.longitude]);
  useEffect(() => setCamZoom(zoom), [zoom]);

  const line: GeoJSON.Feature<GeoJSON.LineString> | null =
    routeLine && routeLine.length >= 2
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine.map(toLngLat) } }
      : null;

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onPress={onMapPress ? (f) => onMapPress(fromLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])) : undefined}
      >
        <Camera centerCoordinate={toLngLat(camCenter)} zoomLevel={camZoom} animationDuration={300} />

        {line && (
          <ShapeSource id="route-line" shape={line}>
            <LineLayer id="route-line-layer" style={{ lineColor: COLORS.periwinkle, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
          </ShapeSource>
        )}

        {markers.map((m) => {
          const color = TONE_COLOR[m.tone ?? 'default'];
          return (
            <PointAnnotation
              key={m.id}
              id={m.id}
              coordinate={[m.longitude, m.latitude]}
              onSelected={onMarkerPress ? () => onMarkerPress(m.id) : undefined}
            >
              <View style={[styles.pin, { backgroundColor: color }, m.selected && styles.pinSelected]}>
                {m.label ? <Text style={styles.pinLabel}>{m.label}</Text> : null}
              </View>
            </PointAnnotation>
          );
        })}

        {children}
      </MapView>

      {controls && (
        <View style={styles.controls}>
          <Pressable style={styles.ctrlBtn} onPress={() => setCamCenter(center ?? base)} hitSlop={8}>
            <Text style={styles.ctrlIcon}>◎</Text>
          </Pressable>
          <Pressable style={styles.ctrlBtn} onPress={() => setCamZoom((z) => Math.min(z + 1, 20))} hitSlop={8}>
            <Text style={styles.ctrlIcon}>＋</Text>
          </Pressable>
          <Pressable style={styles.ctrlBtn} onPress={() => setCamZoom((z) => Math.max(z - 1, 2))} hitSlop={8}>
            <Text style={styles.ctrlIcon}>－</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  pin: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  pinSelected: { transform: [{ scale: 1.25 }] },
  pinLabel: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  controls: { position: 'absolute', right: 12, top: 12, gap: 8 },
  ctrlBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  ctrlIcon: { fontSize: 20, color: COLORS.navy, fontWeight: '600' },
});
