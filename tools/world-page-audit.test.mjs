// world-page-audit.test.mjs — the focused OFFLINE check of tools/perf/world-page-audit.mjs (WLD-222).
//
// Pure functions only: this opens no browser and no network, and never runs the audit. The audit itself is a
// manual CLI (node tools/perf/world-page-audit.mjs); importing it runs nothing. What is pinned here is the part
// that decides whether a row may be a baseline at all: a sample that measured the wrong place, did not actually
// pan, lacks a measurement, failed its cold load or straddled two versions of the served town is INVALID, and an
// invalid sample can never turn into a valid zero or a shorter median.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantile, median, spread, quietFrom, frameGaps, longestTask, centredWithin, sameScale, dragMoved, sameVersion, versionOf,
  sampleProblems, auditRow, repoPathOf, PLACES, MIN_CAMERA_WRITES, MIN_TRAVEL_PX,
} from "./perf/world-page-audit.mjs";

const BUILD = { code_sha: "c", town_data_sha: "d", town_sha: "t", world_sha: "w", world_digest: "g", crossing: 323, world_settlement: "S183" };
const place = (over = {}) => ({ located: true, scale: 1.2, scale_ref: 1.2, scale_ok: true, camera_writes: 90, travel_px: 300, still_in_view: true, frame_p95_ms: 33, longest_task_ms: 0, long_tasks: 0, drawn_marks: 120, ...over });
const sample = (over = {}) => ({
  error: null, visibility: "visible", map_shown_ms: 9000, interactive_ms: 12000, bytes_cold_load_encoded: 4_000_000, failed_requests: [],
  version_before: versionOf(BUILD), version_after: versionOf(BUILD), idle_busy_pct: 8, heap_after_gc_mib: 60, scale_ref: 1.2,
  places: { town_centre: place(), spire: place() }, ...over,
});
const row = (samples, official = true) => auditRow({ samples, town: { marks: 3066 }, env: {}, official, at: "2026-11-20T00:00:00Z" });

test("the median of three is the middle one and the range is kept; a missing sample is no value at all, never a zero", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.deepEqual(spread([5, 1, 3]), { median: 3, min: 1, max: 5, samples: [5, 1, 3] });
  assert.equal(quantile([], 0.5), null);
  assert.equal(spread([5, NaN, 3]), null, "one failed sample cannot shorten the median to two");
  assert.equal(spread([]), null);
});

test("interactive = the first 2 s window with no long task; a window not yet over is not an answer", () => {
  const lt = [[1000, 300], [1500, 400], [4000, 100]];            // busy to 1900, quiet 1900-4000, a task at 4000
  assert.equal(quietFrom(lt, 1000, 2000, 10_000), 1900 + 0, "after the last task of the first burst, 2.1 s clear");
  assert.equal(quietFrom([[1000, 300], [2200, 100]], 1000, 2000, 10_000), 2300, "a task inside the window pushes the quiet past it");
  assert.equal(quietFrom([[1000, 300]], 1000, 2000, 2500), null, "only 1.2 s of quiet so far: not yet");
  assert.equal(quietFrom([], 500, 2000, 3000), 500, "no long task at all: interactive the moment the map is shown");
});

test("the pan numbers: frame gaps inside the drag only, and the longest task that overlaps it", () => {
  assert.deepEqual(frameGaps([0, 16, 33, 100, 120, 500], 10, 130), [17, 67, 20]);
  assert.deepEqual(longestTask([[0, 60], [100, 250], [900, 80]], 120, 600), { ms: 250, count: 1 }, "overlap counts; a task wholly before or after does not");
  assert.deepEqual(longestTask([[0, 60]], 120, 600), { ms: 0, count: 0 }, "none reached 50 ms: 0, not a missing value");
});

test("a place is 'located' only when it is under the middle of the map", () => {
  const pane = { x: 0, y: 0, width: 1000, height: 800 };
  assert.equal(centredWithin({ x: 480, y: 380, width: 40, height: 40 }, pane), true);
  assert.equal(centredWithin({ x: 900, y: 380, width: 40, height: 40 }, pane), false, "off to one side");
  assert.equal(centredWithin(null, pane), false, "no shape on the page is not 'near the middle'");
  assert.equal(sameScale(1.2, 1.21), true);
  assert.equal(sameScale(1.2, 0.6), false);
  assert.equal(dragMoved({ writes: MIN_CAMERA_WRITES, travelPx: MIN_TRAVEL_PX }), true);
  assert.equal(dragMoved({ writes: 0, travelPx: 0 }), false);
});

test("a complete, well-placed, panned, single-version sample is valid, and three of them make a valid row with medians", () => {
  assert.deepEqual(sampleProblems(sample(), { official: true }), []);
  const r = row([sample({ map_shown_ms: 9000 }), sample({ map_shown_ms: 7000 }), sample({ map_shown_ms: 8000 })]);
  assert.equal(r.valid, true, r.invalid.join("; "));
  assert.equal(r.metrics.map_shown_ms.median, 8000);
  assert.deepEqual([r.metrics.map_shown_ms.min, r.metrics.map_shown_ms.max], [7000, 9000]);
  assert.equal(r.metrics.places.spire.pan_frame_p95_ms.median, 33);
});

test("FALSIFIERS — each of these makes the row INVALID, never a baseline", () => {
  const bad = (s, re) => {
    const r = row([sample(), sample(), s]);
    assert.equal(r.valid, false);
    assert.ok(r.invalid.some((m) => re.test(m)), `${re}: ${r.invalid.join("; ")}`);
  };
  bad(sample({ places: { town_centre: place(), spire: place({ located: false }) } }), /spire: the place was not under the middle/);   // the wrong location
  bad(sample({ places: { town_centre: place({ camera_writes: 0, travel_px: 0 }), spire: place() } }), /town_centre: the drag did not move the camera/);   // no actual pan
  bad(sample({ places: { town_centre: place(), spire: place({ scale_ok: false, scale: 0.4 }) } }), /spire: the camera was not at the common scale/);
  bad(sample({ places: { town_centre: place(), spire: place({ still_in_view: false }) } }), /spire: the place had left the screen/);
  bad(sample({ places: { town_centre: place() } }), /spire: not measured/);                                                          // an unsupported / skipped measurement
  bad(sample({ map_shown_ms: null }), /the map was never shown/);                                                                   // a failed phase
  bad(sample({ interactive_ms: null }), /never reached a 2 s stutter-free window/);
  bad(sample({ error: "page.click: Timeout 30000ms exceeded." }), /phase failed/);                                                  // a missing selector
  bad(sample({ failed_requests: ["404 https://postmark.town/WORLD/world-state.json"] }), /failed requests/);                        // a failed cold load
  bad(sample({ bytes_cold_load_encoded: 0 }), /no cold-load bytes/);
  bad(sample({ visibility: "hidden" }), /not visible/);
  bad(sample({ version_after: versionOf({ ...BUILD, crossing: 324 }) }), /mixed version/);                                          // the town moved under the sample
  bad(sample({ version_before: null, version_after: null }), /build\.json was unavailable/);
  const r = row([sample(), sample(), sample({ idle_busy_pct: NaN })]);
  assert.equal(r.valid, false);
  assert.equal(r.metrics.idle_busy_pct, null, "a gap in one sample leaves the median null, it is not computed over two");
  assert.ok(r.invalid.some((m) => /no value for idle_busy_pct/.test(m)));
});

test("an unofficial run (another origin, other sample count) is flagged so; its version is not required", () => {
  const s = sample({ version_before: null, version_after: null });
  assert.deepEqual(sampleProblems(s, { official: false }), []);
  assert.equal(row([s], false).official, false);
});

test("versions compare on every key; the repo path of a served URL is only for what the repo serves", () => {
  assert.equal(sameVersion(versionOf(BUILD), versionOf({ ...BUILD })), true);
  assert.equal(sameVersion(versionOf(BUILD), versionOf({ ...BUILD, town_sha: "x" })), false);
  assert.equal(sameVersion(null, versionOf(BUILD)), false);
  assert.equal(repoPathOf("/world-engine/spectator/viewer.mjs?v=1"), "spectator/viewer.mjs");
  assert.equal(repoPathOf("/WORLD/world-state.json"), "WORLD/world-state.json");
  assert.equal(repoPathOf("/media/x.png"), null, "an image is not the repo's");
  assert.deepEqual(Object.keys(PLACES), ["town_centre", "spire"], "the two named places");
});
