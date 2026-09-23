/**
 * What kind of file something *looks like*, from its name (task `057`). Presentational only —
 * an icon and a filter. Never a security decision: the server derives real content types from
 * the bytes (task `051`), and a `.wav` that is not a WAV is still served as a download.
 */
export const FILE_TYPES = ['audio', 'archive', 'midi', 'image', 'document', 'other'] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABELS: Readonly<Record<FileType, string>> = {
  audio: 'Audio',
  archive: 'Project & archive',
  midi: 'MIDI',
  image: 'Image',
  document: 'Document',
  other: 'Other',
};

const BY_EXTENSION: ReadonlyArray<readonly [RegExp, FileType]> = [
  [/\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus|caf)$/i, 'audio'],
  [/\.(zip|logicx|xpj|als|ptx|flp|rpp|cpr|song|band|tar|gz|7z|rar)$/i, 'archive'],
  [/\.(mid|midi)$/i, 'midi'],
  [/\.(png|jpe?g|gif|webp|heic|tiff?)$/i, 'image'],
  [/\.(txt|md|pdf|rtf|docx?|pages|csv)$/i, 'document'],
];

export function fileTypeOf(name: string): FileType {
  for (const [pattern, type] of BY_EXTENSION) if (pattern.test(name)) return type;
  return 'other';
}
