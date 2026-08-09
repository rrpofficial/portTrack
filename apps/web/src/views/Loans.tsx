/**
 * Loans — the hand-loan register.
 *
 * Replaces a tracking spreadsheet, so it shows the same columns and answers the
 * same question first: how much is out there, and how much interest is owed.
 *
 * Two decisions are worth stating because both are visible on screen:
 *
 *  1. **Pending interest is split into two tiles.** Interest still owed on a
 *     loan whose principal came back has no repayment arriving alongside it, so
 *     it is the balance most easily forgotten. Folded into one number it hides
 *     inside the larger figure for live loans.
 *  2. **The tiles describe the FILTERED set.** Filter to one borrower and the
 *     totals become that borrower's. Totals that ignored the filter would be
 *     read as the filtered ones and quietly mislead.
 *
 * Every figure is computed by the API. Summing decimal strings in the browser
 * would reintroduce the float drift ADR-002 exists to prevent, and these are
 * amounts someone is owed.
 */
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  api,
  type LoanQuery,
  type LoanRegister,
  type LoanSortKey,
  type LoanStatus,
  type LoanView,
  type PaymentMode,
} from '../api.js';
import { Amount, Card, Chip } from '../components/primitives.js';

const STATUSES: readonly { readonly value: LoanStatus; readonly label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PARTIALLY_REPAID', label: 'Partially repaid' },
  { value: 'REPAID', label: 'Repaid' },
];

const MODES: readonly PaymentMode[] = ['BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE', 'OTHER'];

const SORTABLE: readonly { readonly key: LoanSortKey; readonly label: string }[] = [
  { key: 'borrowerName', label: 'Borrower' },
  { key: 'status', label: 'Status' },
  { key: 'loanDate', label: 'Loan date' },
  { key: 'principal', label: 'Amount' },
];

const STATUS_LABEL: Readonly<Record<LoanStatus, string>> = {
  ACTIVE: 'Active',
  PARTIALLY_REPAID: 'Partially repaid',
  REPAID: 'Repaid',
};

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function Tile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="pt-tile" data-testid={testId}>
      <span className="pt-tile__label">{label}</span>
      <strong className="pt-tile__value pt-numeric">{value}</strong>
      {hint !== undefined && <span className="pt-tile__hint">{hint}</span>}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function Loans() {
  const [register, setRegister] = useState<LoanRegister | undefined>();
  const [statuses, setStatuses] = useState<readonly LoanStatus[]>([]);
  const [borrowers, setBorrowers] = useState<readonly string[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<LoanSortKey>('loanDate');
  const [direction, setDirection] = useState<'ASC' | 'DESC'>('DESC');
  const [expanded, setExpanded] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [showNewLoan, setShowNewLoan] = useState(false);

  const query: LoanQuery = {
    ...(statuses.length === 0 ? {} : { statuses }),
    ...(borrowers.length === 0 && search.trim().length === 0
      ? {}
      : { borrowers: [...borrowers, ...(search.trim().length === 0 ? [] : [search.trim()])] }),
    sortBy,
    direction,
  };

  const load = useCallback(async (): Promise<void> => {
    const result = await api.loans(query);
    if (result.ok) {
      setRegister(result.value);
      setError(undefined);
    } else setError(result.error.message);
    // The query object is rebuilt each render; its VALUES are the dependency.
  }, [statuses, borrowers, search, sortBy, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleStatus = (status: LoanStatus): void => {
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  };

  const toggleBorrower = (name: string): void => {
    setBorrowers((current) =>
      current.includes(name) ? current.filter((b) => b !== name) : [...current, name],
    );
  };

  const totals = register?.totals;

  return (
    <div className="pt-stack">
      <Card
        title="Hand loans"
        action={
          <button
            type="button"
            className="pt-button-inline"
            onClick={() => {
              setShowNewLoan((open) => !open);
            }}
          >
            {showNewLoan ? 'Cancel' : 'Record a loan'}
          </button>
        }
      >
        <div className="pt-tiles" data-testid="loan-tiles">
          <Tile
            label="Total lent"
            value={INR.format(Number(totals?.totalPrincipal.amount ?? '0'))}
            hint={`${String(totals?.loanCount ?? 0)} loan(s) shown`}
            testId="tile-total-lent"
          />
          <Tile
            label="Principal outstanding"
            value={INR.format(Number(totals?.totalOutstanding.amount ?? '0'))}
            hint="Still to come back"
            testId="tile-outstanding"
          />
          <Tile
            label="Pending interest — active"
            value={INR.format(Number(totals?.pendingInterestActive.amount ?? '0'))}
            hint="On loans not yet fully repaid"
            testId="tile-pending-active"
          />
          <Tile
            label="Pending interest — principal repaid"
            value={INR.format(Number(totals?.pendingInterestRepaid.amount ?? '0'))}
            // Kept separate on purpose: nothing else is due on these loans, so
            // this is the balance that quietly goes uncollected.
            hint="Owed after the money came back"
            testId="tile-pending-repaid"
          />
        </div>

        {showNewLoan && <NewLoanForm onSaved={() => void load()} onClose={() => { setShowNewLoan(false); }} />}
      </Card>

      <Card title="Filter and sort">
        <div className="pt-controls">
          <span className="pt-controls__label">Status</span>
          {STATUSES.map((status) => (
            <label key={status.value} className="pt-check">
              <input
                type="checkbox"
                checked={statuses.includes(status.value)}
                onChange={() => {
                  toggleStatus(status.value);
                }}
              />
              {status.label}
            </label>
          ))}
          {statuses.length === 0 && <span className="pt-muted">none selected — showing all</span>}
        </div>

        <div className="pt-controls">
          <label htmlFor="borrower-search">Borrower</label>
          <input
            id="borrower-search"
            type="search"
            value={search}
            placeholder="Search by name"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          {/*
            A dropdown, not a checkbox per borrower. A checkbox list is readable
            at three names and unusable at fifty — it pushes the register itself
            off the screen. Selecting from the list adds a removable chip, which
            keeps multi-select without the wall of controls.
          */}
          <label htmlFor="borrower-select">Add</label>
          <select
            id="borrower-select"
            value=""
            onChange={(event) => {
              if (event.target.value.length > 0) toggleBorrower(event.target.value);
            }}
          >
            <option value="">Choose a borrower…</option>
            {(register?.borrowers ?? [])
              .filter((name) => !borrowers.includes(name))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </div>

        {borrowers.length > 0 && (
          <div className="pt-controls" data-testid="borrower-chips">
            {borrowers.map((name) => (
              <button
                key={name}
                type="button"
                className="pt-chip pt-chip--removable"
                aria-label={`Remove ${name} from the filter`}
                onClick={() => {
                  toggleBorrower(name);
                }}
              >
                {name} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button
              type="button"
              className="pt-link pt-link--inline"
              onClick={() => {
                setBorrowers([]);
              }}
            >
              Clear all
            </button>
          </div>
        )}

        <div className="pt-controls">
          <label htmlFor="sort-by">Sort by</label>
          <select
            id="sort-by"
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value as LoanSortKey);
            }}
          >
            {SORTABLE.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pt-link pt-link--inline"
            onClick={() => {
              setDirection((current) => (current === 'ASC' ? 'DESC' : 'ASC'));
            }}
          >
            {direction === 'ASC' ? 'Ascending' : 'Descending'}
          </button>

          <span className="pt-controls__spacer" />
          {/* Carry the current filters, so the file matches the screen. */}
          <a className="pt-link pt-link--inline" href={api.loanCsvUrl(query)} download>
            Export CSV
          </a>
          <a className="pt-link pt-link--inline" href={api.loanPdfUrl(query)} download>
            Export PDF
          </a>
        </div>
      </Card>

      <Card title="Register" action={<Chip>{`${String(register?.loans.length ?? 0)} shown`}</Chip>}>
        {error !== undefined && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}

        <div className="pt-table-scroll">
          <table className="pt-table" data-testid="loan-table">
            <thead>
              <tr>
                <th scope="col">Borrower</th>
                <th scope="col">Loan date</th>
                <th scope="col">Status</th>
                <th scope="col" className="pt-align-end">
                  Amount
                </th>
                <th scope="col" className="pt-align-end">
                  Outstanding
                </th>
                <th scope="col" className="pt-align-end">
                  Rate
                </th>
                <th scope="col" className="pt-align-end">
                  Interest owed
                </th>
                <th scope="col" className="pt-align-end">
                  Months
                </th>
              </tr>
            </thead>
            <tbody>
              {register === undefined && (
                <tr>
                  <td colSpan={8} className="pt-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {register?.loans.length === 0 && (
                <tr>
                  <td colSpan={8} className="pt-muted" data-testid="loan-empty">
                    No loans match these filters.
                  </td>
                </tr>
              )}
              {register?.loans.map((loan) => (
                <LoanRow
                  key={loan.loanId}
                  loan={loan}
                  expanded={expanded === loan.loanId}
                  onToggle={() => {
                    setExpanded(expanded === loan.loanId ? undefined : loan.loanId);
                  }}
                  onChanged={() => void load()}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function LoanRow({
  loan,
  expanded,
  onToggle,
  onChanged,
}: {
  loan: LoanView;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="pt-link pt-link--inline" aria-expanded={expanded} onClick={onToggle}>
            {loan.borrowerName}
          </button>
          {loan.notes.length > 0 && <div className="pt-muted">{loan.notes}</div>}
        </td>
        <td>{loan.loanDate}</td>
        <td>
          <span className={`pt-status pt-status--${loan.status.toLowerCase()}`}>
            {STATUS_LABEL[loan.status]}
          </span>
        </td>
        <td className="pt-align-end">
          <Amount value={loan.principal} />
        </td>
        <td className="pt-align-end">
          <Amount value={loan.outstandingPrincipal} />
        </td>
        <td className="pt-align-end pt-numeric">{loan.interestRatePct}%</td>
        <td className="pt-align-end">
          <Amount value={loan.interestBalance} />
        </td>
        <td className="pt-align-end pt-numeric">{loan.totalInterestMonths}</td>
      </tr>
      {expanded && (
        <tr className="pt-table__detail">
          <td colSpan={8}>
            <LoanDetail loan={loan} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function LoanDetail({ loan, onChanged }: { loan: LoanView; onChanged: () => void }) {
  return (
    <div className="pt-stack" data-testid={`loan-detail-${loan.loanId}`}>
      <dl className="pt-stats">
        <div>
          <dt>Interest accrued</dt>
          <dd>
            <Amount value={loan.totalInterestAccrued} />
          </dd>
        </div>
        <div>
          <dt>Interest received</dt>
          <dd>
            <Amount value={loan.interestPaid} />
          </dd>
        </div>
        <div>
          <dt>Interest / month</dt>
          <dd>
            <Amount value={loan.interestPerMonth} />
          </dd>
        </div>
        <div>
          <dt>Balance months</dt>
          <dd className="pt-numeric">{loan.interestBalanceMonths}</dd>
        </div>
        <div>
          <dt>Principal repaid</dt>
          <dd>
            <Amount value={loan.principalRepaid} />
          </dd>
        </div>
      </dl>

      <PaymentHistory title="Principal repayments" payments={loan.repayments} empty="None yet." />
      <PaymentHistory
        title="Interest payments"
        payments={loan.interestPayments}
        empty="No interest received yet."
      />

      <div className="pt-grid">
        <PaymentForm
          title="Record an interest payment"
          testId={`interest-form-${loan.loanId}`}
          submitLabel="Record interest"
          onSubmit={(input) => api.recordInterestPayment(loan.loanId, input)}
          onDone={onChanged}
        />
        <PaymentForm
          title="Record a principal repayment"
          testId={`principal-form-${loan.loanId}`}
          submitLabel="Record repayment"
          hint="Interest accrues only on what remains, from this date."
          onSubmit={(input) => api.recordPrincipalRepayment(loan.loanId, input)}
          onDone={onChanged}
        />
      </div>
    </div>
  );
}

function PaymentHistory({
  title,
  payments,
  empty,
}: {
  title: string;
  payments: readonly LoanView['interestPayments'][number][];
  empty: string;
}) {
  return (
    <div>
      <h3 className="pt-subhead">{title}</h3>
      {payments.length === 0 ? (
        <p className="pt-muted">{empty}</p>
      ) : (
        <table className="pt-table pt-table--nested">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="pt-align-end">
                Amount
              </th>
              <th scope="col">Mode</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment, index) => (
              <tr key={payment.paymentId ?? `${payment.date}-${String(index)}`}>
                <td>{payment.date}</td>
                <td className="pt-align-end">
                  <Amount value={payment.amount} />
                </td>
                <td>{payment.mode.replaceAll('_', ' ').toLowerCase()}</td>
                <td>{payment.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface PaymentInput {
  date: string;
  amount: { amount: string; currency: string };
  mode: PaymentMode;
  notes?: string;
}

function PaymentForm({
  title,
  testId,
  submitLabel,
  hint,
  onSubmit,
  onDone,
}: {
  title: string;
  testId: string;
  submitLabel: string;
  hint?: string;
  onSubmit: (input: PaymentInput) => Promise<{ ok: boolean }>;
  onDone: () => void;
}) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = useCallback(async (): Promise<void> => {
    if (amount.trim().length === 0) {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await onSubmit({
      date,
      amount: { amount: amount.trim(), currency: 'INR' },
      mode,
      ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
    });
    setBusy(false);
    if (!result.ok) {
      setError('That payment could not be recorded.');
      return;
    }
    setAmount('');
    setNotes('');
    onDone();
  }, [amount, date, mode, notes, onSubmit, onDone]);

  function onFormSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="pt-form" onSubmit={onFormSubmit} data-testid={testId}>
      <h3 className="pt-subhead">{title}</h3>
      {hint !== undefined && <p className="pt-muted">{hint}</p>}

      <label htmlFor={`${testId}-date`}>Date</label>
      <input
        id={`${testId}-date`}
        type="date"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />

      <label htmlFor={`${testId}-amount`}>Amount</label>
      <input
        id={`${testId}-amount`}
        type="text"
        inputMode="decimal"
        value={amount}
        placeholder="0"
        onChange={(event) => {
          setAmount(event.target.value);
        }}
      />

      <label htmlFor={`${testId}-mode`}>Mode</label>
      <select
        id={`${testId}-mode`}
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as PaymentMode);
        }}
      >
        {MODES.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll('_', ' ').toLowerCase()}
          </option>
        ))}
      </select>

      <label htmlFor={`${testId}-notes`}>Notes</label>
      <input
        id={`${testId}-notes`}
        type="text"
        value={notes}
        onChange={(event) => {
          setNotes(event.target.value);
        }}
      />

      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {error !== undefined && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function NewLoanForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [borrowerName, setBorrowerName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('12');
  const [loanDate, setLoanDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    const result = await api.recordLoan({
      borrowerName,
      principal: { amount: principal.trim(), currency: 'INR' },
      interestRatePct: rate.trim(),
      loanDate,
      ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setBorrowerName('');
    setPrincipal('');
    setNotes('');
    onSaved();
    onClose();
  }, [borrowerName, principal, rate, loanDate, notes, onSaved, onClose]);

  function onFormSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="pt-form pt-form--grid" onSubmit={onFormSubmit} data-testid="new-loan-form">
      <div>
        <label htmlFor="loan-borrower">Borrower name</label>
        <input
          id="loan-borrower"
          type="text"
          value={borrowerName}
          onChange={(event) => {
            setBorrowerName(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor="loan-amount">Loan amount</label>
        <input
          id="loan-amount"
          type="text"
          inputMode="decimal"
          value={principal}
          onChange={(event) => {
            setPrincipal(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor="loan-rate">Interest rate %</label>
        <input
          id="loan-rate"
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor="loan-date">Loan date</label>
        <input
          id="loan-date"
          type="date"
          value={loanDate}
          onChange={(event) => {
            setLoanDate(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor="loan-notes">Notes</label>
        <input
          id="loan-notes"
          type="text"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </div>
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save loan'}
      </button>
      {error !== undefined && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
