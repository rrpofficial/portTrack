/**
 * Dashboard — net worth, allocation and the entry points to everything else.
 * Renders what the API computed; no figure on this screen is derived here.
 */
import { Amount, Card, Chip, ProvisionalBanner } from '../components/primitives.js';
import { navigate } from '../router.js';
import type { Valuation } from '../api.js';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function Dashboard({ valuation }: { valuation: Valuation | undefined }) {
  return (
    <div className="pt-grid">
      <Card title="Net worth" action={<Chip>Live</Chip>}>
        {valuation === undefined ? (
          <p className="pt-muted">Loading your portfolio…</p>
        ) : (
          <>
            <p className="pt-display pt-numeric" data-testid="net-worth">
              {INR.format(Number(valuation.netWorth.amount))}
            </p>
            <dl className="pt-stats">
              <div>
                <dt>Gross assets</dt>
                <dd>
                  <Amount value={valuation.grossAssets} />
                </dd>
              </div>
              <div>
                <dt>Liabilities</dt>
                <dd>
                  <Amount value={valuation.totalLiabilities} />
                </dd>
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
            <p className="pt-muted">
              No holdings recorded yet. Import a statement to populate your ledger.
            </p>
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

      <Card
        title="Snapshots"
        action={
          <button
            type="button"
            className="pt-link"
            onClick={() => {
              navigate('Snapshots');
            }}
          >
            Compare
          </button>
        }
      >
        <p className="pt-muted">
          Compliance snapshots freeze on 31 March (domestic) and 31 December (foreign).
        </p>
      </Card>

      <Card title="Advance tax">
        <ProvisionalBanner />
        <p className="pt-muted">
          Quarterly instalments appear in the Tax section once your income for the year is recorded.
        </p>
      </Card>
    </div>
  );
}
