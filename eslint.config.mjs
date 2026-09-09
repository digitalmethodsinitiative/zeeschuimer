/**
 * ESLint configuration for Zeeschuimer.
 *
 * The rules are ESLint's recommended set, with the ones listed below switched
 * off. The one doing most of the work is `no-undef`: manifest.json loads most
 * of the extension as plain background scripts sharing one global scope, so the
 * helpers in `js/lib.js` are free identifiers everywhere, and nothing else
 * notices when one goes missing. That covers the `map_item` functions 4CAT
 * generates and syncs in, where a helper called but never defined has been the
 * most common way for a batch to arrive broken.
 *
 * The names those scripts share come from `tests/lib-globals.cjs`, which the
 * Jest setup reads as well.
 *
 * Run it with `npm run lint` from `tests/`.
 */
import { createRequire } from 'node:module';

// This file sits at the repository root, and the dependencies live in `tests/`.
// Resolving from there finds both the `globals` package and the shared name list.
const require = createRequire(new URL('tests/package.json', import.meta.url));
const globals = require('globals');
const js = require('@eslint/js');
const { ALL_NAMES, BACKGROUND_SCRIPTS } = require('./lib-globals.cjs');

const zeeschuimer_globals = Object.fromEntries(
    ALL_NAMES.map(name => [name, 'readonly']),
);

const rules = {
    ...js.configs.recommended.rules,

    // Every empty block in the codebase is a `catch` that means it.
    'no-empty': ['error', { allowEmptyCatch: true }],

    // Off: the `map_item` bodies 4CAT generates trip these, and a sync replaces
    // those blocks whole. None of them change what the code does.
    'no-extra-boolean-cast': 'off',    // !!value ? "yes" : "no"
    'no-redeclare': 'off',             // the same `var` declared twice in one function
    'no-unused-vars': 'off',           // variables assigned and then never read
    'no-useless-assignment': 'off',    // a value replaced before anything reads it
    'no-useless-escape': 'off',        // \[ and \/ inside a character class

    // Off, but not cosmetic: `obj.hasOwnProperty(key)` throws if the JSON a
    // platform sent has a key of that name. `Object.hasOwn(obj, key)` is the
    // fix, at 31 places across js/ and modules/.
    'no-prototype-builtins': 'off',
};

export default [
    {
        ignores: [
            'inc/**',            // third-party bundles, minified and not ours to fix
            '.claude/**',        // scratch worktrees hold copies of every module
            // Not extension code: a Firefox profile's prefs.js, a stealth script
            // written to run inside a page. What is, `npm test` runs.
            'tests/**',
            // `popup/interface.js` uses `init_tooltips` from `popup/tooltips.js`,
            // a separate script `popup/interface.html` loads into the same scope,
            // and nothing here works out that list. The other names no-undef
            // reports there are inside `download_blob`, which the file marks unused.
            'popup/**',
        ],
    },
    {
        // Capture and map_item modules. `modules/package.json` marks these as
        // ES modules; they still use the background-script globals.
        files: ['modules/**/*.js'],
        ignores: BACKGROUND_SCRIPTS,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.webextensions, ...zeeschuimer_globals },
        },
        rules,
    },
    {
        // Plain scripts: everything manifest.json lists under `background`, which
        // is how `modules/_loader.js` lands here rather than above, plus the rest
        // of `js/`.
        files: ['js/**/*.js', ...BACKGROUND_SCRIPTS],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser, ...globals.webextensions, ...zeeschuimer_globals },
        },
        rules,
    },
];
