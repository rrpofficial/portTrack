/**
 * Presentational primitives, styled entirely from design tokens (PRD FR-9.1).
 * No component declares a raw colour — a guard test asserts it.
 */
import type { ReactNode } from 'react';
import type { Money } from '../api.js';

export function Card({ children, title, action }: {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section className="pt-card">
      {title !== undefined && (
        <header className="pt-card__head">
          <h2>{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatMoney(money: Money): string {
  const value = Number(money.amount);
  return `${money.currency === 'INR' ? '₹' : ''}${INR.format(value)}`;
}

/**
 * Financial direction is shown by sign AND colour, never colour alone (NFR-4).
 * Roughly one man in twelve cannot separate the gain and loss hues reliably.
 */
export function Delta({ value }: { value: Money }) {
  const amount = Number(value.amount);
  const direction = amount > 0 ? 'gain' : amount < 0 ? 'loss' : 'flat';
  const arrow = amount > 0 ? '▲' : amount < 0 ? '▼' : '■';
  const sign = amount > 0 ? '+' : '';
  return (
    <span className={`pt-delta pt-delta--${direction} pt-numeric`}>
      <span aria-hidden="true">{arrow}</span> {sign}
      {formatMoney(value)}
    </span>
  );
}

export function Amount({ value }: { value: Money }) {
  return <span className="pt-numeric">{formatMoney(value)}</span>;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="pt-chip">{children}</span>;
}

/**
 * Shown wherever a tax figure appears while the FY rule set is provisional.
 * A number that cannot be filed must not look like one that can.
 */
export function ProvisionalBanner() {
  return (
    <div className="pt-banner" role="status">
      <strong>Provisional tax rates.</strong> These figures are computed from an unverified rule set
      and cannot be used for filing until the rates are sourced from the Finance Act.
    </div>
  );
}
