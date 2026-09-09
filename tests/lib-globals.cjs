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
const espree = require('espree');

const ROOT = path.join(__dirname, '..');

function read(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

const LIB_SOURCE = read('js', 'lib.js');

// Identify the names one statement declares. A statement that declares nothing like a
// function call, an assignment, or an if block returns gives back an empty list.
function declared_names(statement) {
    function declared_names(statement) {
    if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
        // functions and classes
        return [statement.id.name];
    }
    if (statement.type === 'VariableDeclaration') {
        // variables
        return statement.declarations.map(declaration => {
                if (declaration.id.type === 'Identifier') {
                    return declaration.id.name;
                } else {
                    // multiple names for a single statement
                    const line = declaration.loc.start.line;
                    throw new Error(
                        `lib-globals.cjs: js/lib.js line ${line} declares names in a ` +
                        'form this file does not read:\n\n' +
                        `    ${LIB_SOURCE.split('\n')[line - 1].trim()}\n\n` +
                        'Add that form to declared_names(), or declare the names one ' +
                        'per line.'
                    );
                }
            });
    }
}

// Every name js/lib.js declares at its top level. `body` holds the outermost
// statements only, so a helper written inside another one like`_traverse_data` 
// inside `traverse_data` is not in the list.
const LIB_NAMES = espree
    .parse(LIB_SOURCE, { ecmaVersion: 'latest', sourceType: 'script', loc: true })
    .body.flatMap(declared_names);

if (LIB_NAMES.length === 0) {
    throw new Error(
        'lib-globals.cjs: found nothing declared at the top level of js/lib.js. ' +
        'The tests and the linter both read this list, and neither works without it.'
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
