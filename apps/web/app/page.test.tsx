import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const { default: Home } = await import('./page');

describe('the front door', () => {
  it('sends a signed-in person straight to their library', () => {
    expect(() => Home()).toThrow('NEXT_REDIRECT /library');
    expect(redirect).toHaveBeenCalledWith('/library');
  });
});
