import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { COLORS, SPACING } from '@/theme';
import { Header, ListRow, SectionLabel } from '@/ui';
import { authService } from '@/auth-service';
import { clearBiometric } from '@/biometric';

/**
 * Overflow: perfil, config, import (gating por rol en F3).
 *
 * La sección **Clientes** (cartera/S4) junta las puertas del módulo. "Nuevo cliente" no está acá:
 * el alta se alcanza desde la cartera misma (FAB). "Importación" agrupa sus dos pantallas —
 * subir archivo (`plans/import/README.md §6.3`) y reglas de columnas — desplegándolas al tocarla.
 */
export default function MasScreen() {
  const [importOpen, setImportOpen] = useState(false);

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
          icon="people-outline"
          onPress={() => router.push('/(tabs)/cobranza')}
        />
        <ListRow
          title="Importación"
          subtitle="Subir archivo y reglas de lectura"
          icon="cloud-upload-outline"
          expanded={importOpen}
          onPress={() => setImportOpen((v) => !v)}
        />
        {importOpen && (
          <View style={{ gap: SPACING.md, paddingLeft: SPACING.lg }}>
            <ListRow
              title="Importar datos"
              subtitle="Subí el archivo de tu sistema"
              icon="document-attach-outline"
              // `from=menu` → entrada a mano: sin gate y sin marcar el día como saltado (import §6.3).
              onPress={() => router.push({ pathname: '/import', params: { from: 'menu' } })}
            />
            <ListRow
              title="Reglas de importación"
              subtitle="Cómo se leen las columnas del archivo"
              icon="options-outline"
              onPress={() => router.push('/ajustes/importacion')}
            />
          </View>
        )}

        <SectionLabel>Cuenta</SectionLabel>
        <ListRow
          title="Mi cuenta"
          subtitle="Perfil, datos del negocio y equipo"
          icon="person-circle-outline"
          onPress={() => router.push('/cuenta')}
        />
        <ListRow title="Cerrar sesión" icon="log-out-outline" onPress={logout} />
      </ScrollView>
    </View>
  );
}
