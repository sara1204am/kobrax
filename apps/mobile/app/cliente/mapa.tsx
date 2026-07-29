import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { EmptyState, Header, ListRow, StatusBadge } from '@/ui';
import { Button } from '@/components';
import { MapCanvas, type MapMarker } from '@/maps/MapCanvas';
import { clientContext, type LocationOption } from '@/agenda.service';

const TIPO: Record<string, string> = {
  HOME: 'Casa',
  WORK: 'Trabajo',
  GUARANTOR: 'Garante',
  FAMILY: 'Familia',
  OTHER: 'Otra',
};

/**
 * Dónde queda el cliente, **en el mapa de Kobrax**. El botón "Navegar" abría Google Maps y sacaba al
 * cobrador de la app; acá ve el punto sobre el mismo mapa que usa la ruta, y funciona con los packs
 * offline.
 *
 * No es navegación paso a paso: eso necesita el motor de ruteo que se decide en Rutas S3.
 * Muestra **todas** las ubicaciones del cliente (las suyas y las de sus garantes) y centra en la
 * pedida por `locationId`, o en la primera que tenga punto.
 */
export default function ClienteMapaScreen() {
  const { clientId, locationId, name } = useLocalSearchParams<{ clientId: string; locationId?: string; name?: string }>();
  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | undefined>(locationId);

  useEffect(() => {
    void (async () => {
      const res = await clientContext(clientId);
      if (res.status !== 'ok') return setError(res.status === 'offline' ? 'Sin conexión.' : 'No se pudo cargar la ubicación.');
      setLocations(res.data.locations);
    })();
  }, [clientId]);

  const conPunto = (locations ?? []).filter((l) => l.latitude != null && l.longitude != null);
  const centro = conPunto.find((l) => l.id === focus) ?? conPunto[0];

  const markers: MapMarker[] = conPunto.map((l) => ({
    id: l.id,
    latitude: l.latitude!,
    longitude: l.longitude!,
    tone: l.id === centro?.id ? 'active' : 'default',
    selected: l.id === centro?.id,
  }));

  return (
    <View style={styles.screen}>
      <Header title={name ?? 'Dónde queda'} onBack={() => router.back()} />

      {locations === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : error ? (
        <EmptyState icon="⚠️" title={error} />
      ) : conPunto.length === 0 ? (
        <View style={{ flex: 1, padding: SPACING.lg, gap: SPACING.md }}>
          <EmptyState
            icon="📍"
            title="Sin punto marcado"
            hint="Este cliente tiene dirección escrita, pero nadie marcó el lugar en el mapa."
          />
          <Button label="Marcar el punto" onPress={() => router.replace(`/cliente/editar?clientId=${clientId}`)} />
        </View>
      ) : (
        <>
          <MapCanvas
            markers={markers}
            center={centro ? { latitude: centro.latitude!, longitude: centro.longitude! } : undefined}
            controls
            style={{ flex: 1 }}
            onMarkerPress={setFocus}
          />
          <View style={styles.panel}>
            {centro && (
              <View style={styles.destacada}>
                <Text style={styles.tipo}>{lugar(centro)}</Text>
                <Text style={TYPE.body}>{centro.address ?? 'Sin dirección escrita'}</Text>
                {centro.zone && <Text style={TYPE.secondary}>{centro.zone}</Text>}
              </View>
            )}
            {conPunto.length > 1 && (
              <>
                {conPunto
                  .filter((l) => l.id !== centro?.id)
                  .map((l) => (
                    <ListRow
                      key={l.id}
                      title={lugar(l)}
                      subtitle={l.address ?? undefined}
                      right={<StatusBadge label="Ver" tone="neutral" />}
                      onPress={() => setFocus(l.id)}
                    />
                  ))}
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** "Casa" · "Casa (garante)" — el tipo de lugar, tal como se cargó. */
function lugar(l: LocationOption): string {
  return TIPO[l.locationType] ?? 'Ubicación';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  panel: { backgroundColor: COLORS.white, borderTopWidth: 1, borderColor: COLORS.border, padding: SPACING.lg, gap: SPACING.sm },
  destacada: { gap: 2, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tipo: { ...TYPE.secondary, color: COLORS.purple, fontWeight: '700' },
});
