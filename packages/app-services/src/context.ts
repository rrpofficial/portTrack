/**
 * Application context — the wiring that use cases share.
 *
 * Domain packages are pure and take their dependencies as ports; this is where
 * the real ones are assembled. Keeping assembly in one place is what lets a
 * functional test swap the price feed or the clock without a mock framework, and
 * what keeps every use case free of hidden global state except this.
 */
import { Money, type Clock } from '@porttrack/shared-kernel';
import type { Asset, FxSource, Liability, PriceSource } from '@porttrack/core-domain';
import { createLogger, type Logger } from '@porttrack/platform';

export interface AppContext {
  readonly dataDir: string;
  readonly unlocked: boolean;
}

export interface Ports {
  readonly clock: Clock;
  readonly logger: Logger;
  /** Live holdings. Backed by the vault once persistence repositories land. */
  readonly assets: () => readonly Asset[];
  readonly liabilities: () => readonly Liability[];
  readonly prices?: PriceSource;
  readonly fx?: FxSource;
}

const systemClock: Clock = {
  // The only wall-clock read in the application. Everything downstream receives
  // an explicit instant, so snapshots and tax computations stay reproducible.
  now: () => new Date().toISOString().replace('Z', '+00:00'),
  today: () => new Date().toISOString().slice(0, 10),
};

const NO_SINK = { write: () => undefined };

let ports: Ports = {
  clock: systemClock,
  logger: createLogger({ sink: NO_SINK, now: () => systemClock.now() }),
  assets: () => [],
  liabilities: () => [],
};

export function configure(overrides: Partial<Ports>): void {
  ports = { ...ports, ...overrides };
}

export function currentPorts(): Ports {
  return ports;
}

/** Test seam: restores the default wiring between scenarios. */
export function resetPorts(): void {
  ports = {
    clock: systemClock,
    logger: createLogger({ sink: NO_SINK, now: () => systemClock.now() }),
    assets: () => [],
    liabilities: () => [],
  };
}

export const ZERO_INR = Money.zero('INR');
