/**
 * Compare JS map_item output against 4CAT's Python map_item via dataset keys.
 *
 * For each 4CAT dataset key in FOURCAT_DATASETS, this test:
 *   1. HEADs the items endpoint to read the datasource id from the
 *      `X-4CAT-Dataset-*` response headers (no metadata-endpoint dependency)
 *   2. translates that id back to a Zeeschuimer module name via
 *      zeeschuimer-to-4cat.json (used in reverse)
 *   3. inspects the local module (must export map_item)
 *   4. fetches in parallel, both as NDJSON:
 *        /download/<key>                       -> INPUTS (post-wrap)
 *        /api/dataset/<key>/items/?annotations=no&missing_fields=keep&stream=true
 *                                              -> mapped EXPECTED OUTPUTS
 *   5. runs each input through the local map_item, then pairs by the
 *      resulting MAPPED `id` — which can differ from the raw input id (e.g.
 *      instagram maps to the post shortcode, not the numeric pk) — and
 *      deep-equals each mapped result against the corresponding expected
 *      output.
 *
 * The items endpoint is fetched with `stream=true` (NDJSON): its JSON-array
 * form paginates at `limit=100`, silently dropping rows on larger datasets.
 * `annotations=no` drops processor-added fields; `missing_fields=keep` keeps
 * unmapped fields as `{ __missing: true, value: "" }` markers (matching the JS
 * side) and additionally adds a comma-joined `missing_fields` summary key.
 * That summary is API-only — the JS map_item never emits it — so it is
 * excluded from the diff (see API_ONLY_FIELDS); the per-field markers it
 * summarizes are still compared.
 *
 * Items from /download/<key> already have `wrap_for_map_item` applied by
 * Zeeschuimer pre-upload, so they're fed to map_item directly without
 * re-wrapping. The trade-off is that this comparator does not exercise
 * `wrap_for_map_item` itself — see docs/map-item-test-plan.md for the
 * accepted-gap rationale.
 *
 * Environment notes (fetch + DOMParser):
 *   - jsdom env so `strip_tags` (used by gab/pinterest/rednote/truth) has
 *     a native DOMParser.
 *   - jsdom doesn't ship `fetch`. Spiked three candidates on 2026-06-03
 *     under node:20-alpine:
 *       * `undici`     — crashes at import in jsdom (pokes at
 *                        clearImmediate/markResourceTiming/fast-now
 *                        timers that jsdom shadows).
 *       * `node-fetch` v3 — imports clean but `res.text()` throws
 *                        `ReferenceError: TextDecoder is not defined`
 *                        (jsdom doesn't expose TextDecoder as a global).
 *       * `cross-fetch/polyfill` — clean import + working round-trip.
 *     So this file imports `cross-fetch/polyfill`, which assigns
 *     `globalThis.fetch` when undefined.
 *
 * Invocation:
 *   npm run test:compare                 # runs every key in FOURCAT_DATASETS
 *   npm run test:compare -- <key>        # narrows to one key (must be in
 *                                        #   FOURCAT_DATASETS to avoid typos)
 *
 * Hard-errors at registration time if FOURCAT_URL, FOURCAT_API_KEY, or
 * FOURCAT_DATASETS is missing — by Tier 2 contract these are required.
 */

import 'cross-fetch/polyfill';
import 'dotenv/config';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect_module } from './_module-info.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The end-of-run roll-up is written here, then printed by run-compare.mjs
// AFTER jest exits — jest buffers in-test stdout and hoists it above the
// result tree, so writing it from here directly would never land last. Keep
// in sync with the same constant in run-compare.mjs.
const SUMMARY_PATH = join(__dirname, '.compare-summary.txt');

const FOURCAT_URL = process.env.FOURCAT_URL?.replace(/\/$/, '');
const FOURCAT_API_KEY = process.env.FOURCAT_API_KEY;

// Hard-fail if env is missing — Tier 2 contract.
function require_env(name, value, placeholder_values = []) {
    if (!value || placeholder_values.includes(value)) {
        throw new Error(
            `${name} is not configured. Set it in tests/.env (see tests/.env.example).`
        );
    }
    return value;
}
require_env('FOURCAT_URL', FOURCAT_URL);
require_env('FOURCAT_API_KEY', FOURCAT_API_KEY, ['your-api-key-here']);

const FOURCAT_DATASETS = require_env(
    'FOURCAT_DATASETS',
    process.env.FOURCAT_DATASETS,
    ['key1,key2,key3'],
)
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

if (FOURCAT_DATASETS.length === 0) {
    throw new Error('FOURCAT_DATASETS parsed as empty. Set a comma-separated list of dataset keys in tests/.env.');
}

// Optional narrowing to a single dataset key. The `npm run test:compare --
// <key>` form is handled by run-compare.mjs, which sets COMPARE_DATASET; jest
// itself would mis-read a bare key as a test-path-pattern filter and silently
// run nothing. A narrowed key must still be declared in FOURCAT_DATASETS —
// erroring on an unlisted key catches typos and keeps the dataset list the
// single source of truth.
const COMPARE_DATASET = process.env.COMPARE_DATASET?.trim() || undefined;
if (COMPARE_DATASET && !FOURCAT_DATASETS.includes(COMPARE_DATASET)) {
    throw new Error(
        `COMPARE_DATASET=${COMPARE_DATASET} is not listed in FOURCAT_DATASETS. ` +
        `Add it to tests/.env before narrowing the run to it.`
    );
}

const DATASET_KEYS_TO_RUN = COMPARE_DATASET ? [COMPARE_DATASET] : FOURCAT_DATASETS;

// 4CAT datasource id -> Zeeschuimer module name. The on-disk map is
// authored in the natural direction (zeeschuimer -> 4cat); flip here.
const ID_MAP_PATH = join(__dirname, 'zeeschuimer-to-4cat.json');
const ZEESCHUIMER_TO_4CAT = existsSync(ID_MAP_PATH)
    ? JSON.parse(readFileSync(ID_MAP_PATH, 'utf8'))
    : {};
const FOURCAT_TO_ZEESCHUIMER = Object.fromEntries(
    Object.entries(ZEESCHUIMER_TO_4CAT)
        .filter(([k]) => !k.startsWith('_'))
        .map(([z, f]) => [f, z])
);

// When true (default), comparison of a dataset stops at its first failing
// item; the remaining items are reported as a single skipped "halted"
// placeholder rather than one failure each. Disable it with the `--all`
// launcher flag (preferred — crosses every shell) or FAIL_FAST=0. Trim
// because `set FAIL_FAST=0 && ...` in cmd.exe includes the trailing space;
// treat both '0' and 'false' (case-insensitive) as off.
const FAIL_FAST_RAW = (process.env.FAIL_FAST ?? '').trim().toLowerCase();
const FAIL_FAST = FAIL_FAST_RAW !== '0' && FAIL_FAST_RAW !== 'false';

function auth_headers(extra = {}) {
    return {
        // 4CAT accepts the raw key without a `Bearer ` prefix.
        'Authorization': FOURCAT_API_KEY,
        ...extra,
    };
}

async function fetch_headers(url) {
    const res = await fetch(url, { method: 'HEAD', headers: auth_headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status} from HEAD ${url}`);
    return res.headers;
}

async function fetch_ndjson(url) {
    const res = await fetch(url, { headers: auth_headers() });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
    return text
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map((line, i) => {
            try { return JSON.parse(line); }
            catch (e) { throw new Error(`bad NDJSON at line ${i} of ${url}: ${e.message}`); }
        });
}

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

function looks_like_url(v) {
    return typeof v === 'string' && /^https?:\/\//i.test(v);
}

// Percent-decode for encoding-insensitive URL comparison. Decode each maximal
// %XX run on its own so a malformed sequence doesn't throw and abort the rest.
function decode_url_loose(s) {
    return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
        try { return decodeURIComponent(run); } catch { return run; }
    });
}

function deep_equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') {
        // Treat encoding-equivalent URLs as equal. The comparator targets bad
        // data, not cosmetic percent-encoding differences: `=` vs `%3D` in a
        // query value (and the like) resolve to the same URL, so 4CAT emitting
        // one form while the JS normalizer emits the other is not a defect.
        // Applied at the leaf so it covers URLs nested in arrays/objects too.
        // Tradeoff: this also collapses `%2F` vs `/`, which can be semantically
        // distinct — accepted, as a genuinely different URL still differs once
        // decoded.
        if (looks_like_url(a) && looks_like_url(b)) {
            return decode_url_loose(a) === decode_url_loose(b);
        }
        return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deep_equal(v, b[i]));
    }
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) return false;
    return a_keys.every(k => k in b && deep_equal(a[k], b[k]));
}

function diff_objects(js_obj, py_obj) {
    const diffs = [];
    const keys = new Set([...Object.keys(js_obj ?? {}), ...Object.keys(py_obj ?? {})]);
    for (const key of keys) {
        const in_js = js_obj && key in js_obj;
        const in_py = py_obj && key in py_obj;
        if (!in_js) {
            diffs.push({ key, kind: 'only_python', python: py_obj[key] });
        } else if (!in_py) {
            diffs.push({ key, kind: 'only_js', js: js_obj[key] });
        } else if (!deep_equal(js_obj[key], py_obj[key])) {
            diffs.push({ key, kind: 'mismatch', js: js_obj[key], python: py_obj[key] });
        }
    }
    return diffs;
}

function format_diffs(diffs) {
    return diffs.map(d => {
        if (d.kind === 'only_js') {
            return `  + only in JS:     ${d.key} = ${JSON.stringify(d.js)}`;
        }
        if (d.kind === 'only_python') {
            return `  - only in Python: ${d.key} = ${JSON.stringify(d.python)}`;
        }
        return `  ~ ${d.key}\n      JS:     ${JSON.stringify(d.js)}\n      Python: ${JSON.stringify(d.python)}`;
    }).join('\n');
}

function format_error_with_location(err) {
    if (!err) return String(err);
    const message = err.message || String(err);
    const stack = err.stack || '';
    const module_frames = stack.split('\n')
        .filter(l => l.includes('/modules/') || l.includes('\\modules\\'))
        .slice(0, 3)
        .map(l => l.trim());
    return module_frames.length
        ? `${message}\n  ${module_frames.join('\n  ')}`
        : message;
}

// Map each input through the local map_item, then pair the mapped result
// against the expected output by `id`. Pairing MUST key on the mapped id:
// some modules emit an `id` that differs from the raw input id — instagram,
// for instance, maps to the post shortcode (`node.code`), not the numeric pk
// — so pairing raw input ids against the API's already-mapped ids would match
// nothing. Falls back to index pairing (with a logged warning) if either side
// lacks a usable id. A throw inside map_item is captured per-item and surfaced
// later as that item's failure.
function map_and_pair(inputs, outputs, map_item, dataset_key) {
    // Map every input up front so pairing can key on the mapped id.
    const mapped = inputs.map(input => {
        try {
            return { input, js_result: map_item(input), error: null };
        } catch (e) {
            return {
                input,
                js_result: null,
                error: new Error(`JS map_item threw: ${format_error_with_location(e)}`),
            };
        }
    });

    const probe_mapped = mapped.find(m => m.js_result)?.js_result;
    const probe_out = outputs[0];
    const has_id_mapped = probe_mapped && 'id' in probe_mapped && probe_mapped.id != null;
    const has_id_out = probe_out && 'id' in probe_out && probe_out.id != null;

    if (!has_id_mapped || !has_id_out) {
        // eslint-disable-next-line no-console
        console.warn(
            `[compare] ${dataset_key}: no usable 'id' on ${!has_id_mapped ? 'map_item output' : '/items'} ` +
            `side — falling back to index pairing for this dataset.`
        );
        const n = Math.min(mapped.length, outputs.length);
        return {
            mode: 'index',
            pairs: Array.from({ length: n }, (_, i) => ({
                input: mapped[i].input,
                js_result: mapped[i].js_result,
                error: mapped[i].error,
                expected: outputs[i],
                id: i,
            })),
            input_count: inputs.length,
            output_count: outputs.length,
            unmatched_inputs: [],
            unmatched_outputs: [],
        };
    }

    // An id is NOT guaranteed unique: some datasources re-emit the same post
    // across paginated/scroll responses (e.g. imgur gallery returns a post on
    // every page it appears on), so a key can legitimately recur with a
    // different `collected_from_url` per capture. Bucket outputs into a FIFO
    // queue per id rather than a single slot — then the k-th input occurrence
    // of an id pairs with the k-th output occurrence. Both endpoints stream the
    // dataset in the same stored order, so occurrences line up. (A plain
    // last-wins Map would cross-match occurrence #0 against the surviving
    // occurrence #N, fabricating field diffs and bogus unmatched ids.)
    const by_id_out = new Map();
    for (const item of outputs) {
        const k = String(item.id);
        if (!by_id_out.has(k)) by_id_out.set(k, []);
        by_id_out.get(k).push(item);
    }

    const pairs = [];
    const unmatched_inputs = [];
    for (const m of mapped) {
        // A throw produces no mapped id to pair on. Surface it as its own
        // failing item (labelled with the raw input id) rather than burying it
        // in the unmatched-id list — otherwise an id-transforming module hides
        // the actual map_item error behind a generic "unmatched input" report.
        if (m.error) {
            const label = m.input && m.input.id != null ? String(m.input.id) : '(no id)';
            pairs.push({ input: m.input, js_result: null, error: m.error, expected: null, id: label });
            continue;
        }
        // Key on the mapped id; a successful map whose id matches no remaining
        // output occurrence is a genuine pairing miss and goes to unmatched_inputs.
        const lookup_id = m.js_result && m.js_result.id != null ? String(m.js_result.id) : null;
        const queue = lookup_id != null ? by_id_out.get(lookup_id) : undefined;
        const expected = queue && queue.length ? queue.shift() : undefined;
        if (expected) {
            pairs.push({ input: m.input, js_result: m.js_result, error: null, expected, id: lookup_id });
        } else {
            unmatched_inputs.push(lookup_id);
        }
    }
    // Any output occurrences left in the queues had no matching input.
    const unmatched_outputs = [];
    for (const [id, queue] of by_id_out) {
        for (let i = 0; i < queue.length; i++) unmatched_outputs.push(id);
    }
    return {
        mode: 'id',
        pairs,
        input_count: inputs.length,
        output_count: outputs.length,
        unmatched_inputs,
        unmatched_outputs,
    };
}

// Recover the datasource id from a dataset's response headers. 4CAT exposes it
// directly as `X-4CAT-Dataset-Datasource`. Older responses may only carry
// `X-4CAT-Dataset-Type` (the datasource id with a `-search`/`-import` suffix),
// so fall back to stripping that — anchored to end-of-string because
// datasource ids can themselves contain hyphens (e.g. `xiaohongshu-comments`).
// The result is translated to a Zeeschuimer module via FOURCAT_TO_ZEESCHUIMER.
function datasource_id_from_headers(headers) {
    const datasource = headers.get('x-4cat-dataset-datasource');
    if (datasource) return datasource.trim();
    const type = headers.get('x-4cat-dataset-type');
    if (type) return type.trim().replace(/-(search|import)$/, '');
    return null;
}

// Fields 4CAT's API attaches to every mapped item that the JS map_item never
// produces, so they would otherwise diff as spurious "only_python" entries.
// `missing_fields` is a comma-joined summary of which fields came back as
// MissingMappedField — redundant with the per-field `{__missing:true}`
// markers, which ARE compared.
const API_ONLY_FIELDS = new Set(['missing_fields']);

function strip_api_fields(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out = {};
    for (const k of Object.keys(obj)) {
        if (!API_ONLY_FIELDS.has(k)) out[k] = obj[k];
    }
    return out;
}

// Diff each paired (already-mapped) JS result against 4CAT's expected output.
// map_item was run up front during pairing — so we could key on the mapped id
// — so here we only diff, or report an input whose map_item threw. With
// FAIL_FAST on (default), stop at the first failing item and record how many
// were left unchecked — so one bad item yields a single failure plus one
// skipped "halted" placeholder, not N failures.
function compare_pairs(pairs) {
    const results = [];
    let halted_count = 0;
    for (let i = 0; i < pairs.length; i++) {
        const { id, js_result, error, expected } = pairs[i];
        let message = null;
        if (error) {
            message = error.message;
        } else {
            const diffs = diff_objects(
                strip_api_fields(normalize(js_result)),
                strip_api_fields(normalize(expected)),
            );
            if (diffs.length > 0) {
                message = `${diffs.length} field(s) differ between JS and 4CAT:\n${format_diffs(diffs)}`;
            }
        }
        results.push({ id, ok: message === null, message });
        if (message !== null && FAIL_FAST) {
            halted_count = pairs.length - (i + 1);
            break;
        }
    }
    return { results, halted_count };
}

// Pre-pass: for each dataset, resolve the datasource (HEAD), fetch items, and
// run the comparison up front, so tests register with knowable counts and a
// deterministic pass/fail per item. Fetch/setup failures become a single
// "setup" failure inside that dataset's describe.
const dataset_state = {};
for (const key of DATASET_KEYS_TO_RUN) {
    try {
        // The same items URL serves double duty: a HEAD reveals the datasource
        // (via X-4CAT-Dataset-* headers) with no body; the GET pulls the mapped
        // rows. `stream=true` avoids the JSON form's limit=100 pagination, which
        // would silently drop rows (and break id-pairing) on larger datasets.
        const items_url = `${FOURCAT_URL}/api/dataset/${key}/items/?annotations=no&missing_fields=keep&stream=true`;
        const headers = await fetch_headers(items_url);
        const datasource_id = datasource_id_from_headers(headers);
        if (!datasource_id) {
            throw new Error(
                `no datasource id in response headers for ${key} ` +
                `(looked for X-4CAT-Dataset-Datasource / X-4CAT-Dataset-Type)`
            );
        }
        const module_name = FOURCAT_TO_ZEESCHUIMER[datasource_id] ?? datasource_id;
        const module_state = await inspect_module(module_name);

        if (module_state.state === 'ok') {
            const [inputs, outputs] = await Promise.all([
                fetch_ndjson(`${FOURCAT_URL}/download/${key}`),
                fetch_ndjson(items_url),
            ]);
            const pairing = map_and_pair(inputs, outputs, module_state.map_item, key);
            const comparison = compare_pairs(pairing.pairs);
            dataset_state[key] = { datasource_id, module_name, module_state, pairing, comparison };
        } else {
            dataset_state[key] = { datasource_id, module_name, module_state };
        }
    } catch (e) {
        dataset_state[key] = { error: e };
    }
}

for (const dataset_key of DATASET_KEYS_TO_RUN) {
    const info = dataset_state[dataset_key];

    if (info.error) {
        describe(`map_item compare: dataset ${dataset_key}`, () => {
            test('setup', () => { throw info.error; });
        });
        continue;
    }

    const { datasource_id, module_name, module_state, pairing, comparison } = info;
    const label = `${dataset_key} (datasource: ${datasource_id}, module: ${module_name})`;

    if (module_state.state === 'no_map_item') {
        describe(`map_item compare: ${label}`, () => {
            test.skip(`modules/${module_name}.js has no map_item — nothing to compare`, () => {});
        });
        continue;
    }
    if (module_state.state === 'syntax_error' || module_state.state === 'import_error') {
        const msg = module_state.state === 'syntax_error'
            ? `syntax error:\n${module_state.error}`
            : `import failed: ${module_state.error.message}`;
        describe(`map_item compare: ${label}`, () => {
            test('module loads', () => { throw new Error(msg); });
        });
        continue;
    }

    describe(`map_item compare: ${label}`, () => {
        test('pairing', () => {
            const messages = [];
            if (pairing.input_count !== pairing.output_count) {
                messages.push(
                    `input count ${pairing.input_count} != output count ${pairing.output_count}`
                );
            }
            if (pairing.unmatched_inputs.length) {
                const shown = pairing.unmatched_inputs.slice(0, 5).join(', ');
                const extra = pairing.unmatched_inputs.length > 5
                    ? ` (+${pairing.unmatched_inputs.length - 5} more)`
                    : '';
                messages.push(`unmatched input ids: ${shown}${extra}`);
            }
            if (pairing.unmatched_outputs.length) {
                const shown = pairing.unmatched_outputs.slice(0, 5).join(', ');
                const extra = pairing.unmatched_outputs.length > 5
                    ? ` (+${pairing.unmatched_outputs.length - 5} more)`
                    : '';
                messages.push(`unmatched output ids: ${shown}${extra}`);
            }
            if (pairing.mode === 'index') {
                messages.push(`paired by index (no usable 'id' field) — diffs may be misaligned`);
            }
            if (messages.length) throw new Error(messages.join('\n'));
        });

        comparison.results.forEach(({ id, ok, message }, i) => {
            test(`item ${i} (id=${id})`, () => {
                if (!ok) throw new Error(message);
            });
        });

        if (comparison.halted_count > 0) {
            test.skip(
                `halted after first failure — ${comparison.halted_count} later item(s) not compared ` +
                `(pass --all, or set FAIL_FAST=0, to compare every item)`,
                () => {},
            );
        }
    });
}

// Reduce a dataset's pre-computed state to a single verdict + one-line detail.
// Mirrors the assertions above exactly so the summary never disagrees with the
// per-test results: PASS only when pairing is clean AND every compared item
// matched; a FAIL_FAST halt leaves items unchecked, so it cannot be a PASS.
function summarize_dataset(key, info) {
    if (info.error) {
        return { key, status: 'FAIL', datasource: '?', module: '?', detail: `setup error: ${info.error.message}` };
    }
    const { datasource_id, module_name, module_state, pairing, comparison } = info;
    if (module_state.state === 'no_map_item') {
        return { key, status: 'SKIP', datasource: datasource_id, module: module_name, detail: 'no map_item — nothing to compare' };
    }
    if (module_state.state === 'syntax_error' || module_state.state === 'import_error') {
        return { key, status: 'FAIL', datasource: datasource_id, module: module_name, detail: `module ${module_state.state.replace('_', ' ')}` };
    }

    const pairing_problems = [];
    if (pairing.input_count !== pairing.output_count) {
        pairing_problems.push(`count ${pairing.input_count}!=${pairing.output_count}`);
    }
    if (pairing.unmatched_inputs.length) pairing_problems.push(`${pairing.unmatched_inputs.length} unmatched input(s)`);
    if (pairing.unmatched_outputs.length) pairing_problems.push(`${pairing.unmatched_outputs.length} unmatched output(s)`);
    if (pairing.mode === 'index') pairing_problems.push(`paired by index`);

    const compared = comparison.results.length;
    const failed_items = comparison.results.filter(r => !r.ok).length;
    const total = pairing.pairs.length;

    if (pairing_problems.length || failed_items) {
        const parts = [];
        if (pairing_problems.length) parts.push(`pairing: ${pairing_problems.join(', ')}`);
        if (failed_items) {
            const halted = comparison.halted_count > 0 ? `, halted (+${comparison.halted_count} unchecked)` : '';
            parts.push(`${failed_items}/${compared} item(s) differ${halted}`);
        }
        return { key, status: 'FAIL', datasource: datasource_id, module: module_name, detail: parts.join('; ') };
    }
    return { key, status: 'PASS', datasource: datasource_id, module: module_name, detail: `${total}/${total} items match` };
}

// Build the per-datasource roll-up once the whole file has run and stash it
// for run-compare.mjs to print as the genuine final output (see SUMMARY_PATH).
afterAll(() => {
    const rows = DATASET_KEYS_TO_RUN.map(key => summarize_dataset(key, dataset_state[key]));
    const w_status = 4; // PASS/FAIL/SKIP
    const w_module = Math.max(6, ...rows.map(r => r.module.length));

    const lines = ['', '=== map_item compare summary ==='];
    for (const r of rows) {
        const mark = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '○' : '✗';
        lines.push(
            `  ${mark} ${r.status.padEnd(w_status)}  ${r.module.padEnd(w_module)}  ${r.key}  — ${r.detail}`
        );
    }
    const passed = rows.filter(r => r.status === 'PASS').length;
    const failed = rows.filter(r => r.status === 'FAIL').length;
    const skipped = rows.filter(r => r.status === 'SKIP').length;
    lines.push(`${rows.length} datasource(s): ${passed} passed, ${failed} failed, ${skipped} skipped`);
    writeFileSync(SUMMARY_PATH, lines.join('\n') + '\n');
});
