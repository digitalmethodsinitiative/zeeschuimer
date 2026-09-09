/**
 * Make js/lib.js's helpers available as globals inside the Jest test
 * environment, mirroring how the browser sees them after the manifest
 * loads lib.js as a plain script.
 *
 * map_item bodies reference these as free identifiers (MappedItem,
 * MissingMappedField, strip_tags, normalize_url_encoding, ...). Without
 * this shim they'd hit ReferenceError as soon as a test invokes map_item.
 *
 * Which names those are is worked out in lib-globals.cjs, which the ESLint
 * config reads as well so both agree on what exists. Only lib.js is evaluated
 * here; nav-index.test.js evaluates js/zs-background.js itself, with the browser
 * API stubs that file needs.
 */

const { LIB_SOURCE, LIB_NAMES } = require('./lib-globals.cjs');

const factory = new Function(`
${LIB_SOURCE}
return { ${LIB_NAMES.join(', ')} };
`);

Object.assign(globalThis, factory());
