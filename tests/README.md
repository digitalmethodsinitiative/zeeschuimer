## Tests for Zeeschuimer

This folder contains **testing** code for Zeeschuimer.

### Integration Tests (Selenium)

The Python + Selenium tests visit pages on supported platforms
and see how many items are captured. If the amount of items captured is 
unexpectedly low or high, this is flagged and may indicate that Zeeschuimer no
longer properly captures data from the platform.

These tests are **supervised** i.e. they require monitoring by a human and 
cannot run fully autonomously, since some platforms (TikTok in particular)
occasionally show CAPTCHAs that need to be completed for a test to run
successfully. This is also why Selenium does not run a headless Firefox.

The amount of items returned per page is somewhat variable for most platforms,
so if the number is slightly lower or higher than expected this is not 
necessarily a problem (but worth checking).

Additionally, most platforms require logging in before (full) access to the UI
is available. The testing script borrows a Firefox profile directory from 
elsewhere on the system to do this. It will try to find one automatically but
you can also pass one with the `--profiledir` argument. The idea is that you
log in to the various sites (Instagram, etc) in your 'normal' Firefox, and the
tests then borrow that login to interface with the website.

Run `test.py` to run tests. Required non-standard libraries are in 
`requirements.txt`.

Tests are defined in `tests.json` with the following structure:

```json
{
  "platform id as in zeeschuimer (e.g. 'tiktok.com')": {
    "test case (e.g. 'Home feed')": {
      "url": {
        "expected": 0,  # amount of items expected to be captured on this page
        "more-after-scroll": false,  # whether scrolling is supposed to load more items (currently unsupported)
        "wait": 10  # wait time before checking number of items (optional, default 5)
      } # more URLS can be added per test case
    }
  }
}
```

### Unit Tests (Jest)

The JavaScript unit tests verify duplicate-handling logic in isolation using 
a mocked Dexie database. These tests ensure that when the duplicate behavior 
setting is changed, the correct existing record is selected for updates.

**Prerequisites**
- Node.js (v18 or later) and npm must be installed

**Setup**

1. Install Node.js dependencies:
   ```bash
   cd tests
   npm install
   ```

**Running tests**

```bash
npm test
```

For watch mode during development:
```bash
npm run test:watch
```

**Test coverage**
- Schema upgrade backfills `last_updated` from `timestamp_collected`
- Compound index correctly selects most recent item by `last_updated`
- Forward-looking behavior: switching from "keep" to "update" targets newest record
- Forward-looking behavior: switching from "update" to "keep" creates new records
- Merge behavior: shallow merge preserves fields from both records
- Skip behavior: no modifications occur when duplicate found
- Platform isolation: same `item_id` on different platforms are independent
- Tie-breaker: when `last_updated` is equal, prefer higher `id`
