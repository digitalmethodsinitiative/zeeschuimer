/**
 * The names Zeeschuimer's own scripts put into global scope.
 *
 * manifest.json loads the scripts under `background` as plain scripts, so what
 * they declare at their top level is shared. Module code — and the `map_item`
 * functions generated from 4CAT — uses those names without declaring or
 * importing anything.
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

// The scripts that share the background page's global scope, in the order the
// browser loads them.
const BACKGROUND_SCRIPTS = JSON.parse(read('manifest.json')).background?.scripts;

if (!Array.isArray(BACKGROUND_SCRIPTS) || BACKGROUND_SCRIPTS.length === 0) {
    throw new Error(
        'lib-globals.cjs: manifest.json has no background.scripts for this file to ' +
        'read.'
    );
}

// `inc/dexie.js` and `inc/he.js` are third-party bundles: minified, and wrapped
// so that nothing about them can be read off the source. Their names are written
// out here against the path the manifest loads them from.
const VENDORED_NAMES = {
    'inc/dexie.js': ['Dexie'],
    'inc/he.js': ['he'],
};

const unloaded = Object.keys(VENDORED_NAMES).filter(script => !BACKGROUND_SCRIPTS.includes(script));
if (unloaded.length > 0) {
    throw new Error(
        `lib-globals.cjs: ${unloaded.join(', ')} named above, but manifest.json does ` +
        'not load it. A renamed file or a swapped-out library leaves an entry here ' +
        'that no longer does anything; drop it, or correct the path.'
    );
}

// Identify the names one statement declares. A statement that declares nothing like a
// function call, an assignment, or an if block gives back an empty list.
function declared_names(statement, script, source) {
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
                const line = declaration.loc.start.line;
                throw new Error(
                    `lib-globals.cjs: ${script} line ${line} declares names in a ` +
                    'form this file does not read:\n\n' +
                    `    ${source.split('\n')[line - 1].trim()}\n\n` +
                    'Add that form to declared_names(), or declare the names one ' +
                    'per line.'
                );
            }
        });
    }
    return [];
}

// Identify the name one statement hangs off `window`. js/zs-background.js opens
// with `window.db = new Dexie(...)` and `window.zeeschuimer = {...}`, and this
// picks `db` and `zeeschuimer` out of them.
function assigned_names(statement) {
    // First drop anything that is not an assignment
    if (statement.expression?.type !== 'AssignmentExpression') {
        return [];
    }

    // Then take the name after the dot in `window.<name>`. Only that spelling: the
    // browser treats `window['db'] = ...` and `window[key] = ...` the same way,
    // but the first hides the name inside a string and the second does not have
    // one in the file at all. Neither appears in js/zs-background.js.
    const target = statement.expression.left;
    if (!target.computed && target.object?.name === 'window') {
        return [target.property.name];
    }

    return [];
}

// Every name a script puts into global scope. `body` holds the outermost
// statements only, so a helper written inside another one like `_traverse_data`
// inside `traverse_data` is not in the list.
function global_names(script, source) {
    return espree
        .parse(source, { ecmaVersion: 'latest', sourceType: 'script', loc: true })
        .body.flatMap(statement => [
            ...declared_names(statement, script, source),
            ...assigned_names(statement),
        ]);
}

// setup-globals.cjs evaluates js/lib.js and pulls these names back out of it.
const LIB_SOURCE = read('js/lib.js');
const LIB_NAMES = global_names('js/lib.js', LIB_SOURCE);

// Every script is expected to put something into global scope, so one that
// contributes nothing probably means this file could not read it rather than that 
// there was nothing to find.
const ALL_NAMES = [...new Set(BACKGROUND_SCRIPTS.flatMap(script => {
    if (script in VENDORED_NAMES) {
        return VENDORED_NAMES[script];
    }

    const names = global_names(script, read(script));
    if (names.length === 0) {
        throw new Error(
            `lib-globals.cjs: manifest.json loads ${script}, but no global names ` +
            'could be read out of it. Add them to VENDORED_NAMES above, keyed by ' +
            `'${script}' or, if it really does declare nothing, list it there ` +
            'with an empty array.'
        );
    }
    return names;
}))];

module.exports = { LIB_SOURCE, LIB_NAMES, ALL_NAMES };
