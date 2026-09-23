import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const current = vi.hoisted(() => ({ currentWorkspace: vi.fn() }));
vi.mock('@/lib/workspace/current', () => current);

const { WorkspaceGate } = await import('../workspace-gate');

describe('the workspace gate', () => {
  it('renders the page once the workspace resolves', async () => {
    current.currentWorkspace.mockResolvedValue({ workspace: { workspaceId: 'w1' } });
    render(await WorkspaceGate({ children: <p>Library</p> }));
    expect(screen.getByText('Library')).toBeInTheDocument();
  });

  it('renders no page at all when it cannot, and says so', async () => {
    // Rendering the page anyway would show an empty library to someone whose music is fine —
    // which reads as data loss. Saying "not available" is the honest failure (CLAUDE.md §7).
    current.currentWorkspace.mockResolvedValue(null);
    render(await WorkspaceGate({ children: <p>Library</p> }));
    expect(screen.queryByText('Library')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your workspace isn’t available');
  });
});
