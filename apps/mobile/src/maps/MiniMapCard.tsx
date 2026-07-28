/**
 * Mini-mapa estático no-interactivo (RT-5 "Hora recomendada" / garante cercano). Muestra el punto del
 * cliente (y opcionalmente puntos cercanos) sin permitir pan/zoom. Reusa la misma fuente de tiles.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera, MapView, PointAnnotation } from '@maplibre/maplibre-react-native';
import { COLORS, RADIUS } from '@/theme';
import { MAP_STYLE, PIN_ZOOM, toLngLat, type LngLat } from './tiles';

export interface MiniMapPoint extends LngLat {
  id: string;
  tone?: 'primary' | 'nearby';
}

export interface MiniMapCardProps {
  center: LngLat;
  points?: MiniMapPoint[];
  height?: number;
  zoom?: number;
  style?: StyleProp<ViewStyle>;
}

export function MiniMapCard({ center, points, height = 160, zoom = PIN_ZOOM, style }: MiniMapCardProps) {
  const marks: MiniMapPoint[] = points ?? [{ id: 'primary', ...center, tone: 'primary' }];
  return (
    <View style={[styles.card, { height }, style]}>
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Camera centerCoordinate={toLngLat(center)} zoomLevel={zoom} animationDuration={0} />
        {marks.map((p) => (
          <PointAnnotation key={p.id} id={p.id} coordinate={[p.longitude, p.latitude]}>
            <View style={[styles.dot, p.tone === 'nearby' ? styles.dotNearby : styles.dotPrimary]} />
          </PointAnnotation>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.card, overflow: 'hidden', backgroundColor: COLORS.lightBg },
  map: { flex: 1 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: COLORS.white },
  dotPrimary: { backgroundColor: COLORS.purple },
  dotNearby: { backgroundColor: COLORS.warning },
});
