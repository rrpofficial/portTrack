/**
 * Just enough PDF to read an encrypted CAS: locate the /Encrypt dictionary and
 * the document ID, decrypt content streams, and recover the drawn text.
 *
 * Deliberately not a general PDF implementation. It handles the single shape a
 * consolidated account statement takes — uncompressed content streams, RC4
 * encryption, text drawn with Tj — and refuses anything else rather than
 * guessing, because a half-understood statement produces plausible wrong units.
 */
import { objectKey, rc4 } from './standard-security.js';

export interface EncryptInfo {
  readonly ownerEntry: Buffer;
  readonly userEntry: Buffer;
  readonly permissions: number;
  readonly keyLength: number;
  readonly firstId: Buffer;
  readonly revision: number;
}

const hexToBuffer = (hex: string): Buffer => Buffer.from(hex.replace(/\s+/g, ''), 'hex');

export function readEncryptInfo(pdf: Buffer): EncryptInfo | undefined {
  const text = pdf.toString('latin1');

  const encrypt = /\/Filter\s*\/Standard(.*?)>>/s.exec(text);
  if (encrypt === null) return undefined;
  const dict = encrypt[1] ?? '';

  const owner = /\/O\s*<([0-9A-Fa-f\s]+)>/.exec(dict);
  const user = /\/U\s*<([0-9A-Fa-f\s]+)>/.exec(dict);
  const perms = /\/P\s*(-?\d+)/.exec(dict);
  const length = /\/Length\s*(\d+)/.exec(dict);
  const revision = /\/R\s*(\d+)/.exec(dict);
  const id = /\/ID\s*\[\s*<([0-9A-Fa-f\s]+)>/.exec(text);

  if (owner === null || user === null || perms === null || id === null) return undefined;

  return {
    ownerEntry: hexToBuffer(owner[1] ?? ''),
    userEntry: hexToBuffer(user[1] ?? ''),
    permissions: Number(perms[1]),
    keyLength: length === null ? 5 : Number(length[1]) / 8,
    firstId: hexToBuffer(id[1] ?? ''),
    revision: revision === null ? 2 : Number(revision[1]),
  };
}

interface StreamObject {
  readonly objNum: number;
  readonly genNum: number;
  readonly data: Buffer;
}

/**
 * Every `N G obj … stream … endstream`, with its OWN object number.
 *
 * Each stream is scoped to the object that encloses it. Searching forward from an
 * object header to the next `stream` keyword anywhere in the file attributes the
 * stream to the wrong object, and since the decryption key is derived from the
 * object number, that yields silent garbage rather than an error.
 */
export function readStreams(pdf: Buffer): readonly StreamObject[] {
  const text = pdf.toString('latin1');
  const streams: StreamObject[] = [];
  const headers = /(\d+)\s+(\d+)\s+obj\b/g;

  let header: RegExpExecArray | null;
  while ((header = headers.exec(text)) !== null) {
    const objectStart = header.index + header[0].length;
    const objectEnd = text.indexOf('endobj', objectStart);
    const boundary = objectEnd < 0 ? text.length : objectEnd;

    const streamKeyword = /stream\r?\n/g;
    streamKeyword.lastIndex = objectStart;
    const opening = streamKeyword.exec(text);
    if (opening === null || opening.index >= boundary) continue;

    const dataStart = opening.index + opening[0].length;
    const dataEnd = text.indexOf('endstream', dataStart);
    if (dataEnd < 0 || dataEnd > boundary) continue;

    streams.push({
      objNum: Number(header[1]),
      genNum: Number(header[2]),
      data: pdf.subarray(dataStart, dataEnd),
    });
  }
  return streams;
}

export function decryptStream(stream: StreamObject, fileKey: Buffer): Buffer {
  return rc4(objectKey(fileKey, stream.objNum, stream.genNum), stream.data);
}

/**
 * Text drawn by `(…) Tj`. Escapes are unwound so a scheme name containing a
 * bracket survives intact.
 */
export function extractText(contentStream: Buffer): readonly string[] {
  const content = contentStream.toString('latin1');
  const lines: string[] = [];
  const pattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const raw = match[0].slice(1, match[0].lastIndexOf(')'));
    lines.push(raw.replace(/\\([()\\])/g, '$1'));
  }
  return lines;
}
