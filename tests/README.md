## Tests for Zeeschuimer

This folder contains testing code for Zeeschuimer. There are three suites,
each with a different purpose and a different runtime environment:

| Suite                            | Tests                                                     | Environment        | When it runs                    | Needs                                  |
|----------------------------------|-----------------------------------------------------------|--------------------|---------------------------------|----------------------------------------|
| Selenium integration             | Page captures real items from each supported platform     | Real Firefox       | Reviewer-supervised, manual     | Firefox profile, sometimes a human     |
| Duplicate-behavior unit (Jest)   | DB merge / keep / update semantics in isolation           | jsdom + fake-IDB   | `npm test` (every push)         | None                                   |
| Module load smoke (Jest, Tier 1) | Each `modules/*.js` parses and imports cleanly            | jsdom              | `npm test` (every push)         | None                                   |
| `map_item` comparator (Jest, Tier 2) | JS `map_item` output matches 4CAT's Python mapping per item | jsdom + cross-fetch | `npm run test:compare` (on demand) | Live 4CAT, API key, dataset key(s) |

Hermetic suites (no external dependencies) live in `npm test`. Anything that
requires a real browser, a 4CAT server, or a human in the loop is opt-in.

### Integration tests (Selenium)

The Python + Selenium tests visit pages on supported platforms and see how
many items are captured. If the amount of items captured is unexpectedly
low or high, this is flagged and may indicate that Zeeschuimer no longer
properly captures data from the platform.

These tests are **supervised** — they require monitoring by a human and
cannot run fully autonomously, since some platforms (TikTok in particular)
occasionally show CAPTCHAs that need to be completed for a test to run
successfully. This is also why Selenium does not run a headless Firefox.

The amount of items returned per page is somewhat variable for most
platforms, so if the number is slightly lower or higher than expected this
is not necessarily a problem (but worth checking).

Most platforms require logging in before (full) access to the UI is
available. The testing script borrows a Firefox profile directory from
elsewhere on the system to do this. It will try to find one automatically
but you can also pass one with the `--profiledir` argument. Log in to the
various sites (Instagram, etc) in your 'normal' Firefox, and the tests then
borrow that login.

Run `test.py` to run tests. Required non-standard libraries are in
`requirements.txt`.

Tests are defined in `tests.json` with the following structure:

```json
{
  "platform id as in zeeschuimer (e.g. 'tiktok.com')": {
    "test case (e.g. 'Home feed')": {
      "url": {
        "expected": 0,
        "more-after-scroll": false,
        "wait": 10
      }
    }
  }
}
```

### Jest suites

**Prerequisites**
- Node.js (v18 or later) and npm
- `cd tests && npm install`

**Recommended: develop the tests inside Docker.** On Windows the global
permission model can make `npm install` / `npm test` awkward to run from
an arbitrary shell, and an agentic assistant working in auto-mode will
hit deny-rules before it can do a `cross-fetch`-style dependency spike.
Any minimal `node:20`-or-newer image with this repo mounted in is
enough — install what you need, run `npm install`, run `npm test` and
`npm run test:compare`. The host's `tests/.env` is picked up via the
mount, and `FOURCAT_URL` can point at a 4CAT reachable from the
container (`host.docker.internal` on Windows/Mac, the host IP on
Linux).

#### Duplicate-behavior unit tests

Verify duplicate-handling logic in isolation using a mocked Dexie database.
Ensures that when the duplicate behavior setting is changed, the correct
existing record is selected for updates.

Coverage:
- Schema upgrade backfills `last_updated` from `timestamp_collected`
- Compound index correctly selects most recent item by `last_updated`
- Forward-looking behavior: "keep" → "update" targets newest record
- Forward-looking behavior: "update" → "keep" creates new records
- Merge: shallow merge preserves fields from both records
- Skip: no modifications occur when duplicate found
- Platform isolation: same `item_id` on different platforms are independent
- Tie-breaker: when `last_updated` is equal, prefer higher `id`

#### Module load smoke (Tier 1)

For every file under `modules/*.js`, `tests/map_item.test.js` asserts the
module parses and imports without throwing. Modules with a `map_item`
export and modules without one both pass this tier — the goal is purely to
catch a generator that emits a syntax error or an import-time throw.

No data is run through `map_item` here; that work belongs in the
comparator.

#### `map_item` comparator (Tier 2)

For every 4CAT dataset key listed in `FOURCAT_DATASETS`,
`tests/map_item_compare.test.js`:

1. sends a HEAD to the items endpoint and reads the datasource id from its
   `X-4CAT-Dataset-Datasource` response header (no metadata-endpoint call)
2. translates that id to a Zeeschuimer module name via
   `zeeschuimer-to-4cat.json` (used in reverse)
3. fetches `/download/<key>` (NDJSON inputs, already wrapped via
   `wrap_for_map_item` by Zeeschuimer pre-upload) and
   `/api/dataset/<key>/items/?annotations=no&missing_fields=keep&stream=true`
   (expected outputs from 4CAT's Python `map_item`, as NDJSON — `stream=true`
   avoids the JSON form's `limit=100` pagination)
4. pairs items by `id` (or by index with a warning if `id` is missing on
   either side), runs each input through the local `map_item`, and
   field-by-field diffs against the expected output (4CAT's API-only
   aggregate `missing_fields` key is excluded; per-field `{__missing:true}`
   markers are still compared)

The comparator does **not** exercise `wrap_for_map_item` itself — Zeeschuimer
applies it pre-storage and `/download/<key>` returns post-wrap items. This
is an accepted gap; see `docs/map-item-test-plan.md`.

**Configuration:** copy `tests/.env.example` to `tests/.env` and set:
- `FOURCAT_URL` — base URL of the 4CAT instance (no trailing slash)
- `FOURCAT_API_KEY` — raw API key (no `Bearer ` prefix)
- `FOURCAT_DATASETS` — comma-separated list of dataset keys

The comparator hard-errors at startup if any of these are missing.

**Optional knob:** by default the comparator halts a dataset at its first
failing item (reporting the rest as one skipped "halted" placeholder). To
compare *every* item, pass `--all`:

```bash
npm run test:compare -- <dataset_key> --all
```

`FAIL_FAST=0` (or `FAIL_FAST=false`) does the same, but prefer `--all`: an
inline `FAIL_FAST=0 npm run …` does not reliably reach node when npm/node is
the Windows binary run through WSL interop, and isn't env syntax in cmd.exe.
A CLI flag crosses every shell.

### Running

```bash
# everything that's hermetic — duplicate-behavior unit + module load smoke
npm test

# watch mode for the same
npm run test:watch

# the comparator — every dataset key in FOURCAT_DATASETS
npm run test:compare

# the comparator narrowed to one dataset key (must still appear in
# FOURCAT_DATASETS — protects against typos)
npm run test:compare -- <dataset_key>

# compare every item instead of halting at the first failure
npm run test:compare -- <dataset_key> --all
```

### Where does a new test go?

- **Pure data transformation, no live external state, runs anywhere.**
  Duplicate-behavior unit suite (DB logic) or the Tier 1 smoke
  (`map_item` static checks).
- **Field-by-field correctness against 4CAT's Python `map_item`.** Tier 2
  comparator. Add a dataset to `FOURCAT_DATASETS` that covers the case;
  the comparator will pick it up.
- **End-to-end user flow in the extension.** Selenium.

### Why the environments differ

The two Jest tiers run in **jsdom** rather than node env. The reasoning:

- `map_item` bodies are pure data transformation, but four of them
  (`gab`, `pinterest`, `rednote`, `truth`) call `strip_tags`, which
  invokes `new DOMParser()`. jsdom provides a spec-compliant native
  `DOMParser`; node env doesn't.
- jsdom doesn't ship `fetch`. The standard workaround
  (`undici`) crashes inside jsdom because it pokes at
  `clearImmediate` / `markResourceTiming` / fast-now timers that jsdom
  shadows. `cross-fetch` wraps `node-fetch` v2 internally and doesn't
  hit those Node internals, so it works in jsdom — the comparator
  imports `cross-fetch/polyfill` to assign `globalThis.fetch`.

The tradeoff is parser parity. `cross-fetch`-via-`node-fetch` and
jsdom's `DOMParser` are not byte-equal to Firefox's Gecko `DOMParser`,
which is what runs in production. Whitespace handling around `<br>` and
block elements is the usual suspect. If the comparator emits false-
positive diffs on text fields for the four `strip_tags` modules, the
right fix is to normalise whitespace in the comparator's `deep_equal`
rather than chase parser parity. The Selenium tier sits above and
provides the real-Gecko fidelity check.
