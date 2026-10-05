import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { Header } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { ClienteFormView } from '@/cliente-form-view';
import { buildClientePayload, canSubmitCliente, clienteEnPunto, initialCliente, type ClienteForm } from '@kobrax/shared';
import { createClient } from '@/clients.service';
import { checkDuplicates, duplicateBlocks, duplicateCheckInput, nameSignature, type DuplicateAnswer } from '@/duplicate-check';
import { DuplicateNotice } from '@/duplicate-notice';
import { hayLugar } from '@/account.service';
import { nuevoId } from '@/ids';
import { queueForLater } from '@/sync/sync.service';

/**
 * V1 — Alta de cliente (§5.1). El formulario es `ClienteFormView`, **el mismo que usa la edición**:
 * acá sólo vive el guardar. Si llega `lat`/`lng` (alta desde el mapa de Rutas, S2), la primera
 * ubicación arranca con el punto marcado.
 */
export default function NuevoClienteScreen() {
  const { lat, lng } = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const [form, setForm] = useState<ClienteForm>(() => {
    const point = { latitude: Number(lat), longitude: Number(lng) };
    return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) ? clienteEnPunto(point) : initialCliente();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<DuplicateAnswer | null>(null);
  /** El nombre para el que se confirmó «es otra persona»; si el nombre cambia, la confirmación ya no vale. */
  const [accepted, setAccepted] = useState<string | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  /** Pregunta por duplicados (servidor con señal, teléfono sin ella). `null` = nada que preguntar o no se pudo saber. */
  const runCheck = useCallback(async (f: ClienteForm): Promise<DuplicateAnswer | null> => {
    const input = duplicateCheckInput(f);
    const answer = input ? await checkDuplicates(input) : null;
    setDup(answer);
    return answer;
  }, []);
  const onIdentityBlur = useCallback(() => void runCheck(formRef.current), [runCheck]);
  const confirmed = accepted === nameSignature(form);

  const submit = useCallback(
    async (thenLoan: boolean) => {
      setSaving(true);
      setError(null);

      // El tope del plan se avisa acá y no al sincronizar: es el único momento en que el cobrador
      // puede hacer algo al respecto. Ver el mismo caso, explicado entero, en `prestamo/nuevo`.
      if (!(await hayLugar('clients'))) {
        setSaving(false);
        return setError(
          'Tu plan llegó al tope de clientes. Avisale a tu administrador antes de cargar este.',
        );
      }

      // Duplicados ANTES de encolar: un alta offline que el servidor rechazaría por documento repetido
      // fallaría después, sin que el cobrador esté mirando. El documento bloquea; el nombre pide confirmar.
      const answer = await runCheck(form);
      const blocked = duplicateBlocks(answer?.check ?? null, accepted === nameSignature(form));
      if (blocked) {
        setSaving(false);
        return setError(
          blocked === 'document'
            ? 'Ya existe un cliente con ese documento. No se puede crear otro.'
            : 'Hay alguien con ese nombre. Confirma que es otra persona para continuar.',
        );
      }

      // El id se genera acá y no lo devuelve el server: es lo que permite seguir al préstamo sin
      // esperar respuesta, y lo que hace que reintentar el alta desde la cola no cree dos clientes.
      const id = nuevoId();
      const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim();
      const input = { id, ...buildClientePayload(form) };
      const res = await createClient(input);
      setSaving(false);

      if (res.status === 'ok' || res.status === 'offline') {
        // Sin señal el alta queda guardada y sube sola. Para el cobrador el cliente ya existe:
        // frenarlo en la puerta del deudor es lo que este módulo vino a evitar.
        if (res.status === 'offline') {
          const guardado = await queueForLater({ kind: 'client.create', input });
          if (!guardado) return setError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
        }
        if (thenLoan) router.replace({ pathname: '/prestamo/nuevo', params: { clientId: id, name } });
        else router.back();
        return;
      }
      if (res.status === 'unauthenticated') return setError('Tu sesión venció. Volvé a iniciar sesión.');
      setError(res.message); // "Ya existe un cliente con ese documento" en duplicado (§5.1)
    },
    [form, accepted, runCheck],
  );

  const disabled = saving || !canSubmitCliente(form) || !!dup?.check.document;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo cliente" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />
        <ClienteFormView
          form={form}
          setForm={setForm}
          onError={setError}
          onIdentityBlur={onIdentityBlur}
          identityNotice={
            <DuplicateNotice
              check={dup?.check ?? null}
              local={dup?.source === 'local'}
              accepted={confirmed}
              onAccept={() => setAccepted(nameSignature(form))}
            />
          }
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar y agregar préstamo" onPress={() => submit(true)} loading={saving} disabled={disabled} />
        <Button label="Solo guardar cliente" variant="ghost" onPress={() => submit(false)} disabled={disabled} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },
  footer: { padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
