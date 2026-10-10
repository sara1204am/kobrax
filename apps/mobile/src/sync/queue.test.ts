/**
 * El envío de una acción encolada. El caso que importa es la visita compuesta: cuando sube, tiene
 * que reproducir exactamente lo que la pantalla habría hecho con señal — visita, foto, cobro y
 * promesa, **en ese orden**, y con la clave de idempotencia derivada de la visita ya creada.
 */
const mockCalls: string[] = [];
/** Detalles de las llamadas (ids, rutas) que no forman parte del ORDEN que verifican los casos de arriba. */
const mockDetail: string[] = [];
const mockState: { visit: Record<string, unknown>; upload: Record<string, unknown> } = {
  visit: { status: 'ok', data: { id: 'v1' } },
  upload: { status: 'ok', url: 'http://x/f.jpg', hash: 'h1' },
};
const mockPayment: { idem?: string; input?: Record<string, unknown> } = {};
const mockMora: { res: Record<string, unknown> } = { res: { status: 'ok', data: {} } };
/** Lo que la cola escribió en la base (filas nuevas, rechazos, payloads reescritos, mapa de ids) y lo que el server responde. */
const mockDb = {
  enqueued: [] as { userId: string; kind: string; payload: Record<string, unknown>; idempotencyKey?: string }[],
  rejected: [] as { id: number; error: string }[],
  rewritten: [] as { id: number; payload: Record<string, unknown> }[],
  dequeued: [] as number[],
  meta: new Map<string, string>(),
};
const mockApi = {
  existingAttachments: [] as { fileHash: string }[],
  agendaWrite: { status: 'ok', data: {} } as { status: string; data?: unknown; message?: string; httpStatus?: number },
  payment: { status: 'ok', data: {} } as Record<string, unknown>,
  item: { status: 'ok', data: {} } as Record<string, unknown>,
  evidence: { status: 'ok', data: {} } as Record<string, unknown>,
  context: { status: 'ok', data: { contacts: [], locations: [] } } as Record<string, unknown>,
  addContact: { status: 'ok', data: { id: 'srv-contact' } } as Record<string, unknown>,
  addLocation: { status: 'ok', data: { id: 'srv-loc' } } as Record<string, unknown>,
  removeContact: { status: 'ok', data: null } as Record<string, unknown>,
  photoExists: true,
};

jest.mock('../field.service', () => ({
  createVisit: jest.fn(async () => {
    mockCalls.push('createVisit');
    return mockState.visit;
  }),
  addVisitEvidence: jest.fn(async (visitId: string) => {
    mockCalls.push('addVisitEvidence');
    mockDetail.push(`evidence:${visitId}`);
    return mockApi.evidence;
  }),
}));
jest.mock('../queue-photos', () => ({
  persistPhoto: jest.fn(async (p: { uri: string }) => ({ ...p, uri: `durable://${p.uri}` })),
  photoExists: jest.fn(async () => mockApi.photoExists),
  deleteQueuePhoto: jest.fn(async (uri?: string) => void mockDetail.push(`deletePhoto:${uri}`)),
}));
jest.mock('./optimistic', () => ({
  confirmProvisionalRow: jest.fn(async (kind: string, id: string) => void mockDetail.push(`confirm:${kind}:${id}`)),
  dropProvisionalRow: jest.fn(async (kind: string, id: string) => void mockDetail.push(`drop:${kind}:${id}`)),
}));
jest.mock('../uploads.service', () => ({
  uploadImage: jest.fn(async () => {
    mockCalls.push('uploadImage');
    return mockState.upload;
  }),
}));
jest.mock('../payments.service', () => ({
  createPayment: jest.fn(async (input: Record<string, unknown>, idem: string) => {
    mockCalls.push('createPayment');
    mockPayment.idem = idem;
    mockPayment.input = input;
    return mockApi.payment;
  }),
}));
jest.mock('../agenda.service', () => ({
  createItem: jest.fn(async (input: { id?: string; details?: { contactId?: string } }) => {
    mockCalls.push('createItem');
    mockDetail.push(`createItem:id=${input.id}:contact=${input.details?.contactId}`);
    return mockApi.item;
  }),
  completeItem: jest.fn(async (id: string, outcome: string, _notes?: string, ctx?: Record<string, unknown>) => {
    mockCalls.push(`completeItem:${id}:${outcome}:${JSON.stringify(ctx ?? {})}`);
    return { status: 'ok', data: {} };
  }),
  postponeItem: jest.fn(async (id: string, minutes: number, toTime?: string) => {
    mockCalls.push(`postponeItem:${id}:${minutes}:${toTime}`);
    return { status: 'ok', data: {} };
  }),
  clientContextLive: jest.fn(async () => mockApi.context),
  addClientContact: jest.fn(async () => {
    mockCalls.push('addClientContact');
    return mockApi.addContact;
  }),
  addClientLocation: jest.fn(async () => {
    mockCalls.push('addClientLocation');
    return mockApi.addLocation;
  }),
  cancelItem: jest.fn(async (id: string, reasonCode: string) => {
    mockCalls.push(`cancelItem:${id}:${reasonCode}`);
    return { status: 'ok', data: {} };
  }),
  rescheduleItem: jest.fn(async (id: string, input: { scheduledDate: string }) => {
    mockCalls.push(`rescheduleItem:${id}:${input.scheduledDate}`);
    return { status: 'ok', data: {} };
  }),
  updateItem: jest.fn(async (id: string, patch: { observations?: string }) => {
    mockCalls.push(`updateItem:${id}:${patch.observations}`);
    return mockApi.agendaWrite;
  }),
  deleteItem: jest.fn(async (id: string) => {
    mockCalls.push(`deleteItem:${id}`);
    return mockApi.agendaWrite;
  }),
}));
jest.mock('../db', () => ({
  enqueue: jest.fn(async (row: { userId: string; kind: string; payload: Record<string, unknown>; idempotencyKey?: string }) => {
    mockDb.enqueued.push(row);
    return mockDb.enqueued.length;
  }),
  pending: jest.fn(async () => []),
  markRejected: jest.fn(async (id: number, error: string) => void mockDb.rejected.push({ id, error })),
  updatePayload: jest.fn(async (id: number, payload: Record<string, unknown>) => void mockDb.rewritten.push({ id, payload })),
  dequeue: jest.fn(async (id: number) => void mockDb.dequeued.push(id)),
  getMeta: jest.fn(async (k: string) => mockDb.meta.get(k) ?? null),
  setMeta: jest.fn(async (k: string, v: string) => void mockDb.meta.set(k, v)),
}));
jest.mock('../session', () => ({ getUserId: jest.fn(async () => 'u1') }));
jest.mock('../routes.service', () => ({ updateRouteStatus: jest.fn(async () => ({ status: 'ok', data: {} })) }));
jest.mock('../clients.service', () => ({
  addAttachment: jest.fn(async () => {
    mockCalls.push('addAttachment');
    return mockApi.agendaWrite;
  }),
  getClient: jest.fn(async () => ({ status: 'ok', data: { attachments: mockApi.existingAttachments } })),
  updateClient: jest.fn(async (id: string, patch: Record<string, unknown>) => {
    mockCalls.push(`updateClient:${id}:${JSON.stringify(patch)}`);
    return { status: 'ok', data: {} };
  }),
  saveIncomeProfile: jest.fn(async (id: string, profile: Record<string, unknown> | null) => {
    mockCalls.push(`saveIncomeProfile:${id}:${JSON.stringify(profile)}`);
    return { status: 'ok', data: {} };
  }),
  updateContact: jest.fn(async (cid: string, id: string) => {
    mockCalls.push(`updateContact:${cid}:${id}`);
    return { status: 'ok', data: {} };
  }),
  removeContact: jest.fn(async () => mockApi.removeContact),
  updateLocation: jest.fn(async () => ({ status: 'ok', data: {} })),
  removeLocation: jest.fn(async () => ({ status: 'ok', data: null })),
  createClient: jest.fn(async (input: { id?: string }) => {
    mockCalls.push(`createClient:${input.id}`);
    return { status: 'ok', data: { id: input.id } };
  }),
}));
jest.mock('../credits.service', () => ({
  createCredit: jest.fn(async (input: { id?: string; clientId?: string }) => {
    mockCalls.push(`createCredit:${input.id}:cliente=${input.clientId}`);
    return { status: 'ok', data: { id: input.id } };
  }),
  markArrears: jest.fn(async (creditId: string, days?: number) => {
    mockCalls.push(`markArrears:${creditId}:${days ?? '-'}`);
    return { status: 'ok', data: {} };
  }),
  clearArrears: jest.fn(async (creditId: string, input: { mode: string; date?: string }) => {
    mockCalls.push(`clearArrears:${creditId}:${input.mode}:${input.date ?? '-'}`);
    return { status: 'ok', data: {} };
  }),
}));

jest.mock('../mora.service', () => ({
  addMoraActivity: jest.fn(async (creditId: string, input: { id?: string; type: string }) => {
    mockCalls.push(`addMoraActivity:${creditId}:${input.id}:${input.type}`);
    return mockMora.res;
  }),
  addMoraNote: jest.fn(async (creditId: string, input: { id?: string }) => {
    mockCalls.push(`addMoraNote:${creditId}:${input.id}`);
    return mockMora.res;
  }),
}));

import { ACTION_LABEL, actionLabel, discardPending, enqueue, parseAction, QUEUE_VERSION, send, stabilize, withStableIds } from './queue';

const visitInput = { creditId: 'cr1', lat: -17.7, lng: -63.1, outcome: 'PAID' } as never;

beforeEach(() => {
  mockCalls.length = 0;
  mockDetail.length = 0;
  mockState.visit = { status: 'ok', data: { id: 'v1' } };
  mockState.upload = { status: 'ok', url: 'http://x/f.jpg', hash: 'h1' };
  delete mockPayment.idem;
  mockMora.res = { status: 'ok', data: {} };
  mockDb.enqueued.length = 0;
  mockDb.rejected.length = 0;
  mockDb.rewritten.length = 0;
  mockDb.dequeued.length = 0;
  mockDb.meta.clear();
  mockApi.payment = { status: 'ok', data: {} };
  mockApi.item = { status: 'ok', data: {} };
  mockApi.evidence = { status: 'ok', data: {} };
  mockApi.context = { status: 'ok', data: { contacts: [], locations: [] } };
  mockApi.addContact = { status: 'ok', data: { id: 'srv-contact' } };
  mockApi.addLocation = { status: 'ok', data: { id: 'srv-loc' } };
  mockApi.removeContact = { status: 'ok', data: null };
  mockApi.photoExists = true;
});

describe('send · visita compuesta', () => {
  it('sube visita, foto, cobro y promesa en ese orden', async () => {
    const r = await send({
      kind: 'visit',
      input: visitInput,
      photo: { uri: 'file:///f.jpg' },
      payment: { creditId: 'cr1', amount: 100, method: 'CASH' },
      promise: { creditId: 'cr1' } as never,
    });
    expect(r.status).toBe('ok');
    expect(mockCalls).toEqual(['createVisit', 'uploadImage', 'addVisitEvidence', 'createPayment', 'createItem']);
  });

  // Es la garantía anti doble cobro: la llave sale de la visita, que el server crea una sola vez.
  it('la clave de idempotencia del cobro sale de la visita recién creada', async () => {
    await send({
      kind: 'visit',
      input: visitInput,
      payment: { creditId: 'cr1', amount: 100, method: 'CASH' },
    });
    expect(mockPayment.idem).toBe('visit-v1');
  });

  it('la foto subida queda como comprobante del cobro', async () => {
    await send({
      kind: 'visit',
      input: visitInput,
      photo: { uri: 'file:///f.jpg' },
      payment: { creditId: 'cr1', amount: 100, method: 'CASH' },
    });
    expect(mockPayment.input).toMatchObject({ receiptUrl: 'http://x/f.jpg', receiptHash: 'h1' });
  });

  // Si la visita no salió, NADA de lo que cuelga de ella puede salir: sin id no hay a qué colgarlo.
  it('si la visita falla, no intenta el resto', async () => {
    mockState.visit = { status: 'error', message: 'boom' };
    const r = await send({
      kind: 'visit',
      input: visitInput,
      payment: { creditId: 'cr1', amount: 100, method: 'CASH' },
    });
    expect(r.status).toBe('error');
    expect(mockCalls).toEqual(['createVisit']);
  });

  // Reintentar toda la acción duplicaría la parada visitada: la visita ya quedó registrada.
  it('una foto que no sube NO hace fallar la acción entera', async () => {
    mockState.upload = { status: 'error', message: 'archivo ilegible' };
    const r = await send({ kind: 'visit', input: visitInput, photo: { uri: 'file:///f.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).not.toContain('addVisitEvidence');
  });
});

/**
 * El alta en la calle: cliente y préstamo se dan de alta sin señal y suben después. Lo que hace
 * que esto funcione es que **el id lo pone el teléfono**, así el préstamo puede nombrar a un
 * cliente que todavía no llegó al servidor.
 */
describe('send · altas offline', () => {
  it('sube el alta de cliente con el id que se generó en el teléfono', async () => {
    await send({ kind: 'client.create', input: { id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' } });
    expect(mockCalls).toContain('createClient:cli-1');
  });

  // Sin esto, el préstamo tendría que esperar la respuesta del alta del cliente para saber de
  // quién es — imposible sin señal, que es justo cuando hace falta.
  it('el préstamo viaja apuntando al cliente creado offline', async () => {
    await send({
      kind: 'credit.create',
      input: { id: 'cre-1', clientId: 'cli-1', principalAmount: 1000, installmentAmount: 100 } as never,
    });
    expect(mockCalls).toContain('createCredit:cre-1:cliente=cli-1');
  });

  it('cancelar y reagendar viajan con su motivo', async () => {
    await send({ kind: 'agenda.cancel', id: 'a1', reasonCode: 'NO_ESTABA' });
    await send({
      kind: 'agenda.reschedule',
      id: 'a2',
      input: { scheduledDate: '2026-08-20', timeMode: 'LAPSE', timeSlot: 'MORNING', reasonCode: 'PIDIO_OTRO_DIA' } as never,
    });
    expect(mockCalls).toEqual(['cancelItem:a1:NO_ESTABA', 'rescheduleItem:a2:2026-08-20']);
  });

  it('marcar en mora viaja con los días que puso el cobrador', async () => {
    await send({ kind: 'arrears.mark', creditId: 'cr1', days: 15 });
    expect(mockCalls).toContain('markArrears:cr1:15');
  });

  /**
   * 🔴 **La prueba que evita regalarle un mes al deudor.**
   *
   * El servidor entiende `next_period`, que avanza un período *desde donde esté el crédito*. Encolado
   * así, un reintento —lo normal en una cola offline: se manda, se corta la señal antes de la
   * respuesta, se vuelve a mandar— correría el vencimiento **dos veces**. La pantalla resuelve la
   * fecha con `addPeriods` (la misma función que usa el servidor) y encola `date`, que escribe un
   * valor fijo: mandarlo diez veces deja la misma fecha.
   */
  it('poner al día se reintenta sin correr la fecha dos veces', async () => {
    const accion = { kind: 'arrears.clear', creditId: 'cr1', input: { mode: 'date', date: '2026-09-17' } } as const;
    await send(accion);
    await send(accion); // el reintento de la cola
    expect(mockCalls).toEqual(['clearArrears:cr1:date:2026-09-17', 'clearArrears:cr1:date:2026-09-17']);
    expect(mockCalls.some((c) => c.includes('next_period'))).toBe(false);
  });

  it('«sin fecha de vencimiento» también es idempotente', async () => {
    await send({ kind: 'arrears.clear', creditId: 'cr1', input: { mode: 'none' } });
    expect(mockCalls).toContain('clearArrears:cr1:none:-');
  });
});

describe('send · mora', () => {
  const ID = '33333333-3333-4333-8333-333333333333';

  // El id lo puso el teléfono: es lo que hace que reintentar no duplique la gestión ni su promesa.
  it('la gestión viaja con el mismo id con el que se encoló', async () => {
    const r = await send({ kind: 'mora.activity', creditId: 'cr1', input: { id: ID, type: 'CALL', result: 'NO_ANSWER' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).toEqual([`addMoraActivity:cr1:${ID}:CALL`]);
  });

  it('la nota viaja con el mismo id con el que se encoló', async () => {
    await send({ kind: 'credit.note', creditId: 'cr1', input: { id: ID, body: 'Llamar después de las 18' } });
    expect(mockCalls).toEqual([`addMoraNote:cr1:${ID}`]);
  });

  it('un 4xx del servidor es definitivo y queda a la vista, no se reintenta', async () => {
    mockMora.res = { status: 'error', message: 'Ese id de nota ya pertenece a otro crédito.', httpStatus: 409 };
    const r = await send({ kind: 'credit.note', creditId: 'cr1', input: { id: ID, body: 'x' } });
    expect(r).toEqual({ status: 'error', message: 'Ese id de nota ya pertenece a otro crédito.', permanent: true });
  });

  it('sin red no es error: queda en la cola', async () => {
    mockMora.res = { status: 'offline' };
    expect((await send({ kind: 'mora.activity', creditId: 'cr1', input: { id: ID, type: 'CALL', result: 'NO_ANSWER' } })).status).toBe('offline');
  });

  it('las dos acciones se llaman en la hoja de pendientes', () => {
    expect(ACTION_LABEL['mora.activity']).toBe('Gestión registrada');
    expect(ACTION_LABEL['credit.note']).toBe('Nota del crédito');
  });
});

describe('isPermanentRejection', () => {
  it('un 4xx es definitivo, salvo 408 y 429; un 5xx o sin status no', () => {
    const { isPermanentRejection } = jest.requireActual('./queue') as typeof import('./queue');
    expect(isPermanentRejection(400)).toBe(true);
    expect(isPermanentRejection(422)).toBe(true);
    expect(isPermanentRejection(408)).toBe(false);
    expect(isPermanentRejection(429)).toBe(false);
    // 🔴 El corte de versión no dice nada de la acción: descartarla sería perder una cobranza por tener la app vieja.
    expect(isPermanentRejection(426)).toBe(false);
    expect(isPermanentRejection(500)).toBe(false);
    expect(isPermanentRejection(undefined)).toBe(false);
  });
});

/**
 * Lo que falla DESPUÉS de que la visita quedó registrada no se pierde ni arrastra a la visita: cada parte
 * se re-encola como su propio ítem, con sus mismas llaves/ids, y queda a la vista en pendientes.
 */
describe('send · visita compuesta: lo que falla después se re-encola', () => {
  const pago = { creditId: 'cr1', amount: 100, method: 'CASH' } as const;
  const promesa = { id: 'prom-1', creditId: 'cr1' } as never;

  it('si el cobro falla, se re-encola con su MISMA clave de idempotencia y la acción termina ok', async () => {
    mockApi.payment = { status: 'offline' };
    const r = await send({ kind: 'visit', input: visitInput, payment: pago });
    expect(r.status).toBe('ok'); // la visita ya salió: repetir toda la acción la duplicaría
    expect(mockDb.enqueued).toHaveLength(1);
    expect(mockDb.enqueued[0]).toMatchObject({ kind: 'payment', idempotencyKey: 'visit-v1' });
    expect(mockDb.enqueued[0]!.payload).toMatchObject({ kind: 'payment', idempotencyKey: 'visit-v1', v: QUEUE_VERSION });
  });

  it('si la promesa falla, se re-encola como agenda.create con su id', async () => {
    mockApi.item = { status: 'error', message: 'boom', httpStatus: 500 };
    const r = await send({ kind: 'visit', input: visitInput, promise: promesa });
    expect(r.status).toBe('ok');
    expect(mockDb.enqueued.map((e) => e.kind)).toEqual(['agenda.create']);
    expect((mockDb.enqueued[0]!.payload.input as { id: string }).id).toBe('prom-1');
  });

  it('si la promesa no traía id, se le genera uno antes de enviarla y el mismo viaja a la cola', async () => {
    mockApi.item = { status: 'offline' };
    await send({ kind: 'visit', input: visitInput, promise: { creditId: 'cr1' } as never });
    const enviado = mockDetail.find((d) => d.startsWith('createItem:id='))!;
    const id = enviado.split(':')[1]!.replace('id=', '');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((mockDb.enqueued[0]!.payload.input as { id: string }).id).toBe(id);
  });

  it('si la foto no sube, se re-encola como visit.evidence con la foto', async () => {
    mockState.upload = { status: 'offline' };
    const r = await send({ kind: 'visit', input: visitInput, photo: { uri: 'file:///f.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockDb.enqueued).toHaveLength(1);
    expect(mockDb.enqueued[0]!.payload).toMatchObject({ kind: 'visit.evidence', visitId: 'v1', photo: { uri: 'durable://file:///f.jpg' } });
  });

  it('si la foto subió pero el sellado falló, se re-encola con la URL (no se vuelve a subir)', async () => {
    mockApi.evidence = { status: 'offline' };
    await send({ kind: 'visit', input: visitInput, photo: { uri: 'file:///f.jpg' } });
    expect(mockDb.enqueued[0]!.payload).toMatchObject({ kind: 'visit.evidence', visitId: 'v1', uploaded: { url: 'http://x/f.jpg', hash: 'h1' } });
    expect(mockDb.enqueued[0]!.payload.photo).toBeUndefined();
  });

  it('una foto que ya no está en el teléfono deja un aviso RECHAZADO a la vista (nunca en silencio)', async () => {
    mockApi.photoExists = false;
    const r = await send({ kind: 'visit', input: visitInput, photo: { uri: 'file:///f.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).not.toContain('uploadImage');
    expect(mockDb.enqueued[0]).toMatchObject({ kind: 'photo.lost' });
    expect(mockDb.rejected).toHaveLength(1);
    expect(mockDb.rejected[0]!.error).toContain('ya no está en el teléfono');
  });

  it('la foto subida con señal antes de cortarse (photoUploaded) se sella sin volver a subirla', async () => {
    await send({ kind: 'visit', input: visitInput, photoUploaded: { url: 'http://x/u.jpg', hash: 'hu' }, payment: pago });
    expect(mockCalls).toEqual(['createVisit', 'addVisitEvidence', 'createPayment']);
    expect(mockPayment.input).toMatchObject({ receiptUrl: 'http://x/u.jpg', receiptHash: 'hu' });
  });

  it('la copia durable de la foto se borra cuando subió', async () => {
    await send({ kind: 'visit', input: visitInput, photo: { uri: 'durable://x.jpg' } });
    expect(mockDetail).toContain('deletePhoto:durable://x.jpg');
  });

  it('la visita viaja con el id que se fijó al abrir la pantalla', async () => {
    const { createVisit } = jest.requireMock('../field.service') as { createVisit: jest.Mock };
    await send({ kind: 'visit', input: { ...visitInput, id: 'visita-1' } });
    expect(createVisit).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'visita-1' }));
  });

  it('si ni la cola puede guardar lo que falta (sin sesión), la acción falla pasajera: nada se descarta', async () => {
    mockApi.payment = { status: 'offline' };
    const { getUserId } = jest.requireMock('../session') as { getUserId: jest.Mock };
    getUserId.mockResolvedValueOnce(null);
    const r = await send({ kind: 'visit', input: visitInput, payment: pago });
    expect(r).toMatchObject({ status: 'error' });
    expect((r as { permanent?: boolean }).permanent).toBeUndefined();
  });
});

describe('send · pagos y fotos', () => {
  const input = { creditId: 'cr1', amount: 50, method: 'CASH' } as never;

  it('el cobro con un comprobante que ya no existe sube igual, sin comprobante, y deja un aviso a la vista', async () => {
    mockApi.photoExists = false;
    const r = await send({ kind: 'payment', input, idempotencyKey: 'k1', photo: { uri: 'durable://gone.jpg' } });
    expect(r.status).toBe('ok'); // es plata: no se retiene por una foto
    expect(mockCalls).toContain('createPayment');
    expect(mockDb.enqueued[0]).toMatchObject({ kind: 'photo.lost' });
    expect(mockDb.rejected).toHaveLength(1);
  });

  it('un cobro con comprobante que no sube por falta de señal se reintenta entero (no sale sin recibo)', async () => {
    mockState.upload = { status: 'offline' };
    const r = await send({ kind: 'payment', input, idempotencyKey: 'k1', photo: { uri: 'durable://p.jpg' } });
    expect(r.status).toBe('offline');
    expect(mockCalls).not.toContain('createPayment');
  });

  it('visit.evidence con la foto ausente es un rechazo permanente y explícito', async () => {
    mockApi.photoExists = false;
    const r = await send({ kind: 'visit.evidence', visitId: 'v1', photo: { uri: 'durable://gone.jpg' } });
    expect(r).toMatchObject({ status: 'error', permanent: true });
    expect((r as { message: string }).message).toContain('ya no está en el teléfono');
  });

  it('visit.evidence sube la foto, la sella y borra la copia', async () => {
    const r = await send({ kind: 'visit.evidence', visitId: 'v9', photo: { uri: 'durable://p.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockDetail).toEqual(expect.arrayContaining(['evidence:v9', 'deletePhoto:durable://p.jpg']));
  });
});

describe('enqueue · versión y foto durable', () => {
  it('guarda el payload con su versión y copia la foto a la carpeta durable', async () => {
    const ok = await enqueue({ kind: 'payment', input: { amount: 1 } as never, idempotencyKey: 'k', photo: { uri: 'cache://a.jpg' } });
    expect(ok).toBe(true);
    expect(mockDb.enqueued[0]!.payload).toMatchObject({ kind: 'payment', v: QUEUE_VERSION, photo: { uri: 'durable://cache://a.jpg' } });
    expect(mockDb.enqueued[0]!.idempotencyKey).toBe('k');
  });
});

describe('parseAction · cola robusta', () => {
  it('un JSON roto NO tira: vuelve como no soportada', () => {
    const a = parseAction({ kind: 'payment', payload: '{no es json' });
    expect(a).toMatchObject({ kind: 'unsupported', rawKind: 'payment' });
  });

  it('un tipo desconocido vuelve como no soportado, con el tipo original', () => {
    const a = parseAction({ kind: 'cosa.nueva', payload: JSON.stringify({ kind: 'cosa.nueva', v: 1 }) });
    expect(a).toMatchObject({ kind: 'unsupported', rawKind: 'cosa.nueva' });
  });

  it('un payload de una versión más nueva vuelve como no soportado', () => {
    const a = parseAction({ kind: 'payment', payload: JSON.stringify({ kind: 'payment', v: QUEUE_VERSION + 1 }) });
    expect(a).toMatchObject({ kind: 'unsupported' });
  });

  it('un payload que no es un objeto vuelve como no soportado', () => {
    expect(parseAction({ kind: 'payment', payload: 'null' }).kind).toBe('unsupported');
    expect(parseAction({ kind: 'payment', payload: '[1]' }).kind).toBe('unsupported');
  });

  it('sin v (anterior al versionado) se lee como v0 y SE ACEPTA', () => {
    const a = parseAction({ kind: 'mora.activity', payload: JSON.stringify({ kind: 'mora.activity', creditId: 'cr1', input: { type: 'NOTE' } }) });
    expect(a.kind).toBe('mora.activity');
  });

  // F4/08: `case.activity` ya no existe (dev-only: el cambio de esquema borra la cola). Si una fila así aparece igual
  // —una base restaurada a mano— no rompe el drenaje: cae en «no soportado», visible y descartable.
  it('un case.activity viejo vuelve como no soportado (no tira el drenaje)', async () => {
    const a = parseAction({ kind: 'case.activity', payload: JSON.stringify({ kind: 'case.activity', caseId: 'c', input: { type: 'NOTE' } }) });
    expect(a).toMatchObject({ kind: 'unsupported', rawKind: 'case.activity' });
    expect((await send(a)).status).toBe('error');
    expect(actionLabel('case.activity')).toBe('Acción pendiente (no soportada)');
  });

  it('la gestión es una sola etiqueta: «Gestión registrada»', () => {
    expect(ACTION_LABEL['mora.activity']).toBe('Gestión registrada');
    expect(ACTION_LABEL).not.toHaveProperty('case.activity');
  });

  it('usa el kind de la fila si al payload le falta', () => {
    expect(parseAction({ kind: 'route.status', payload: JSON.stringify({ routeId: 'r', status: 'COMPLETED' }) }).kind).toBe('route.status');
  });

  it('no deja la v en la acción', () => {
    const a = parseAction({ kind: 'route.status', payload: JSON.stringify({ kind: 'route.status', v: 1, routeId: 'r' }) });
    expect(a).not.toHaveProperty('v');
  });

  it('send de una acción no soportada es un rechazo permanente («no soportado»), no una excepción', async () => {
    const r = await send({ kind: 'unsupported', rawKind: 'x', reason: 'razón' });
    expect(r).toEqual({ status: 'error', message: 'No soportado: razón', permanent: true });
  });

  it('las etiquetas tienen un respaldo para tipos desconocidos', () => {
    expect(actionLabel('cosa.nueva')).toBe('Acción pendiente (no soportada)');
    expect(actionLabel('visit')).toBe('Visita registrada');
    for (const k of ['visit.evidence', 'photo.lost', 'client.update', 'client.income', 'client.contact', 'client.location']) {
      expect(ACTION_LABEL[k as keyof typeof ACTION_LABEL]).toBeTruthy();
    }
  });
});

describe('discardPending', () => {
  it('borra la fila y la copia de la foto', async () => {
    await discardPending(5, { kind: 'visit.evidence', visitId: 'v', photo: { uri: 'durable://p.jpg' } });
    expect(mockDb.dequeued).toEqual([5]);
    expect(mockDetail).toContain('deletePhoto:durable://p.jpg');
  });

  it('descartar un alta de cliente rechazada quita su fila provisional', async () => {
    await discardPending(6, { kind: 'client.create', input: { id: 'cli-1', clientType: 'PERSON' } });
    expect(mockDetail).toContain('drop:client:cli-1');
    expect(mockDb.dequeued).toEqual([6]);
  });
});

describe('ítems viejos (v0, sin ids): id estable al primer envío', () => {
  it('genera el id y lo PERSISTE en la fila antes de enviar', async () => {
    const vieja = { kind: 'agenda.create', input: { creditId: 'cr1' } } as never;
    const nueva = await stabilize(42, vieja);
    const id = (nueva as { input: { id?: string } }).input.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb.rewritten).toHaveLength(1);
    expect(mockDb.rewritten[0]!.id).toBe(42);
    expect(mockDb.rewritten[0]!.payload).toMatchObject({ kind: 'agenda.create', v: QUEUE_VERSION, input: { id } });
  });

  it('si ya tenía id no toca la base ni cambia el id', async () => {
    const a = { kind: 'agenda.create', input: { id: 'ya-tenia' } } as never;
    expect(await stabilize(1, a)).toBe(a);
    expect(mockDb.rewritten).toHaveLength(0);
  });

  it('cubre la visita (y su promesa) y el agendado; un reintento reusa el id guardado', () => {
    const v = withStableIds({ kind: 'visit', input: visitInput, promise: { creditId: 'k' } as never });
    expect(v).toMatchObject({ input: { id: expect.any(String) }, promise: { id: expect.any(String) } });
    expect(withStableIds(v)).toBe(v); // estable: ya no cambia
    expect(withStableIds({ kind: 'agenda.create', input: {} as never })).toMatchObject({ input: { id: expect.any(String) } });
  });

  it('el envío de un ítem viejo funciona (con el id recién generado)', async () => {
    const estable = await stabilize(3, { kind: 'agenda.create', input: { creditId: 'k1' } as never });
    expect((await send(estable)).status).toBe('ok');
    expect(mockDetail.some((d) => /^createItem:id=[0-9a-f-]{36}/.test(d))).toBe(true);
  });
});

describe('send · posponer con hora absoluta', () => {
  it('manda toTime y minutes juntos', async () => {
    await send({ kind: 'agenda.postpone', id: 'a1', minutes: 30, toTime: '10:30' });
    expect(mockCalls).toContain('postponeItem:a1:30:10:30');
  });

  it('un ítem viejo (sin toTime) sigue mandando sólo minutes', async () => {
    await send({ kind: 'agenda.postpone', id: 'a1', minutes: 15 });
    expect(mockCalls).toContain('postponeItem:a1:15:undefined');
  });
});

describe('send · timeout vs offline', () => {
  it('un timeout es reintentable y marca que el resultado es desconocido', async () => {
    mockMora.res = { status: 'offline', reason: 'timeout' };
    const r = await send({ kind: 'credit.note', creditId: 'c', input: { id: 'n', body: 'x' } });
    expect(r).toEqual({ status: 'offline', outcomeUnknown: true });
  });

  it('sin red a secas no lo marca', async () => {
    mockMora.res = { status: 'offline', reason: 'offline' };
    const r = await send({ kind: 'credit.note', creditId: 'c', input: { id: 'n', body: 'x' } });
    expect(r).toEqual({ status: 'offline' });
  });
});

describe('send · adjunto del cliente (C4)', () => {
  beforeEach(() => {
    mockApi.agendaWrite = { status: 'ok', data: {} };
    mockApi.existingAttachments = [];
  });

  it('sube la foto, crea el adjunto y borra la copia', async () => {
    const r = await send({ kind: 'client.attachment', clientId: 'c1', fileType: 'ID_CARD', photo: { uri: 'durable://a.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).toContain('addAttachment');
  });

  it('si el adjunto ya está (mismo hash), no lo duplica', async () => {
    mockApi.existingAttachments = [{ fileHash: 'h-up' }];
    const r = await send({ kind: 'client.attachment', clientId: 'c1', fileType: 'ID_CARD', uploaded: { url: 'http://x/a.jpg', hash: 'h-up' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).not.toContain('addAttachment');
  });

  it('sin la foto en el teléfono es un rechazo explícito', async () => {
    const r = await send({ kind: 'client.attachment', clientId: 'c1', fileType: 'ID_CARD' });
    expect(r).toMatchObject({ status: 'error', permanent: true });
  });
});

describe('send · editar y eliminar una gestión (A1)', () => {
  beforeEach(() => {
    mockApi.agendaWrite = { status: 'ok', data: {} };
  });

  it('editar manda el parche completo', async () => {
    expect((await send({ kind: 'agenda.update', id: 'a1', patch: { observations: 'llamar antes' } })).status).toBe('ok');
    expect(mockCalls).toContain('updateItem:a1:llamar antes');
  });

  it('eliminar una que ya no existe (404) es el resultado buscado', async () => {
    mockApi.agendaWrite = { status: 'error', message: 'no existe', httpStatus: 404 };
    expect((await send({ kind: 'agenda.delete', id: 'a1' })).status).toBe('ok');
  });

  it('editar una que cambió (409) o ajena (403) es rechazo definitivo y explicado', async () => {
    for (const httpStatus of [409, 403]) {
      mockApi.agendaWrite = { status: 'error', message: 'x', httpStatus };
      expect(await send({ kind: 'agenda.update', id: 'a1', patch: {} })).toMatchObject({ status: 'error', permanent: true });
    }
  });

  it('sin señal sigue pendiente', async () => {
    mockApi.agendaWrite = { status: 'offline' };
    expect((await send({ kind: 'agenda.delete', id: 'a1' })).status).toBe('offline');
  });
});

describe('send · contexto de la gestión agendada (F4/13 · E4)', () => {
  it('🔴 una acción encolada ANTES de estos campos sale igual, sin contexto', async () => {
    mockCalls.length = 0;
    const r = await send({ kind: 'agenda.complete', id: 'a1', outcome: 'CONTACTED', notes: 'ok' } as never);
    expect(r.status).toBe('ok');
    expect(mockCalls.some((x) => x.startsWith('completeItem:a1'))).toBe(true);
  });

  it('el motivo, la fecha y quién responde viajan con la gestión', async () => {
    mockCalls.length = 0;
    await send({ kind: 'agenda.complete', id: 'a2', outcome: 'CONTACTED', reasonCode: 'LATE_INCOME', expectedIncomeDate: '2026-10-20', payerParty: 'HOLDER' } as never);
    expect(mockCalls.some((x) => x.includes('completeItem:a2') && x.includes('LATE_INCOME') && x.includes('2026-10-20') && x.includes('HOLDER'))).toBe(true);
  });
});

describe('send · edición de la ficha del cliente', () => {
  it('client.update manda el PATCH con los valores fijos', async () => {
    await send({ kind: 'client.update', clientId: 'cl1', patch: { firstName: 'Ana' } });
    expect(mockCalls).toContain('updateClient:cl1:{"firstName":"Ana"}');
  });

  it('client.income manda el PUT del perfil (valor fijo, repetible)', async () => {
    await send({ kind: 'client.income', clientId: 'cl1', profile: { occupationCode: 'TRANSPORT', incomeCycle: 'WEEKLY', incomeDay: 5 } });
    expect(mockCalls).toContain('saveIncomeProfile:cl1:{"occupationCode":"TRANSPORT","incomeCycle":"WEEKLY","incomeDay":5}');
  });

  it('client.income con null borra el perfil', async () => {
    await send({ kind: 'client.income', clientId: 'cl1', profile: null });
    expect(mockCalls).toContain('saveIncomeProfile:cl1:null');
  });

  it('borrar un teléfono que ya no existe (404) cuenta como hecho', async () => {
    mockApi.removeContact = { status: 'error', message: 'no existe', httpStatus: 404 };
    expect((await send({ kind: 'client.contact', clientId: 'cl1', op: 'remove', contactId: 'x' })).status).toBe('ok');
  });

  it('otro error al borrar sigue siendo error', async () => {
    mockApi.removeContact = { status: 'error', message: 'prohibido', httpStatus: 403 };
    expect(await send({ kind: 'client.contact', clientId: 'cl1', op: 'remove', contactId: 'x' })).toMatchObject({ status: 'error', permanent: true });
  });

  it('alta de teléfono: si el server ya lo tiene (un intento anterior llegó) NO lo crea de nuevo', async () => {
    mockApi.context = { status: 'ok', data: { contacts: [{ id: 'ya-estaba', contactType: 'PHONE', value: '+591 700-12345' }], locations: [] } };
    const r = await send({ kind: 'client.contact', clientId: 'cl1', op: 'add', localId: 'local:1', input: { contactType: 'PHONE', value: '70012345' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).not.toContain('addClientContact');
    expect(mockDb.meta.get('idmap:local:1')).toBe('ya-estaba');
  });

  it('alta de teléfono nuevo: lo crea y guarda local→real', async () => {
    const r = await send({ kind: 'client.contact', clientId: 'cl1', op: 'add', localId: 'local:2', input: { contactType: 'PHONE', value: '71111111' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).toContain('addClientContact');
    expect(mockDb.meta.get('idmap:local:2')).toBe('srv-contact');
  });

  it('repetir un alta ya confirmada no vuelve a llamar al server', async () => {
    mockDb.meta.set('idmap:local:3', 'real');
    const r = await send({ kind: 'client.contact', clientId: 'cl1', op: 'add', localId: 'local:3', input: { contactType: 'PHONE', value: '1' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).toEqual([]);
  });

  it('sin señal al mirar al server, el alta espera (no crea a ciegas)', async () => {
    mockApi.context = { status: 'offline' };
    const r = await send({ kind: 'client.contact', clientId: 'cl1', op: 'add', localId: 'local:4', input: { contactType: 'PHONE', value: '1' } });
    expect(r.status).toBe('offline');
    expect(mockCalls).not.toContain('addClientContact');
  });

  it('alta de dirección: reutiliza la que ya existe con el mismo tipo y texto', async () => {
    mockApi.context = { status: 'ok', data: { contacts: [], locations: [{ id: 'loc-ya', locationType: 'HOME', address: '  Av. Siempre   Viva 742 ' }] } };
    await send({ kind: 'client.location', clientId: 'cl1', op: 'add', localId: 'local:5', input: { locationType: 'HOME', address: 'av. siempre viva 742' } });
    expect(mockCalls).not.toContain('addClientLocation');
    expect(mockDb.meta.get('idmap:local:5')).toBe('loc-ya');
  });

  it('el agendado que cita un teléfono provisional lo traduce al id real', async () => {
    mockDb.meta.set('idmap:local:9', 'contacto-real');
    const r = await send({ kind: 'agenda.create', input: { id: 'ag-1', details: { contactId: 'local:9' } } as never });
    expect(r.status).toBe('ok');
    expect(mockDetail).toContain('createItem:id=ag-1:contact=contacto-real');
  });

  it('si ese teléfono todavía no subió, el agendado espera (fallo pasajero) y no se envía', async () => {
    const r = await send({ kind: 'agenda.create', input: { id: 'ag-1', details: { contactId: 'local:10' } } as never });
    expect(r).toMatchObject({ status: 'error' });
    expect((r as { permanent?: boolean }).permanent).toBeUndefined();
    expect(mockCalls).not.toContain('createItem');
  });
});

describe('send · altas offline confirman su fila provisional', () => {
  it('al subir el cliente, la fila deja de ser provisional', async () => {
    await send({ kind: 'client.create', input: { id: 'cli-9', clientType: 'PERSON' } });
    expect(mockDetail).toContain('confirm:client:cli-9');
  });

  it('al subir el préstamo, también', async () => {
    await send({ kind: 'credit.create', input: { id: 'cre-9', clientId: 'cli-9' } as never });
    expect(mockDetail).toContain('confirm:credit:cre-9');
  });
});

describe('send · plantilla elegida de una gestión agendada (F4/13 · E5)', () => {
  it('el código de la plantilla viaja con la gestión', async () => {
    mockCalls.length = 0;
    await send({ kind: 'agenda.complete', id: 'a9', outcome: 'CONTACTED', templateCode: 'LAST_NOTICE' } as never);
    expect(mockCalls.some((x) => x.includes('completeItem:a9') && x.includes('LAST_NOTICE'))).toBe(true);
  });
});
