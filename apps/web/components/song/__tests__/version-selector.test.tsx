import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { initialVersionId, VersionPanel, VersionSelector } = await import('../version-selector');

const PANEL = {
  songId: 'S1',
  capabilities: { comment: false, edit: false, download: false },
} as const;

import { NOW, version, VERSIONS } from './fixtures';

describe('initialVersionId', () => {
  it('prefers a linked version of this song, then the current one, then the newest', () => {
    expect(initialVersionId(VERSIONS, 'V1')).toBe('V1');
    expect(initialVersionId(VERSIONS, 'SOMEONE-ELSES')).toBe('V2');
    expect(initialVersionId(VERSIONS, null)).toBe('V2');
    const noCurrent = VERSIONS.map((v) => ({ ...v, isCurrent: false }));
    expect(initialVersionId(noCurrent, null)).toBe('V3');
    expect(initialVersionId([], null)).toBeNull();
  });
});

describe('VersionSelector', () => {
  it('names the current version in words, not by colour', () => {
    render(<VersionSelector versions={VERSIONS} selectedId="V3" onSelect={() => {}} now={NOW} />);
    const current = screen.getByRole('radio', { name: /Version 2/ });
    expect(within(current).getByText('Current')).toBeInTheDocument();
    // Exactly one version says so.
    expect(screen.getAllByText('Current')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Version 3/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('moves the selection with arrow keys, one tab stop for the group', async () => {
    const selected: string[] = [];
    render(
      <VersionSelector
        versions={VERSIONS}
        selectedId="V2"
        onSelect={(id) => selected.push(id)}
        now={NOW}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: /Version 2/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(selected).toEqual(['V1']);
    expect(screen.getByRole('radio', { name: /Version 1/ })).toHaveFocus();
    // Wraps: from the last version, down lands on the first.
    await userEvent.keyboard('{ArrowDown}');
    expect(selected).toEqual(['V1', 'V3']);
  });
});

describe('VersionPanel', () => {
  it('starts on the current version and shows its details', () => {
    render(
      <VersionPanel
        versions={VERSIONS}
        linkedVersionId={null}
        now={NOW}
        songTitle="Headlights"
        {...PANEL}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Version 2' })).toBeInTheDocument();
    expect(screen.getByText('48 kHz')).toBeInTheDocument();
    expect(screen.getByText('24-bit')).toBeInTheDocument();
    expect(screen.getByText('−14.2 LUFS')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Waveform for Headlights, Version 2' }),
    ).toBeVisible();
  });

  it('switches details when another version is chosen, without touching the URL', async () => {
    const before = window.location.href;
    render(
      <VersionPanel
        versions={VERSIONS}
        linkedVersionId={null}
        now={NOW}
        songTitle="Headlights"
        {...PANEL}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Version 3/ }));
    expect(screen.getByRole('heading', { name: 'Version 3' })).toBeInTheDocument();
    // Processing state is an icon and a word.
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(window.location.href).toBe(before);
  });

  it('says why loudness is missing rather than showing a number or a blank', () => {
    render(
      <VersionPanel
        versions={[
          version({ integratedLufs: null, truePeakDb: null, loudnessUnavailable: 'silent' }),
        ]}
        linkedVersionId={null}
        now={NOW}
        songTitle="Headlights"
        {...PANEL}
      />,
    );
    expect(screen.getByText('Silent')).toBeInTheDocument();
    expect(screen.queryByText(/inf/)).toBeNull();
  });

  it('shows the failure detail only when it was given one', () => {
    render(
      <VersionPanel
        versions={[version({ processingState: 'failed', processingError: 'decoder error' })]}
        linkedVersionId={null}
        now={NOW}
        songTitle="Headlights"
        {...PANEL}
      />,
    );
    expect(screen.getByText('Processing failed')).toBeInTheDocument();
    expect(screen.getByText('decoder error')).toBeInTheDocument();
  });

  it('says what to do when there are no versions yet', () => {
    render(
      <VersionPanel
        versions={[]}
        linkedVersionId={null}
        now={NOW}
        songTitle="Headlights"
        {...PANEL}
      />,
    );
    expect(screen.getByText(/No versions yet/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waveform for Headlights' })).toBeVisible();
  });
});
