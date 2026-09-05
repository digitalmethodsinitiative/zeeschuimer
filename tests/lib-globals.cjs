/**
 * The names Zeeschuimer's own scripts put into global scope.
 *
 * The manifest loads `inc/dexie.js`, `inc/he.js`, `js/lib.js`,
 * `js/zs-background.js` and `modules/_loader.js` as plain background scripts,
 * so their top-level declarations are shared globals. Module code — and the
 * `map_item` functions generated from 4CAT — uses those names without
 * declaring or importing anything.
 *
 * Two things need that list, and they need the same one:
 *   - `setup-globals.cjs`, which puts the helpers into scope for Jest.
 *   - `eslint.config.mjs`, which tells `no-undef` that these names exist.
 *
 * The names are read out of the source rather than typed here, so adding a
 * helper to `js/lib.js` makes it available to both without editing this file.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

// `js/lib.js` declares its helpers unindented at the top level. Requiring
// column 0 keeps nested helpers — such as the `_traverse_data` inside
// `traverse_data` — from being treated as globals.
const LIB_SOURCE = read('js', 'lib.js');
const LIB_DECLARATION = /^(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm;
const LIB_NAMES = Array.from(LIB_SOURCE.matchAll(LIB_DECLARATION), m => m[1]);

if (LIB_NAMES.length === 0) {
    throw new Error(
        'lib-globals.cjs: no top-level function or class declarations found in ' +
        'js/lib.js. The pattern that finds them is broken, and everything ' +
        'relying on those names will fail: tests with a ReferenceError, the ' +
        'linter with a no-undef error on every module.'
    );
}

// `js/zs-background.js` takes the other shape, assigning onto `window`.
const BACKGROUND_ASSIGNMENT = /^window\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
const BACKGROUND_NAMES = Array.from(
    read('js', 'zs-background.js').matchAll(BACKGROUND_ASSIGNMENT),
    m => m[1],
);

// `inc/dexie.js` and `inc/he.js` are third-party bundles: minified, and
// wrapped so that nothing about them can be read off the source. Their names
// are written out here, and only change if one of those libraries is swapped.
const VENDORED_NAMES = ['Dexie', 'he'];

const ALL_NAMES = [...new Set([...LIB_NAMES, ...BACKGROUND_NAMES, ...VENDORED_NAMES])];

module.exports = { LIB_SOURCE, LIB_NAMES, BACKGROUND_NAMES, VENDORED_NAMES, ALL_NAMES };
