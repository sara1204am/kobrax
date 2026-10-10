/**
 * Los avisos locales con el sistema de notificaciones DOBLADO: lo que importa es qué se le pide (qué se programa, qué se cancela,
 * cuándo se pregunta por el permiso), no cómo suena en el teléfono.
 */
const mockScheduled: { identifier: string }[] = [];
const mockMeta = new Map<string, string>();
const mockPerm = { granted: false, canAskAgain: true };

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ ...mockPerm })),
  requestPermissionsAsync: jest.fn(async () => {
    mockPerm.granted = true;
    return { granted: true };
  }),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...mockScheduled]),
  scheduleNotificationAsync: jest.fn(async (req: { identifier: string }) => {
    mockScheduled.push({ identifier: req.identifier });
    return req.identifier;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = mockScheduled.findIndex((s) => s.identifier === id);
    if (i >= 0) mockScheduled.splice(i, 1);
  }),
  AndroidImportance: { HIGH: 4 },
}));
jest.mock('./db', () => ({
  getMeta: jest.fn(async (k: string) => mockMeta.get(k) ?? null),
  setMeta: jest.fn(async (k: string, v: string) => void mockMeta.set(k, v)),
}));

import * as Notifications from 'expo-notifications';
import type { AgendaListItem } from '@kobrax/shared';
import { cancelAgendaReminder, cancelAllAgendaReminders, ensureNotificationPermission, itemIdOfNotification, syncAgendaReminders } from './agenda-notifications';

const NOW = new Date(2026, 9, 7, 7, 0, 0);
const item = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, scheduledDate: '2026-10-07T00:00:00.000Z', status: 'SCHEDULED', type: 'CALL', clientName: 'Ana', scheduledTime: '10:00', ...over }) as unknown as AgendaListItem;
const ids = () => mockScheduled.map((s) => s.identifier).sort();

beforeEach(() => {
  mockScheduled.length = 0;
  mockMeta.clear();
  mockPerm.granted = false;
  mockPerm.canAskAgain = true;
  jest.clearAllMocks();
});

describe('syncAgendaReminders', () => {
  it('programa un aviso por gestión pendiente, con el id de la gestión', async () => {
    mockPerm.granted = true;
    const n = await syncAgendaReminders([item('a'), item('b', { scheduledTime: '11:00' })], { now: NOW });
    expect(n).toBe(2);
    expect(ids()).toEqual(['agenda:a', 'agenda:b']);
    const req = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0]![0];
    expect(req.content.data).toEqual({ itemId: 'a' });
    expect(req.content.title).toBe('Llamada con Ana');
  });

  it('con la lista completa cancela los avisos de lo que ya no está (hecho, cancelado, reasignado)', async () => {
    mockPerm.granted = true;
    mockScheduled.push({ identifier: 'agenda:vieja' }, { identifier: 'otra-cosa' });
    await syncAgendaReminders([item('a')], { complete: true, now: NOW });
    expect(ids()).toEqual(['agenda:a', 'otra-cosa']); // solo toca los suyos
  });

  it('con una lista parcial no toca los avisos de gestiones que no están en ella', async () => {
    mockPerm.granted = true;
    mockScheduled.push({ identifier: 'agenda:de-otro-dia' });
    await syncAgendaReminders([item('a')], { complete: false, now: NOW });
    expect(ids()).toContain('agenda:de-otro-dia');
  });

  it('una gestión de la lista que ya no merece aviso (hecha) se cancela aunque la lista sea parcial', async () => {
    mockPerm.granted = true;
    mockScheduled.push({ identifier: 'agenda:a' });
    await syncAgendaReminders([item('a', { status: 'EXECUTED' })], { complete: false, now: NOW });
    expect(ids()).toEqual([]);
  });

  it('repetir la sincronización no duplica avisos', async () => {
    mockPerm.granted = true;
    await syncAgendaReminders([item('a')], { complete: true, now: NOW });
    await syncAgendaReminders([item('a')], { complete: true, now: NOW });
    expect(ids().filter((i) => i === 'agenda:a').length).toBeGreaterThanOrEqual(1);
  });

  it('sin permiso no programa nada y no falla', async () => {
    mockPerm.canAskAgain = false;
    expect(await syncAgendaReminders([item('a')], { now: NOW })).toBe(0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('ensureNotificationPermission', () => {
  it('pide el permiso UNA vez por instalación', async () => {
    expect(await ensureNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    // Lo negó después: no se le vuelve a preguntar.
    mockPerm.granted = false;
    expect(await ensureNotificationPermission()).toBe(false);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('si ya lo tiene no pregunta', async () => {
    mockPerm.granted = true;
    expect(await ensureNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('cancelar', () => {
  it('cancelAgendaReminder quita el aviso de UNA gestión', async () => {
    mockScheduled.push({ identifier: 'agenda:a' }, { identifier: 'agenda:b' });
    await cancelAgendaReminder('a');
    expect(ids()).toEqual(['agenda:b']);
  });

  it('cancelAllAgendaReminders quita los de la agenda y deja los demás', async () => {
    mockScheduled.push({ identifier: 'agenda:a' }, { identifier: 'agenda:b' }, { identifier: 'ajeno' });
    await cancelAllAgendaReminders();
    expect(ids()).toEqual(['ajeno']);
  });
});

describe('itemIdOfNotification', () => {
  it('lee la gestión del aviso, y nada si el dato no es el esperado', () => {
    expect(itemIdOfNotification({ itemId: 'g1' })).toBe('g1');
    expect(itemIdOfNotification({ itemId: 5 })).toBeUndefined();
    expect(itemIdOfNotification(null)).toBeUndefined();
  });
});
