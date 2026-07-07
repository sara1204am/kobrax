import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { COLORS, SPACING } from '@/theme';
import { Header, ListRow } from '@/ui';
import { authService } from '@/auth-service';
import { clearBiometric } from '@/biometric';

/** Overflow: perfil, config, import (gating por rol en F3). Slice 0: perfil + cerrar sesión. */
export default function MasScreen() {
  async function logout() {
    await authService.logout();
    await clearBiometric(); // logout limpia SecureStore completo (incl. flags biométricos)
    router.replace('/(auth)/login');
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Más" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ListRow title="Perfil y seguridad" subtitle="Datos de sesión, biometría" onPress={() => {}} />
        <ListRow title="Cerrar sesión" onPress={logout} />
      </ScrollView>
    </View>
  );
}
