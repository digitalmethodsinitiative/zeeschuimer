/**
 * Shared helper for the map_item test drivers.
 *
 * Pre-validates a module by:
 *   1. Running `node --check` on its file (syntax check; avoids the
 *      worker-killing experimental-ESM crash when a syntax error reaches
 *      the dynamic importer).
 *   2. Dynamically importing it and checking for a `map_item` export.
 *
 * Returns one of four states the test driver can branch on:
 *   { state: 'ok',           map_item: <fn> }
 *   { state: 'no_map_item' }
 *   { state: 'syntax_error', error: <string> }
 *   { state: 'import_error', error: <Error> }
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES_ROOT = join(__dirname, '..', 'modules');

function check_module_syntax(module_name) {
    const module_path = join(MODULES_ROOT, `${module_name}.js`);
    const result = spawnSync(process.execPath, ['--check', module_path], { encoding: 'utf8' });
    if (result.status === 0) return null;
    return (result.stderr || result.stdout || `exit code ${result.status}`).trim();
}

export async function inspect_module(module_name) {
    const syntax_error = check_module_syntax(module_name);
    if (syntax_error) {
        return { state: 'syntax_error', error: syntax_error };
    }
    try {
        const mod = await import(`../modules/${module_name}.js`);
        if (typeof mod.map_item !== 'function') {
            return { state: 'no_map_item' };
        }
        return { state: 'ok', map_item: mod.map_item };
    } catch (e) {
        return { state: 'import_error', error: e };
    }
}
