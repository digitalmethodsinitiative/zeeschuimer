# Selenium Test Harness — Improvement Plan

Date: 2026-04-30

Overview

This document captures an actionable plan to improve the Selenium-based integration tests in `tests/test.py` for the Zeeschuimer Firefox extension. The goals are to:

- Make profile handling reliable and reusable (so logged-in sessions persist across runs).
- Preserve and export captured data per platform for offline analysis and for passing to 4CAT.
- Add optional automated upload to a 4CAT instance for mapping/validation tests.
- Reduce fragility caused by popups and interactive dialogs (pausing/dismissal patterns).
- Improve robustness, error handling, and machine-readable results.

Scope

All changes are confined to the test harness and test metadata (`tests/test.py` and `tests/tests.json`) and to this planning document. No changes are required in the extension source for the planned items (the test harness will interact with the extension's UI pages and background DB).

Phases & Changes

Phase 1 — Profile management

- Problem: copying an entire profile can race with a running Firefox and the current ignore rule hides potentially useful session data.
- Changes:
  - Detect if the selected profile directory appears locked (presence of `lock` or `.parentlock`) and warn if Firefox is running.
  - Replace the naive ignore lambda used in `shutil.copytree` with a function that only excludes `storage`, `extensions`, and `signedInUser.json` at the profile root.
  - Add CLI flags: `--profile-name NAME` (choose profile by display name from `profiles.ini`), `--save-profile PATH` (save the temp profile for reuse), and `--no-cleanup` (do not remove `.temp-profile` after run).

Implementation note (copytree ignore example):

```python
def _profile_ignore(root, names):
    # Only ignore these entries in the root profile dir
    if os.path.abspath(root) == os.path.abspath(profile_dir):
        return {"storage", "extensions", "signedInUser.json"}
    return set()

shutil.copytree(profile_dir, profile_file, ignore=_profile_ignore)
```

Phase 2 — Data preservation & export

- Problem: `reset-all` wipes the DB before each URL; no artifacts are kept for post-mortem or mapping tests.
- Decision: export a single combined NDJSON file per platform containing items collected while testing that platform.
- Changes:
  - Add CLI `--export-dir PATH` (default `./zeeschuimer-exports/{timestamp}/`).
  - Before clicking `reset-all` for each URL, read the current DB contents from the extension background page (Dexie) via `execute_async_script` and append those items to a per-platform in-memory list in Python. After all URLs for a platform are done, write `{export-dir}/{platform}.ndjson`.
  - Optionally add `--no-reset` to skip the `reset-all` call entirely (default behavior remains to reset before each URL).

Execute_async_script pattern (example):

```python
script = '''
const cb = arguments[0];
background.db.items.toArray().then(items => cb(JSON.stringify(items))).catch(e => cb(JSON.stringify({error: String(e)})));
'''
items_json = driver.execute_async_script(script)
items = json.loads(items_json)
```

Phase 3 — 4CAT integration (optional)

- Problem: mapping tests live in 4CAT and need NDJSON input.
- Changes:
  - Add CLI flags: `--4cat-url URL` and `--4cat-key KEY` (API key). Require both for upload.
  - After writing the per-platform NDJSON, POST it to `{4cat_url.rstrip('/')}/api/import-dataset/` with header `X-Zeeschuimer-Platform: {platform}` and `Authorization: Bearer {key}` (confirm header with your 4CAT instance; alternative is to trigger the extension UI upload button when cookie-based auth is required).
  - Do not fail the test run on 4CAT errors — print status and continue.

Example upload with `requests`:

```python
import requests
with open(ndjson_path, 'rb') as f:
    headers = {
        'X-Zeeschuimer-Platform': platform,
        'Authorization': f'Bearer {fourcat_key}'
    }
    r = requests.post(f"{fourcat_url.rstrip('/')}/api/import-dataset/", headers=headers, data=f)
    # check r.status_code and r.text for details
```

Phase 4 — Interactive controls & popup dismissals

- Problem: cookie banners, paywall prompts, and other popups frequently interfere with automated navigation and can cause false failures.
- Decision: pause by default **once per platform** (not before every URL) so the tester can clear residual prompts; provide opt-out and finer-grained options.
- Changes:
  - CLI flags: `--no-interactive` (disable all pauses), `--pause-before-url` (pause before each URL), `--pause-on-fail` (pause on failure), `--extra-wait N` (add N seconds to every wait), `--screenshot-dir PATH` (capture screenshots on fail/warning).
  - Add a `dismiss-selectors` optional field in `tests.json` per URL: a list of CSS selectors to click to dismiss known popups. Example:

```json
"dismiss-selectors": ["button.cookie-accept", ".modal .close"]
```

  - Add per-URL `timeout` (page load timeout override).

Phase 5 — Runner robustness & reporting

- Problem: unhandled exceptions abort the run; final runtime is calculated incorrectly; no machine-readable results.
- Changes:
  - Wrap each URL test body in try/except, increment `failed` on exceptions, and continue.
  - Move the global `start_time = time.time()` to before the outer platform loop so the final elapsed time is for the full run.
  - Add CLI flags: `--results-file PATH` (write JSON summary), `--resume-from PLATFORM` (skip earlier platforms), and `--screenshot-dir PATH` (as noted).
  - Fix small test metadata issues (e.g., `more-after-scrolll` typo in `tests.json`).

tests.json schema additions

- Per-URL optional fields:
  - `dismiss-selectors`: array of CSS selectors to click after page load
  - `timeout`: numeric page load timeout seconds for this URL
  - `extra-wait`: per-URL additional wait seconds

CLI flags (summary)

- `--profiledir PATH` — explicit profile path (existing)
- `--profile-name NAME` — choose Firefox profile by display name
- `--save-profile PATH` — persist the copied profile for reuse
- `--no-cleanup` — keep `.temp-profile`
- `--export-dir PATH` — where to write NDJSON exports
- `--no-reset` — do not click `reset-all` between URLs
- `--4cat-url URL` — base URL for 4CAT server
- `--4cat-key KEY` — API key for 4CAT uploads
- `--4cat-per-url` — upload per URL instead of per platform (optional)
- `--no-interactive` — disable pausing (default is to pause per-platform)
- `--pause-before-url` — pause before each URL
- `--pause-on-fail` — pause when a test fails
- `--extra-wait N` — add N seconds to every URL wait
- `--screenshot-dir PATH` — save screenshots on fail/warning
- `--results-file PATH` — write machine-readable results JSON
- `--resume-from PLATFORM` — resume a run from a platform

Verification checklist

1. `python tests/test.py --sources instagram.com --export-dir ./exports` -> `exports/instagram.com.ndjson` exists and contains NDJSON with captured items.
2. `python tests/test.py --save-profile .saved-profile --login` -> create a saved profile that can be reused with `--profiledir .saved-profile`.
3. Run with default interactive behavior and confirm one pause per platform.
4. `python tests/test.py --results-file results.json` -> JSON summary produced with per-URL status and counts.
5. Test 4CAT upload using a local mock server and `--4cat-url http://localhost:8000 --4cat-key KEY`.

Implementation steps (recommended order)

1. Docs and small fixes (this document + tests.json typo fix).
2. Profile management changes (`--profile-name`, improved copy ignore, `--save-profile`, lock detection).
3. Export behavior: `--export-dir` + `execute_async_script` collection and NDJSON write.
4. Runner robustness: try/except around URL loop, `--results-file`, fix `start_time` placement.
5. Interactive and dismissal features (`dismiss-selectors`, pause flags, screenshots).
6. 4CAT upload integration (optional, requires confirmation of auth header).

Estimated effort: 6–10 hours of focused work to implement and test everything end-to-end; can be split into 3-4 incremental PRs.

Open questions / confirmations needed

- Confirm 4CAT API key header format (currently suggested: `Authorization: Bearer {key}`). If your 4CAT requires cookie-based auth, we should emulate the extension upload button via Selenium instead.
- Confirm desired default for interactive mode. (Current recommendation: pause once per platform by default; provide `--no-interactive` to run fully headless.)

Next steps

- I have created a matching TODO list in the session tracker and written this document to `docs/test-plan.md`.
- If you want, I can start implementing Phase 1 (profile management) in `tests/test.py` now and submit incremental changes.

---

Requested file: `docs/test-plan.md`
