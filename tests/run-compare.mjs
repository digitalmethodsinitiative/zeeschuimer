/**
 * Launcher for the Tier 2 map_item comparator (`npm run test:compare`).
 *
 *   npm run test:compare              -> compares every key in FOURCAT_DATASETS
 *   npm run test:compare -- <key>     -> narrows the run to a single key
 *   npm run test:compare -- <key> -t "id=123"   -> key + forwarded jest flags
 *
 * Why this exists instead of invoking jest directly: jest treats any bare
 * positional argument as a test-path-pattern filter. A 4CAT dataset key
 * (`5daeba72a2dfbb5ed8c855f824a61570`) matches no test file path, so
 * `jest <key>` silently discovers zero tests and exits "green" having run
 * nothing. This launcher intercepts the first non-flag argument, hands it to
 * the comparator through the COMPARE_DATASET env var, and forwards only the
 * remaining flags to jest — so the key never reaches jest's argv.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// First non-flag arg (if any) is the dataset key to narrow to. Everything
// that looks like a flag is forwarded to jest verbatim.
const dataset_key = args.find(a => !a.startsWith('-'));
const jest_flags = args.filter(a => a !== dataset_key);

const env = { ...process.env };
if (dataset_key) env.COMPARE_DATASET = dataset_key;

const jest_bin = join(__dirname, 'node_modules', 'jest', 'bin', 'jest.js');
const child = spawn(
    process.execPath,
    ['--experimental-vm-modules', jest_bin, '--config', 'jest.compare.config.cjs', ...jest_flags],
    { stdio: 'inherit', cwd: __dirname, env },
);

child.on('exit', code => process.exit(code ?? 1));
child.on('error', err => {
    console.error(`failed to launch jest: ${err.message}`);
    process.exit(1);
});
