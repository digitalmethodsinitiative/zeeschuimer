# Auto-generator translation errors

Patterns of incorrect Python → JavaScript translation observed in
auto-generated `modules/*.js` files. Each entry has a search pattern so
this doc doubles as a checklist when reviewing a new auto-generator PR.

When an entry is fixed at the generator level (no longer appears in
fresh output), mark it `[fixed]` and keep the entry around — useful
history when something regresses.

## How to use

- Found a new pattern? Add an entry below following the template.
- Reviewing a generator PR? `grep` each `Search pattern` against the
  changed module files. Anything that hits is worth a manual look.
- Iterating on the generator prompt? The "Why" lines are the
  feedback to add — they describe the exact Python-vs-JS semantic
  difference the LLM keeps missing.

## Template

```
### <short-name>

**Status:** open | fixed in generator | accepted

**Why it happens:** <one-line description of the Python-vs-JS difference>

**Wrong JS:**
```js
<the broken pattern>
```

**Correct JS:**
```js
<what it should look like>
```

**Example:** `modules/<file>.js:<line>`

**Search pattern:** `<grep-able regex>`
```

---

## Observed patterns

### `in` operator on strings

**Status:** open

**Why it happens:** In Python, `"x" in some_string` is a substring check.
In JavaScript, the `in` operator only works on **objects** and checks for
property/key existence; using it with a string on the right-hand side
throws `TypeError: cannot use 'in' operator to search for "x" in <string>`.

**Wrong JS:**
```js
const is_polaris = '__typename' in item && 'polaris' in item.__typename.toLowerCase();
```

**Correct JS:**
```js
const is_polaris = '__typename' in item && item.__typename.toLowerCase().includes('polaris');
```

**Example:** `modules/instagram.js:513`

**Search pattern:** `'[^']+' in [a-zA-Z_$][\w$]*\.` — quoted string followed
by `in` followed by a method call. Quick rough check: `grep -E "' in [a-zA-Z]" modules/`

**Watch out for partial fixes:** seen as `'polaris' in (item.__typename ?? '').toLowerCase()`
— adding `?? ''` guards against `undefined` but the `in` operator itself
still throws on the resulting *string*. The fix is `.includes()`, not just
defaulting the operand.

---

### Python f-string syntax left in single-quoted JS strings

**Status:** open

**Why it happens:** Python `f"... {var} ..."` interpolates. JS uses
template literals (backticks) with `${var}`. The auto-generator leaves the
`{var}` notation in a regular single- or double-quoted JS string, which is
just literal text — no interpolation happens.

**Wrong JS:**
```js
throw new MapItemException('Unable to parse item: different user {user.id} and owner {owner.id}');
```

**Correct JS:**
```js
throw new MapItemException(`Unable to parse item: different user ${user.id} and owner ${owner.id}`);
```

**Example:** `modules/instagram.js:754`

**Search pattern:** `'[^']*\{[a-zA-Z_$][\w$.]*\}[^']*'` or `"[^"]*\{[a-zA-Z_$][\w$.]*\}[^"]*"`
— a non-template-literal string containing `{identifier}` or `{identifier.path}`.
Quick check: `grep -nE "['\"][^'\"]*\{[a-zA-Z_][a-zA-Z0-9_.]*\}[^'\"]*['\"]" modules/`

---

### `?? {}` default that defeats subsequent truthy checks

**Status:** open

**Why it happens:** When porting Python's `node.get('user') or {}` (which is
intended to make subsequent code safe to call), the generator emits
`node.user ?? {}`. That's a *valid* Python-equivalent, **but** any following
`if (user && owner) { ... }` guard then never short-circuits because both
`{}` references are truthy. The check ends up reading "if user and owner
*objects* exist" when the intent was "if user and owner data exist."
Subsequent property accesses then compare real ids/usernames against
`undefined` on the missing side, often throwing.

**Wrong JS:**
```js
const user  = node.user  ?? {};
const owner = node.owner ?? {};
if (user && owner) {
    if (user.id === owner.id) { /* … */ }
    else if (user.username !== owner.username) {
        throw new MapItemException('different user and owner');
    }
}
```

**Correct JS** (depending on intent — pick one):
```js
// (a) drop the defaults so truthy guard means "both present"
const user  = node.user;
const owner = node.owner;
if (user && owner) { /* compare */ }
```
```js
// (b) check for actual content, not just object identity
const user  = node.user  ?? {};
const owner = node.owner ?? {};
if (Object.keys(user).length && Object.keys(owner).length) { /* compare */ }
```

**Example:** `modules/instagram.js:748-756`

**Search pattern:** `\?\?\s*\{\s*\}` — any `?? {}` occurrence is worth a
review of subsequent guards. Quick check: `grep -nE "\?\?\s*\{\s*\}" modules/`

---

### Bare relative path as a statement (junk auto-imports section)

**Status:** open

**Why it happens:** The generator emits an "auto-generated imports" marker
block at the top of the module but writes the import target as a bare
relative path on its own line (`../js/lib.js`) instead of a real `import`
statement. JS parses that as `..` then `.` then `/js/lib.js` — syntax error.

**Wrong JS:**
```js
// === auto-generated imports for map_item — DO NOT EDIT BY HAND ===
../js/lib.js
// === end auto-generated imports ===
```

**Correct JS** (one of):
```js
// === auto-generated imports — DO NOT EDIT BY HAND ===
// Provided as globals by js/lib.js (loaded via manifest.json):
//   MappedItem, MissingMappedField, MapItemException, traverse_data,
//   strip_tags, normalize_url_encoding, formatUtcTimestamp
// === end auto-generated imports ===
```

Or, if a real import is intended, an ESM import with named bindings:
```js
import { MappedItem, MissingMappedField } from '../js/lib.js';
```

**Example:** seen historically in `modules/tiktok.js:2`

**Search pattern:** `^\.\./` at the start of a line in module files.
Quick check: `grep -nE "^\.\." modules/*.js`

---

### Key-existence check (`'X' in obj`) used where Python intended value-truthiness (`obj.get('X')`)

**Status:** open

**Why it happens:** Python's `if node.get('usertags'):` is a *truthy check on
the value* — returns False if the key is missing **or** if the value is
`None`/empty/falsy. The generator translates this to `if ('usertags' in
node)`, which in JS is a *key-existence check* — returns True even when
the value is `null`. Subsequent property accesses on the null value then
throw `Cannot read properties of null`.

**Wrong JS:**
```js
const usertags = 'usertags' in node ? node.usertags.in.map(...).join(',') : '';
// node.usertags can be null → .in.map blows up
```

**Correct JS:**
```js
const usertags = node.usertags ? node.usertags.in.map(...).join(',') : '';
```

**Example:** `modules/instagram.js:777`

**Search pattern:** `'[^']+' in [a-zA-Z_$][\w$]*\s*\?` — quoted-string `in`
identifier followed by `?` (ternary). Quick check:
`grep -nE "'[^']+' in [a-zA-Z_]+ \?" modules/`

---

### Datetime serialization format mismatch

**Status:** open

**Why it happens:** Python's `datetime.utcfromtimestamp(t).strftime('%Y-%m-%d %H:%M:%S')`
produces `"2026-05-13 21:27:31"` — space-separated, no timezone marker. JS's
`new Date(t * 1000).toISOString()` produces `"2026-05-13T21:27:31.000Z"` — T
separator, milliseconds, Z. The generator emits the JS `.toISOString()` form
instead of using the existing `formatUtcTimestamp` helper from lib.js that
mimics Python's output exactly.

**Wrong JS:**
```js
collected_at = new Date(node.taken_at * 1000).toISOString();
```

**Correct JS:**
```js
collected_at = formatUtcTimestamp(node.taken_at);
// formatUtcTimestamp is defined in js/lib.js as:
//   new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
```

**Example:** `modules/instagram.js:782`

**Search pattern:** `new Date\([^)]+\)\.toISOString\(\)` — any use of
`.toISOString()`. The helper should be used instead. Quick check:
`grep -nE "\.toISOString\(\)" modules/`

---

### `re.findall` capture groups vs JS `.match` with /g flag

**Status:** open

**Why it happens:** Python's `re.findall(r'#(\w+)', s)` returns the **capture
group contents**: `['lotr', 'woodart']`. JS's `s.match(/#(\w+)/g)` (with the
global flag) returns the **full matches**: `['#lotr', '#woodart']` — capture
groups are ignored. The generator translates the regex literally without
adjusting for this semantic difference, so the resulting strings keep
prefixes/wrappers that Python would have stripped.

**Wrong JS:**
```js
hashtags: caption.match(/#([^\s!@#$%^&*()_+{}:"|<>?;',./`~]+)/g)?.join(',')
// produces "#lotr,#woodart"
```

**Correct JS:**
```js
// Option A: strip the literal prefix from each full match
hashtags: caption.match(/#([^\s...]+)/g)?.map(h => h.slice(1)).join(',') ?? ''
// Option B: use matchAll to get capture groups properly
hashtags: [...caption.matchAll(/#([^\s...]+)/g)].map(m => m[1]).join(',') ?? ''
```

**Example:** `modules/instagram.js:812` (also 766, 870 — three copies)

**Search pattern:** `\.match\(/[^/]*\([^/]*\)[^/]*/g\)` — any `.match()` with
a global-flag regex containing a capture group. Quick check:
`grep -nE "\.match\(/.*\(.*\).*\/g\)" modules/`

---

### `undefined` field values get dropped from JSON, but Python's `None` becomes `null`

**Status:** open

**Why it happens:** When `JSON.stringify` encounters an object property whose
value is `undefined`, it **omits the key entirely** from the output. Python's
`json.dumps` serializes `None` as `null`, keeping the key. The generator
writes assignments like `location.city = node.location.city` where the
right-hand side can be `undefined`, producing missing keys in JS output
that show up as `only in Python: <field> = null` diffs against 4CAT.

**Wrong JS:**
```js
location.city = node.location.city;  // undefined if .city missing
// JSON.stringify({location_city: undefined}) → "{}" (key omitted)

body: caption,  // null if no caption — Python returns "" here, not null
```

**Correct JS:**
```js
// Whichever fallback Python uses for that specific field:
location.city = node.location.city ?? null;   // some fields → null
body: caption ?? '',                          // other fields → ""
```

**Example:** `modules/instagram.js:745, 853` (`null` flavor),
559, 648, 798 (`""` flavor for `body`)

**Note:** Python's choice of `None` vs `""` is per-field — there's no
universal rule. When the comparator reports `~ X  JS: null  Python: ""` use
`?? ''`. When it reports `- only in Python: X = null` use `?? null`. The
distinction matters because the JS output should match Python's choice
exactly for that field.

**Search pattern:** harder to grep automatically — any property assignment
where the RHS could be `undefined`/`null` and the resulting field is
expected to appear in the mapped output. Look at "only in Python: X = null"
and "~ X  JS: null  Python: \"\"" diffs in the comparator output to find
specific cases.

---

### Object-reference inequality used as type check

**Status:** open

**Why it happens:** The generator emits `caption !== new MissingMappedField('')`
to mean "caption is not a missing-marker", but `new MissingMappedField('')`
creates a fresh object every time, and `!==` on objects compares references.
The expression is **always true**, so the conditional never takes the
"missing" branch. Likely originates from Python idioms like `caption != ""`
or `caption is not None`, mistranslated through the MissingMappedField
abstraction.

**Wrong JS:**
```js
hashtags: caption !== new MissingMappedField('') ? caption.match(...) : '',
// !== between two different object references is always true
```

**Correct JS:**
```js
// If the intent was "if caption has content", just truthy-check it:
hashtags: caption ? caption.match(...) : '',
// If the intent was "if caption is not a MissingMappedField instance":
hashtags: !(caption instanceof MissingMappedField) ? caption.match(...) : '',
```

**Example:** `modules/instagram.js:812` (and two other copies)

**Search pattern:** `!== new [A-Z]` or `=== new [A-Z]` — any equality
comparison with a freshly-constructed object. Quick check:
`grep -nE "(!==|===) new [A-Z]" modules/`

---

### `.method()` chain on potentially-null result

**Status:** open

**Why it happens:** In Python, calling a method on `None` raises
`AttributeError`, which 4CAT sometimes catches. In JS, calling a method on
`null`/`undefined` throws `TypeError: Cannot read properties of null
(reading '<method>')`. The generator emits the same dotted chain without
optional-chaining (`?.`) protection.

**Wrong JS:**
```js
hashtags: caption !== new MissingMappedField('')
    ? caption.match(/#([^\s!@#$%^&*()_+{}:"|<>?;',./`~]+)/g)?.join(',')
    : '',
```
(here `caption` is allowed to be `null`, so `caption.match(...)` blows up
on null caption)

**Correct JS:**
```js
hashtags: caption
    ? caption.match(/#([^\s!@#$%^&*()_+{}:"|<>?;',./`~]+)/g)?.join(',') ?? ''
    : '',
```

**Example:** `modules/instagram.js:809`

**Search pattern:** harder to grep — needs reading. Worth manual review of
any field that uses `caption.match`, `something.split`, `something.join`
without `?.` on a value that could be null/undefined.

---

## Generator prompt feedback (running list)

Concrete things to fold into the generator's prompt over time:

1. **Python `x in y` where `y` is a string** → use `y.includes(x)` in JS,
   never `x in y`.
2. **Python f-strings** → use JS template literals (backticks) with
   `${...}` syntax. Never leave `{...}` in single- or double-quoted strings.
3. **`?? {}` after a `.get(...) or {}` translation** → only use this if the
   following code does property-access. If the following code does a
   truthy guard (`if (x && y)`), drop the default and use just `node.user`.
4. **Method chains on possibly-null values** → use `?.` (optional
   chaining) instead of `.` whenever the receiver could be null/undefined.
5. **The auto-imports header block** → emit either real `import { ... }`
   statements with valid relative paths, or a comment-only header.
   Never emit bare paths as JS statements.
6. **Python `node.get('X')` truthy check** → in JS, use `node.X` (or
   `node.X != null`), not `'X' in node`. The `in` operator checks key
   existence, which is True even for explicit-null values.
7. **Datetime serialization** → use the `formatUtcTimestamp` helper from
   lib.js (which mimics Python's `strftime('%Y-%m-%d %H:%M:%S')` format),
   not `new Date(...).toISOString()` (which has a different output shape:
   T separator, milliseconds, Z suffix).
8. **`re.findall` with capture groups** → in JS, `.match(/.../g)` returns
   full matches, NOT capture groups. To get capture-group behavior, use
   either `[...s.matchAll(/.../g)].map(m => m[1])` or post-process the
   full matches with `.map(...)` to strip the literal parts.
9. **Object-reference equality (`!== new X(...)`)** → never. Creating an
   object with `new` produces a fresh reference; `===`/`!==` compares
   identity. Use `instanceof X` for type checks, or compare values
   directly. The MissingMappedField "is this missing?" check should be
   `caption instanceof MissingMappedField` or just truthy-check the value.
10. **Python `None` → JSON `null` vs JS `undefined` → omitted** — when a
    field's value could be missing and Python returns `null` for it,
    JS must explicitly assign `null` (not leave the value as `undefined`).
    `JSON.stringify` drops `undefined` keys silently. Use `value ?? null`
    when the field is expected to appear in the mapped output.
