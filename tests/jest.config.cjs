module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.js'],
  transform: {},
  moduleFileExtensions: ['js', 'json'],
  collectCoverageFrom: ['*.test.js'],
  setupFiles: ['<rootDir>/setup-globals.cjs'],
  verbose: true
};
