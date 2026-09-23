import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ createDirectClient: vi.fn(() => ({ db: { handle: 1 } })) }));
vi.mock('server-only', () => ({}));
vi.mock('@youandfriends/db', () => db);

const { transactionalDatabase } = await import('../database');

describe('the transactional handle', () => {
  it('opens one small pool per instance and reuses it', () => {
    const first = transactionalDatabase();
    const second = transactionalDatabase();

    expect(first).toBe(second);
    expect(db.createDirectClient).toHaveBeenCalledTimes(1);
    // Small on purpose: Neon's unpooled endpoint counts connections, and serverless instances
    // multiply them.
    expect(db.createDirectClient.mock.calls[0]).toEqual([expect.anything(), { max: 2 }]);
  });
});
