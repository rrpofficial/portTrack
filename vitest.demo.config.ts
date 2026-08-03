import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string) => path.resolve(root, `packages/${name}/src/index.ts`);

/**
 * The walking skeleton (`pnpm demo`). Standalone rather than `mergeConfig(base, …)`:
 * vitest merges array options by concatenation, so extending the base config would
 * run the entire suite alongside it — the same trap the container config hit.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@porttrack/shared-kernel': pkg('shared-kernel'),
      '@porttrack/core-domain': pkg('core-domain'),
      '@porttrack/fx-itbr': pkg('fx-itbr'),
      '@porttrack/tax-engine': pkg('tax-engine'),
      '@porttrack/snapshot': pkg('snapshot'),
      '@porttrack/ingestion': pkg('ingestion'),
      '@porttrack/compliance': pkg('compliance'),
      '@porttrack/pii-masker': pkg('pii-masker'),
      '@porttrack/persistence': pkg('persistence'),
      '@porttrack/adapters-fx': pkg('adapters-fx'),
      '@porttrack/app-services': pkg('app-services'),
      '@porttrack/platform': pkg('platform'),
      '@porttrack/test-kit': path.resolve(root, 'tests/test-kit/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/manual/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
