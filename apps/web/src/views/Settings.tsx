/**
 * Settings — vault state, egress audit and where the data actually lives.
 *
 * The egress log is the user-facing half of ADR-010. An empty log is the correct
 * and expected state for a default install, so it is labelled as such: "no
 * entries" must not read as "logging is broken".
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Chip } from '../components/primitives.js';

export function Settings({ onLocked }: { onLocked: () => void }) {
  const [egressEntries, setEgressEntries] = useState<readonly unknown[] | undefined>();
  const [logLines, setLogLines] = useState<readonly string[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    const [egress, log] = await Promise.all([api.egressLog(), api.applicationLog()]);
    if (egress.ok) setEgressEntries(egress.value.entries);
    if (log.ok) setLogLines(log.value.lines);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lock = useCallback(async (): Promise<void> => {
    const result = await api.lock();
    if (result.ok) onLocked();
    else setError(result.error.message);
  }, [onLocked]);

  return (
    <div className="pt-stack">
      <Card
        title="Vault"
        action={
          <button type="button" className="pt-button-inline" onClick={() => void lock()}>
            Lock vault
          </button>
        }
      >
        <p className="pt-muted">
          Your database is encrypted at rest with page-level AES-256-CBC and HMAC-SHA512, on a disk
          you control. The passphrase is never written anywhere — not to a file, not to a log, not
          to an image layer.
        </p>
        <p className="pt-banner" role="status">
          <strong>Back up the whole data directory, not just vault.db.</strong> The key derivation
          salt lives in <code>vault.db.meta.json</code> beside it. A backup of the database alone
          restores to a vault nobody can open, and you would find out at the worst moment.
        </p>
        {error !== undefined && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}
      </Card>

      <Card
        title="Network egress"
        action={
          <Chip>
            {egressEntries === undefined
              ? 'Loading'
              : egressEntries.length === 0
                ? 'None'
                : `${String(egressEntries.length)} calls`}
          </Chip>
        }
      >
        <p className="pt-muted">
          portTrack makes no outbound request by default. The API container sits on a network with
          no gateway, so this is not the application policing itself — there is no route out.
        </p>
        {egressEntries !== undefined && egressEntries.length === 0 ? (
          <p className="pt-muted" data-testid="egress-log-empty">
            No outbound call has been made. For a default install this is the expected state, not a
            missing log.
          </p>
        ) : (
          <ul className="pt-log" data-testid="egress-log">
            {(egressEntries ?? []).map((entry, index) => (
              <li key={index} className="pt-numeric">
                {JSON.stringify(entry)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Application log">
        <p className="pt-muted">
          Structured and PII-free by construction — a functional test asserts that no PAN, folio or
          account number can reach a log line.
        </p>
        {logLines === undefined || logLines.length === 0 ? (
          <p className="pt-muted">Nothing logged this session.</p>
        ) : (
          <ul className="pt-log" data-testid="application-log">
            {logLines.slice(-50).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
