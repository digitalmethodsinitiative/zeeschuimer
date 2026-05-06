# Test fixtures for `map_item`

Real captured items used to exercise each module's auto-generated `map_item`
function.

## Layout

```
tests/fixtures/
  <module_name>/
    <whatever>.ndjson
    <whatever-else>.ndjson
```

`<module_name>` matches the filename in `modules/` without `.js` —
e.g. `tiktok/` → `modules/tiktok.js`, `pinterest/` → `modules/pinterest.js`.
You can drop multiple `.ndjson` files in a module folder; each gets its own
`describe` block and each line becomes its own `test`.

Filenames are free-form — the auto-export filename from the popup
(`zeeschuimer-export-<platform>-<timestamp>.ndjson`) is fine.

## Privacy / committing

These files contain real captured platform data — usernames, post
content, URLs, sometimes images and other PII. 

If we want to create test exports or annonomize real exports, add them to 
.gitignore.