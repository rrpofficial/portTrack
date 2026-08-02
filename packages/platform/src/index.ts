/**
 * platform — cross-cutting infrastructure: PII-safe logging (US-8.9) and the
 * single audited egress choke point (US-8.10, ADR-010).
 *
 * These have no home in the original repo layout, which is a gap in the plan
 * rather than a deliberate omission: both are infrastructure that every layer
 * touches but no domain package may import.
 */
export { Logger, createLogger, type LogRecord, type LogSink, type LogLevel } from './logger.js';
export { EgressGateway, createEgressGateway, type EgressPolicy } from './egress.js';
