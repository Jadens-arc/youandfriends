'use client';

import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import {
  SECTION_KINDS,
  SECTION_LABELS,
  sectionHeadings,
  type LyricsDocument,
  type SectionKind,
} from '@youandfriends/contracts';
import {
  Button,
  cn,
  usePrefersReducedMotion,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  focusRing,
} from '@youandfriends/ui';
import { ArrowDown, ArrowUp, Clock, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

import { LYRICS_FRAGMENT } from '@/lib/lyrics/yjs';

import { LyricsTimestamps, timestampStorage } from '../timestamps/extension';
import {
  anchorStorage,
  commentAnchorsKey,
  LyricCommentAnchors,
  type AnchorThread,
} from '@/components/comments/lyric-anchor/extension';

import { useKeepCaretVisible } from '../mobile/keyboard';
import { useFollowAlong } from '../timestamps/follow-along';
import type { LyricsTiming } from '../timestamps/playback';

import {
  currentSection,
  fromEditorContent,
  LYRICS_SHORTCUTS,
  lyricsExtensions,
  lyricsSchemaExtensions,
  toEditorContent,
} from './schema';

/**
 * The structured lyrics editor (task `081`): a notebook page of sections and lines in the
 * typewriter face, at a readable measure, with one quiet row of section controls above it.
 *
 * Every control acts on the section holding the cursor and has a keyboard shortcut; the controls
 * are real buttons outside the editable surface, so they are reachable by Tab and named for
 * screen readers. Headings are derived from order (`sectionHeadings`) and never typed.
 */

/** Editing together (task `082`): the shared document and the awareness that carries cursors. */
export interface EditorCollaboration {
  readonly doc: Y.Doc;
  /** Present when a room is joined: cursors are shared through it. */
  readonly awareness: Awareness | null;
  readonly user: { readonly name: string; readonly color: string } | null;
}

/**
 * A collaborator's cursor: a bar and their name, in their colour — the name in words, so colour
 * never identifies anyone alone. Hidden from assistive technology, which hears joins and leaves
 * from the presence list instead of every cursor movement (`docs/DESIGN.md` §12).
 */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === 'string' ? user.color : 'var(--color-secondary)';
  const caret = document.createElement('span');
  caret.className = 'lyrics-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.style.borderColor = color;
  const label = document.createElement('span');
  label.className = 'lyrics-caret-label';
  label.style.backgroundColor = color;
  label.textContent = typeof user.name === 'string' ? user.name : 'Someone';
  caret.append(label);
  return caret;
}

export interface LyricsEditorHandle {
  /** Replace the whole document without it counting as an edit (loading a newer version). */
  replace(document: LyricsDocument): void;
  /** The live editor, for things that read its selection or scroll to a place in it. */
  editor(): Editor | null;
}

const SHORTCUT_KEYS: Readonly<Partial<Record<SectionKind, string>>> = {
  verse: '1',
  pre_chorus: '2',
  chorus: '3',
  bridge: '4',
  intro: '5',
  outro: '6',
  freeform: '0',
};

function spokenKeys(keys: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return keys
    .replaceAll('Mod', mac ? '⌘' : 'Ctrl')
    .replaceAll('Alt', mac ? '⌥' : 'Alt')
    .replaceAll('ArrowUp', '↑')
    .replaceAll('ArrowDown', '↓');
}

interface SectionState {
  readonly index: number;
  readonly count: number;
  readonly heading: string;
  readonly kind: SectionKind;
  readonly label: string | null;
}

function sectionState(editor: Editor | null): SectionState | null {
  if (editor === null) return null;
  const here = currentSection(editor.state);
  if (here === null) return null;
  const sections: { attrs: { kind: SectionKind; label: string | null } }[] = [];
  editor.state.doc.forEach((node) => {
    sections.push({
      attrs: { kind: node.attrs.kind as SectionKind, label: node.attrs.label as string | null },
    });
  });
  return {
    index: here.index,
    count: editor.state.doc.childCount,
    heading: sectionHeadings(sections)[here.index] ?? '',
    kind: here.node.attrs.kind as SectionKind,
    label: here.node.attrs.label as string | null,
  };
}

export const LyricsEditor = React.forwardRef<
  LyricsEditorHandle,
  {
    readonly document: LyricsDocument;
    readonly editable: boolean;
    /** The editing surface's accessible name, e.g. "Lyrics for Headlights". */
    readonly label: string;
    readonly describedBy?: string;
    readonly onChange: (document: LyricsDocument) => void;
    readonly onBlur?: () => void;
    /** Present when editing together; the document then comes from `collaboration.doc`. */
    readonly collaboration?: EditorCollaboration | null;
    /** The song these lyrics belong to, for timestamps and follow-along (task `083`). */
    readonly timing?: LyricsTiming | null;
    /**
     * Full-screen on a phone (task `085`): the section controls dock above the on-screen
     * keyboard (`inset` pixels up from the bottom), and the caret is kept visible in `scroller`.
     */
    readonly dock?: {
      readonly inset: number;
      readonly scroller: React.RefObject<HTMLElement | null>;
    } | null;
    /** Called when the writing surface gains focus — a phone enters full screen then. */
    readonly onFocus?: () => void;
    /** Told the live editor once it exists (and null when it goes). */
    readonly onEditor?: (editor: Editor | null) => void;
    /** Lyric comments to mark in the text (task `092`). */
    readonly commentAnchors?: {
      readonly threads: readonly AnchorThread[];
      readonly active: string | null;
      readonly onOpen: (threadId: string) => void;
    } | null;
  }
>(function LyricsEditor(
  {
    document,
    editable,
    label,
    describedBy,
    onChange,
    onBlur,
    collaboration = null,
    timing = null,
    dock = null,
    onFocus,
    commentAnchors = null,
    onEditor,
  },
  ref,
) {
  const change = React.useRef(onChange);
  const blur = React.useRef(onBlur);
  const focus = React.useRef(onFocus);
  const [timingMessage, setTimingMessage] = React.useState('');
  // The editor is created once; it reads the latest handlers through these.
  React.useEffect(() => {
    change.current = onChange;
    blur.current = onBlur;
    focus.current = onFocus;
  });
  const timestamps = LyricsTimestamps.configure({ onRefused: setTimingMessage });

  const placeholder = Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node }) => (node.type.name === 'lyricsLine' ? 'Write a line…' : ''),
  });
  const editor = useEditor(
    {
      extensions:
        collaboration === null
          ? [...lyricsExtensions, placeholder, timestamps, LyricCommentAnchors]
          : [
              ...lyricsSchemaExtensions,
              placeholder,
              timestamps,
              LyricCommentAnchors,
              Collaboration.configure({ document: collaboration.doc, field: LYRICS_FRAGMENT }),
              ...(collaboration.awareness === null || collaboration.user === null
                ? []
                : [
                    CollaborationCaret.configure({
                      provider: { awareness: collaboration.awareness },
                      user: collaboration.user,
                      render: renderCaret,
                      // The default appends a hex alpha to the colour, which a CSS variable cannot take.
                      selectionRender: (user: Record<string, unknown>) => ({
                        class: 'lyrics-remote-selection',
                        style: `background-color: color-mix(in srgb, ${String(user.color)} 22%, transparent)`,
                      }),
                    }),
                  ]),
            ],
      // Together, the shared document is the content; alone, the stored one.
      ...(collaboration === null ? { content: toEditorContent(document) } : {}),
      editable,
      // Rendered on the client only: the document arrives by fetch, never in the server HTML.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': label,
          ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
          spellcheck: 'true',
          class: 'lyrics-editor-surface font-lyric',
        },
      },
      onUpdate: ({ editor: current, transaction }) => {
        // Someone else's edit arriving through the room is theirs to save, not this tab's.
        const sync = transaction.getMeta(ySyncPluginKey) as
          { isChangeOrigin?: boolean } | undefined;
        if (sync?.isChangeOrigin === true) return;
        change.current(fromEditorContent(current.getJSON()));
      },
      onBlur: () => blur.current?.(),
      onFocus: () => focus.current?.(),
    },
    // A new shared document (a fresh session after an access change) is a new editor.
    [collaboration?.doc, collaboration?.awareness],
  );

  React.useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  React.useEffect(() => {
    if (editor === null) return;
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Which lyric comments to mark — redrawn whenever the list or the open thread changes.
  React.useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    anchorStorage(editor).set(
      commentAnchors?.threads ?? [],
      commentAnchors?.active ?? null,
      commentAnchors?.onOpen ?? (() => {}),
    );
    editor.view.dispatch(
      editor.state.tr.setMeta(commentAnchorsKey, true).setMeta('addToHistory', false),
    );
  }, [editor, commentAnchors]);

  // Which song timestamps play and stamp from — set on the live editor, not at creation.
  React.useEffect(() => {
    if (editor === null) return;
    timestampStorage(editor).setTiming(timing);
  }, [editor, timing]);

  React.useImperativeHandle(
    ref,
    () => ({
      editor: () => editor,
      replace(next) {
        // Together there is nothing to replace: the room is already the newest version.
        if (collaboration !== null) return;
        editor?.commands.setContent(toEditorContent(next), { emitUpdate: false });
      },
    }),
    [editor, collaboration],
  );

  const section = useEditorState({
    editor,
    selector: ({ editor: current }) => sectionState(current),
  });

  useFollowAlong(editor, timing?.songId ?? null, usePrefersReducedMotion());

  // The docked controls are about 64 px tall; the caret must clear them and the keyboard.
  const emptyScroller = React.useRef<HTMLElement | null>(null);
  useKeepCaretVisible(editor, dock?.scroller ?? emptyScroller, {
    enabled: dock !== null,
    inset: dock?.inset ?? 0,
    reserved: (dock?.inset ?? 0) + 72,
  });

  return (
    <div className="flex flex-col gap-3">
      {editable && editor !== null ? (
        <SectionToolbar
          editor={editor}
          section={section}
          timed={timing !== null}
          timingMessage={timingMessage}
          onTimingMessage={setTimingMessage}
          docked={dock === null ? null : dock.inset}
        />
      ) : null}
      <div
        className={cn(
          'lyrics-editor border-border-subtle bg-card rounded-md border px-5 py-4 md:px-8 md:py-6',
          // Room below the last line for the docked controls, so they never cover the writing.
          dock !== null && 'max-md:mb-24 max-md:rounded-none max-md:border-x-0',
          'focus-within:outline-ring focus-within:outline-2 focus-within:outline-offset-2',
          !editable && 'bg-transparent',
        )}
      >
        <EditorContent editor={editor} />
      </div>
      {editable ? (
        <details className="text-caption text-muted-foreground font-sans">
          <summary className={cn('w-fit cursor-pointer rounded-sm', focusRing)}>
            Keyboard shortcuts
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {LYRICS_SHORTCUTS.map((shortcut) => (
              <React.Fragment key={shortcut.keys}>
                <dt>
                  <kbd className="font-mono">{spokenKeys(shortcut.keys)}</kbd>
                </dt>
                <dd className="m-0">{shortcut.action}</dd>
              </React.Fragment>
            ))}
          </dl>
          <p className="mt-2">
            Timestamps belong to the song, not to one version. Where versions differ in timing, a
            timestamp set on one is only approximate on another.
          </p>
        </details>
      ) : null}
    </div>
  );
});

function SectionToolbar({
  editor,
  section,
  timed,
  timingMessage,
  onTimingMessage,
  docked,
}: {
  readonly editor: Editor;
  readonly section: SectionState | null;
  readonly timed: boolean;
  readonly timingMessage: string;
  readonly onTimingMessage: (message: string) => void;
  /** Docked above the keyboard on a phone, this many pixels up; null when inline. */
  readonly docked: number | null;
}) {
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const kindId = React.useId();
  const nameId = React.useId();
  const heading = section?.heading ?? '';

  function startRename() {
    setName(section?.label ?? heading);
    setRenaming(true);
  }

  function finishRename(save: boolean) {
    if (save) editor.chain().focus().renameSection(name).run();
    else editor.commands.focus();
    setRenaming(false);
  }

  return (
    <div
      role="toolbar"
      aria-label="Section"
      data-docked={docked === null ? undefined : 'true'}
      style={docked === null ? undefined : { bottom: docked }}
      className={cn(
        'border-border-subtle flex flex-wrap items-center gap-2 border-b pb-2 font-sans',
        // A thumb's reach on a phone: every control 44 px.
        'max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_select]:h-11',
        docked !== null &&
          'bg-background max-md:fixed max-md:inset-x-0 max-md:z-50 max-md:flex-nowrap max-md:overflow-x-auto max-md:border-t max-md:border-b-0 max-md:px-2 max-md:py-2',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Plus aria-hidden />
            Add section
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {SECTION_KINDS.map((kind) => (
            <DropdownMenuItem
              key={kind}
              onSelect={() => editor.chain().focus().insertSection(kind).run()}
            >
              <span className="flex-1">
                {kind === 'freeform' ? 'Freeform' : SECTION_LABELS[kind]}
              </span>
              <kbd className="text-muted-foreground font-mono text-xs">
                {spokenKeys(`Mod-Alt-${SHORTCUT_KEYS[kind] ?? ''}`)}
              </kbd>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {section === null ? null : renaming ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            finishRename(true);
          }}
        >
          <label htmlFor={nameId} className="text-caption text-muted-foreground">
            Name for {heading}
          </label>
          <input
            id={nameId}
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                finishRename(false);
              }
            }}
            className={cn(
              'border-border bg-card text-body h-8 w-44 rounded-md border px-2',
              focusRing,
            )}
          />
          <Button type="submit" size="sm" variant="primary">
            Save name
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => finishRename(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <p className="text-caption text-muted-foreground" aria-live="polite">
            In <span className="text-foreground font-medium">{heading}</span>
          </p>
          <label htmlFor={kindId} className="sr-only">
            Type of {heading}
          </label>
          <select
            id={kindId}
            value={section.kind}
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .setSectionKind(event.target.value as SectionKind)
                .run()
            }
            className={cn(
              'border-border bg-card text-caption h-8 rounded-md border px-2',
              focusRing,
            )}
          >
            {SECTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === 'freeform' ? 'Freeform' : SECTION_LABELS[kind]}
              </option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={startRename}>
            <Pencil aria-hidden />
            Rename
          </Button>
          <ToolbarIcon
            label={`Move ${heading} up`}
            disabled={section.index === 0}
            onClick={() => editor.chain().focus().moveSection(-1).run()}
          >
            <ArrowUp aria-hidden />
          </ToolbarIcon>
          <ToolbarIcon
            label={`Move ${heading} down`}
            disabled={section.index >= section.count - 1}
            onClick={() => editor.chain().focus().moveSection(1).run()}
          >
            <ArrowDown aria-hidden />
          </ToolbarIcon>
          <ToolbarIcon
            label={`Duplicate ${heading}`}
            onClick={() => editor.chain().focus().duplicateSection().run()}
          >
            <Copy aria-hidden />
          </ToolbarIcon>
          <ToolbarIcon
            label={`Delete ${heading}`}
            onClick={() => editor.chain().focus().deleteSection().run()}
          >
            <Trash2 aria-hidden />
          </ToolbarIcon>
          {timed ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                title={spokenKeys('Mod-Alt-t')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onTimingMessage('');
                  editor.chain().focus().stampLine().run();
                }}
              >
                <Clock aria-hidden />
                Time this line
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={spokenKeys('Mod-Alt-Shift-t')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onTimingMessage('');
                  editor.chain().focus().stampSection().run();
                }}
              >
                <Clock aria-hidden />
                Time {heading}
              </Button>
              <ToolbarIcon
                label="Clear this line’s time"
                onClick={() => editor.chain().focus().setLineTimestamp(null).run()}
              >
                <X aria-hidden />
              </ToolbarIcon>
            </>
          ) : null}
        </>
      )}
      <p aria-live="polite" className="text-caption text-muted-foreground basis-full empty:hidden">
        {timingMessage}
      </p>
    </div>
  );
}

function ToolbarIcon({
  label,
  onClick,
  disabled = false,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Keep the cursor where it is: a mouse press on a toolbar button must not blur the editor
      // into a different section before the command runs.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
