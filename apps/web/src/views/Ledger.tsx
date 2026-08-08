/**
 * Ledger — every holding, its lots, its disposals and its liabilities.
 *
 * Shows REMAINING quantity beside original, because those two diverging is the
 * only visible sign that a disposal was applied. A view that showed only the
 * original quantity would look identical whether or not sells had been recorded.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Ledger as LedgerData } from '../api.js';
import { Amount, Card, Chip } from '../components/primitives.js';

export function Ledger() {
  const [ledger, setLedger] = useState<LedgerData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    const result = await api.ledger();
    if (result.ok) setLedger(result.value);
    else setError(result.error.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== undefined) {
    return (
      <Card title="Ledger">
        <p className="pt-error" role="alert">
          {error}
        </p>
      </Card>
    );
  }

  if (ledger === undefined) {
    return (
      <Card title="Ledger">
        <p className="pt-muted">Loading your holdings…</p>
      </Card>
    );
  }

  if (ledger.assets.length === 0 && ledger.liabilities.length === 0) {
    return (
      <Card title="Ledger">
        <p className="pt-muted" data-testid="ledger-empty">
          Nothing recorded yet. Import a broker or fund statement to build your ledger.
        </p>
      </Card>
    );
  }

  return (
    <div className="pt-stack">
      <Card title="Holdings" action={<Chip>{`${String(ledger.assets.length)} assets`}</Chip>}>
        <div className="pt-table-scroll">
          <table className="pt-table" data-testid="ledger-table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Class</th>
                <th scope="col">Where</th>
                <th scope="col" className="pt-align-end">
                  Lots
                </th>
                <th scope="col" className="pt-align-end">
                  Held
                </th>
                <th scope="col" className="pt-align-end">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.assets.map((asset) => {
                const held = asset.lots.reduce(
                  (sum, lot) => sum + Number(lot.remainingQuantity),
                  0,
                );
                const cost = asset.lots.reduce(
                  (sum, lot) => sum + Number(lot.remainingQuantity) * Number(lot.costPerUnit.amount),
                  0,
                );
                const isOpen = expanded === asset.assetId;

                return [
                  <tr key={asset.assetId}>
                    <td>
                      <button
                        type="button"
                        className="pt-link pt-link--inline"
                        aria-expanded={isOpen}
                        onClick={() => {
                          setExpanded(isOpen ? undefined : asset.assetId);
                        }}
                      >
                        {asset.symbol ?? asset.isin ?? asset.assetId}
                      </button>
                    </td>
                    <td>{asset.assetClass.replaceAll('_', ' ').toLowerCase()}</td>
                    <td>{asset.jurisdiction.toLowerCase()}</td>
                    <td className="pt-align-end pt-numeric">{asset.lots.length}</td>
                    <td className="pt-align-end pt-numeric">{held}</td>
                    <td className="pt-align-end">
                      <Amount value={{ amount: String(cost), currency: asset.currency }} />
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${asset.assetId}-lots`} className="pt-table__detail">
                      <td colSpan={6}>
                        <table className="pt-table pt-table--nested">
                          <thead>
                            <tr>
                              <th scope="col">Acquired</th>
                              <th scope="col" className="pt-align-end">
                                Quantity
                              </th>
                              <th scope="col" className="pt-align-end">
                                Remaining
                              </th>
                              <th scope="col" className="pt-align-end">
                                Cost per unit
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {asset.lots.map((lot) => (
                              <tr key={lot.lotId}>
                                <td>{lot.acquisitionDate}</td>
                                <td className="pt-align-end pt-numeric">{lot.quantity}</td>
                                <td className="pt-align-end pt-numeric">{lot.remainingQuantity}</td>
                                <td className="pt-align-end">
                                  <Amount value={lot.costPerUnit} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {ledger.exits.length > 0 && (
        <Card title="Disposals" action={<Chip>{`${String(ledger.exits.length)} exits`}</Chip>}>
          <div className="pt-table-scroll">
            <table className="pt-table" data-testid="exit-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Asset</th>
                  <th scope="col" className="pt-align-end">
                    Quantity
                  </th>
                  <th scope="col" className="pt-align-end">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.exits.map((exit) => (
                  <tr key={exit.txnId}>
                    <td>{exit.exitDate}</td>
                    <td>{exit.assetId}</td>
                    <td className="pt-align-end pt-numeric">{exit.quantity}</td>
                    <td className="pt-align-end">
                      <Amount value={exit.pricePerUnit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {ledger.liabilities.length > 0 && (
        <Card title="Liabilities">
          <div className="pt-table-scroll">
            <table className="pt-table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">As of</th>
                  <th scope="col" className="pt-align-end">
                    Rate
                  </th>
                  <th scope="col" className="pt-align-end">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.liabilities.map((liability) => (
                  <tr key={liability.liabilityId}>
                    <td>{liability.kind.replaceAll('_', ' ').toLowerCase()}</td>
                    <td>{liability.asOf}</td>
                    <td className="pt-align-end pt-numeric">{liability.interestRatePct}%</td>
                    <td className="pt-align-end">
                      <Amount value={liability.principalOutstanding} />
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
