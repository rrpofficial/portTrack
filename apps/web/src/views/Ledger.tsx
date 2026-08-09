/**
 * Ledger — every holding, its lots, its disposals, its loans and its liabilities.
 *
 * Shows REMAINING quantity beside original, because those two diverging is the
 * only visible sign that a disposal was applied. A view that showed only the
 * original quantity would look identical whether or not sells had been recorded.
 *
 * **Hand loans get their own section rather than a row in Holdings.** A loan is a
 * receivable, not a holding of units: it has no acquisition lots, no quantity and
 * no cost per unit, so rendering it through the instrument table produced a row
 * reading `0 lots · 0 held · ₹0` under a raw asset id — every column meaningless
 * and the one figure that matters, what is still owed, absent entirely.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type Ledger as LedgerData, type LoanRegister } from '../api.js';
import { Amount, Card, Chip } from '../components/primitives.js';
import { navigate } from '../router.js';

const STATUS_LABEL: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  PARTIALLY_REPAID: 'Partially repaid',
  REPAID: 'Repaid',
};

export function Ledger() {
  const [ledger, setLedger] = useState<LedgerData | undefined>();
  const [loans, setLoans] = useState<LoanRegister | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | undefined>();

  const load = useCallback(async (): Promise<void> => {
    // The loan register rather than the raw assets: it already carries the
    // borrower, the outstanding principal and the interest owed, computed the
    // same way the Loans tab computes them, so the two cannot disagree.
    const [ledgerResult, loanResult] = await Promise.all([api.ledger(), api.loans()]);
    if (ledgerResult.ok) setLedger(ledgerResult.value);
    else setError(ledgerResult.error.message);
    if (loanResult.ok) setLoans(loanResult.value);
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

  // Instruments only. Loans are receivables and are reported below.
  const holdings = ledger.assets.filter((asset) => asset.assetClass !== 'HAND_LOAN');

  if (holdings.length === 0 && ledger.liabilities.length === 0 && (loans?.loans.length ?? 0) === 0) {
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
      {loans !== undefined && loans.loans.length > 0 && (
        <Card
          title="Loans receivable"
          action={
            <button
              type="button"
              className="pt-link pt-link--inline"
              onClick={() => {
                navigate('Loans');
              }}
            >
              Open the loan register
            </button>
          }
        >
          <p className="pt-muted">
            Money lent out, carried at the principal still owed plus interest accrued and not yet
            received. Lots and quantity do not apply to a receivable.
          </p>
          <div className="pt-table-scroll">
            <table className="pt-table" data-testid="loans-receivable-table">
              <thead>
                <tr>
                  <th scope="col">Borrower</th>
                  <th scope="col">Lent on</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pt-align-end">
                    Principal lent
                  </th>
                  <th scope="col" className="pt-align-end">
                    Outstanding
                  </th>
                  <th scope="col" className="pt-align-end">
                    Interest owed
                  </th>
                  <th scope="col" className="pt-align-end">
                    Carrying value
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.loans.map((loan) => (
                  <tr key={loan.loanId}>
                    <td>{loan.borrowerName}</td>
                    <td>{loan.loanDate}</td>
                    <td>
                      <span className={`pt-status pt-status--${loan.status.toLowerCase()}`}>
                        {STATUS_LABEL[loan.status] ?? loan.status}
                      </span>
                    </td>
                    <td className="pt-align-end">
                      <Amount value={loan.principal} />
                    </td>
                    <td className="pt-align-end">
                      <Amount value={loan.outstandingPrincipal} />
                    </td>
                    <td className="pt-align-end">
                      <Amount value={loan.interestBalance} />
                    </td>
                    <td className="pt-align-end">
                      {/* What this contributes to net worth: outstanding + owed. */}
                      <Amount
                        value={{
                          amount: String(
                            Number(loan.outstandingPrincipal.amount) +
                              Number(loan.interestBalance.amount),
                          ),
                          currency: loan.principal.currency,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {holdings.length > 0 && (
      <Card title="Holdings" action={<Chip>{`${String(holdings.length)} assets`}</Chip>}>
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
              {holdings.map((asset) => {
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
      )}

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
