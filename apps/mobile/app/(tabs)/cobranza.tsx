import { View } from 'react-native';
import { COLORS } from '@/theme';
import { EmptyState, Header } from '@/ui';

/** Cobranza / pagos en campo (Slice 4). Slice 0: placeholder. */
export default function CobranzaScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Cobranza" />
      <EmptyState icon="💵" title="Cobranza" hint="Registro de pagos en campo (Slice 4)." />
    </View>
  );
}
