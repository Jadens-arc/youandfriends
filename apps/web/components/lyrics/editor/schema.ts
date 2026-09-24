import { Extension, Node, type CommandProps, type Editor, type JSONContent } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema, Slice } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { UndoRedo } from '@tiptap/extensions';
import {
  EMPTY_LYRICS,
  SECTION_KINDS,
  sectionHeadings,
  type LyricsDocument,
  type SectionKind,
} from '@youandfriends/contracts';

import { lyricsToText, textToLyrics } from '@/lib/lyrics/text-format';

/**
 * The lyrics editor's schema (task `081`) — deliberately closed. A document is sections, a
 * section is lines, a line is plain text with **no marks**. Nothing else can exist in it: no
 * paragraphs, lists, links, images, or HTML, because the stored document is also projected to
 * plain text, anchored by timestamps (task `083`), and shown in search results and notifications.
 *
 * Pasting and dropping never go through ProseMirror's HTML parser: they read `text/plain` only,
 * strip what the contract forbids, and infer structure from bracketed headings (`[Chorus]`).
 *
 * Section headings — "Verse 1", "Verse 2" — are derived from order by `sectionHeadings` and drawn
 * as decorations, so a reorder renumbers everything and nothing stale is ever stored.
 */

/** A line longer than this is not saved (the contract's bound); pasted text is cut to fit. */
export const MAX_LINE_CHARACTERS = 2_000;

const LyricsDoc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'lyricsSection+',
});

const LyricsText = Node.create({
  name: 'text',
  group: 'inline',
});

const LyricsLine = Node.create({
  name: 'lyricsLine',
  content: 'text*',
  marks: '',
  defining: true,
  addAttributes() {
    return {
      timestampMs: { default: null, rendered: false, keepOnSplit: false },
    };
  },
  parseHTML() {
    return [{ tag: 'p[data-lyrics-line]' }];
  },
  renderHTML() {
    return ['p', { 'data-lyrics-line': '', class: 'lyrics-line' }, 0];
  },
});

const LyricsSection = Node.create({
  name: 'lyricsSection',
  content: 'lyricsLine+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      kind: { default: 'verse', rendered: false },
      label: { default: null, rendered: false },
      timestampMs: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-lyrics-section]' }];
  },
  renderHTML() {
    return ['section', { 'data-lyrics-section': '' }, 0];
  },
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('section');
      dom.className = 'lyrics-section';
      dom.dataset.lyricsSection = '';
      const heading = document.createElement('p');
      heading.contentEditable = 'false';
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '3');
      heading.className = 'lyrics-section-heading';
      const contentDOM = document.createElement('div');
      contentDOM.className = 'lyrics-section-lines';
      dom.append(heading, contentDOM);
      const paint = (current: PMNode, decos: readonly { spec: unknown }[]) => {
        dom.dataset.kind = String(current.attrs.kind);
        const spec = decos.find(
          (deco) => typeof (deco.spec as { heading?: unknown }).heading === 'string',
        );
        heading.textContent = (spec?.spec as { heading: string } | undefined)?.heading ?? '';
      };
      paint(node, decorations);
      return {
        dom,
        contentDOM,
        update(next, nextDecorations) {
          if (next.type.name !== 'lyricsSection') return false;
          paint(next, nextDecorations);
          return true;
        },
        // The heading is chrome, not content: clicks on it must not become selections in it.
        stopEvent: (event) => heading.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) => heading.contains(mutation.target),
      };
    };
  },
});

const headingsKey = new PluginKey('lyricsSectionHeadings');

function headingDecorations(doc: PMNode): DecorationSet {
  const sections: { attrs: { kind: SectionKind; label: string | null } }[] = [];
  doc.forEach((node) => {
    sections.push({
      attrs: { kind: node.attrs.kind as SectionKind, label: node.attrs.label as string | null },
    });
  });
  const headings = sectionHeadings(sections);
  const decorations: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    const heading = headings[index] ?? '';
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, { 'data-heading': heading }, { heading }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** Where the cursor is: the section around it, its index, and its position. */
export function currentSection(state: EditorState): {
  readonly node: PMNode;
  readonly index: number;
  readonly pos: number;
} | null {
  const { $from } = state.selection;
  if ($from.depth < 1) return null;
  const index = $from.index(0);
  const node = state.doc.child(index);
  return { node, index, pos: $from.before(1) };
}

function emptySection(schema: Schema, kind: SectionKind, label: string | null = null): PMNode {
  return schema.nodes.lyricsSection!.create({ kind, label }, schema.nodes.lyricsLine!.create());
}

/** Put the cursor at the start of the section beginning at `pos`. */
function cursorInto(tr: Transaction, pos: number, atEnd = false) {
  const section = tr.doc.nodeAt(pos);
  if (section === null) return tr;
  const target = atEnd ? pos + section.nodeSize - 2 : pos + 2;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(target), atEnd ? -1 : 1));
}

/** Remove what the contract forbids from pasted text: control characters and bidi overrides. */
export function cleanPastedText(text: string): string {
  let out = '';
  for (const character of text.replace(/\r\n?/g, '\n')) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) {
      out += character;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    out += character;
  }
  return out;
}

function lineNode(schema: Schema, text: string): PMNode {
  const clipped = text.slice(0, MAX_LINE_CHARACTERS);
  return schema.nodes.lyricsLine!.create(null, clipped === '' ? null : schema.text(clipped));
}

const HEADING_LINE = /^\s*\[.{1,80}\]\s*$/m;

/**
 * Insert pasted plain text. Without bracketed headings it becomes lines at the cursor, like
 * typing them; with headings it becomes whole sections after the current one (or in place of it,
 * when it is empty). Never HTML — the caller hands over `text/plain` only.
 */
export function insertPastedText(view: EditorView, raw: string): boolean {
  const text = cleanPastedText(raw);
  if (text === '') return true;
  const { state } = view;
  const { schema } = state;
  if (!HEADING_LINE.test(text)) {
    const lines = text.split('\n').map((line) => lineNode(schema, line));
    view.dispatch(
      state.tr.replaceSelection(new Slice(Fragment.from(lines), 1, 1)).scrollIntoView(),
    );
    return true;
  }
  const parsed = textToLyrics(text);
  const sections = parsed.content.map((section) =>
    schema.nodes.lyricsSection!.create(
      { kind: section.attrs.kind, label: section.attrs.label ?? null },
      section.content.map((line) =>
        lineNode(schema, (line.content ?? []).map((node) => node.text).join('')),
      ),
    ),
  );
  if (sections.length === 0) return true;
  const here = currentSection(state);
  let tr = state.tr;
  let at: number;
  if (here === null) {
    at = state.doc.content.size;
    tr = tr.insert(at, sections);
  } else if (here.node.textContent === '' && here.node.childCount === 1) {
    at = here.pos;
    tr = tr.replaceWith(here.pos, here.pos + here.node.nodeSize, sections);
  } else {
    at = here.pos + here.node.nodeSize;
    tr = tr.insert(at, sections);
  }
  const end = at + sections.reduce((size, node) => size + node.nodeSize, 0);
  // The cursor lands at the end of the last pasted line, where typing would continue.
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end - 2), -1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** What a copy puts on the clipboard: the bracketed text format, so a paste restores structure. */
function serializeSlice(slice: Slice): string {
  const sections: LyricsDocument['content'] = [];
  const loose: string[] = [];
  slice.content.forEach((node) => {
    if (node.type.name === 'lyricsSection') {
      const json = node.toJSON() as LyricsDocument['content'][number];
      sections.push(json);
    } else {
      loose.push(node.textContent);
    }
  });
  if (sections.length === 0) return loose.join('\n');
  // A selection inside one section copies its lines, not a heading the reader did not select.
  if (sections.length === 1 && slice.openStart > 0) {
    return (sections[0]?.content ?? [])
      .map((line) => (line.content ?? []).map((node) => node.text).join(''))
      .join('\n');
  }
  return lyricsToText({ type: 'doc', content: sections });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lyricsSections: {
      /** Add an empty section after the current one and move into it. */
      insertSection: (kind?: SectionKind) => ReturnType;
      moveSection: (direction: -1 | 1) => ReturnType;
      duplicateSection: () => ReturnType;
      deleteSection: () => ReturnType;
      /** Name the section; `null` or blank returns it to its numbered kind name. */
      renameSection: (label: string | null) => ReturnType;
      setSectionKind: (kind: SectionKind) => ReturnType;
      /** Move the cursor to the start of the previous or next section. */
      goToSection: (direction: -1 | 1) => ReturnType;
    };
  }
}

type Run = (props: CommandProps) => boolean;

const insertSection =
  (kind: SectionKind = 'verse'): Run =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    const at = here === null ? state.doc.content.size : here.pos + here.node.nodeSize;
    if (dispatch) {
      tr.insert(at, emptySection(state.schema, kind));
      cursorInto(tr, at).scrollIntoView();
    }
    return true;
  };

const moveSection =
  (direction: -1 | 1): Run =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null) return false;
    const target = here.index + direction;
    if (target < 0 || target >= state.doc.childCount) return false;
    if (dispatch) {
      const offset = state.selection.from - here.pos;
      const neighbour = state.doc.child(target);
      tr.delete(here.pos, here.pos + here.node.nodeSize);
      const insertAt =
        direction === -1 ? here.pos - neighbour.nodeSize : here.pos + neighbour.nodeSize;
      tr.insert(insertAt, here.node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + offset)));
      tr.scrollIntoView();
    }
    return true;
  };

const duplicateSection: () => Run =
  () =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null) return false;
    if (dispatch) {
      const at = here.pos + here.node.nodeSize;
      // A copy is the same words, not the same moment: timestamps stay with the original.
      const copy = here.node.type.create(
        { ...here.node.attrs, timestampMs: null },
        Fragment.fromArray(
          Array.from({ length: here.node.childCount }, (_, i) => {
            const line = here.node.child(i);
            return line.type.create({ ...line.attrs, timestampMs: null }, line.content);
          }),
        ),
      );
      tr.insert(at, copy);
      cursorInto(tr, at).scrollIntoView();
    }
    return true;
  };

const deleteSection: () => Run =
  () =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null) return false;
    if (dispatch) {
      if (state.doc.childCount === 1) {
        tr.replaceWith(
          here.pos,
          here.pos + here.node.nodeSize,
          emptySection(state.schema, 'verse'),
        );
        cursorInto(tr, 0);
      } else {
        tr.delete(here.pos, here.pos + here.node.nodeSize);
        if (here.index > 0) {
          const previous = state.doc.child(here.index - 1);
          cursorInto(tr, here.pos - previous.nodeSize, true);
        } else {
          cursorInto(tr, 0);
        }
      }
      tr.scrollIntoView();
    }
    return true;
  };

const renameSection =
  (label: string | null): Run =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null) return false;
    const clean = cleanPastedText(label ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (dispatch) tr.setNodeAttribute(here.pos, 'label', clean === '' ? null : clean);
    return true;
  };

const setSectionKind =
  (kind: SectionKind): Run =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null || !SECTION_KINDS.includes(kind)) return false;
    if (dispatch) tr.setNodeAttribute(here.pos, 'kind', kind);
    return true;
  };

const goToSection =
  (direction: -1 | 1): Run =>
  ({ state, tr, dispatch }) => {
    const here = currentSection(state);
    if (here === null) return false;
    const target = here.index + direction;
    if (target < 0 || target >= state.doc.childCount) return false;
    if (dispatch) {
      const pos =
        direction === -1
          ? here.pos - state.doc.child(target).nodeSize
          : here.pos + here.node.nodeSize;
      cursorInto(tr, pos).scrollIntoView();
    }
    return true;
  };

/** Keyboard shortcuts, as the help line and the shortcut list say them. */
export const LYRICS_SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Mod-Enter', action: 'New section after this one' },
  { keys: 'Mod-Alt-1 … 6', action: 'New Verse, Pre-Chorus, Chorus, Bridge, Intro, Outro' },
  { keys: 'Mod-Alt-0', action: 'New freeform section' },
  { keys: 'Alt-ArrowUp / Alt-ArrowDown', action: 'Previous / next section' },
  { keys: 'Mod-Shift-ArrowUp / Mod-Shift-ArrowDown', action: 'Move this section up / down' },
  { keys: 'Mod-Shift-d', action: 'Duplicate this section' },
  { keys: 'Backspace in an empty section', action: 'Delete it' },
  { keys: 'Mod-z / Mod-Shift-z', action: 'Undo / redo' },
];

const KIND_DIGITS: readonly [string, SectionKind][] = [
  ['1', 'verse'],
  ['2', 'pre_chorus'],
  ['3', 'chorus'],
  ['4', 'bridge'],
  ['5', 'intro'],
  ['6', 'outro'],
  ['0', 'freeform'],
];

const LyricsSections = Extension.create({
  name: 'lyricsSections',
  addCommands() {
    return {
      insertSection,
      moveSection,
      duplicateSection,
      deleteSection,
      renameSection,
      setSectionKind,
      goToSection,
    };
  },
  addKeyboardShortcuts() {
    const shortcuts: Record<string, (props: { editor: Editor }) => boolean> = {
      'Mod-Enter': ({ editor }) => editor.commands.insertSection('verse'),
      'Alt-ArrowUp': ({ editor }) => editor.commands.goToSection(-1),
      'Alt-ArrowDown': ({ editor }) => editor.commands.goToSection(1),
      'Mod-Shift-ArrowUp': ({ editor }) => editor.commands.moveSection(-1),
      'Mod-Shift-ArrowDown': ({ editor }) => editor.commands.moveSection(1),
      'Mod-Shift-d': ({ editor }) => editor.commands.duplicateSection(),
      Backspace: ({ editor }) => {
        const { state } = editor;
        const here = currentSection(state);
        if (here === null || !state.selection.empty) return false;
        if (here.node.childCount !== 1 || here.node.textContent !== '') return false;
        if (state.doc.childCount === 1) return false;
        return editor.commands.deleteSection();
      },
    };
    for (const [digit, kind] of KIND_DIGITS) {
      shortcuts[`Mod-Alt-${digit}`] = ({ editor }) => editor.commands.insertSection(kind);
    }
    return shortcuts;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: headingsKey,
        state: {
          init: (_, state) => headingDecorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? headingDecorations(tr.doc) : previous),
        },
        props: {
          decorations: (state) => headingsKey.getState(state) as DecorationSet,
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain') ?? '';
            return insertPastedText(view, text);
          },
          handleDrop: (view, event, _slice, moved) => {
            // A section dragged within the editor is already clean; anything from outside is
            // read as plain text only.
            if (moved) return false;
            event.preventDefault();
            const text = event.dataTransfer?.getData('text/plain') ?? '';
            return insertPastedText(view, text);
          },
          // Belt and braces: should any path reach the HTML parser, it gets nothing to parse.
          transformPastedHTML: () => '',
          clipboardTextSerializer: serializeSlice,
        },
      }),
    ];
  },
});

export const lyricsExtensions = [
  LyricsDoc,
  LyricsText,
  LyricsLine,
  LyricsSection,
  LyricsSections,
  UndoRedo,
];

/** Stored document → editor content. The editor always has a section to type into. */
export function toEditorContent(document: LyricsDocument): JSONContent {
  // The contract's types are exact where Tiptap's are loose; the shapes are the same.
  if (document.content.length > 0) return document as unknown as JSONContent;
  return {
    type: 'doc',
    content: [
      {
        type: 'lyricsSection',
        attrs: { kind: 'verse', label: null },
        content: [{ type: 'lyricsLine' }],
      },
    ],
  };
}

/** Editor content → stored document. An untouched empty verse is no lyrics at all. */
export function fromEditorContent(json: unknown): LyricsDocument {
  const document = json as LyricsDocument;
  const only = document.content[0];
  if (
    document.content.length === 1 &&
    only !== undefined &&
    only.attrs.kind === 'verse' &&
    (only.attrs.label ?? null) === null &&
    only.content.every((line) => (line.content ?? []).length === 0) &&
    only.content.length === 1
  ) {
    return EMPTY_LYRICS;
  }
  return document;
}
