/**
 * Argon2id in a worker thread.
 *
 * The KDF is CPU-bound and deliberately expensive (~350 ms at the OWASP
 * baseline). Run on the main thread it blocks Node's event loop for that whole
 * time, so a single unlock stalls EVERY other request — health checks included —
 * and two unlocks queue rather than overlap. Measured: ten unlocks took
 * 0.35s, 0.70s, 1.05s … 3.50s, exactly serialized, and a health probe issued
 * mid-unlock took 0.31s against 0.001s idle.
 *
 * Plain `.mjs`, loaded by path rather than compiled: a worker entry point has to
 * be a real file on disk at runtime, which a bundled build would not leave.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { parentPort, workerData } from 'node:worker_threads';

const { passphrase, salt, params } = workerData;

const key = argon2id(passphrase, new Uint8Array(salt), {
  t: params.t,
  m: params.m,
  p: params.p,
  dkLen: params.dkLen,
});

// Transferred, not copied: the buffer leaves this thread entirely.
const out = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
parentPort.postMessage(out, [out]);
