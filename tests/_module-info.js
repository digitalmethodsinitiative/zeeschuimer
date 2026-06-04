/**
 * Shared helper for the map_item test drivers.
 *
 * Pre-validates a module by:
 *   1. Running `node --check` on its file (syntax check; avoids the
 *      worker-killing experimental-ESM crash when a syntax error reaches
 *      the dynamic importer).
 *   2. Dynamically importing it and checking for a `map_item` export.
 *
 * Results are cached per module name so test files that load this helper
 * via separate Jest workers/files don't pay the spawnSync cost twice.
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

const syntax_cache = new Map();
const inspect_cache = new Map();

function check_module_syntax(module_name) {
    if (syntax_cache.has(module_name)) return syntax_cache.get(module_name);
    const module_path = join(MODULES_ROOT, `${module_name}.js`);
    const result = spawnSync(process.execPath, ['--check', module_path], { encoding: 'utf8' });
    const out = result.status === 0
        ? null
        : (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    syntax_cache.set(module_name, out);
    return out;
}

export async function inspect_module(module_name) {
    if (inspect_cache.has(module_name)) return inspect_cache.get(module_name);
    const syntax_error = check_module_syntax(module_name);
    let result;
    if (syntax_error) {
        result = { state: 'syntax_error', error: syntax_error };
    } else {
        try {
            const mod = await import(`../modules/${module_name}.js`);
            result = typeof mod.map_item === 'function'
                ? { state: 'ok', map_item: mod.map_item }
                : { state: 'no_map_item' };
        } catch (e) {
            result = { state: 'import_error', error: e };
        }
    }
    inspect_cache.set(module_name, result);
    return result;
}
