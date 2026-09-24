import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { reviewFolder } from '@/lib/upload/manifest';

import { FolderReview } from '../folder-review';

function folder(paths: readonly string[], size = 10) {
  return reviewFolder({
    name: 'Night Drive',
    files: paths.map((relativePath) => ({
      file: new File([new Uint8Array(size)], relativePath),
      relativePath,
    })),
  });
}

describe('FolderReview', () => {
  it('lists every left-out file with its reason before anything is sent', async () => {
    const onConfirm = vi.fn();
    render(
      <FolderReview
        review={folder(['Audio/Kick.wav', 'Audio/.DS_Store', '../evil.wav'])}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Upload “Night Drive”' })).toBeInTheDocument();
    expect(screen.getByText(/2 will be left out/)).toBeInTheDocument();
    const leftOut = screen.getByText('Left out').closest('details') as HTMLElement;
    expect(within(leftOut).getByText('Audio/.DS_Store')).toBeInTheDocument();
    expect(within(leftOut).getByText(/macOS folder settings/)).toBeInTheDocument();
    expect(within(leftOut).getByText('../evil.wav')).toBeInTheDocument();
    expect(within(leftOut).getByText('It points outside the folder.')).toBeInTheDocument();
    // Status in words, never colour alone.
    expect(within(leftOut).getByText('Ignored')).toBeInTheDocument();
    expect(within(leftOut).getByText('Can’t include')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upload folder' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not offer a browser upload above the ceiling, and points to the Mac app', () => {
    render(
      <FolderReview
        review={folder(['big.wav'], 600 * 1024 * 1024)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/Mac app/);
    expect(screen.getByRole('button', { name: 'Upload folder' })).toBeDisabled();
  });
});
