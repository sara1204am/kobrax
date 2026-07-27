import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/theme';
import { Header, OfflineIndicator } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { FORMAT_HINT, importService, type PickedFile, type ProfileKind } from '@/import.service';
import { pickImportFile } from '@/file-picker';
import { useNetStore } from '@/store/net';

/**
 * Elegir el archivo del día (mockups `24:1907` / `24:1981`).
 *
 * Es UNA pantalla con dos estados —sin archivo y listo—, no dos: los mockups comparten dropzone,
 * caja de requisitos y layout, y sólo cambian título, copy y el CTA.
 *
 * `test=1` = "Probar con un archivo" desde Ajustes: llega a la Vista Previa y ahí no se puede
 * confirmar. Sirve para verificar el emparejado sin tocar la cartera.
 */
export default function ArchivoScreen() {
  const { test } = useLocalSearchParams<{ test?: string }>();
  const isTest = test === '1';
  const [file, setFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProfileKind | null>(null);
  const online = useNetStore((s) => s.isConnected);

  // El copy de formatos sale de la config del tenant (S3-R5). Si no se puede leer, se calla:
  // no vamos a mentirle "CSV o XLSX" a quien sube un extracto PDF.
  useEffect(() => {
    void importService.getConfig().then((res) => {
      if (res.status === 'ok') setKind(res.data.config.profile.kind);
    });
  }, []);

  async function pick() {
    setError(null);
    const picked = await pickImportFile();
    if (picked) setFile(picked);
  }

  function next() {
    if (!file) return;
    router.push({
      pathname: '/import/preview',
      params: { uri: file.uri, name: file.name, mimeType: file.mimeType ?? '', test: isTest ? '1' : '' },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <OfflineIndicator />
      <Header title={isTest ? 'Probar con un archivo' : 'Actualizar archivo'} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        {error && <ErrorBanner message={error} />}
        {!online && (
          <ErrorBanner message="Sin conexión. El import se hace en la oficina, con wifi." />
        )}

        <Text style={styles.title}>{file ? 'Listo para continuar' : 'Traé la cartera de hoy'}</Text>
        <Text style={styles.hint}>
          {file
            ? 'Vas a ver qué cambia antes de que se aplique nada.'
            : 'Elegí el archivo que emite tu sistema. Nada se importa hasta que lo confirmes.'}
        </Text>

        {/* Dropzone del mockup. En un teléfono no hay "arrastrar": el área entera es el botón. */}
        <Pressable
          onPress={() => void pick()}
          accessibilityRole="button"
          accessibilityLabel="Elegir archivo"
          style={({ pressed }) => [styles.drop, file && styles.dropFilled, pressed && styles.dropPressed]}
        >
          <Text style={styles.dropIcon}>{file ? '📄' : '📥'}</Text>
          <Text style={styles.dropTitle} numberOfLines={2}>
            {file ? file.name : 'Tocá para elegir el archivo'}
          </Text>
          <Text style={styles.dropHint}>{file ? 'Tocá de nuevo para cambiarlo' : 'Desde tu teléfono o Drive'}</Text>
        </Pressable>

        <View style={styles.reqs}>
          <Text style={styles.reqTitle}>Requisitos</Text>
          <Text style={styles.reqLine}>{kind ? FORMAT_HINT[kind] : 'Hasta 15 MB'}</Text>
          <Text style={styles.reqLine}>Tiene que traer el N° de crédito de cada registro.</Text>
        </View>

        <Button
          label={file ? 'Siguiente' : 'Continuar'}
          onPress={next}
          disabled={!file || !online}
          variant={file ? 'primary' : 'ghost'}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, gap: SPACING.md },
  title: { fontSize: 20, fontWeight: '600', color: COLORS.navy },
  hint: { fontSize: 14, color: COLORS.text2 },
  drop: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.periwinkle,
    borderRadius: RADIUS.card,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.white,
  },
  dropFilled: { borderStyle: 'solid', borderColor: COLORS.navy, backgroundColor: COLORS.lightBg },
  dropPressed: { opacity: 0.7 },
  dropIcon: { fontSize: 32 },
  dropTitle: { fontSize: 15, fontWeight: '600', color: COLORS.navy, textAlign: 'center' },
  dropHint: { fontSize: 13, color: COLORS.text2 },
  reqs: { backgroundColor: COLORS.lightBg, borderRadius: RADIUS.card, padding: SPACING.md, gap: 2 },
  reqTitle: { fontSize: 13, fontWeight: '600', color: COLORS.navy },
  reqLine: { fontSize: 13, color: COLORS.text2 },
});
