/**
 * Selector de UN punto en el mapa: tocar para marcar, arrastrar el pin para ajustar. Reemplaza el
 * `react-native-maps` que usaba agenda y se agrega a la ubicación de cliente/garantes en cartera.
 * Un solo picker para toda la app. Props neutrales (`{latitude,longitude}`); el GPS ("usar mi
 * ubicación") lo maneja el caller (ya tiene `expo-location`) y baja el punto vía `latitude/longitude`.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera, MapView, PointAnnotation } from '@maplibre/maplibre-react-native';
import { COLORS } from '@/theme';
import { DEFAULT_ZOOM, FALLBACK_CENTER, MAP_STYLE, PIN_ZOOM, toLngLat, type LngLat } from './tiles';

export interface MapPickerProps {
  latitude?: number;
  longitude?: number;
  onChange: (coord: LngLat) => void;
  fallback?: LngLat;
  style?: StyleProp<ViewStyle>;
}

export function MapPicker({ latitude, longitude, onChange, fallback = FALLBACK_CENTER, style }: MapPickerProps) {
  const hasPoint = latitude != null && longitude != null;
  const center: LngLat = hasPoint ? { latitude, longitude } : fallback;

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onPress={(feature: GeoJSON.Feature) => {
          if (feature.geometry.type !== 'Point') return;
          const [lng, lat] = feature.geometry.coordinates;
          onChange({ latitude: lat, longitude: lng });
        }}
      >
        <Camera centerCoordinate={toLngLat(center)} zoomLevel={hasPoint ? PIN_ZOOM : DEFAULT_ZOOM} animationDuration={300} />
        {hasPoint && (
          <PointAnnotation
            id="picked-point"
            coordinate={[longitude, latitude]}
            draggable
            onDragEnd={(payload) => {
              const [lng, lat] = payload.geometry.coordinates;
              onChange({ latitude: lat, longitude: lng });
            }}
          >
            <View style={styles.pin} />
          </PointAnnotation>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.purple,
    borderWidth: 3,
    borderColor: COLORS.white,
  },
});
