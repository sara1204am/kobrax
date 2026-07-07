import { View } from 'react-native';
import { COLORS } from '@/theme';
import { EmptyState, Header } from '@/ui';

/** Agenda diaria de gestiones (Slice 3). Slice 0: placeholder. */
export default function AgendaScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Agenda" />
      <EmptyState icon="🗓️" title="Agenda diaria" hint="Tus gestiones del día aparecerán aquí (Slice 3)." />
    </View>
  );
}
