/**
 * Snapshots — the frozen record, and variance against it.
 *
 * The content hash is shown, truncated, on every row. A compliance snapshot's
 * whole value is that it cannot change quietly; displaying the hash is what lets
 * a user verify that claim rather than take it on trust.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type SnapshotSummary, type VarianceReport } from '../api.js';
import { Amount, Card, Chip, Delta } from '../components/primitives.js';

/**
 * The most recent fully-elapsed day.
 *
 * A custom snapshot is taken as of the END of its date, so asking for today
 * means asking for a moment that has not happened — the domain refuses it, and
 * rightly: today's closing position is not yet knowable. Defaulting to yesterday
 * makes the default action succeed instead of teaching the user that the button
 * is broken.
 */
function latestCompleteDay(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function Snapshots() {
  const [asOf, setAsOf] = useState<string>(latestCompleteDay);
  const [snapshots, setSnapshots] = useState<readonly SnapshotSummary[] | undefined>();
  const [variance, setVariance] = useState<VarianceReport | undefined>();
  const [comparing, setComparing] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await api.snapshots();
    if (result.ok) setSnapshots(result.value.snapshots);
    else setError(result.error.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await api.createSnapshot(asOf);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }, [asOf, load]);

  const compare = useCallback(async (snapshotId: string): Promise<void> => {
    setError(undefined);
    setComparing(snapshotId);
    const result = await api.compareToLive(snapshotId);
    if (result.ok) setVariance(result.value);
    else {
      setVariance(undefined);
      setError(result.error.message);
    }
  }, []);

  return (
    <div className="pt-stack">
      <Card
        title="Snapshots"
        action={
          <button type="button" className="pt-button-inline" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create snapshot'}
          </button>
        }
      >
        <p className="pt-muted">
          Statutory snapshots freeze on 31 March (domestic) and 31 December (foreign). A frozen
          snapshot is never rewritten — re-running the scheduler returns the existing one.
        </p>

        <div className="pt-controls">
          <label htmlFor="as-of">As of</label>
          <input
            id="as-of"
            type="date"
            value={asOf}
            max={latestCompleteDay()}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
          <span className="pt-muted">
            A snapshot covers a whole day, so the latest available date is yesterday.
          </span>
        </div>

        {error !== undefined && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}

        <div className="pt-table-scroll">
          <table className="pt-table" data-testid="snapshot-list">
            <thead>
              <tr>
                <th scope="col">Snapshot</th>
                <th scope="col">Kind</th>
                <th scope="col">Scope</th>
                <th scope="col">As of</th>
                <th scope="col">Content hash</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {snapshots === undefined && (
                <tr>
                  <td colSpan={6} className="pt-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {snapshots?.length === 0 && (
                <tr>
                  <td colSpan={6} className="pt-muted">
                    No snapshots yet.
                  </td>
                </tr>
              )}
              {snapshots?.map((snapshot) => (
                <tr key={snapshot.snapshotId}>
                  <td>{snapshot.snapshotId}</td>
                  <td>{snapshot.kind}</td>
                  <td>{snapshot.scope}</td>
                  <td>{snapshot.asOf.slice(0, 10)}</td>
                  <td className="pt-numeric pt-hash">{snapshot.contentHash.slice(0, 12)}…</td>
                  <td className="pt-align-end">
                    <button
                      type="button"
                      className="pt-link pt-link--inline"
                      onClick={() => void compare(snapshot.snapshotId)}
                    >
                      Compare to live
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {variance !== undefined && (
        <Card
          title="Variance against live"
          action={comparing === undefined ? undefined : <Chip>{comparing}</Chip>}
        >
          <dl className="pt-stats">
            <div>
              <dt>Then</dt>
              <dd>
                <Amount value={variance.netWorthBefore} />
              </dd>
            </div>
            <div>
              <dt>Now</dt>
              <dd>
                <Amount value={variance.netWorthAfter} />
              </dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd>
                <Delta value={variance.netWorthDelta} />
              </dd>
            </div>
            <div>
              <dt>Change %</dt>
              <dd className="pt-numeric">{variance.netWorthDeltaPct}%</dd>
            </div>
          </dl>

          <div className="pt-table-scroll">
            <table className="pt-table" data-testid="variance-table">
              <thead>
                <tr>
                  <th scope="col">Movement</th>
                  <th scope="col">Asset</th>
                  <th scope="col" className="pt-align-end">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {variance.positions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="pt-muted">
                      Nothing moved between the snapshot and now.
                    </td>
                  </tr>
                )}
                {variance.positions.map((row) => (
                  <tr key={row.assetId}>
                    <td>{row.bucket.replaceAll('_', ' ').toLowerCase()}</td>
                    <td>{row.assetId}</td>
                    <td className="pt-align-end">
                      <Delta value={row.valueDelta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
