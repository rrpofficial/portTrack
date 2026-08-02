/**
 * US-8.8 — Backup, restore and export (PRD NFR-1)
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backup, SnapshotRepository, Vault } from '@porttrack/persistence';
import { expectOk } from '@porttrack/test-kit';

const dir = () => mkdtempSync(join(tmpdir(), 'porttrack-backup-'));

describe('US-8.8 Scenario: Encrypted backup round-trips exactly', () => {
  it('produces a backup artifact on disk', async () => {
    const source = dir();
    expectOk(await Vault.open({ dataDir: source, fileName: 'vault.db' }));
    const path = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    expect(existsSync(path)).toBe(true);
  });

  it('restores every snapshot with an identical contentHash', async () => {
    const source = dir();
    expectOk(await Vault.open({ dataDir: source, fileName: 'vault.db' }));
    const before = await SnapshotRepository.listIds();
    const hashesBefore = await Promise.all(
      before.map(async (id) => (await SnapshotRepository.findById(id))?.contentHash),
    );

    const archive = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    const target = dir();
    expectOk(await Backup.restore(archive, target));
    expectOk(await Vault.open({ dataDir: target, fileName: 'vault.db' }));

    const after = await SnapshotRepository.listIds();
    const hashesAfter = await Promise.all(
      after.map(async (id) => (await SnapshotRepository.findById(id))?.contentHash),
    );
    expect(after).toEqual(before);
    expect(hashesAfter).toEqual(hashesBefore);
  });

  it('keeps the backup encrypted at rest', async () => {
    const archive = expectOk(await Backup.backup(join(dir(), 'backup.ptb')));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(archive, 'latin1')).not.toContain('ABCDE1234F');
  });
});
