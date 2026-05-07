/**
 * Make js/lib.js's helpers available as globals inside the Jest test
 * environment, mirroring how the browser sees them after the manifest
 * loads lib.js as a plain script.
 *
 * map_item bodies reference these as free identifiers (MappedItem,
 * MissingMappedField, strip_tags, normalize_url_encoding, ...). Without this
 * shim they'd hit ReferenceError as soon as a test invokes map_item.
 *
 * Approach: read lib.js, wrap it in a new Function() body that returns the
 * named helpers, call the function, and assign the returned object onto
 * globalThis. (Earlier attempt with vm.runInThisContext failed because in
 * the jsdom env the vm context's global differs from jsdom's window.)
 *
 * If a new helper is added to lib.js, append its name to EXPOSED_NAMES.
 */

const fs = require('node:fs');
const path = require('node:path');

const EXPOSED_NAMES = [
    'traverse_data',
    'MappedItem',
    'MissingMappedField',
    'MapItemException',
    'wrap_for_map_item',
    'strip_tags',
    'normalize_url_encoding',
    'formatUtcTimestamp',
];

const lib_source = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'lib.js'),
    'utf8',
);

const factory = new Function(`
${lib_source}
return { ${EXPOSED_NAMES.join(', ')} };
`);

Object.assign(globalThis, factory());
