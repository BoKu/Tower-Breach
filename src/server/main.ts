// `npm run server`: the dedicated co-op server from source, serving the web build from ./dist (or --web-root).
// The standalone binaries use a generated entry (scripts/build-server.mjs) that embeds dist/ instead.
import { cli } from './dedicated';

void cli();
