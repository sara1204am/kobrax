import { View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '@/theme';
import { EmptyState, Header } from '@/ui';

/** Alta de cliente → préstamo (Cartera S2). Placeholder hasta construir el flujo. */
export default function NuevoClienteScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo cliente" onBack={() => router.back()} />
      <EmptyState icon="🧑‍💼" title="Alta de cliente" hint="El alta de cliente y préstamo llega en el Slice 2." />
    </View>
  );
}
