/**
 * PDF standard security handler (US-4.2, NFR-1).
 *
 * Implements the /V 2 /R 3 (RC4-128) scheme from PDF Reference 1.7 §7.6.3 —
 * algorithms 2 (file key), 4/5 (the /U entry) and 6 (password verification).
 *
 * Written rather than pulled in because the alternative was a native PDF library:
 * this runs inside a pure domain package with no I/O, and a CAS password must be
 * verifiable without shelling out to a binary that might log it.
 *
 * The password is handled as a short-lived buffer and overwritten by the caller
 * once the key is derived; it is never returned, stored, or placed in an error.
 */
import { createHash } from 'node:crypto';

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...parts: Buffer[]): Buffer =>
  createHash('md5').update(Buffer.concat(parts)).digest();

/**
 * Every index below is masked to 0-255 or bounded by the buffer length, so the
 * zero fallback is unreachable. It exists because `noUncheckedIndexedAccess`
 * types a byte read as possibly-undefined, and a non-null assertion would be a
 * worse answer than a total function.
 */
const byteAt = (bytes: Uint8Array, index: number): number => bytes[index] ?? 0;

export function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + byteAt(s, i) + byteAt(key, i % key.length)) & 0xff;
    const swap = byteAt(s, i);
    s[i] = byteAt(s, j);
    s[j] = swap;
  }

  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + byteAt(s, i)) & 0xff;
    const swap = byteAt(s, i);
    s[i] = byteAt(s, j);
    s[j] = swap;
    out[k] = byteAt(data, k) ^ byteAt(s, (byteAt(s, i) + byteAt(s, j)) & 0xff);
  }
  return out;
}

const padPassword = (password: string): Buffer =>
  Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

/** Algorithm 2 — the file encryption key. */
export function computeFileKey(
  password: string,
  ownerEntry: Buffer,
  permissions: number,
  firstId: Buffer,
  keyLength: number,
): Buffer {
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions, 0);
  let digest = md5(padPassword(password), ownerEntry, p, firstId);
  for (let i = 0; i < 50; i++) digest = md5(digest.subarray(0, keyLength));
  return digest.subarray(0, keyLength);
}

/** Algorithms 4/5 — the expected /U entry for a given file key (R >= 3). */
export function computeUserEntry(fileKey: Buffer, firstId: Buffer): Buffer {
  let out = rc4(fileKey, md5(PAD, firstId));
  for (let i = 1; i <= 19; i++) {
    out = rc4(Buffer.from(fileKey.map((byte) => byte ^ i)), out);
  }
  return out;
}

/**
 * Algorithm 6 — password verification. Only the first 16 bytes of /U are
 * meaningful for R >= 3; the remainder is arbitrary padding.
 */
export function verifyUserPassword(
  password: string,
  ownerEntry: Buffer,
  userEntry: Buffer,
  permissions: number,
  firstId: Buffer,
  keyLength: number,
): { valid: boolean; fileKey: Buffer } {
  const fileKey = computeFileKey(password, ownerEntry, permissions, firstId, keyLength);
  const expected = computeUserEntry(fileKey, firstId);
  return { valid: expected.subarray(0, 16).equals(userEntry.subarray(0, 16)), fileKey };
}

/** Per-object key: MD5(fileKey ‖ objNum[3] ‖ genNum[2]), truncated. */
export function objectKey(fileKey: Buffer, objNum: number, genNum: number): Buffer {
  const extra = Buffer.from([
    objNum & 0xff,
    (objNum >> 8) & 0xff,
    (objNum >> 16) & 0xff,
    genNum & 0xff,
    (genNum >> 8) & 0xff,
  ]);
  return md5(fileKey, extra).subarray(0, Math.min(fileKey.length + 5, 16));
}
