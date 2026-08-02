/** Container entrypoint for `porttrack-api`. */
import { buildApp } from './app.js';

const dataDir = process.env.PORTTRACK_DATA_DIR ?? '/var/lib/porttrack';
const port = Number(process.env.PORT ?? 8080);

const app = await buildApp({ dataDir, port });
await app.listen({ port, host: '0.0.0.0' });
