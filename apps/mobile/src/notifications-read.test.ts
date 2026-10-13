const mockRead = jest.fn();
const mockQueue = jest.fn();
jest.mock('./notifications.service', () => ({ markRead: (...a: unknown[]) => mockRead(...a) }));
jest.mock('./sync/sync.service', () => ({ queueForLater: (...a: unknown[]) => mockQueue(...a) }));

import { markReadOrQueue } from './notifications-read';

beforeEach(() => {
  mockRead.mockReset();
  mockQueue.mockReset().mockResolvedValue(true);
});

describe('markReadOrQueue', () => {
  it('con señal no encola', async () => {
    mockRead.mockResolvedValue({ status: 'ok', data: null });
    await markReadOrQueue('n1');
    expect(mockQueue).not.toHaveBeenCalled();
  });

  it('sin señal queda en la cola', async () => {
    mockRead.mockResolvedValue({ status: 'offline' });
    await markReadOrQueue('n1');
    expect(mockQueue).toHaveBeenCalledWith({ kind: 'notification.read', id: 'n1' });
  });

  it('nunca lanza', async () => {
    mockRead.mockRejectedValue(new Error('boom'));
    await expect(markReadOrQueue('n1')).resolves.toBeUndefined();
  });
});
