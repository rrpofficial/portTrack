/**
 * US-8.8 — Backup, restore and export (PRD NFR-1)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backup, SnapshotRepository, Vault } from '@porttrack/persistence';
import { expectOk } from '@porttrack/test-kit';

const PASSPHRASE = 'correct horse battery staple';
const dir = () => mkdtempSync(join(tmpdir(), 'porttrack-backup-'));

/** A vault only exists on disk once it has been unlocked — migrations run then. */
async function openedVault(dataDir = dir()): Promise<string> {
  expectOk(await Vault.open({ dataDir, fileName: 'vault.db' }));
  expectOk(await Vault.unlock(PASSPHRASE));
  return dataDir;
}

describe('US-8.8 Scenario: Encrypted backup round-trips exactly', () => {
  it('produces a backup artifact on disk', async () => {
    await openedVault();
    const path = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    expect(existsSync(path)).toBe(true);
  });

  it('refuses to back up a vault that was never unlocked', async () => {
    expectOk(await Vault.open({ dataDir: dir(), fileName: 'vault.db' }));
    const result = await Backup.backup(join(dir(), 'backup.ptb'));
    expect(result.ok).toBe(false);
  });

  it('restores every snapshot with an identical contentHash', async () => {
    await openedVault();
    const before = await SnapshotRepository.listIds();
    const hashesBefore = await Promise.all(
      before.map(async (id) => (await SnapshotRepository.findById(id))?.contentHash),
    );

    const archive = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    const target = dir();
    expectOk(await Backup.restore(archive, target));
    await Vault.close();
    expectOk(await Vault.open({ dataDir: target, fileName: 'vault.db' }));
    expectOk(await Vault.unlock(PASSPHRASE));

    const after = await SnapshotRepository.listIds();
    const hashesAfter = await Promise.all(
      after.map(async (id) => (await SnapshotRepository.findById(id))?.contentHash),
    );
    expect(after).toEqual(before);
    expect(hashesAfter).toEqual(hashesBefore);
  });

  it('keeps the backup encrypted at rest', async () => {
    await openedVault();
    const archive = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(archive, 'latin1')).not.toContain('ABCDE1234F');
  });
});
