/**
 * Manually exercise 4CAT's /api/map-item/ endpoint against a fixture item.
 *
 * Usage:
 *   node probe-4cat.mjs <module_name> [<fixture_filename>] [--index N]
 *
 * <module_name> is the Zeeschuimer module filename without `.js` (e.g.
 *   "tiktok", "pinterest"). If <fixture_filename> is omitted, the first
 *   .ndjson in tests/fixtures/<module_name>/ is used. --index selects which
 *   line of the fixture to send (default 0).
 *
 * Requires tests/.env with FOURCAT_URL and FOURCAT_API_KEY.
 */

import 'dotenv/config';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FOURCAT_URL = process.env.FOURCAT_URL?.replace(/\/$/, '');
const FOURCAT_API_KEY = process.env.FOURCAT_API_KEY;

if (!FOURCAT_URL || !FOURCAT_API_KEY || FOURCAT_API_KEY === 'your-api-key-here') {
    console.error('error: FOURCAT_URL and FOURCAT_API_KEY must be set in tests/.env');
    console.error('       (copy tests/.env.example to tests/.env and fill in real values)');
    process.exit(1);
}

const ID_MAP_PATH = join(__dirname, 'zeeschuimer-to-4cat.json');
const ID_MAP = existsSync(ID_MAP_PATH)
    ? JSON.parse(readFileSync(ID_MAP_PATH, 'utf8'))
    : {};

function auth_headers() {
    return { 'Authorization': `${FOURCAT_API_KEY}` };
}

async function list_datasources() {
    const res = await fetch(`${FOURCAT_URL}/api/datasources/`, { headers: auth_headers() });
    if (!res.ok) {
        throw new Error(`GET /api/datasources/ → ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    return body.datasources ?? [];
}

async function map_item(datasource_id, item) {
    const res = await fetch(`${FOURCAT_URL}/api/map-item/${datasource_id}/`, {
        method: 'POST',
        headers: { ...auth_headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status_code: res.status, body };
}

function parse_args(argv) {
    const args = { module: null, fixture: null, index: 0 };
    const positional = [];
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--index') {
            args.index = parseInt(argv[++i], 10);
        } else if (argv[i].startsWith('--index=')) {
            args.index = parseInt(argv[i].split('=')[1], 10);
        } else {
            positional.push(argv[i]);
        }
    }
    args.module = positional[0];
    args.fixture = positional[1];
    return args;
}

async function main() {
    const args = parse_args(process.argv);
    if (!args.module) {
        console.error('Usage: node probe-4cat.mjs <module_name> [<fixture_filename>] [--index N]');
        process.exit(1);
    }

    const datasource_id = ID_MAP[args.module] ?? args.module;
    const fixture_dir = join(__dirname, 'fixtures', args.module);

    if (!existsSync(fixture_dir)) {
        console.error(`error: no fixture dir at ${fixture_dir}`);
        process.exit(1);
    }

    const candidates = readdirSync(fixture_dir).filter(f => f.endsWith('.ndjson'));
    if (candidates.length === 0) {
        console.error(`error: no .ndjson fixtures under ${fixture_dir}`);
        process.exit(1);
    }
    const fixture_name = args.fixture ?? candidates[0];
    const fixture_path = join(fixture_dir, fixture_name);
    if (!existsSync(fixture_path)) {
        console.error(`error: fixture ${fixture_path} not found`);
        process.exit(1);
    }

    const lines = readFileSync(fixture_path, 'utf8').split('\n').filter(l => l.trim().length > 0);
    if (args.index >= lines.length) {
        console.error(`error: --index ${args.index} but fixture has ${lines.length} items`);
        process.exit(1);
    }
    const item = JSON.parse(lines[args.index]);

    console.log(`Module:        ${args.module}`);
    console.log(`Datasource id: ${datasource_id}${ID_MAP[args.module] ? ' (mapped via zeeschuimer-to-4cat.json)' : ''}`);
    console.log(`URL:           ${FOURCAT_URL}/api/map-item/${datasource_id}/`);
    console.log(`Fixture:       ${fixture_name}, item ${args.index} (item_id=${item.item_id ?? item.id})`);
    console.log('');

    const { status_code, body } = await map_item(datasource_id, item);
    console.log(`HTTP ${status_code}`);
    console.log(JSON.stringify(body, null, 2));

    if (status_code === 404) {
        console.error('');
        console.error('Hint: datasource id may be wrong. Available Zeeschuimer-origin datasources:');
        try {
            const datasources = await list_datasources();
            datasources
                .filter(d => d.is_from_zeeschuimer && d.has_map_item)
                .forEach(d => console.error(`  - ${d.id}  (${d.name})`));
        } catch (e) {
            console.error(`  (couldn't fetch list: ${e.message})`);
        }
        process.exit(2);
    }
}

main().catch(e => {
    console.error(`probe failed: ${e.message}`);
    process.exit(2);
});
