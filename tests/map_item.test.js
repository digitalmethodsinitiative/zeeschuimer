/**
 * Smoke test driver for module `map_item` functions.
 *
 * Convention:
 *   tests/fixtures/<module_name>/*.ndjson
 *
 * <module_name> matches a file in modules/ (e.g. "tiktok" maps to modules/tiktok.js).
 * Each .ndjson line is one Zeeschuimer-stored item exported from the popup.
 *
 * Each item is wrapped via wrap_for_map_item to mirror how 4CAT's importer
 * presents items to a map_item function, then run through the module's
 * map_item. Tests assert: function returns a non-null object, and any fields
 * listed in REQUIRED_NON_EMPTY for that module are present and non-empty.
 *
 * Module-level state is determined upfront by inspect_module():
 *   - 'ok'            → register per-item tests
 *   - 'no_map_item'   → register a single skipped test (not applicable)
 *   - 'syntax_error'  → register a single failing test pointing at the line
 *   - 'import_error'  → register a single failing test with the message
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect_module } from './_module-info.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, 'fixtures');

const REQUIRED_NON_EMPTY = {
    tiktok: ['id', 'author', 'unix_timestamp'],
};

/**
 * Local mirror of wrap_for_map_item from js/lib.js. lib.js is loaded by
 * the browser as a plain script and so cannot be imported from Node; this
 * three-line mirror is cheaper than restructuring lib.js into a module.
 */
function wrap_for_map_item(stored_item) {
    const { data, ...meta } = stored_item;
    return { ...data, __import_meta: meta };
}

function list_module_dirs() {
    if (!existsSync(FIXTURE_ROOT)) return [];
    return readdirSync(FIXTURE_ROOT).filter(name => {
        try { return statSync(join(FIXTURE_ROOT, name)).isDirectory(); }
        catch { return false; }
    });
}

const module_dirs = list_module_dirs();

// Pre-pass: synchronously determine each module's state so we can branch
// on it at describe/test registration time. Top-level await is supported
// in Jest's experimental-vm-modules mode.
const module_info = {};
for (const module_name of module_dirs) {
    module_info[module_name] = await inspect_module(module_name);
}

let total_fixtures = 0;

for (const module_name of module_dirs) {
    const fixture_dir = join(FIXTURE_ROOT, module_name);
    const fixture_files = readdirSync(fixture_dir).filter(f => f.endsWith('.ndjson'));
    if (fixture_files.length === 0) continue;
    total_fixtures += fixture_files.length;

    const info = module_info[module_name];

    if (info.state === 'no_map_item') {
        describe(`map_item: ${module_name}`, () => {
            test.skip(`modules/${module_name}.js does not export a map_item function — nothing to smoke test`, () => {});
        });
        continue;
    }

    if (info.state === 'syntax_error' || info.state === 'import_error') {
        const msg = info.state === 'syntax_error'
            ? `syntax error:\n${info.error}`
            : `import failed: ${info.error.message}`;
        describe(`map_item: ${module_name}`, () => {
            test(`module loads`, () => { throw new Error(msg); });
        });
        continue;
    }

    // state === 'ok' — register per-item tests
    const map_item = info.map_item;

    describe(`map_item: ${module_name}`, () => {
        for (const fixture_file of fixture_files) {
            const lines = readFileSync(join(fixture_dir, fixture_file), 'utf8')
                .split('\n')
                .filter(line => line.trim().length > 0);

            describe(fixture_file, () => {
                lines.forEach((line, i) => {
                    test(`item ${i} maps without throwing`, () => {
                        const stored_item = JSON.parse(line);
                        const mapped = map_item(wrap_for_map_item(stored_item));
                        expect(mapped).not.toBeNull();
                        expect(typeof mapped).toBe('object');
                        for (const field of REQUIRED_NON_EMPTY[module_name] ?? []) {
                            expect(mapped[field]).toBeDefined();
                            expect(mapped[field]).not.toBe('');
                            expect(mapped[field]).not.toBeNull();
                        }
                    });
                });
            });
        }
    });
}

if (total_fixtures === 0) {
    describe('map_item', () => {
        test.skip('no fixtures found under tests/fixtures/<module_name>/*.ndjson', () => {});
    });
}
