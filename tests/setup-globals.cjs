/**
 * Make js/lib.js's helpers available as globals inside the Jest test
 * environment, mirroring how the browser sees them after the manifest
 * loads lib.js as a plain script.
 *
 * map_item bodies reference these as free identifiers (MappedItem,
 * MissingMappedField, strip_tags, normalize_url_encoding, ...). Without
 * this shim they'd hit ReferenceError as soon as a test invokes map_item.
 *
 * Names are auto-discovered from lib.js by regex-matching top-level
 * `function name(...)` and `class Name ...` declarations. Adding a helper
 * to lib.js makes it available to tests without touching this file.
 */

const fs = require('node:fs');
const path = require('node:path');

const lib_source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'lib.js'),
    'utf8',
);

// Match `function name(` and `class Name {` / `class Name extends` at
// column 0 of a line. lib.js is a classic script with all top-level
// declarations unindented; requiring column 0 keeps nested helpers (like
// the `_traverse_data` IIFE inside `traverse_data`) from being exposed.
const NAME_PATTERN = /^(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm;
const EXPOSED_NAMES = Array.from(
    lib_source.matchAll(NAME_PATTERN),
    m => m[1],
);

if (EXPOSED_NAMES.length === 0) {
    throw new Error(
        'setup-globals.cjs: no top-level function/class declarations found in js/lib.js — ' +
        'auto-discovery regex may be broken. Tests will ReferenceError if not fixed.'
    );
}

const factory = new Function(`
${lib_source}
return { ${EXPOSED_NAMES.join(', ')} };
`);

Object.assign(globalThis, factory());
