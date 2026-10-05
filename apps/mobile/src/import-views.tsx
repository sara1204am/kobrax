import { StyleSheet, View } from 'react-native';
import { SPACING } from '@/theme';
import { StatTile } from '@/ui';
import { countTiles } from '@/import.service';

/** Los contadores de una importación, de a tres por fila (ver `countTiles` para cuáles y por qué). */
export function CountTiles({ counts }: { counts: Parameters<typeof countTiles>[0] }) {
  const tiles = countTiles(counts);
  const rows: (typeof tiles)[] = [];
  for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
  return (
    <View style={{ gap: SPACING.sm }}>
      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((t) => (
            <StatTile key={t.key} label={t.label} value={String(t.value)} tone={t.tone} />
          ))}
          {/* Relleno: una fila corta no estira sus tiles al ancho completo. */}
          {Array.from({ length: 3 - row.length }, (_, k) => (
            <View key={`pad${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: SPACING.sm } });
