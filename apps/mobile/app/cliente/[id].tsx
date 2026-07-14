import { View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '@/theme';
import { EmptyState, Header } from '@/ui';

/** Ficha de cobranza del cliente (Cartera S3). Placeholder hasta construir el detalle + pago + gestión. */
export default function ClienteFichaScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Ficha del cliente" onBack={() => router.back()} />
      <EmptyState icon="📄" title="Ficha de cobranza" hint="El detalle, el pago y la gestión llegan en el Slice 3." />
    </View>
  );
}
