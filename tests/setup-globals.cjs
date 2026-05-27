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

// jsdom doesn't expose fetch and Jest's jsdom env shadows Node's global
// fetch, so the comparator can't hit 4CAT without help. Polyfill from
// undici (a Node-friendly HTTP client, separately installable on npm —
// distinct from the undici bundled internally by Node, which isn't
// require()-able by name).
// Note: tests that use fetch (e.g. map_item_compare.test.js) declare
// `@jest-environment node` at the top of the file. Node env has fetch
// natively. Don't try to polyfill into jsdom — undici's internals use
// Node-specific globals that jsdom shadows (clearImmediate,
// markResourceTiming, fast timers), and polyfilling them all is brittle.
