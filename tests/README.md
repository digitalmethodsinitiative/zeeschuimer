## Tests for Zeeschuimer

This folder contains testing code for Zeeschuimer. Each check below has a
different purpose and a different runtime environment:

| Suite                            | Tests                                                     | Environment        | When it runs                    | Needs                                  |
|----------------------------------|-----------------------------------------------------------|--------------------|---------------------------------|----------------------------------------|
| Selenium integration             | Page captures real items from each supported platform     | Real Firefox       | Reviewer-supervised, manual     | Firefox profile, sometimes a human     |
| Duplicate-behavior unit (Jest)   | DB merge / keep / update semantics in isolation           | jsdom + fake-IDB   | `npm test` (every push)         | None                                   |
| Navigation index (Jest)          | The real background script counts navigations and dedupes across them | jsdom + fake-IDB   | `npm test` (every push)         | None                                   |
| Module load smoke (Jest, Tier 1) | Each `modules/*.js` parses and imports cleanly            | jsdom              | `npm test` (every push)         | None                                   |
| Navigation index (Jest)          | Tab and navigation bookkeeping in `js/zs-background.js`   | jsdom + fake-IDB   | `npm test` (every push)         | None                                   |
| ESLint                           | Every name `js/` and `modules/` use is defined somewhere  | Node               | `npm run lint` (every push)     | None                                   |
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

`tests/blank_firefox_profile` is a profile kept for exactly this, with logins
to the platforms that need one. It is the profile to pass to `--profiledir`.

**Adding or refreshing a login in it.** The run works on a *copy* of the
profile (`.temp-profile`) and deletes that copy when it finishes, so logging in
during a run is thrown away. Log in to the profile itself instead: close the
tests, start Firefox on it directly, log in, and close the window so the
cookies are written to disk.

```powershell
& 'C:/Program Files/Mozilla Firefox/firefox.exe' -no-remote -profile 'C:/path/to/zeeschuimer/tests/blank_firefox_profile'
```

`-no-remote` matters: without it Firefox hands the request to an instance that
is already running and uses that instance's profile instead, and nothing is
saved where the tests will look. `about:profiles` in the new window shows which
profile is actually in use.

Logins expire. If a platform's tests start failing in a way that looks like
being logged out, refresh its login the same way. The stored cookies and their
expiry dates can be read from `cookies.sqlite` in that folder.

The same applies to the 4CAT server used by `--fourcat`: uploads authenticate
with the browser session, so log in to it in this profile too and the tests
will stop asking.

RedNote (Xiaohongshu) is the exception: an account needs a Chinese phone
number, and no current developer has one, so all RedNote development and
testing is done logged out. Logged out, search redirects to the login page,
saved-post boards are empty, and profile pages show only their first 12
posts, without post IDs. Anything that needs a login can only be checked
against items researchers have already collected and uploaded to 4CAT.
RedNote also limits logged-out browsing: after enough page views, every page
redirects to the login page, even after clearing cookies.

Weibo is tested logged out as well, since no current developer has an account.
Logged out, Weibo shows no search results, profile timelines or reposts, so
the Weibo tests do not cover them.

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
        "wait": 10,
        "comment": "free-form note, ignored by the runner",
        "captcha-selector": "div#captcha_container"
      }
    }
  }
}
```

`expected` may be a single number or a `[low, high]` range, inclusive. A range
is usually the honest answer: platforms load in batches and a slow page lands
on a lower count without anything being wrong. `captcha-selector` names an
element whose appearance pauses the run so a human can solve the captcha.

Douyin is the exception to the borrowed-login note above: no maintainer
currently has an account, so its expectations record what a **logged-out**
visitor sees. Search is not covered at all, because Douyin will not show
results without a login.

#### Sending a run to 4CAT

A capture is only useful if 4CAT can read it, and a module that starts
returning a new shape breaks that quietly. `--fourcat` uploads what each
platform captured, as one dataset per platform, once that platform's tests
finish:

```bash
python3 test.py --fourcat http://localhost
```

Uploading is deliberate about a few things:

- **One dataset per platform, not per test case.** Which case an item came from
  is recoverable afterwards from `source_platform_url` in the NDJSON.
- **A bad run is uploaded too.** A capture 4CAT cannot read is the finding, not
  a reason to withhold it.
- **You must be logged in to that 4CAT in the test browser.** Uploads
  authenticate with the browser session, not an API key, so the script checks at
  startup and waits rather than discovering it after the first platform. Note
  that a session cookie is not written to disk, so a profile that was logged in
  when it was copied usually is not logged in when the tests run - expect to log
  in at the prompt.
- **Failures ask rather than abort.** Not logged in, rate limited, or refused:
  the run pauses with `[Enter] retry`, `[s]` skip this platform, `[n]` stop
  uploading. With no terminal attached it takes the last of those and carries
  on.

The run ends with the dataset URLs and a line to paste into `tests/.env`, so the
`map_item` comparator can be pointed straight at what was just captured:

```
FOURCAT_DATASETS=a1b2c3,d4e5f6
```

`--dump-dir <folder>` writes the same NDJSON to disk instead of, or as well as,
uploading. It is byte for byte what an upload sends, so a dump can be uploaded
by hand later. `--keep-open` leaves the browser running at the end so the
captured items can be looked at in the interface.

### Jest suites

**Prerequisites**
- Node.js (v20.19 or later, the floor ESLint sets) and npm
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

#### Navigation index

`tests/nav-index.test.js` evaluates `js/zs-background.js` the way the browser
does - as a classic script against `Dexie` and `browser` globals - and calls
the functions it defines.

This is deliberately not a re-implementation. The duplicate-behavior suite
above supplies `nav_index` values as fixtures (`'1:1:0'`, `'1:1:1'`), which
assumes navigations are counted correctly without ever running the code that
counts them; a `nav_handler` that stored `NaN` on every navigation therefore
went unnoticed while every test passed.

Coverage:
- `nav_handler` assigns a first index and increments it on each navigation
- the stored index stays a usable number
- consecutive navigations produce distinct indices
- the object form `webNavigation.onCommitted` passes is unwrapped
- tabs are counted independently
- an item seen twice on one page is stored once
- "keep duplicates" records an item once per page it appears on
- "skip duplicates" keeps only the first sighting

The duplicate-handling cases browse three pages rather than two: an index that
is merely wrong still differs from the initial one, so a single navigation
cannot tell a working counter from a stuck one.

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
# everything that's hermetic — duplicate-behavior, nav index, module smoke
npm test

# watch mode for the same
npm run test:watch

# ESLint over js/ and modules/
npm run lint

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
- **Behaviour of the background script itself.** Navigation-index suite. Call
  the real functions from `js/zs-background.js` rather than restating what they
  are supposed to do.
- **Field-by-field correctness against 4CAT's Python `map_item`.** Tier 2
  comparator. Add a dataset to `FOURCAT_DATASETS` that covers the case;
  the comparator will pick it up.
- **End-to-end user flow in the extension.** Selenium.
- **A name that nothing defines** — a helper a `map_item` calls but no file
  declares. Nothing to add: ESLint's `no-undef` covers every name in `js/` and
  `modules/` already.

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
