/**
 * Foto de una ubicación (miniatura) y su visor a pantalla completa. Las fotos las sirve la API **detrás de la sesión**, así que
 * una `<Image>` pelada no las ve: se descargan con el token a la caché durable (`image-cache.ts`) y se muestran desde el
 * archivo local — por eso también se ven sin señal si ya se habían visto.
 */
import { useEffect, useState } from 'react';
import { Dimensions, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ensureImage, cachedImagePath } from './image-cache';
import { getSession } from './session';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { lugarLabel } from './route-labels';

import { photoUri } from './photo-uri';

/** Resuelve una foto remota a un archivo local. `null` mientras carga o si no se pudo (sin red y sin caché). */
export function useLocalPhoto(fileUrl: string | undefined): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const url = photoUri(fileUrl);
    if (!url) {
      setPath(null);
      return;
    }
    void (async () => {
      const hit = await cachedImagePath(url);
      if (hit) return alive && setPath(hit);
      const session = await getSession();
      if (!session) return;
      const got = await ensureImage(url, session.accessToken);
      if (alive) setPath(got);
    })();
    return () => {
      alive = false;
    };
  }, [fileUrl]);
  return path;
}

/** Miniatura cuadrada. Sin foto o sin poder cargarla: un recuadro neutro (nunca un error). */
export function LocationPhoto({
  fileUrl,
  size = 56,
  onPress,
  label = 'Foto de la ubicación',
}: {
  fileUrl: string | undefined;
  size?: number;
  onPress?: () => void;
  label?: string;
}) {
  const path = useLocalPhoto(fileUrl);
  const box = { width: size, height: size, borderRadius: RADIUS.input };
  const content = path ? (
    <Image source={{ uri: path }} style={box} accessibilityLabel={label} />
  ) : (
    <View style={[box, styles.empty]}>
      <Text>🏠</Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={label} hitSlop={6}>
      {content}
    </Pressable>
  );
}

function Page({ fileUrl, width }: { fileUrl: string; width: number }) {
  const path = useLocalPhoto(fileUrl);
  return (
    <View style={{ width, alignItems: 'center', justifyContent: 'center' }}>
      {path ? (
        <Image source={{ uri: path }} style={{ width, height: '100%' }} resizeMode="contain" />
      ) : (
        <Text style={styles.hint}>Sin conexión y sin copia guardada de esta foto.</Text>
      )}
    </View>
  );
}

/**
 * Visor a pantalla completa: se pasa de foto deslizando, «Principal» marca la primera y la X cierra. El zoom por pellizco
 * queda pendiente (necesita gesture-handler, que la app no trae); la foto se ve entera, ajustada a la pantalla.
 */
export function PhotoViewer({
  photos,
  startIndex = 0,
  visible,
  onClose,
}: {
  photos: string[];
  startIndex?: number;
  visible: boolean;
  onClose: () => void;
}) {
  const width = Dimensions.get('window').width;
  const [index, setIndex] = useState(startIndex);
  useEffect(() => setIndex(startIndex), [startIndex, visible]);
  if (photos.length === 0) return null;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        <View style={styles.bar}>
          <Text style={styles.count}>
            {`${index + 1} de ${photos.length}`}
            {index === 0 ? ' · Principal' : ''}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} style={styles.close}>
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>
        <FlatList
          data={photos}
          keyExtractor={(u, i) => `${i}-${u}`}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.min(startIndex, photos.length - 1)}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => <Page fileUrl={item} width={width} />}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: COLORS.lightBg, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  count: { ...TYPE.body, color: '#fff' },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { color: '#fff', fontSize: 22 },
  line: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  hint: { ...TYPE.secondary, color: '#fff', textAlign: 'center', padding: SPACING.lg },
});

/** Una dirección del cliente: miniatura (si tiene), de quién es y qué tipo, y la dirección. Tocar la foto abre el visor. */
export function LocationLine({
  loc,
}: {
  loc: { locationType: string; address: string | null; zone?: string; photoUrls?: string[]; ownerName?: string; ownerRelation?: string };
}) {
  const [open, setOpen] = useState(false);
  const photos = loc.photoUrls ?? [];
  return (
    <View style={styles.line}>
      {photos.length > 0 && <LocationPhoto fileUrl={photos[0]} size={48} onPress={() => setOpen(true)} label="Ver fotos de la ubicación" />}
      <View style={{ flex: 1 }}>
        <Text style={TYPE.secondary}>{lugarLabel(loc)}</Text>
        <Text style={TYPE.body}>{[loc.address, loc.zone].filter(Boolean).join(' · ') || 'Sin dirección'}</Text>
        {photos.length > 1 && <Text style={TYPE.caption}>{`${photos.length} fotos`}</Text>}
      </View>
      <PhotoViewer photos={photos} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}
