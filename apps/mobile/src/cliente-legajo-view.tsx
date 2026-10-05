/**
 * Bloques de la ficha del cliente que el panel web ya tenía (F4/08 · fase 5, paridad):
 * aviso de posible duplicado, adjuntos del legajo y garantes/garantías (sólo lectura).
 * Viven acá y no en la pantalla para no engordar `cliente/[id].tsx`. La lógica pura está en `cliente-legajo.ts`.
 */
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ATTACHMENT_TYPES, type ClientAttachmentDetail, type ClientDetail } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, Chips, SectionLabel, StatusBadge } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { API_BASE } from '@/api';
import { getSession } from '@/session';
import { useNetStore } from '@/store/net';
import { addAttachment, getClient } from '@/clients.service';
import { uploadImage } from '@/uploads.service';
import { choosePhoto } from '@/photo';
import { prettyDay } from '@/credit-terms-view';
import {
  attachmentLabel,
  attachmentUri,
  collateralsForCredit,
  isImageFile,
  phonesOf,
  RELATION_LABEL,
  relationsForCredit,
  sortAttachments,
} from '@/cliente-legajo';

const money = (n: number, currency?: string) => `${currency ?? ''} ${n.toLocaleString('es-BO')}`.trim();

/** «Posible duplicado, revisa en el panel»: un cliente creado por la importación que puede ser alguien que ya existía. */
export function LinkReviewBanner({ detail }: { detail: ClientDetail | null }) {
  if (!detail?.linkReviewPending) return null;
  const names = (detail.linkSuggestions ?? []).map((s) => s.displayName);
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.bannerTitle}>⚠️ Posible duplicado, revisa en el panel</Text>
      <Text style={TYPE.secondary}>
        {`Este cliente lo creó la importación y puede ser alguien que ya existía${names.length ? ` (${names.slice(0, 3).join(', ')})` : ''}. Vincularlo o confirmarlo se hace desde el panel web.`}
      </Text>
    </View>
  );
}

/** Garantes y garantías: sólo lectura. Editarlos es «Editar cliente». */
export function GarantesBlock({ detail, creditId }: { detail: ClientDetail | null; creditId: string | null }) {
  const relations = relationsForCredit(detail?.relations, creditId);
  const collaterals = collateralsForCredit(detail?.collaterals, creditId);
  return (
    <View>
      <SectionLabel>Garantes y garantías</SectionLabel>
      {relations.length === 0 && collaterals.length === 0 && <Text style={styles.line}>Sin garantes ni garantías cargados.</Text>}
      {relations.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{r.relatedName}</Text>
            {r.linked && <StatusBadge label="Respalda este préstamo" tone="info" />}
          </View>
          <Text style={TYPE.secondary}>{RELATION_LABEL[r.relationshipType] ?? r.relationshipType}</Text>
          {phonesOf(r).map((p) => (
            <Text key={p} style={styles.line}>📱 {p}</Text>
          ))}
        </View>
      ))}
      {collaterals.map((g) => (
        <View key={g.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{g.description}</Text>
            {g.linked && <StatusBadge label="Respalda este préstamo" tone="info" />}
          </View>
          <Text style={TYPE.secondary}>
            {[g.type, g.estimatedValue != null ? `Valor estimado ${money(g.estimatedValue, g.currency)}` : null].filter(Boolean).join(' · ') || 'Garantía'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Miniatura con la sesión del cobrador: el archivo lo sirve el servidor sólo dentro de su empresa. */
function Thumb({ uri }: { uri: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void getSession().then((s) => alive && setToken(s?.accessToken ?? null));
    return () => {
      alive = false;
    };
  }, []);
  if (failed || !token) return <View style={[styles.thumb, styles.thumbEmpty]}><Text>🖼️</Text></View>;
  return <Image source={{ uri, headers: { Authorization: `Bearer ${token}` } }} style={styles.thumb} onError={() => setFailed(true)} />;
}

const TYPE_OPTIONS = ATTACHMENT_TYPES.map((t) => ({ value: t, label: attachmentLabel(t) }));

/**
 * Adjuntos del legajo: se leen del caché sin señal; **subir necesita señal** (la foto va al servidor antes de
 * colgarse del cliente) y la pantalla lo dice.
 */
export function AttachmentsBlock({
  clientId,
  rows,
  onChanged,
}: {
  clientId: string;
  rows: ClientAttachmentDetail[] | undefined;
  onChanged: (detail: ClientDetail) => void;
}) {
  const online = useNetStore((s) => s.isConnected);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof ATTACHMENT_TYPES)[number]>('ID_CARD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = sortAttachments(rows);

  async function pick() {
    setError(null);
    const photo = await choosePhoto();
    if (!photo) return;
    setBusy(true);
    const up = await uploadImage(photo.uri, photo.mimeType ?? 'image/jpeg');
    if (up.status !== 'ok') {
      setBusy(false);
      return setError(up.status === 'offline' ? 'Sin conexión: no se pudo subir.' : up.status === 'unauthenticated' ? 'Tu sesión venció.' : up.message);
    }
    const res = await addAttachment(clientId, { fileType: type, fileUrl: up.url, fileHash: up.hash });
    if (res.status !== 'ok') {
      setBusy(false);
      return setError(res.status === 'offline' ? 'Sin conexión: no se pudo guardar.' : res.status === 'unauthenticated' ? 'Tu sesión venció.' : res.message);
    }
    const fresh = await getClient(clientId);
    setBusy(false);
    setOpen(false);
    if (fresh.status === 'ok') onChanged(fresh.data);
  }

  return (
    <View>
      <SectionLabel>{`Adjuntos (${list.length})`}</SectionLabel>
      {list.length === 0 && <Text style={styles.line}>Sin adjuntos.</Text>}
      {list.map((a) => {
        const uri = attachmentUri(a.fileUrl, API_BASE);
        return (
          <View key={a.id} style={[styles.card, styles.attRow]}>
            {uri && isImageFile(a.fileUrl) ? <Thumb uri={uri} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Text>📄</Text></View>}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{attachmentLabel(a.fileType)}</Text>
              <Text style={TYPE.secondary}>{prettyDay(a.createdAt)}</Text>
            </View>
          </View>
        );
      })}
      <Pressable
        onPress={() => online && setOpen(true)}
        disabled={!online}
        accessibilityRole="button"
        style={[styles.addBtn, !online && { opacity: 0.5 }]}
      >
        <Text style={styles.addText}>＋ Agregar adjunto</Text>
      </Pressable>
      {!online && <Text style={TYPE.caption}>Sin conexión: los adjuntos se ven, pero para subir uno hace falta señal.</Text>}

      <BottomSheet visible={open} onClose={() => !busy && setOpen(false)} title="Agregar adjunto">
        <ErrorBanner message={error} />
        <SectionLabel>Qué es</SectionLabel>
        <Chips options={TYPE_OPTIONS} value={type} onChange={setType} />
        <View style={{ marginTop: SPACING.md }}>
          <Button label="Elegir foto (cámara o galería)" onPress={pick} loading={busy} disabled={busy || !online} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: COLORS.warningBg, borderColor: COLORS.warning, borderWidth: 1, borderRadius: RADIUS.input, padding: SPACING.md, gap: SPACING.xs },
  bannerTitle: { ...TYPE.body, fontWeight: '600', color: COLORS.warningText },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginTop: SPACING.sm, gap: 2 },
  cardTitle: { ...TYPE.body, fontWeight: '600', flexShrink: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  line: { ...TYPE.body, paddingVertical: 2 },
  attRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  thumb: { width: 48, height: 48, borderRadius: RADIUS.input, backgroundColor: COLORS.lightBg },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  addBtn: { marginTop: SPACING.sm, paddingVertical: SPACING.sm },
  addText: { ...TYPE.link, fontSize: 15 },
});
