'use client';

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
} from '@youandfriends/ui';
import { Loader2, Plus } from 'lucide-react';
import * as React from 'react';

import { Section, States } from './scaffold';

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive', 'onEspresso'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg', 'icon'] as const;

export function Controls() {
  const [checked, setChecked] = React.useState(true);
  const [on, setOn] = React.useState(true);
  const [volume, setVolume] = React.useState([65]);

  return (
    <>
      <Section
        id="button"
        title="Button"
        note="Pending is a composition — a disabled button with a spinning icon — not a variant. The component has no loading prop, and inventing one here would be a local copy."
      >
        {BUTTON_VARIANTS.map((variant) => (
          <States
            key={variant}
            label={variant}
            testId={`showcase-button-${variant}`}
            className={variant === 'onEspresso' ? 'bg-espresso rounded p-3' : undefined}
          >
            {BUTTON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size === 'icon' ? <Plus aria-label="Add" /> : size}
              </Button>
            ))}
            <Button variant={variant} disabled>
              disabled
            </Button>
            <Button variant={variant} disabled>
              <Loader2 className="animate-spin" aria-hidden />
              pending
            </Button>
            <Button variant={variant}>
              <Plus aria-hidden />
              with icon
            </Button>
          </States>
        ))}
      </Section>

      <Section
        id="badge"
        title="Badge"
        note="Every variant pairs colour with a word. State is never colour alone (docs/DESIGN.md §12)."
      >
        <States label="Variants" testId="showcase-badge">
          <Badge variant="neutral">Draft</Badge>
          <Badge variant="current">Current version</Badge>
          <Badge variant="attention">Processing</Badge>
          <Badge variant="problem">Upload failed</Badge>
        </States>
      </Section>

      <Section id="input" title="Input, textarea, and label">
        <States label="States" testId="showcase-input" className="!items-start">
          <div className="w-56">
            <Label htmlFor="showcase-default">Song title</Label>
            <Input id="showcase-default" defaultValue="Blue Hour" />
          </div>
          <div className="w-56">
            <Label htmlFor="showcase-placeholder">Empty</Label>
            <Input id="showcase-placeholder" placeholder="Untitled" />
          </div>
          <div className="w-56">
            <Label htmlFor="showcase-invalid">Error</Label>
            <Input
              id="showcase-invalid"
              aria-invalid
              defaultValue=""
              aria-describedby="showcase-invalid-message"
            />
            <p
              id="showcase-invalid-message"
              className="text-caption text-destructive mt-1 font-sans"
            >
              A song needs a title.
            </p>
          </div>
          <div className="w-56">
            <Label htmlFor="showcase-disabled">Disabled</Label>
            <Input id="showcase-disabled" disabled defaultValue="Locked" />
          </div>
          <div className="w-56">
            <Label htmlFor="showcase-textarea">Version note</Label>
            <Textarea id="showcase-textarea" placeholder="What changed?" />
          </div>
          <div className="w-56">
            <Label htmlFor="showcase-textarea-invalid">Version note — error</Label>
            <Textarea id="showcase-textarea-invalid" aria-invalid defaultValue="" />
          </div>
        </States>
      </Section>

      <Section id="toggle" title="Checkbox, switch, and slider">
        <States label="Checkbox" testId="showcase-checkbox">
          <Checkbox aria-label="Unchecked" checked={false} onCheckedChange={() => {}} />
          <Checkbox
            aria-label="Checked"
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
          />
          <Checkbox aria-label="Indeterminate" checked="indeterminate" onCheckedChange={() => {}} />
          <Checkbox aria-label="Disabled" disabled />
          <Checkbox aria-label="Disabled and checked" disabled checked />
        </States>

        <States label="Switch" testId="showcase-switch">
          <Switch aria-label="Off" checked={false} onCheckedChange={() => {}} />
          <Switch aria-label="On" checked={on} onCheckedChange={setOn} />
          <Switch aria-label="Disabled" disabled />
          <Switch aria-label="Disabled and on" disabled checked />
        </States>

        <States label="Slider" testId="showcase-slider" className="!items-start">
          <div className="w-64">
            <Label htmlFor="showcase-volume">Volume — {volume[0]}</Label>
            <Slider
              id="showcase-volume"
              value={volume}
              onValueChange={setVolume}
              max={100}
              step={1}
            />
          </div>
          <div className="w-64">
            <Label htmlFor="showcase-volume-disabled">Disabled</Label>
            <Slider id="showcase-volume-disabled" defaultValue={[30]} max={100} disabled />
          </div>
        </States>
      </Section>

      <Section id="select" title="Select">
        <States label="States" testId="showcase-select">
          <Select defaultValue="latest">
            <SelectTrigger className="w-48" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Recently changed</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="added">Date added</SelectItem>
            </SelectContent>
          </Select>

          <Select>
            <SelectTrigger className="w-48" aria-label="Empty select">
              <SelectValue placeholder="Choose a folder" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="demos">Demos</SelectItem>
            </SelectContent>
          </Select>

          <Select disabled>
            <SelectTrigger className="w-48" aria-label="Disabled select">
              <SelectValue placeholder="Unavailable" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </States>
      </Section>
    </>
  );
}
