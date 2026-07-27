import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { Header, OfflineIndicator } from '@/ui';
import { Button } from '@/components';
import { markImportSkipped } from '@/import.service';

/**
 * I1 Inicio Sync (mockup `24:1049`) — el gate del import diario (§6.7).
 *
 * Entra acá el primer login del día si el tenant tiene `askOnLogin`, y también desde
 * `Más › Importación`. Es sólo la bienvenida y la decisión: el archivo y la Vista Previa viven en
 * sus propias pantallas.
 *
 * **Saltar no es importar**: "Ir al Dashboard" marca el flag de salto, no el de importado, así
 * que la app sigue sabiendo que el import está pendiente.
 *
 * ponytail: sin la tarjeta de KPIs del mockup (clientes totales, rutas activas, saldos) — es S2,
 * y ninguno de esos números está construido todavía.
 */
export default function ImportGateScreen() {
  async function skip() {
    await markImportSkipped();
    router.replace('/(tabs)');
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title="Importar cartera" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>📥</Text>
          <Text style={styles.title}>Traé la cartera de hoy</Text>
          <Text style={styles.hint}>
            Subí el archivo que emite tu sistema. Vas a ver qué cambia antes de que se aplique nada.
          </Text>
        </View>

        <Button label="Sincronizar datos" onPress={() => router.push('/import/archivo')} />
        <Button label="Ir al Dashboard" variant="ghost" onPress={() => void skip()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, gap: SPACING.md },
  hero: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  heroIcon: { fontSize: 40 },
  title: { fontSize: 20, fontWeight: '600', color: COLORS.navy, textAlign: 'center' },
  hint: { fontSize: 14, color: COLORS.text2, textAlign: 'center' },
});
