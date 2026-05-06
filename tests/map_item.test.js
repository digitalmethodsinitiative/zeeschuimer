/**
 * Auto-discovery test driver for module `map_item` functions.
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
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local mirror of wrap_for_map_item from js/lib.js.
 *
 * lib.js is loaded by the browser as a plain script (it defines globals
 * like traverse_data, MappedItem, wrap_for_map_item) and so cannot be
 * imported from Node. The wrap is three trivial lines with no dependencies
 * — duplicating it here is cheaper than restructuring lib.js into a module.
 * If lib.js's wrap_for_map_item ever gains real logic, this needs to track.
 */
function wrap_for_map_item(stored_item) {
    const { data, ...meta } = stored_item;
    return { ...data, __import_meta: meta };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, 'fixtures');
const MODULES_ROOT = join(__dirname, '..', 'modules');

/**
 * Pre-validate module syntax before dynamic import.
 *
 * `await import()` on a module with a syntax error throws inside V8's module
 * linker in a way Jest's experimental-vm-modules can't always recover from
 * (worker retry loop or Node process exit). Running `node --check` first
 * gives us a clean error string we can fail the test with.
 */
function check_module_syntax(module_name) {
    const module_path = join(MODULES_ROOT, `${module_name}.js`);
    const result = spawnSync(process.execPath, ['--check', module_path], {
        encoding: 'utf8',
    });
    if (result.status === 0) return null;
    return (result.stderr || result.stdout || `exit code ${result.status}`).trim();
}

const REQUIRED_NON_EMPTY = {
    tiktok: ['id', 'author', 'unix_timestamp'],
};

function list_module_dirs() {
    if (!existsSync(FIXTURE_ROOT)) return [];
    return readdirSync(FIXTURE_ROOT).filter(name => {
        try { return statSync(join(FIXTURE_ROOT, name)).isDirectory(); }
        catch { return false; }
    });
}

const module_dirs = list_module_dirs();
let total_fixtures = 0;

for (const module_name of module_dirs) {
    const fixture_dir = join(FIXTURE_ROOT, module_name);
    const fixture_files = readdirSync(fixture_dir).filter(f => f.endsWith('.ndjson'));

    if (fixture_files.length === 0) continue;
    total_fixtures += fixture_files.length;

    describe(`map_item: ${module_name}`, () => {
        let map_item;
        let import_error;

        beforeAll(async () => {
            const syntax_error = check_module_syntax(module_name);
            if (syntax_error) {
                import_error = new Error(`syntax error:\n${syntax_error}`);
                return;
            }
            try {
                const mod = await import(`../modules/${module_name}.js`);
                map_item = mod.map_item;
                if (typeof map_item !== 'function') {
                    import_error = new Error(`modules/${module_name}.js does not export a map_item function`);
                }
            } catch (e) {
                import_error = e;
            }
        });

        for (const fixture_file of fixture_files) {
            const lines = readFileSync(join(fixture_dir, fixture_file), 'utf8')
                .split('\n')
                .filter(line => line.trim().length > 0);

            describe(fixture_file, () => {
                lines.forEach((line, i) => {
                    test(`item ${i} maps without throwing`, () => {
                        if (import_error) {
                            throw new Error(`failed to import modules/${module_name}.js: ${import_error.message}`);
                        }
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
