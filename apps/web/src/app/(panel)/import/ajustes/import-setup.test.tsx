import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ColumnsPayload, ConfigScreen, ImportConfig } from '@kobrax/shared';
import { server } from '@/test/msw-server';
import { ToastProvider } from '@/components/toast';
import es from '@/messages/es.json';
import { ImportSetup } from './import-setup';

/**
 * Lo que esta pantalla no puede volver a hacer.
 *
 * El test más importante es el primero: con la configuración vacía —una cuenta nueva, o un reset—
 * la llave y el cliente tienen que estar A LA VISTA. Antes salían de `config.fields`, que en ese
 * caso es `{}`, y quedaban escondidos al fondo de un desplegable de 19 opciones. Así se llega a
 * una cartera entera de «SIN NOMBRE» sin que nada haya avisado.
 */

const CATALOG: ConfigScreen['catalog'] = {
  code: { label: 'N° de crédito', type: 'text', starred: true, locked: true },
  clientName: { label: 'Cliente', type: 'text', starred: true, locked: true },
  daysPastDue: { label: 'Días de retraso', type: 'int', starred: true },
  outstandingBalance: { label: 'Saldo', type: 'number', starred: true },
  phone: { label: 'Teléfono', type: 'text' },
};

const CONFIG: ImportConfig = {
  source: 'file',
  profile: { kind: 'rows' },
  fields: {},
  nameOrder: 'full',
  scope: { kind: 'account', ref: null },
  absentRule: 'set-current',
  carriesAssignee: false,
  askOnLogin: false,
};

const COLUMNS: ColumnsPayload = {
  labels: ['NRO', 'DEUDOR', 'SALDO', 'ATRASO'],
  columnCandidates: [
    {
      header: 'ATRASO',
      samples: [
        { label: 'QUISPE MAMANI ROSA', value: 45 },
        { label: 'VARGAS LEON JULIO', value: 0 },
      ],
    },
  ],
  samples: {
    NRO: ['90210', '90211'],
    DEUDOR: ['QUISPE MAMANI ROSA', 'VARGAS LEON JULIO'],
    SALDO: ['12500.50', '8300.00'],
    ATRASO: ['45', '0'],
  },
};

const screenOf = (fields: ImportConfig['fields'] = {}): ConfigScreen => ({
  config: { ...CONFIG, fields },
  catalog: CATALOG,
  lastRun: null,
  members: [],
  branches: [],
});

/** Sube la muestra y espera a que la pantalla se dibuje con las columnas del archivo. */
async function withSample(user: ReturnType<typeof userEvent.setup>) {
  server.use(http.post('http://localhost/api/imports/run', () => HttpResponse.json(COLUMNS)));
  const file = new File(['NRO,DEUDOR\n90210,ROSA'], 'cartera.csv', { type: 'text/csv' });
  // El input está oculto detrás del botón: se le entrega el archivo directo, que es lo que hace
  // el navegador cuando se elige del disco.
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  await screen.findByText(es.panel.import.columns.essential);
}

/** Responde el `PATCH` devolviendo la config con el parche aplicado, como hace el servidor. */
function patchEcho(base: ImportConfig) {
  let current = base;
  server.use(
    http.patch('http://localhost/api/imports/config', async ({ request }) => {
      const patch = (await request.json()) as { fields?: Record<string, unknown> };
      current = { ...current, ...patch, fields: { ...current.fields, ...(patch.fields ?? {}) } } as ImportConfig;
      return HttpResponse.json({ config: current });
    }),
  );
}

const renderMapper = (fields: ImportConfig['fields'] = {}) =>
  render(
    <ToastProvider>
      <ImportSetup screen={screenOf(fields)} />
    </ToastProvider>,
  );

describe('ImportSetup — los datos necesarios están siempre a la vista', () => {
  it('🔴 con la config vacía igual lista la llave y el cliente, no los esconde en «agregar»', async () => {
    const user = userEvent.setup();
    renderMapper();
    await withSample(user);

    // Los cuatro esenciales del catálogo, estén o no en `config.fields`.
    expect(screen.getByText('N° de crédito')).toBeInTheDocument();
    expect(screen.getByText('Saldo')).toBeInTheDocument();

    // Y NO se ofrecen para agregar: ya están arriba, con su aviso de que les falta columna.
    const add = screen.getByText(es.panel.import.columns.add).closest('div')!;
    expect(within(add).queryByRole('button', { name: /N° de crédito/ })).not.toBeInTheDocument();
    expect(within(add).getByRole('button', { name: /Teléfono/ })).toBeInTheDocument();
  });

  it('el contador dice cuánto falta y cuáles bloquean', async () => {
    const user = userEvent.setup();
    renderMapper();
    await withSample(user);

    // 4 esenciales, ninguno emparejado. Los dos bloqueados son los que impiden importar.
    expect(screen.getByText('0/4')).toBeInTheDocument();
    expect(screen.getByText(/2 datos obligatorios/)).toBeInTheDocument();
  });

  it('cada columna se elige viendo sus valores reales', async () => {
    const user = userEvent.setup();
    renderMapper();
    patchEcho(CONFIG);
    await withSample(user);

    await user.selectOptions(screen.getByLabelText('Sale de — Cliente'), 'DEUDOR');
    // Éste es el punto entero de la pantalla: no se empareja a ciegas.
    expect(await screen.findByText(/QUISPE MAMANI ROSA · VARGAS LEON JULIO/)).toBeInTheDocument();
  });

  it('una columna que ya alimenta otro dato no se puede volver a elegir', async () => {
    const user = userEvent.setup();
    renderMapper({ outstandingBalance: { from: 'SALDO' } });
    await withSample(user);

    // El servidor lo rechaza con COLUMN_ALREADY_MAPPED; se dice antes de gastar el viaje.
    const option = within(screen.getByLabelText('Sale de — N° de crédito')).getByRole('option', {
      name: /SALDO — ya alimenta/,
    });
    expect(option).toBeDisabled();
  });
});

describe('ImportSetup —probar antes de importar', () => {
  const COMPLETE: ImportConfig['fields'] = {
    code: { from: 'NRO' },
    clientName: { from: 'DEUDOR' },
    outstandingBalance: { from: 'SALDO' },
    daysPastDue: { from: 'ATRASO', calibrated: true },
  };

  it('con todo emparejado corre el archivo en seco y dice qué pasaría', async () => {
    const user = userEvent.setup();
    renderMapper(COMPLETE);
    await withSample(user);

    expect(screen.getByText(es.panel.import.columns.statusDone)).toBeInTheDocument();
    // El corte del nombre vive dentro del cliente, y se previsualiza con un nombre REAL del
    // archivo: es lo único que deja elegir la regla sin adivinar.
    expect(screen.getByText(/Quedaría: apellidos «QUISPE MAMANI ROSA»/)).toBeInTheDocument();

    server.use(
      http.post('http://localhost/api/imports/run', () =>
        HttpResponse.json({
          dryRun: true,
          idempotentSkip: false,
          counts: { created: 2, updated: 0, setCurrent: 0, invalid: 0 },
          preview: { toCreate: [{ code: '90210', clientName: 'ROSA' }], toUpdate: [], toSetCurrent: [], invalid: [], warnings: [] },
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: es.panel.import.columns.testCta }));

    expect(await screen.findByText(es.panel.import.columns.testOk)).toBeInTheDocument();
    expect(screen.getByText(/2 nuevos/)).toBeInTheDocument();
  });

  it('sin los obligatorios el botón de probar está apagado, y dice por qué', async () => {
    const user = userEvent.setup();
    renderMapper();
    await withSample(user);

    expect(screen.getByRole('button', { name: es.panel.import.columns.testCta })).toBeDisabled();
    expect(screen.getByText(es.panel.import.columns.testBlocked)).toBeInTheDocument();
  });
});

describe('ImportSetup — cambiar la forma del archivo es destructivo y se pregunta', () => {
  it('con columnas emparejadas pide confirmación antes de guardar', async () => {
    const user = userEvent.setup();
    let patched = false;
    renderMapper({ code: { from: 'NRO' }, clientName: { from: 'DEUDOR' } });
    server.use(
      http.patch('http://localhost/api/imports/config', () => {
        patched = true;
        return HttpResponse.json({ config: { ...CONFIG, profile: { kind: 'pdf-rows' }, fields: {} } });
      }),
    );
    await withSample(user);

    await user.click(screen.getByRole('radio', { name: /Una tabla adentro de un PDF/ }));
    // El servidor borra el emparejado al cambiar la forma. Antes era un renglón gris de aviso:
    // el mismo daño que el reset, que sí preguntaba.
    expect(await screen.findByText(es.panel.import.setup.shapeConfirmTitle)).toBeInTheDocument();
    expect(patched).toBe(false);

    await user.click(screen.getByRole('button', { name: es.panel.import.setup.shapeConfirmCta }));
    await waitFor(() => expect(patched).toBe(true));
  });

  it('🔴 si la muestra ya no sirve para la forma nueva, se suelta en vez de mentir', async () => {
    const user = userEvent.setup();
    renderMapper({ code: { from: 'NRO' } });
    server.use(
      http.patch('http://localhost/api/imports/config', () =>
        HttpResponse.json({ config: { ...CONFIG, profile: { kind: 'pdf-rows' }, fields: {} } }),
      ),
    );
    await withSample(user);

    // El CSV que está en la mano no se puede releer como PDF: `assertFileShape` corre ANTES de
    // parsear. Dejando las columnas viejas en pantalla, el paso 3 seguía ofreciendo los
    // encabezados del CSV mientras la config ya era `pdf-rows` — cada columna elegida ahí es una
    // etiqueta que no existe más.
    server.use(
      http.post('http://localhost/api/imports/run', () =>
        HttpResponse.json({ error: { code: 'FILE_SHAPE_MISMATCH', message: 'Ese archivo no tiene la forma que configuraste.' } }, { status: 400 }),
      ),
    );
    await user.click(screen.getByRole('radio', { name: /Una tabla adentro de un PDF/ }));
    await user.click(screen.getByRole('button', { name: es.panel.import.setup.shapeConfirmCta }));

    expect(await screen.findByText(es.panel.import.setup.step3Blocked)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Sale de — N° de crédito/)).not.toBeInTheDocument();
  });

  it('sin nada emparejado no molesta: no hay qué perder', async () => {
    const user = userEvent.setup();
    let patched = false;
    renderMapper();
    server.use(
      http.patch('http://localhost/api/imports/config', () => {
        patched = true;
        return HttpResponse.json({ config: { ...CONFIG, profile: { kind: 'pdf-rows' } } });
      }),
    );
    await withSample(user);

    await user.click(screen.getByRole('radio', { name: /Una tabla adentro de un PDF/ }));
    await waitFor(() => expect(patched).toBe(true));
    // El `<dialog>` vive siempre en el DOM; lo que dice si está abierto es el atributo `open`.
    expect(screen.getByText(es.panel.import.setup.shapeConfirmTitle).closest('dialog')).not.toHaveAttribute('open');
  });
});

describe('ImportSetup — el alcance incompleto no se guarda en silencio', () => {
  it('elegir «Un oficial» sin elegir a quién no manda nada, y lo dice', async () => {
    const user = userEvent.setup();
    let patched = false;
    renderMapper();
    server.use(
      http.patch('http://localhost/api/imports/config', () => {
        patched = true;
        return HttpResponse.json({ config: CONFIG });
      }),
    );
    await withSample(user);

    await user.click(screen.getByRole('radio', { name: /Un oficial de crédito/ }));
    // El servidor rechaza el par incompleto (IMPORT_NOT_CONFIGURED). Esperar está bien; lo que
    // no puede es parecer guardado.
    expect(patched).toBe(false);
    expect(screen.getByText(es.panel.import.setup.scopePending)).toBeInTheDocument();
  });
});

describe('ImportSetup — la prueba es una prueba', () => {
  it('🔴 `dryRun` viaja en el multipart y NUNCA como `columnsOnly`', async () => {
    const user = userEvent.setup();
    renderMapper({
      code: { from: 'NRO' },
      clientName: { from: 'DEUDOR' },
      outstandingBalance: { from: 'SALDO' },
      daysPastDue: { from: 'ATRASO', calibrated: true },
    });
    await withSample(user);

    let url: string | null = null;
    server.use(
      http.post('http://localhost/api/imports/run', ({ request }) => {
        // El cuerpo NO se lee acá: consumir el multipart en msw/node cuelga el handler. Que
        // `dryRun` viaje adentro del `FormData` lo afirma el test de `postImportFile`.
        url = request.url;
        return HttpResponse.json({
          dryRun: true,
          idempotentSkip: false,
          counts: { created: 1, updated: 0, setCurrent: 0, invalid: 0 },
          preview: { toCreate: [], toUpdate: [], toSetCurrent: [], invalid: [], warnings: [] },
        });
      }),
    );
    await user.click(screen.getByRole('button', { name: es.panel.import.columns.testCta }));
    await screen.findByText(es.panel.import.columns.testOk);

    // Mandar `dryRun` por query haría que el POST aplique la importación de verdad creyendo que
    // previsualiza, y `columnsOnly` haría que no corra nada y la prueba mienta.
    expect(url!).not.toContain('dryRun');
    expect(url!).not.toContain('columnsOnly');
  });
});

describe('ImportSetup —la mora se elige y se confirma en dos pasos', () => {
  it('elegir la columna muestra los valores y NO la deja confirmada', async () => {
    const user = userEvent.setup();
    renderMapper();
    patchEcho(CONFIG);
    await withSample(user);

    await user.selectOptions(screen.getByLabelText(es.panel.import.columns.moraQuestion), 'ATRASO');

    // Los valores de verdad, con el nombre del cliente al lado: es lo único que deja decidir.
    expect(await screen.findByText('QUISPE MAMANI ROSA')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    // Y el botón de confirmar todavía sin apretar: si elegir confirmara, «confirmado» no
    // significaría nada — el servidor lo rechaza con CALIBRATION_STALE.
    expect(screen.getByRole('button', { name: es.panel.import.columns.calibrateConfirm })).toBeInTheDocument();
    expect(screen.queryByText(es.panel.import.columns.calibrated)).not.toBeInTheDocument();
  });

  it('🔴 la mora NO se dibuja además como una fila más de la lista', async () => {
    const user = userEvent.setup();
    renderMapper({ daysPastDue: { from: 'ATRASO', calibrated: true } });
    await withSample(user);

    // Dos controles para el mismo campo escribían parches distintos, y los dos rompían: la fila
    // limpia el `in` (en `pdf-blocks`, el motor busca la columna donde no está y entra toda la
    // cartera con cero días de atraso, sin un solo error) y arrastra el `calibrated` viejo, que el
    // servidor rechaza con CALIBRATION_STALE — sin forma de cumplir desde ese control.
    expect(screen.queryByLabelText(/Sale de — Días de retraso/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(es.panel.import.columns.moraQuestion)).toBeInTheDocument();
    // Y sigue contando: sale de la lista, no del progreso (4 esenciales, la mora emparejada).
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('confirmada, deja de pedirlo', async () => {
    const user = userEvent.setup();
    renderMapper({ daysPastDue: { from: 'ATRASO' } });
    patchEcho({ ...CONFIG, fields: { daysPastDue: { from: 'ATRASO' } } });
    await withSample(user);

    await user.click(screen.getByRole('button', { name: es.panel.import.columns.calibrateConfirm }));
    await waitFor(() => expect(screen.getAllByText(es.panel.import.columns.calibrated).length).toBeGreaterThan(0));
  });
});
