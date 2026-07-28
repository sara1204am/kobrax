import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { COLORS, SPACING } from '@/theme';
import { Header, ListRow, SectionLabel } from '@/ui';
import { authService } from '@/auth-service';
import { clearBiometric } from '@/biometric';

/**
 * Overflow: perfil, config, import (gating por rol en F3).
 *
 * La sección **Clientes** (cartera/S4) junta las cuatro puertas del módulo. Dos ya existían sin entrada:
 * el alta sólo se alcanzaba por el FAB de la cartera, y `/import` sólo aparecía sola en el gate del primer
 * login — la fila que pide `plans/import/README.md §6.3` nunca se había cableado.
 */
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
        <SectionLabel>Clientes</SectionLabel>
        <ListRow
          title="Ver cartera"
          subtitle="Todos tus clientes y su deuda"
          onPress={() => router.push('/(tabs)/cobranza')}
        />
        <ListRow
          title="Nuevo cliente"
          subtitle="Alta manual, con o sin préstamo"
          onPress={() => router.push('/cliente/nuevo')}
        />
        <ListRow
          title="Importar datos"
          subtitle="Subí el archivo de tu sistema"
          // `from=menu` → entrada a mano: sin gate y sin marcar el día como saltado (import §6.3).
          onPress={() => router.push({ pathname: '/import', params: { from: 'menu' } })}
        />
        <ListRow
          title="Reglas de importación"
          subtitle="Cómo se leen las columnas del archivo"
          onPress={() => router.push('/ajustes/importacion')}
        />

        <SectionLabel>Cuenta</SectionLabel>
        <ListRow title="Perfil y seguridad" subtitle="Datos de sesión, biometría" onPress={() => {}} />
        <ListRow title="Cerrar sesión" onPress={logout} />
      </ScrollView>
    </View>
  );
}
