/**
 * Put js/lib.js's helpers into global scope for Jest, the way the browser sees
 * them after the manifest loads lib.js as a plain script.
 *
 * `map_item` bodies use these as free identifiers — MappedItem,
 * MissingMappedField, strip_tags, normalize_url_encoding and the rest — and
 * would hit ReferenceError without this.
 *
 * lib-globals.cjs works out which names those are; the ESLint config reads it
 * too. Only lib.js is evaluated here; nav-index.test.js evaluates
 * js/zs-background.js itself, with the browser API stubs that file needs.
 */

const { LIB_SOURCE, LIB_NAMES } = require('./lib-globals.cjs');

const factory = new Function(`
${LIB_SOURCE}
return { ${LIB_NAMES.join(', ')} };
`);

Object.assign(globalThis, factory());
