/**
 * Key derivation for the vault (ADR-014).
 *
 * Argon2id via @noble/hashes — a pure-JS, audited implementation. Chosen over the
 * native `argon2` binding deliberately: the vault must open on any host the
 * container runs on, and a native KDF is one more thing that can fail to build for
 * a given libc/ABI combination.
 *
 * The derived key is a raw 32-byte value handed straight to the page cipher. It is
 * never written to disk and is zeroised on lock.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';

/**
 * OWASP's recommended Argon2id baseline (19 MiB, t=2, p=1). Stored alongside the
 * salt in the vault metadata so parameters can be raised later without stranding
 * existing vaults.
 */
export const KDF_PARAMS = { t: 2, m: 19_456, p: 1, dkLen: 32 } as const;

export interface KdfParams {
  readonly t: number;
  readonly m: number;
  readonly p: number;
  readonly dkLen: number;
}

export function newSalt(): Uint8Array {
  return new Uint8Array(randomBytes(16));
}

export function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = KDF_PARAMS,
): Uint8Array {
  return argon2id(passphrase, salt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
  });
}

/**
 * Overwrites key material in place. JavaScript cannot guarantee the allocator has
 * not already copied the buffer, so this is defence in depth rather than a proof —
 * the primary guarantee is that the key is never persisted in the first place.
 */
export function zeroise(buffer: Uint8Array): void {
  buffer.fill(0);
}

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
