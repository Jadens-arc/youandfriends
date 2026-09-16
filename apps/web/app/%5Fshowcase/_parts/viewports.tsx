import { Section, States } from './scaffold';

/**
 * Responsive framing.
 *
 * Real iframes, not fixed-width `div`s. Tailwind's breakpoints are viewport media queries, so
 * a 390 px-wide element on a 1440 px screen still renders the desktop shell — the framing
 * would show the wrong answer confidently. An iframe has its own viewport, so `md:hidden`
 * resolves the way it will on the device.
 *
 * The desktop frame is scaled with a transform rather than sized down, which keeps its
 * internal viewport at 1280 px.
 */
function Frame({
  title,
  width,
  height,
  scale = 1,
  testId,
}: {
  title: string;
  width: number;
  height: number;
  scale?: number;
  testId: string;
}) {
  return (
    <figure className="m-0">
      <figcaption className="text-caption text-muted-foreground mb-2 font-sans">
        {title} — {width}×{height}
      </figcaption>
      <div
        className="border-border overflow-hidden rounded-md border"
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          src="/library"
          title={title}
          data-testid={testId}
          width={width}
          height={height}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left', border: 0 }}
        />
      </div>
    </figure>
  );
}

export function Viewports() {
  return (
    <Section
      id="viewports"
      title="Responsive shell"
      note="The real workspace route, framed at two viewports. Each iframe has its own viewport, so the breakpoints resolve honestly."
    >
      <States label="Frames" testId="showcase-viewports" className="!items-start">
        <Frame title="iPhone" width={390} height={844} scale={0.75} testId="showcase-frame-phone" />
        <Frame
          title="Desktop"
          width={1280}
          height={800}
          scale={0.5}
          testId="showcase-frame-desktop"
        />
      </States>
    </Section>
  );
}
