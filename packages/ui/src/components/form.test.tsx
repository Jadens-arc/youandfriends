/**
 * Form primitives.
 *
 * Split by group so Vitest isolates them: a dialog test leaves scroll-lock and aria-hidden
 * residue on the document that broke unrelated tests later in the same file.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Checkbox, Switch } from './checkbox';
import { Input, Label, Textarea } from './input';
import { Slider } from './slider';

describe('Button', () => {
  it('defaults to type=button so it cannot accidentally submit a form', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('activates with Enter and with Space', async () => {
    const user = userEvent.setup();
    const presses: string[] = [];
    render(<Button onClick={() => presses.push('click')}>Play</Button>);

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(presses).toHaveLength(2);
  });

  it('does not fire when disabled', async () => {
    const user = userEvent.setup();
    const presses: string[] = [];
    render(
      <Button disabled onClick={() => presses.push('click')}>
        Play
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(presses).toHaveLength(0);
  });

  it('carries a focus ring on light surfaces', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button').className).toMatch(/focus-visible:outline-ring\b/);
  });

  it('uses the espresso ring on espresso surfaces, where the ink ring is invisible', () => {
    render(<Button variant="onEspresso">Library</Button>);
    expect(screen.getByRole('button').className).toMatch(/focus-visible:outline-ring-on-espresso/);
  });

  it('maps destructive to the AA-safe rust variant', () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button').className).toMatch(/bg-destructive/);
  });
});

describe('Input, Textarea, Label', () => {
  it('associates a label with its control', () => {
    render(
      <>
        <Label htmlFor="title">Song title</Label>
        <Input id="title" />
      </>,
    );
    expect(screen.getByLabelText('Song title')).toBeInTheDocument();
  });

  it('accepts typed input', async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Title" />);
    await user.type(screen.getByLabelText('Title'), 'Nightswim');
    expect(screen.getByLabelText('Title')).toHaveValue('Nightswim');
  });

  it('marks invalid state without relying on colour alone', () => {
    render(<Input aria-label="Title" aria-invalid />);
    // aria-invalid is what assistive technology reads; the border is the visual echo.
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a textarea that receives focus by keyboard', async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Notes" />);
    await user.tab();
    expect(screen.getByLabelText('Notes')).toHaveFocus();
  });
});

describe('Checkbox and Switch', () => {
  it('toggles the checkbox with Space', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Downloadable" />);
    const box = screen.getByRole('checkbox');
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
  });

  it('toggles the switch with Space', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Email notifications" />);
    const toggle = screen.getByRole('switch');
    await user.tab();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
  });

  it('expands the touch target without changing the visual size', () => {
    render(<Checkbox aria-label="Downloadable" />);
    // 44x44 on touch viewports (docs/DESIGN.md §10), via a pseudo-element so dense desktop
    // lists do not inflate.
    expect(screen.getByRole('checkbox').className).toMatch(/after:h-11/);
    expect(screen.getByRole('checkbox').className).toMatch(/after:w-11/);
  });
});

describe('Slider — the accessible alternative to the waveform', () => {
  it('exposes a slider role with an announced value', () => {
    render(<Slider aria-label="Seek" defaultValue={[30]} max={100} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
  });

  it('seeks with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Slider aria-label="Seek" defaultValue={[30]} max={100} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '31');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '29');
  });

  it('jumps to the boundaries with Home and End', async () => {
    const user = userEvent.setup();
    render(<Slider aria-label="Seek" defaultValue={[30]} max={100} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '100');
  });
});
