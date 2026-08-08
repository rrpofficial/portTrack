/**
 * Writes the CSV templates to `templates/` so they exist as files in the
 * repository, not only as a download from a running instance.
 *
 * Generated, never hand-written: the header row a user fills in and the header
 * row the parser matches against must be the same string, and two copies of a
 * column list drift the moment one is edited.
 *
 *   npx tsx scripts/emit-templates.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateRegistry } from '../packages/ingestion/src/index.js';

const outputDir = join(import.meta.dirname, '..', 'templates');
mkdirSync(outputDir, { recursive: true });

for (const template of TemplateRegistry.definitions()) {
  const path = join(outputDir, `${template.name}.csv`);
  writeFileSync(path, TemplateRegistry.generate(template.name), 'utf8');
  process.stdout.write(`wrote ${path}\n`);
}
