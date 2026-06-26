// Tier 2 — live comparator against a 4CAT instance.
//
// Runs only `map_item_compare.test.js`. Requires FOURCAT_URL,
// FOURCAT_API_KEY, and FOURCAT_DATASETS to be set in tests/.env. Hard-errors
// rather than silently skipping if env is missing.
//
// Env is jsdom so that the four modules using `strip_tags` (gab, pinterest,
// rednote, truth) have a native DOMParser. The comparator uses cross-fetch
// to provide a jsdom-friendly fetch (jsdom doesn't ship fetch and undici
// crashes inside jsdom).
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/map_item_compare.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  setupFiles: ['<rootDir>/setup-globals.cjs'],
  testTimeout: 30000,
  verbose: true
};
