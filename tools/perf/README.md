# tools/perf — the World page audit (WLD-222)

`world-page-audit.mjs` is a **manual** CLI. It is not a test, not a CI step and not a schedule; nothing runs it but a person (or the lead's seat) in a quiet window.

```
node tools/perf/world-page-audit.mjs                  # one audit of real, signed-out https://postmark.town: ONE JSON line
node tools/perf/world-page-audit.mjs --backfill-bytes # repo-served bytes at each settlement/S* tag, from git only
```

- Pinned Playwright 1.62.0 (`package.json`), the bundled headless Chromium, a fresh signed-out context per sample, 1366×768, CPU slowed 4×, median of 3 samples.
- Measures cold-load bytes, time to map shown, time to interactive (a 2 s stutter-free window), pan-frame p95 and longest task at the Town Centre and at the Starforge Spire, plus idle CPU, heap after GC, drawn-mark count, and the served town's marks/parcels/settlement/shas. Every key's definition is in the file header.
- Exit 0 = a valid row. Exit 2 = an **invalid** row (a missing phase, a wrong place, an inert drag, a failed cold load, a mixed version…): the row is printed with `valid: false` and its reasons, and is never a baseline. A run against any other origin, or with other sample/CPU settings, says `official: false`.
- Expect about 3 minutes per sample at 4× CPU (one sample took 184 s against the repo's own spectator server; prod has not been timed), so roughly 10 minutes; one Chromium (about 1–2 GB), one busy core, a few MB of public downloads per sample. Run it with no crossing (00:00/12:00Z) or settlement (06:00/18:00Z) within 20 minutes and no other heavy run.
- Results go to `PERF/world-page.jsonl`, one audit row per run, appended by the lead's seat only. The audit writes nothing and files nothing.
- `tools/world-page-audit.test.mjs` is the offline check of the validity rules (pure functions; no browser, no network).
