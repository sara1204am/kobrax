import { View } from 'react-native';
import { COLORS } from '@/theme';
import { EmptyState, Header } from '@/ui';

/** Rutas del día (Slice 3; mapas en dev build). Slice 0: placeholder. */
export default function RutasScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Rutas" />
      <EmptyState icon="🗺️" title="Rutas del día" hint="Paradas y mapa de la ruta (Slice 3 / dev build)." />
    </View>
  );
}
