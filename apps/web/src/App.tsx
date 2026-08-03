/**
 * Application shell (US-8.5).
 *
 * Deliberately small: the SPA renders what the API returns and holds no domain
 * logic. Everything shown here is computed server-side by the engines, so the
 * browser cannot disagree with a snapshot or a tax figure.
 */
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { api, type Valuation } from './api.js';
import { Amount, Card, Chip, ProvisionalBanner } from './components/primitives.js';

const SECTIONS = [
  'Dashboard',
  'Ledger',
  'Import',
  'Snapshots',
  'Tax',
  'Compliance',
  'Settings',
] as const;

export function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [valuation, setValuation] = useState<Valuation | undefined>();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Dashboard');

  const refresh = useCallback(async () => {
    const result = await api.valuation();
    if (result.ok) setValuation(result.value);
  }, []);

  useEffect(() => {
    if (unlocked) void refresh();
  }, [unlocked, refresh]);

  const submitUnlock = useCallback(
    async (): Promise<void> => {
      setError(undefined);
      const result = await api.unlock(passphrase);
      if (!result.ok) {
        setError('That passphrase did not unlock the vault.');
        return;
      }
      // Cleared immediately: never held in state longer than the request.
      setPassphrase('');
      setUnlocked(true);
    },
    [passphrase],
  );

  /** React discards a returned promise, so rejections are handled here. */
  function unlock(event: SyntheticEvent): void {
    event.preventDefault();
    void submitUnlock();
  }

  if (!unlocked) {
    return (
      <main className="pt-shell pt-shell--centred">
        <Card title="Unlock your vault">
          <p className="pt-muted">
            Your portfolio is encrypted on this machine. Nothing leaves it without your say-so.
          </p>
          <form onSubmit={unlock} className="pt-form">
            <label htmlFor="passphrase">Vault passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              autoComplete="current-password"
              onChange={(event) => { setPassphrase(event.target.value); }}
            />
            <button type="submit">Unlock</button>
            {error !== undefined && <p className="pt-error" role="alert">{error}</p>}
          </form>
        </Card>
      </main>
    );
  }

  return (
    <div className="pt-shell">
      <header className="pt-topbar">
        <div className="pt-brand">
          <span className="pt-brand__mark" aria-hidden="true" />
          portTrack
        </div>
        <nav>
          {SECTIONS.map((name) => (
            <a
              key={name}
              href={`#${name.toLowerCase()}`}
              className={name === section ? 'is-active' : ''}
              onClick={() => { setSection(name); }}
            >
              {name}
            </a>
          ))}
        </nav>
      </header>

      <main className="pt-grid">
        <Card title="Net worth" action={<Chip>Live</Chip>}>
          {valuation === undefined ? (
            <p className="pt-muted">Loading your portfolio…</p>
          ) : (
            <>
              <p className="pt-display pt-numeric" data-testid="net-worth">
                {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
                  Number(valuation.netWorth.amount),
                )}
              </p>
              <dl className="pt-stats">
                <div>
                  <dt>Gross assets</dt>
                  <dd><Amount value={valuation.grossAssets} /></dd>
                </div>
                <div>
                  <dt>Liabilities</dt>
                  <dd><Amount value={valuation.totalLiabilities} /></dd>
                </div>
                <div>
                  <dt>Holdings</dt>
                  <dd className="pt-numeric">{valuation.positions.length}</dd>
                </div>
              </dl>
            </>
          )}
        </Card>

        <Card title="Asset allocation">
          <div data-testid="allocation-breakdown">
            {valuation === undefined || Object.keys(valuation.byAssetClass).length === 0 ? (
              <p className="pt-muted">No holdings recorded yet.</p>
            ) : (
              <ul className="pt-allocation">
                {Object.entries(valuation.byAssetClass).map(([assetClass, value]) => (
                  <li key={assetClass}>
                    <span>{assetClass.replaceAll('_', ' ').toLowerCase()}</span>
                    <Amount value={value} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card title="Snapshots" action={<button type="button" className="pt-link">Compare</button>}>
          <p className="pt-muted">
            Compliance snapshots freeze on 31 March (domestic) and 31 December (foreign).
          </p>
        </Card>

        <Card title="Advance tax">
          <ProvisionalBanner />
          <p className="pt-muted">
            Quarterly instalments appear here once your income for the year is recorded.
          </p>
        </Card>
      </main>
    </div>
  );
}
