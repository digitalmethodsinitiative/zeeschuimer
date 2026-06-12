/**
 * Load-only smoke for every module under `modules/*.js`.
 *
 * For each module file, runs `inspect_module()` and asserts the module:
 *   - parses (no SyntaxError)
 *   - imports without throwing
 *   - either exports a `map_item` function, or doesn't (both are fine here)
 *
 * No data is fed through `map_item`. That work belongs in the comparator
 * (Tier 2 — `npm run test:compare`), where real items pulled from a 4CAT
 * dataset provide both the input and the expected output.
 *
 * Catches: parse errors, import-time throws, broken top-level statements.
 * Does NOT catch: anything that requires running `map_item` on real input.
 */

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect_module } from './_module-info.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = join(__dirname, '..', 'modules');

const module_files = readdirSync(MODULES_ROOT)
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));

const module_info = {};
for (const file of module_files) {
    const name = file.replace(/\.js$/, '');
    module_info[name] = await inspect_module(name);
}

describe('module load smoke', () => {
    for (const file of module_files) {
        const name = file.replace(/\.js$/, '');
        test(`modules/${file} loads cleanly`, () => {
            const info = module_info[name];
            if (info.state === 'syntax_error') {
                throw new Error(`syntax error in modules/${file}:\n${info.error}`);
            }
            if (info.state === 'import_error') {
                throw new Error(`import failed for modules/${file}: ${info.error.message}`);
            }
            // 'ok' or 'no_map_item' — both acceptable at this tier.
            expect(['ok', 'no_map_item']).toContain(info.state);
        });
    }
});
