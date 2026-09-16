import {
  accent,
  border,
  contrastRatio,
  motion,
  radius,
  shadow,
  surface,
  text,
  type,
} from '@youandfriends/ui';

import { Section, States } from './scaffold';

/**
 * Token sheets.
 *
 * Values are read from `@youandfriends/ui` at render time rather than retyped, so a token
 * change shows up here without anyone remembering to update the showcase. Inline `style` is
 * correct in this file and only in this file: the whole point is to display the raw token
 * value, and a class would show what Tailwind resolved rather than what the token says.
 */

function Swatch({ name, value, on }: { name: string; value: string; on?: string }) {
  const ratio = on === undefined ? null : contrastRatio(value, on);

  return (
    <div className="w-40">
      <div
        className="border-border flex h-14 items-center justify-center rounded border"
        style={on === undefined ? { background: value } : { background: on, color: value }}
      >
        {on === undefined ? null : <span className="text-body font-sans">Aa</span>}
      </div>
      <p className="text-caption text-foreground mt-1 font-sans">{name}</p>
      <p className="text-caption text-muted-foreground font-mono">{value}</p>
      {ratio === null ? null : (
        <p className="text-caption text-muted-foreground font-mono">{ratio.toFixed(2)}:1</p>
      )}
    </div>
  );
}

export function TokenSheets() {
  return (
    <Section
      id="tokens"
      title="Tokens"
      note="Read from @youandfriends/ui at render time. Contrast ratios are computed, not asserted by eye."
    >
      <States label="Surfaces" testId="showcase-tokens-surfaces">
        {Object.entries(surface).map(([name, value]) => (
          <Swatch key={name} name={name} value={value} />
        ))}
      </States>

      <States label="Text on canvas" testId="showcase-tokens-text">
        {Object.entries(text).map(([name, value]) => (
          <Swatch
            key={name}
            name={name}
            value={value}
            on={/onEspresso$/i.test(name) ? surface.espresso : surface.canvas}
          />
        ))}
      </States>

      <States
        label="Accents — base fills, and the AA-safe text variants"
        testId="showcase-tokens-accents"
      >
        {Object.entries(accent).map(([name, value]) =>
          name.endsWith('Text') ? (
            <Swatch key={name} name={name} value={value} on={surface.canvas} />
          ) : (
            <Swatch key={name} name={name} value={value} />
          ),
        )}
      </States>

      <States label="Borders" testId="showcase-tokens-borders">
        {Object.entries(border).map(([name, value]) => (
          <div key={name} className="w-40">
            <div
              className="h-14 rounded border"
              style={{
                borderColor: value,
                background: name === 'onEspresso' ? surface.espresso : surface.paper,
              }}
            />
            <p className="text-caption text-foreground mt-1 font-sans">{name}</p>
            <p className="text-caption text-muted-foreground font-mono">{value}</p>
          </div>
        ))}
      </States>

      <States label="Type scale" testId="showcase-tokens-type" className="flex-col !items-start">
        {Object.entries(type).map(([name, value]) => (
          <div key={name} className="flex w-full items-baseline gap-4">
            <span className="text-caption text-muted-foreground w-28 shrink-0 font-mono">
              {name}
            </span>
            <span
              className={name === 'lyric' ? 'font-mono' : 'font-serif'}
              style={{ fontSize: value }}
            >
              Where songs live between sessions.
            </span>
            <span className="text-caption text-muted-foreground font-mono">{value}</span>
          </div>
        ))}
      </States>

      <States label="Radii" testId="showcase-tokens-radii">
        {Object.entries(radius).map(([name, value]) => (
          <div key={name} className="w-24">
            <div className="border-border bg-card h-16 border" style={{ borderRadius: value }} />
            <p className="text-caption text-foreground mt-1 font-sans">{name}</p>
            <p className="text-caption text-muted-foreground font-mono">{value}</p>
          </div>
        ))}
      </States>

      <States label="Elevation" testId="showcase-tokens-elevation">
        {Object.entries(shadow).map(([name, value]) => (
          <div key={name} className="w-40">
            <div
              className="h-16 rounded-md"
              style={{
                boxShadow: value,
                background: name === 'inset' ? surface.espresso : surface.paper,
              }}
            />
            <p className="text-caption text-foreground mt-1 font-sans">{name}</p>
            <p className="text-caption text-muted-foreground font-mono break-words">{value}</p>
          </div>
        ))}
      </States>

      <States label="Motion" testId="showcase-tokens-motion" className="flex-col !items-start">
        {Object.entries(motion).map(([name, value]) => (
          <div key={name} className="flex items-baseline gap-4">
            <span className="text-caption text-muted-foreground w-28 shrink-0 font-mono">
              {name}
            </span>
            <span className="text-body text-foreground font-mono">{value}</span>
          </div>
        ))}
        <p className="text-caption text-muted-foreground font-sans">
          Every duration collapses to 0 under prefers-reduced-motion, at the token layer.
        </p>
      </States>
    </Section>
  );
}
