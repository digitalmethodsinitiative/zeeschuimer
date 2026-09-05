/**
 * ESLint configuration for Zeeschuimer.
 *
 * The one rule enabled is `no-undef`: does this code use a name that nothing
 * defines? That is worth checking here because most of what the extension runs
 * is loaded as plain background scripts rather than as modules, so the helpers
 * in `js/lib.js` are free identifiers everywhere, and nothing else notices when
 * one of them goes missing. The Jest suite loads each module and confirms it
 * exports `map_item`, which a module referring to an undefined helper passes
 * without complaint — the error only appears once `map_item` actually runs, on
 * a researcher's machine.
 *
 * It also covers the `map_item` functions 4CAT generates and syncs in. Those
 * are written by a language model, and a helper called but never defined has
 * been the single most common way for a batch of them to arrive broken.
 *
 * The names those scripts share are worked out in `tests/lib-globals.cjs`,
 * read from the source so that adding a helper to `js/lib.js` needs no edit
 * here. The Jest setup reads the same file, so the two cannot drift apart.
 *
 * Run it with `npm run lint` from `tests/`.
 */
import { createRequire } from 'node:module';

// This file sits at the repository root so that the linter can see every
// script the manifest loads, but the dependencies live in `tests/`, which is
// the only part of Zeeschuimer with a package.json. Resolving from there finds
// both the `globals` package and the shared name list, which is CommonJS
// because the Jest setup file sharing it has to be.
const require = createRequire(new URL('tests/package.json', import.meta.url));
const globals = require('globals');
const { ALL_NAMES } = require('./lib-globals.cjs');

const zeeschuimer_globals = Object.fromEntries(
    ALL_NAMES.map(name => [name, 'readonly']),
);

export default [
    {
        ignores: [
            'inc/**',            // third-party bundles, minified and not ours to fix
            '**/node_modules/**',
            '.claude/**',        // scratch worktrees hold copies of every module
            // The test harness is left out on purpose. Running it is a stronger
            // check than `no-undef` could be, and most of what lives there is
            // not extension code at all: a Firefox profile's prefs.js, and a
            // stealth script written to run inside a page rather than in Node.
            'tests/**',
            // The popup is left out for now, and not because it is clean: it
            // reaches for `streamSaver` and `encode`, which come from scripts
            // popup.html loads out of `js/` that are not in the repository at
            // all, and it assigns `fileStream` and `writer` without declaring
            // them. Those want deciding on their own rather than as part of
            // switching a linter on, and until then including this directory
            // would leave every run red, which makes the next real failure
            // easy to miss.
            'popup/**',
        ],
    },
    {
        // Capture and map_item modules. `modules/package.json` marks these as
        // ES modules; they still reach for the background-script globals.
        files: ['modules/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.webextensions, ...zeeschuimer_globals },
        },
        rules: { 'no-undef': 'error' },
    },
    {
        // The background scripts themselves, loaded by the manifest as plain
        // scripts rather than as modules.
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser, ...globals.webextensions, ...zeeschuimer_globals },
        },
        rules: { 'no-undef': 'error' },
    },
];
