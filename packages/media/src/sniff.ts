/**
 * Content typing from the bytes themselves.
 *
 * The client's MIME hint is a claim, not evidence: it comes from the browser's guess at a file
 * extension, and a caller who wants to lie about it simply does. What ends up stored on the
 * version — and therefore what is served back, and what the media pipeline tries to decode — is
 * decided here, from the first bytes of the object as it actually landed (`docs/THREAT_MODEL.md`
 * T4).
 *
 * **The allowlist is the control.** An unrecognized signature is not an error and does not
 * refuse the upload — people keep stranger things next to their songs than we can enumerate,
 * and originals are sacred (`docs/DESIGN.md`). It becomes `application/octet-stream`, which
 * downloads rather than renders. That matters because the alternative is recording a sniffed
 * `text/html` or `image/svg+xml` and handing back a stored-XSS vector under a presigned URL.
 * Nothing outside this table can ever become the stored content type.
 */

/** Bytes needed to identify every signature below. `ftyp` brands sit at offset 8–12. */
export const SNIFF_PREFIX_BYTES = 64;

/** The fallback. Downloads, never renders. */
export const UNKNOWN_CONTENT_TYPE = 'application/octet-stream';

interface Signature {
  readonly contentType: string;
  /** Byte sequences that must all match, each at a fixed offset. */
  readonly at: readonly { readonly offset: number; readonly bytes: string }[];
}

/**
 * Signatures in specificity order: RIFF alone is ambiguous (WAV, AVI, WebP all open `RIFF`), so
 * the form tag at offset 8 is part of the match rather than a detail checked afterwards.
 */
const SIGNATURES: readonly Signature[] = [
  // Uncompressed and lossless — what a master actually arrives as.
  {
    contentType: 'audio/wav',
    at: [
      { offset: 0, bytes: 'RIFF' },
      { offset: 8, bytes: 'WAVE' },
    ],
  },
  {
    contentType: 'audio/aiff',
    at: [
      { offset: 0, bytes: 'FORM' },
      { offset: 8, bytes: 'AIFF' },
    ],
  },
  {
    contentType: 'audio/aiff',
    at: [
      { offset: 0, bytes: 'FORM' },
      { offset: 8, bytes: 'AIFC' },
    ],
  },
  { contentType: 'audio/flac', at: [{ offset: 0, bytes: 'fLaC' }] },
  // Logic writes CAF for long or high-rate recordings, where WAV's 4 GB ceiling runs out.
  { contentType: 'audio/x-caf', at: [{ offset: 0, bytes: 'caff' }] },

  // Compressed references and bounces.
  { contentType: 'audio/mpeg', at: [{ offset: 0, bytes: 'ID3' }] },
  { contentType: 'audio/mp4', at: [{ offset: 4, bytes: 'ftypM4A ' }] },
  { contentType: 'audio/mp4', at: [{ offset: 4, bytes: 'ftypM4B ' }] },
  { contentType: 'video/mp4', at: [{ offset: 4, bytes: 'ftyp' }] },
  { contentType: 'audio/ogg', at: [{ offset: 0, bytes: 'OggS' }] },

  // Project bundles. A Logic project and an MPC program are directories; they arrive zipped.
  // Recorded as ZIP and never expanded server-side (T4).
  //
  // Four bytes, not two, and written as escapes rather than the literal control characters
  // that were here first. `PK` alone is two printable letters plenty of files begin with, so
  // matching on them would call every one of those a zip — and with the raw bytes in the
  // source, `grep` and a diff both rendered these as exactly that bare match. A security
  // review and I each read the bug that was not there; the test below pins the real behaviour.
  // `03 04` opens a local file header, `05 06` an end-of-central-directory record.
  { contentType: 'application/zip', at: [{ offset: 0, bytes: 'PK\x03\x04' }] },
  { contentType: 'application/zip', at: [{ offset: 0, bytes: 'PK\x05\x06' }] },
];

function matchesAt(prefix: Uint8Array, offset: number, bytes: string): boolean {
  if (offset + bytes.length > prefix.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (prefix[offset + i] !== bytes.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * An MPEG audio frame header, for an MP3 with no ID3 tag.
 *
 * Eleven sync bits, then a version and layer that are not the reserved values. The reserved
 * checks are what stop this matching arbitrary binary: without them any byte pair beginning
 * `FF Ex` would be called an MP3, and that is a common enough pattern in compressed data to
 * mistype real files.
 */
function isMpegFrame(prefix: Uint8Array): boolean {
  const b0 = prefix[0];
  const b1 = prefix[1];
  if (b0 === undefined || b1 === undefined) return false;

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  if ((b1 & 0x18) === 0x08) return false; // reserved MPEG version
  if ((b1 & 0x06) === 0x00) return false; // reserved layer
  return true;
}

/**
 * The content type to store, from the object's first bytes.
 *
 * Returns `application/octet-stream` for anything not in the table above — including an empty
 * or truncated prefix. Never returns a type the client supplied.
 */
export function sniffContentType(prefix: Uint8Array): string {
  for (const signature of SIGNATURES) {
    if (signature.at.every(({ offset, bytes }) => matchesAt(prefix, offset, bytes))) {
      return signature.contentType;
    }
  }

  if (isMpegFrame(prefix)) return 'audio/mpeg';

  return UNKNOWN_CONTENT_TYPE;
}

/** True when the stored bytes turned out to be something other than what the client claimed. */
export function hintDisagrees(hint: string | null, sniffed: string): boolean {
  if (hint === null || hint === '') return false;
  return hint.split(';')[0]?.trim().toLowerCase() !== sniffed;
}
