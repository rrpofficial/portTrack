/**
 * Bundles the API for the container image (US-9.1).
 *
 * The source uses NodeNext `./app.js` specifiers, which is correct for
 * TypeScript but has no meaning to Node's type-stripping loader at runtime — it
 * looks for a `.js` file that never existed. Rather than depend on an
 * experimental flag in a production image, the API is bundled ahead of time.
 *
 * Native and data-file dependencies stay external: esbuild cannot inline a
 * `.node` binary, and the wink model ships as data rather than code.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const pkg = (name) => resolve(root, `packages/${name}/src/index.ts`);

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
  /*
   * Only OUR code is bundled; every third-party package stays external and is
   * resolved from node_modules at runtime. Bundling them would force CommonJS
   * dependencies such as Fastify through an ESM wrapper, where their internal
   * `require` calls fail at startup — and it would inline a native addon that
   * cannot be inlined.
   */
  packages: 'external',
  alias: Object.fromEntries(
    [
      'shared-kernel',
      'core-domain',
      'fx-itbr',
      'tax-engine',
      'snapshot',
      'ingestion',
      'compliance',
      'pii-masker',
      'persistence',
      'adapters-fx',
      'app-services',
      'platform',
    ].map((name) => [`@porttrack/${name}`, pkg(name)]),
  ),
  logLevel: 'info',
});
