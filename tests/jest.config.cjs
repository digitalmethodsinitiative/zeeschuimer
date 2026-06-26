// Default Jest config — Tier 1 only (duplicate-behavior + load-only smoke).
// The comparator is excluded; invoke it via `npm run test:compare`.
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', 'map_item_compare\\.test\\.js$'],
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  collectCoverageFrom: ['*.test.js'],
  setupFiles: ['<rootDir>/setup-globals.cjs'],
  verbose: true
};
