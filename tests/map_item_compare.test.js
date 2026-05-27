/**
 * @jest-environment node
 *
 * This file runs in Node test environment (not jsdom) because undici's
 * fetch implementation uses Node-internal APIs (`clearImmediate`,
 * `markResourceTiming`, fast-now timers, etc.) that jsdom shadows or
 * doesn't expose. Polyfilling them into jsdom is whack-a-mole; node env
 * has them all natively.
 *
 * Trade-off: no DOMParser in node env. The four modules that use
 * `strip_tags` (gab, pinterest, rednote, truth) will need a DOMParser
 * polyfill (e.g. via linkedom) before the comparator can run against
 * them. Other modules (including instagram) work as-is.
 */
/**
 * Compare JS map_item output against 4CAT's Python map_item via the API.
 *
 * For every line in every fixture, runs the JS map_item locally AND sends
 * the same stored item to 4CAT's /api/map-item/<datasource>/ endpoint, then
 * diffs the two outputs field-by-field. Each item is its own Jest test —
 * failures point at exactly which item and which fields diverge.
 *
 * Skips itself entirely if FOURCAT_URL / FOURCAT_API_KEY aren't set, so
 * `npm test` keeps working without 4CAT configuration. Drop real values in
 * tests/.env to enable.
 *
 * Datasource id mapping: tests/zeeschuimer-to-4cat.json (Zeeschuimer
 * module filename → 4CAT datasource id, for the few names that diverge).
 *
 * Module-level state is determined upfront by inspect_module() (no
 * map_item / syntax errors / import errors are handled before tests are
 * registered, so they appear once per module, not once per item).
 */

import 'dotenv/config';
import { jest } from '@jest/globals';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect_module } from './_module-info.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FOURCAT_URL = process.env.FOURCAT_URL?.replace(/\/$/, '');
const FOURCAT_API_KEY = process.env.FOURCAT_API_KEY;
const HAS_4CAT = Boolean(
    FOURCAT_URL && FOURCAT_API_KEY && FOURCAT_API_KEY !== 'your-api-key-here'
);

// When true (default), once any item in a module fails, subsequent items
// in that same module skip the HTTP + map_item work and fail fast with a
// "halted" message. Saves time when generator output is broken at the top.
// Set FAIL_FAST=0 in env to run all items regardless.
// Trim because cmd.exe's `set FAIL_FAST=0 && ...` includes the trailing
// space in the variable value, which would otherwise defeat `!== '0'`.
const FAIL_FAST = (process.env.FAIL_FAST ?? '').trim() !== '0';
const halted_modules = new Set();

const FIXTURE_ROOT = join(__dirname, 'fixtures');
const ID_MAP_PATH = join(__dirname, 'zeeschuimer-to-4cat.json');
const ID_MAP = existsSync(ID_MAP_PATH)
    ? JSON.parse(readFileSync(ID_MAP_PATH, 'utf8'))
    : {};

function wrap_for_map_item(stored_item) {
    const { data, ...meta } = stored_item;
    return { ...data, __import_meta: meta };
}

async function call_4cat_map_item(datasource_id, item) {
    const res = await fetch(`${FOURCAT_URL}/api/map-item/${datasource_id}/`, {
        method: 'POST',
        headers: {
            // 4CAT accepts the raw key without a `Bearer ` prefix, per probe
            'Authorization': FOURCAT_API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ item }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} from 4CAT: ${text}`);
    }
    return JSON.parse(text);
}

// Round-trip a value through JSON so MappedItem, MissingMappedField, etc.
// become plain JSON-compatible objects matching what 4CAT emits.
function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

// Recursive structural equality. Doesn't care about object key order, which
// matters for nested values like {__missing: true, value: ""} where JS and
// Python might emit keys in different orders.
function deep_equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deep_equal(v, b[i]));
    }
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) return false;
    return a_keys.every(k => k in b && deep_equal(a[k], b[k]));
}

function diff_objects(js_obj, py_obj) {
    const diffs = [];
    const keys = new Set([...Object.keys(js_obj ?? {}), ...Object.keys(py_obj ?? {})]);
    for (const key of keys) {
        const in_js = js_obj && key in js_obj;
        const in_py = py_obj && key in py_obj;
        if (!in_js) {
            diffs.push({ key, kind: 'only_python', python: py_obj[key] });
        } else if (!in_py) {
            diffs.push({ key, kind: 'only_js', js: js_obj[key] });
        } else if (!deep_equal(js_obj[key], py_obj[key])) {
            diffs.push({ key, kind: 'mismatch', js: js_obj[key], python: py_obj[key] });
        }
    }
    return diffs;
}

function format_diffs(diffs) {
    return diffs.map(d => {
        if (d.kind === 'only_js') {
            return `  + only in JS:     ${d.key} = ${JSON.stringify(d.js)}`;
        }
        if (d.kind === 'only_python') {
            return `  - only in Python: ${d.key} = ${JSON.stringify(d.python)}`;
        }
        return `  ~ ${d.key}\n      JS:     ${JSON.stringify(d.js)}\n      Python: ${JSON.stringify(d.python)}`;
    }).join('\n');
}

// Pull out the first few module-frame lines from an error's stack so the
// failure message points at where in modules/<name>.js the throw happened.
function format_error_with_location(err) {
    if (!err) return String(err);
    const message = err.message || String(err);
    const stack = err.stack || '';
    const module_frames = stack.split('\n')
        .filter(l => l.includes('/modules/') || l.includes('\\modules\\'))
        .slice(0, 3)
        .map(l => l.trim());
    return module_frames.length
        ? `${message}\n  ${module_frames.join('\n  ')}`
        : message;
}

function list_module_dirs() {
    if (!existsSync(FIXTURE_ROOT)) return [];
    return readdirSync(FIXTURE_ROOT).filter(name => {
        try { return statSync(join(FIXTURE_ROOT, name)).isDirectory(); }
        catch { return false; }
    });
}

// Per-test timeout: each test does one HTTP round-trip to 4CAT. Jest's
// default 5s is tight under load.
jest.setTimeout(30000);

if (!HAS_4CAT) {
    describe('map_item compare (JS vs 4CAT Python)', () => {
        test.skip('FOURCAT_URL / FOURCAT_API_KEY not configured — set them in tests/.env to enable', () => {});
    });
} else {
    const module_dirs = list_module_dirs();

    // Pre-pass: synchronously determine each module's state so we can branch
    // on it at registration time.
    const module_info = {};
    for (const module_name of module_dirs) {
        module_info[module_name] = await inspect_module(module_name);
    }

    let any_fixtures = false;

    for (const module_name of module_dirs) {
        const fixture_dir = join(FIXTURE_ROOT, module_name);
        const fixture_files = readdirSync(fixture_dir).filter(f => f.endsWith('.ndjson'));
        if (fixture_files.length === 0) continue;
        any_fixtures = true;

        const datasource_id = ID_MAP[module_name] ?? module_name;
        const info = module_info[module_name];

        if (info.state === 'no_map_item') {
            // eslint-disable-next-line no-console
            console.log(`[compare] skipping ${module_name}: modules/${module_name}.js does not export a map_item`);
            continue;
        }

        if (info.state === 'syntax_error' || info.state === 'import_error') {
            const msg = info.state === 'syntax_error'
                ? `syntax error:\n${info.error}`
                : `import failed: ${info.error.message}`;
            describe(`map_item compare: ${module_name}`, () => {
                test(`module loads`, () => { throw new Error(msg); });
            });
            continue;
        }

        // state === 'ok' — register per-item comparison tests
        const map_item = info.map_item;

        describe(`map_item compare: ${module_name} (4CAT id: ${datasource_id})`, () => {
            for (const fixture_file of fixture_files) {
                const lines = readFileSync(join(fixture_dir, fixture_file), 'utf8')
                    .split('\n')
                    .filter(line => line.trim().length > 0);

                describe(fixture_file, () => {
                    lines.forEach((line, i) => {
                        test(`item ${i}`, async () => {
                            if (FAIL_FAST && halted_modules.has(module_name)) {
                                throw new Error(
                                    '[halted after prior failure in this module — set FAIL_FAST=0 to run all items]'
                                );
                            }
                            try {
                                const stored_item = JSON.parse(line);

                                // 4CAT side
                                const response = await call_4cat_map_item(datasource_id, stored_item);

                                // JS side
                                let js_result;
                                let js_error;
                                try {
                                    js_result = map_item(wrap_for_map_item(stored_item));
                                } catch (e) {
                                    js_error = e;
                                }

                                if (response.status === 'mapped') {
                                    if (js_error) {
                                        throw new Error(
                                            `4CAT mapped this item but JS threw: ${format_error_with_location(js_error)}`
                                        );
                                    }
                                    const js_obj = normalize(js_result);
                                    const py_obj = normalize(response.item);
                                    const diffs = diff_objects(js_obj, py_obj);
                                    if (diffs.length > 0) {
                                        throw new Error(
                                            `${diffs.length} field(s) differ between JS and 4CAT:\n${format_diffs(diffs)}`
                                        );
                                    }
                                } else if (response.status === 'skipped') {
                                    if (!js_error) {
                                        throw new Error(
                                            `4CAT skipped this item ("${response.reason}") but JS produced a result`
                                        );
                                    }
                                    // Both rejected — good. Skip reasons may differ in wording.
                                } else if (response.status === 'error') {
                                    throw new Error(`4CAT errored on this item: ${response.message}`);
                                } else {
                                    throw new Error(`unexpected 4CAT response status: ${JSON.stringify(response)}`);
                                }
                            } catch (e) {
                                if (FAIL_FAST) halted_modules.add(module_name);
                                throw e;
                            }
                        });
                    });
                });
            }
        });
    }

    if (!any_fixtures) {
        describe('map_item compare (JS vs 4CAT Python)', () => {
            test.skip('no fixtures under tests/fixtures/<module>/*.ndjson', () => {});
        });
    }
}
