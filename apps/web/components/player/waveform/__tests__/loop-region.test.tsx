import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoopRegionOverlay } from '../loop-region';

describe('the loop region on the waveform (task 074)', () => {
  it('draws a translucent band over the region, leaving the waveform readable', () => {
    const { container } = render(
      <LoopRegionOverlay
        region={{ start: 50, end: 100 }}
        duration={200}
        onChange={() => undefined}
      />,
    );
    const band = container.querySelector('[data-loop-region]') as HTMLElement;
    expect(band.style.left).toBe('25%');
    expect(band.style.width).toBe('25%');
    expect(band.className).toMatch(/bg-ochre\/20/);
    expect(band.className).toContain('pointer-events-none');
  });

  it('moves each end by keyboard, fine with Shift, without the waveform also seeking', () => {
    const onChange = vi.fn();
    const waveformKey = vi.fn();
    render(
      <div onKeyDown={waveformKey}>
        <LoopRegionOverlay region={{ start: 50, end: 100 }} duration={200} onChange={onChange} />
      </div>,
    );
    const start = screen.getByRole('slider', { name: 'Loop start' });
    const end = screen.getByRole('slider', { name: 'Loop end' });
    expect(start).toHaveAttribute('aria-valuetext', '50 seconds');
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange.mock.calls).toEqual([
      [50.5, 100],
      [50, 99.9],
    ]);
    expect(waveformKey).not.toHaveBeenCalled();
  });
});
