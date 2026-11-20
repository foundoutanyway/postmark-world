#!/usr/bin/env node
// world-page-audit.mjs — the World page's standing performance audit (WLD-222; ported from the WLD-43 harness).
//
// MANUAL ONLY. It is not a test, not a CI step and not a scheduled job: nothing imports it but its own focused
// offline check (tools/world-page-audit.test.mjs, pure functions only — it never opens a browser or the network).
//
//   node tools/perf/world-page-audit.mjs                        one audit of real, signed-out prod: ONE JSON line on stdout
//   node tools/perf/world-page-audit.mjs --backfill-bytes       the repo-served bytes at each settlement tag, from git only
//   options: --origin URL (default https://postmark.town; any other origin is an UNOFFICIAL run, never a baseline row)
//            --samples N (default 3; the audit's median is over these)   --cpu N (default 4: CPU slowed 4x)
//            --world-path P (default /world/; the offline check against the repo's own spectator server uses /)
//
// What it does, per sample (a FRESH, signed-out browser context each time; unmodified prod; no resident act, no
// cookie or session set up, no response rewriting, no wrapped page functions, no clock shift — passive observers
// and CDP reads only; a "skip" click on the tour card and the page's own search box and wheel/drag are the only inputs):
//   1. loads <origin>/world/ with the CPU slowed, and measures the COLD LOAD (bytes) and the two load times;
//   2. holds still 10 s for idle CPU, then reads heap after a forced GC;
//   3. at EACH of two named places — the Town Centre and the Starforge Spire — picks the place from the page's search
//      box, checks the place really is under the middle of the map, brings the camera to the same scale, and drags the
//      map for 10 s the way a hand would, then reads the pan frames and the longest task.
//
// Definitions (units are in every key's name; every time is ms since the page's navigation began, performance.now()):
//   bytes_cold_load_encoded   bytes on the wire (CDP encodedDataLength: headers + compressed body) of every request that
//                             FINISHED before interactive_ms, all origins; a fresh context, so an empty cache.
//   map_shown_ms              the first moment svg#map-svg exists AND at least one drawn mark (#wv-overlay [data-id]) is in
//                             it, in a visible tab — the map is on screen with its marks, not merely attached.
//   interactive_ms            the earliest moment at or after map_shown_ms from which NO long task (>= 50 ms, the Long Tasks
//                             API) starts for the next 2000 ms. "Answers without stutter."
//   idle_busy_pct             10 s with nothing touched: renderer main-thread task time / wall time (CDP TaskDuration), %.
//   heap_after_gc_mib         JS heap in use after a forced garbage collection, at the end of the sample.
//   pan_frame_p95_ms          95th percentile of the gaps between animation frames over the 10 s drag, at a place.
//   pan_longest_task_ms       the longest long task that overlaps the drag; 0 means none reached 50 ms.
//   drawn_marks               distinct drawn marks (#wv-overlay [data-id]) at the start of the drag at that place.
// A sample is VALID only if every phase ran: no phase's selector missing, no failed request for the page's own
// document or data, the place under the middle of the map, the camera at the same scale at both places, the camera
// actually moved during the drag (>= MIN_CAMERA_WRITES writes, >= MIN_TRAVEL_PX of travel), the place still on screen after,
// and the served version (build.json) the same before and after. Any invalid sample makes the row invalid
// (valid: false, with the reasons) and the exit code 2: an invalid row is never a baseline. A medians-of-zero cannot occur:
// a missing number is null and invalidates the row.
//
// Bytes per settlement from git (--backfill-bytes) are NOT a browser timing replay and NOT a cold load: they are the raw and
// gzip sizes of the repo-served files the page requests (/world-engine/* -> the repo path, /WORLD/world-state.json and
// skeleton.json) at each settlement/S* tag. basis says so on every line; files absent at a tag are listed, never zero-filled.

import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

export const PROD = "https://postmark.town";
export const PINNED_PLAYWRIGHT = "1.62.0";
export const VIEWPORT = { width: 1366, height: 768 };
export const IDLE_MS = 10000;
export const PAN_MS = 10000;
export const QUIET_MS = 2000;            // the stutter-free window that makes the page "interactive"
export const MIN_CAMERA_WRITES = 5;      // a drag that moved the camera fewer times than this was inert (a slowed page may write it rarely, never not at all)
export const MIN_TRAVEL_PX = 60;         // …or moved it less far than this (CSS px of the map)
export const SCALE_TOLERANCE = 0.06;     // both places are panned within 6 % of the same map scale

/** the two named places: what the page's search box finds them by, and the record that says where each is. */
export const PLACES = {
  // `standing`: what the page's own coordinate pill says when the camera is over the place ("at TC"); the Town Centre is a
  // region two kilometres across, drawn differently at each zoom, so the pill is its evidence as well as its shape
  town_centre: { id: "the-town/the-town-centre", query: "town centre", standing: /\bTC\b/ },
  spire: { id: "wright/the-starforge-spire", query: "starforge spire", standing: null },
};

// ── pure helpers (the focused offline check exercises these) ────────────────────────────────────────────────
export const quantile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
export const median = (xs) => quantile(xs, 0.5);
/** {median,min,max,samples} — or null when any sample is missing: a gap is never a zero or a shorter median. */
export const spread = (xs) => (xs.length && xs.every((x) => Number.isFinite(x)) ? { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), samples: xs } : null);

/** the earliest t >= from with no long task starting in [t, t+windowMs), or null while that window is not yet over (`now`). */
export function quietFrom(longTasks, from, windowMs, now) {
  let t = from;
  for (const [start, dur] of [...longTasks].sort((a, b) => a[0] - b[0])) {
    if (start + dur <= t) continue;               // finished before t
    if (start >= t + windowMs) break;             // the window is clear of it
    t = Math.max(t, start + dur);                 // it overlaps or lands inside: the quiet starts after it
  }
  return now - t >= windowMs ? t : null;
}
/** frame gaps (ms) between consecutive animation frames inside [a,b]. */
export const frameGaps = (frames, a, b) => { const f = frames.filter((t) => t >= a && t <= b); return f.slice(1).map((t, i) => t - f[i]); };
/** the longest long task overlapping [a,b], as {ms, count}; ms 0 = none (the API reports tasks of 50 ms and over). */
export function longestTask(longTasks, a, b) {
  const lt = longTasks.filter(([s, d]) => s + d >= a && s <= b);
  return { ms: lt.reduce((m, [, d]) => Math.max(m, d), 0), count: lt.length };
}
/** is the rect's centre within `frac` of the pane's middle, each way (fractions of the pane's width and height)? */
export function centredWithin(rect, pane, frac = 0.12) {
  if (!rect || !pane) return false;
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  return Math.abs(cx - (pane.x + pane.width / 2)) <= pane.width * frac && Math.abs(cy - (pane.y + pane.height / 2)) <= pane.height * frac;
}
export const sameScale = (a, b, tol = SCALE_TOLERANCE) => Number.isFinite(a) && Number.isFinite(b) && b > 0 && Math.abs(a / b - 1) <= tol;
/** an inert drag: the camera was written too few times or went too short a way. */
export const dragMoved = ({ writes, travelPx }) => writes >= MIN_CAMERA_WRITES && travelPx >= MIN_TRAVEL_PX;
export const VERSION_KEYS = ["code_sha", "town_data_sha", "town_sha", "world_sha", "world_digest", "crossing", "world_settlement"];
export const versionOf = (build) => (build ? Object.fromEntries(VERSION_KEYS.map((k) => [k, build[k] ?? null])) : null);
export const sameVersion = (a, b) => !!a && !!b && VERSION_KEYS.every((k) => a[k] === b[k]);
const completeVersion = (v) => !!v && VERSION_KEYS.every((k) => v[k] !== null && v[k] !== undefined && v[k] !== "");

/** one sample's own verdict: the reasons it is not valid (empty = valid). `s` is what measureSample returns. */
export function sampleProblems(s, { official }) {
  const bad = [];
  if (s.error) bad.push(`phase failed: ${s.error}`);
  if (s.visibility !== "visible") bad.push(`tab was ${s.visibility}, not visible`);
  if (!Number.isFinite(s.map_shown_ms)) bad.push("the map was never shown");
  if (!Number.isFinite(s.interactive_ms)) bad.push("the page never reached a 2 s stutter-free window");
  if (!(s.bytes_cold_load_encoded > 0)) bad.push("no cold-load bytes were read");
  if (s.failed_requests?.length) bad.push(`failed requests: ${s.failed_requests.slice(0, 3).join(", ")}`);
  if (official && !sameVersion(s.version_before, s.version_after)) bad.push("the served version changed during the sample (mixed version)");
  if (official && !s.version_before) bad.push("build.json was unavailable, so the served version is unknown");
  for (const [k, p] of Object.entries(s.places ?? {})) {
    if (!p.located) bad.push(`${k}: the place was not under the middle of the map`);
    if (!p.scale_ok) bad.push(`${k}: the camera was not at the common scale (${p.scale} vs ${s.scale_ref})`);
    if (!dragMoved({ writes: p.camera_writes, travelPx: p.travel_px })) bad.push(`${k}: the drag did not move the camera (${p.camera_writes} writes, ${Math.round(p.travel_px)} px)`);
    if (!p.still_in_view) bad.push(`${k}: the place had left the screen after the drag`);
    if (!Number.isFinite(p.frame_p95_ms)) bad.push(`${k}: no animation frames in the drag`);
    if (!(p.drawn_marks > 0)) bad.push(`${k}: no drawn marks`);
  }
  for (const k of Object.keys(PLACES)) if (!s.places?.[k]) bad.push(`${k}: not measured`);
  return bad;
}

/** the audit row from the samples. `town` is the served town's size; `env` the tool/browser provenance. */
export function auditRow({ samples, town, env, official, at }) {
  const invalid = samples.flatMap((s, i) => sampleProblems(s, { official }).map((m) => `sample ${i + 1}: ${m}`));
  if (official) {
    const version = versionOf(town ? { ...town, world_settlement: town.settlement } : null);
    if (!completeVersion(version)) invalid.push("the audit town version is incomplete");
    if (![town?.marks, town?.parcels].every((n) => Number.isInteger(n) && n >= 0)) invalid.push("the audit town size is unavailable");
    if (samples.some((s) => !sameVersion(version, s.version_before) || !sameVersion(version, s.version_after))) invalid.push("mixed version across the audit town and samples");
  }
  const pick = (f) => spread(samples.map(f));
  const place = (k, f) => pick((s) => s.places?.[k] ? f(s.places[k]) : NaN);
  const places = Object.fromEntries(Object.keys(PLACES).map((k) => [k, {
    pan_frame_p95_ms: place(k, (p) => p.frame_p95_ms),
    pan_longest_task_ms: place(k, (p) => p.longest_task_ms),
    pan_long_tasks: place(k, (p) => p.long_tasks),
    drawn_marks: place(k, (p) => p.drawn_marks),
  }]));
  const metrics = {
    bytes_cold_load_encoded: pick((s) => s.bytes_cold_load_encoded),
    map_shown_ms: pick((s) => s.map_shown_ms),
    interactive_ms: pick((s) => s.interactive_ms),
    idle_busy_pct: pick((s) => s.idle_busy_pct),
    heap_after_gc_mib: pick((s) => s.heap_after_gc_mib),
    places,
  };
  const gaps = [];
  const walk = (o, path) => { if (o === null) gaps.push(path); else if (o && typeof o === "object" && !("median" in o)) for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k); };
  walk(metrics, "");
  for (const g of gaps) invalid.push(`no value for ${g}`);
  return {
    kind: "world-page-audit", schema: 1, at, valid: invalid.length === 0, official, invalid,
    town, env, metrics,
    samples: samples.map(({ places: pl, ...rest }) => ({ ...rest, places: pl })),
  };
}

// ── the browser run ──────────────────────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  try { const r = await fetch(url, { headers: { "cache-control": "no-cache" } }); return r.ok ? await r.json() : null; } catch { return null; }
}
/** the served town's size and versions, read from the same origin's public files (outside the throttled page). */
export async function readTown(origin) {
  const build = await fetchJson(`${origin}/build.json`);
  const state = await fetchJson(`${origin}/WORLD/world-state.json`);
  const marks = Array.isArray(state?.marks) ? state.marks : null;
  return {
    build, version: versionOf(build),
    town: {
      marks: marks?.length ?? null,
      parcels: Array.isArray(state?.parcels) ? state.parcels.length : (state?.parcels ? Object.keys(state.parcels).length : null),
      settlement: build?.world_settlement ?? null, crossing: build?.crossing ?? null,
      code_sha: build?.code_sha ?? null, town_data_sha: build?.town_data_sha ?? null, town_sha: build?.town_sha ?? null, world_sha: build?.world_sha ?? null,
      world_digest: build?.world_digest ?? null, code_ref: build?.code_ref ?? null,
    },
  };
}

// installed from the first byte of the page, passive only: long tasks, every animation frame, visibility, the map-shown moment, camera writes
function pageInit() {
  const W = (globalThis.__wpa = { lt: [], frames: [], vis: [document.visibilityState], mapShownAt: null, writes: 0, track: false });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) W.lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch {}
  document.addEventListener("visibilitychange", () => W.vis.push(document.visibilityState));
  let last = null;
  const tick = (t) => {
    W.frames.push(t);
    if (W.mapShownAt === null && document.visibilityState === "visible" && document.querySelector("svg#map-svg") && document.querySelector("#wv-overlay [data-id]")) W.mapShownAt = t;
    // a drag moves the painting by the svg's own transform and commits the viewBox when it lets go, so BOTH are the camera
    if (W.track) {
      const s = document.querySelector("svg#map-svg");
      const v = s ? s.getAttribute("viewBox") + "|" + s.style.transform : null;
      if (v !== last) {
        W.writes++; last = v;
        const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(s?.style.transform ?? "");
        if (m) { const [x, y] = [Number(m[1]), Number(m[2])]; W.tx = [Math.min(W.tx?.[0] ?? x, x), Math.max(W.tx?.[1] ?? x, x)]; W.ty = [Math.min(W.ty?.[0] ?? y, y), Math.max(W.ty?.[1] ?? y, y)]; }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const readPage = (page) => page.evaluate(() => { const W = globalThis.__wpa; return { lt: W.lt, frames: W.frames, vis: W.vis, mapShownAt: W.mapShownAt, writes: W.writes, tx: W.tx ?? null, ty: W.ty ?? null }; });
const nowMs = (page) => page.evaluate(() => performance.now());

/** the camera as the page draws it: viewBox x/y/w and the map's CSS size, so scale = CSS px per viewBox unit. */
const camera = (page) => page.evaluate(() => {
  const svg = document.querySelector("svg#map-svg"); if (!svg) return null;
  const [x, y, w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number); const r = svg.getBoundingClientRect();
  return { x, y, w, h, cssW: r.width, cssH: r.height, left: r.left, top: r.top, scale: r.width / w };
});
const placeRect = (page, id) => page.evaluate((id) => {
  // the place's own shape on the painting (its extent polygon, or its far-picture hit area), not its card in the list
  const els = [...document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)].filter((e) => /^(polygon|circle)$/i.test(e.tagName));
  const el = els.find((e) => /polygon/i.test(e.tagName)) ?? els[0];
  const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}, id);
const paneRect = (page) => page.evaluate(() => { const r = document.querySelector("svg#map-svg").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const drawnMarks = (page) => page.evaluate(() => new Set([...document.querySelectorAll("#wv-overlay [data-id]")].map((e) => e.getAttribute("data-id"))).size);

async function settle(page, ms, cap) {
  const end = Date.now() + cap;
  while (Date.now() < end) {
    const { lt } = await readPage(page); const now = await nowMs(page);
    if (now - lt.reduce((m, [s, d]) => Math.max(m, s + d), 0) >= ms) return true;   // no long task has ended in the last `ms`
    await sleep(250);
  }
  return false;
}

async function measureSample(browser, origin, cpu, scaleRef, worldPath) {
  const worldUrl = `${origin}${worldPath}`;
  const out ={ places: {}, failed_requests: [], error: null };
  const before = await readTown(origin);
  out.version_before = before.version;
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(pageInit);
  const page = await ctx.newPage();
  try {
    // same-site first, so the CPU throttle is on the process the World page then runs in
    await page.goto(`${origin}/build.json`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await cdp.send("Performance.enable");
    await cdp.send("Network.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    // the wire: every request's start, finish and size, and what it was
    const reqs = new Map(); let docT0 = null;
    cdp.on("Network.requestWillBeSent", (e) => { if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp, type: e.type }); if (e.type === "Document" && e.request.url === worldUrl && docT0 === null) docT0 = e.timestamp; });
    cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.type = e.type; } });
    cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.bytes = e.encodedDataLength; } });
    cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r && !e.canceled) { r.failed = e.errorText; } });

    // 1 ── the cold load
    await page.goto(worldUrl, { waitUntil: "load" });
    out.visibility = await page.evaluate(() => document.visibilityState);
    let mapAt = null;
    for (let t = 0; t < 480 && mapAt === null; t++) { mapAt = (await readPage(page)).mapShownAt; if (mapAt === null) await sleep(250); }
    out.map_shown_ms = mapAt;
    if (mapAt === null) throw new Error("svg#map-svg with drawn marks never appeared");
    let tti = null;
    for (let t = 0; t < 480 && tti === null; t++) { const { lt } = await readPage(page); tti = quietFrom(lt, mapAt, QUIET_MS, await nowMs(page)); if (tti === null) await sleep(250); }
    out.interactive_ms = tti;
    if (tti === null) throw new Error("no 2 s stutter-free window followed the map");
    // bytes of what finished by interactive_ms (the document's request start is the clock's zero, close to navigation start)
    const done = [...reqs.values()].filter((r) => r.t1 !== undefined && docT0 !== null && (r.t1 - docT0) * 1000 <= tti + 1 && r.t0 >= docT0 - 0.001);
    out.bytes_cold_load_encoded = done.reduce((a, r) => a + (r.bytes ?? 0), 0);
    out.requests_cold_load = done.length;
    out.bytes_by_type = {}; for (const r of done) out.bytes_by_type[r.type ?? "Other"] = (out.bytes_by_type[r.type ?? "Other"] ?? 0) + (r.bytes ?? 0);
    out.cold_load_files = done.map((r) => { try { return new URL(r.url).pathname; } catch { return r.url; } }).sort();
    // a failed request invalidates the sample only if it is the page itself or the town's own data and code; any other
    // failure is recorded beside the sample (other_failed_requests), where a reader can see it, but is not the measure's concern
    const failed = [...reqs.values()].filter((r) => r.failed || r.status >= 400);
    const own = (r) => r.type === "Document" || /\/(WORLD\/(world-state|skeleton)\.json|world-engine\/.*\.mjs|_astro\/.*\.js)(\?|$)/.test(r.url);
    out.failed_requests = failed.filter(own).map((r) => `${r.failed ?? r.status} ${r.url}`);
    out.other_failed_requests = failed.filter((r) => !own(r)).map((r) => `${r.failed ?? r.status} ${r.url}`);

    // 2 ── the tour holds the roll-in; a returning visitor skips it
    // (the tour's wrapper, .wv-tour, carries `hidden`; its card never does)
    const tour = await page.locator(".wv-tour:not([hidden])").count();
    if (tour) {
      await page.click(".wv-tour-skip", { timeout: 30000 });
      await page.waitForSelector(".wv-tour:not([hidden])", { state: "detached", timeout: 15000 }).catch(() => { throw new Error("the tour did not close after skip"); });
    }
    await page.mouse.move(4, 4);
    await settle(page, 1500, 30000);

    // 3 ── idle: nothing touched for 10 s
    const m0 = await metrics();
    await sleep(IDLE_MS);
    const m1 = await metrics();
    out.idle_busy_pct = ((m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp)) * 100;

    // 4 ── the two places, one drag each
    for (const [key, place] of Object.entries(PLACES)) {
      const rec = { id: place.id };
      await settle(page, 1500, 60000);      // the page has let go of the last drag before the next hand reaches for the search box
      await page.fill(".wv-search-input", place.query);
      await page.waitForSelector(`.wv-search-hit[data-hit="${place.id}"]`, { timeout: 15000 });
      await page.click(`.wv-search-hit[data-hit="${place.id}"]`, { timeout: 90000 });
      await sleep(1500);
      const pane = await paneRect(page);
      const mid = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
      await page.mouse.move(mid.x, mid.y);
      // the common scale: the first place takes one wheel notch in (the fit view is the zoom-out limit); the second is brought to that
      let cam = await camera(page);
      if (scaleRef.value === null) { await page.mouse.wheel(0, -300); await sleep(2500); cam = await camera(page); scaleRef.value = cam.scale; }
      for (let n = 0; n < 14 && !sameScale(cam.scale, scaleRef.value); n++) { await page.mouse.wheel(0, cam.scale < scaleRef.value ? -300 : 300); await sleep(1200); cam = await camera(page); }
      rec.scale = cam.scale; rec.scale_ref = scaleRef.value; rec.scale_ok = sameScale(cam.scale, scaleRef.value);
      await settle(page, 1500, 30000);
      const standing = () => page.evaluate(() => document.querySelector(".wv-spectator-coordinate")?.textContent?.trim() ?? "");
      rec.standing = await standing();
      rec.located = centredWithin(await placeRect(page, place.id), await paneRect(page)) || !!place.standing?.test(rec.standing);
      rec.drawn_marks = await drawnMarks(page);
      // the drag: a hand moving the map in a slow ellipse for 10 s, ~60 moves a second
      cam = await camera(page);
      await page.evaluate(() => { const W = globalThis.__wpa; W.track = true; W.writes = 0; W.tx = null; W.ty = null; });
      const cam0 = cam;
      const p0 = await nowMs(page);
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.down();
      const w0 = Date.now(); let moves = 0;
      while (Date.now() - w0 < PAN_MS) {
        const t = (Date.now() - w0) / 1000;
        await page.mouse.move(mid.x - 120 + 120 * Math.cos((2 * Math.PI * t) / 2.5), mid.y + 90 * Math.sin((2 * Math.PI * t) / 3.7));
        moves++; await sleep(16);
      }
      await page.mouse.up();
      const p1 = await nowMs(page);
      const cam1 = await camera(page);
      const R = await readPage(page);
      await page.evaluate(() => { globalThis.__wpa.track = false; });
      const gaps = frameGaps(R.frames, p0, p1);
      const lt = longestTask(R.lt, p0, p1);
      rec.frame_p95_ms = quantile(gaps, 0.95);
      rec.frame_p50_ms = quantile(gaps, 0.5);
      rec.frames = gaps.length;
      rec.longest_task_ms = lt.ms; rec.long_tasks = lt.count;
      rec.moves = moves; rec.camera_writes = R.writes;
      // how far the painting travelled under the hand: the extent of the svg's translate during the drag (CSS px)
      rec.travel_px = R.tx && R.ty ? Math.hypot(R.tx[1] - R.tx[0], R.ty[1] - R.ty[0]) : 0;
      rec.still_in_view = (await placeRect(page, place.id).then((r) => !!r && r.x < pane.x + pane.width && r.x + r.width > pane.x && r.y < pane.y + pane.height && r.y + r.height > pane.y))
        || !!place.standing?.test(await standing());
      out.places[key] = rec;
      await page.mouse.move(4, 4);
    }
    out.scale_ref = scaleRef.value;

    // 5 ── the end of the sample: the throttle proved, the heap after a collection, the page's size
    out.calibration_ms = await page.evaluate(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x = (x + i * 7) % 1000003; return performance.now() - t + (x < 0 ? 1 : 0); });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    out.heap_after_gc_mib = (await metrics()).JSHeapUsedSize / 2 ** 20;
    out.dom_nodes = await page.evaluate(() => document.querySelectorAll("*").length);
    const R = await readPage(page);
    out.long_tasks_total = R.lt.length;
    out.visibility = R.vis.every((v) => v === "visible") ? "visible" : R.vis.join(",");
  } catch (e) {
    out.error = String(e?.message ?? e).split("\n").slice(0, 6).join(" | ").slice(0, 600);
  } finally {
    await ctx.close();
  }
  const after = await readTown(origin);
  out.version_after = after.version;
  return out;
}

export async function runAudit({ origin = PROD, samples = 3, cpu = 4, worldPath = "/world/" } = {}) {
  const require = createRequire(join(REPO, "package.json"));
  const pw = require("playwright");
  const pwVersion = JSON.parse(readFileSync(join(dirname(require.resolve("playwright/package.json")), "package.json"), "utf8")).version;
  const official = origin === PROD && samples === 3 && cpu === 4 && pwVersion === PINNED_PLAYWRIGHT;
  const browser = await pw.chromium.launch({ headless: true, args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });
  const started = Date.now();
  const served = await readTown(origin);
  const scaleRef = { value: null };
  const list = [];
  const chromium = browser.version();
  try { for (let i = 0; i < samples; i++) list.push(await measureSample(browser, origin, cpu, scaleRef, worldPath)); }
  finally { await browser.close(); }
  const env = {
    origin, cpu_throttle: cpu, samples, viewport: VIEWPORT, signed_in: false, idle_ms: IDLE_MS, pan_ms: PAN_MS, quiet_window_ms: QUIET_MS,
    playwright: pwVersion, playwright_pinned: PINNED_PLAYWRIGHT, chromium, node: process.version, duration_s: Math.round((Date.now() - started) / 1000),
  };
  return auditRow({ samples: list, town: served.town, env, official, at: new Date().toISOString() });
}

// ── bytes per settlement, from git (no browser, no network) ──────────────────────────────────────────────────
/** the repo-served files the page requests: /world-engine/x -> x in this repo; /WORLD/f -> WORLD/f. Anything else is not repo-served. */
export function repoPathOf(urlPath) {
  const p = String(urlPath).split("?")[0];
  if (p.startsWith("/world-engine/")) return p.slice("/world-engine/".length);
  if (p === "/WORLD/world-state.json" || p === "/WORLD/skeleton.json") return p.slice(1);
  return null;
}
export const DEFAULT_SERVED = ["WORLD/world-state.json", "WORLD/skeleton.json", "spectator/viewer.mjs", "spectator/mists-render.mjs", "spectator/mark-icons.mjs", "spectator/circle-reader.mjs", "spectator/holdings.mjs", "spectator/home-column.mjs",
  "tools/world-engine.mjs", "tools/world-verbs.mjs", "tools/world-build.mjs", "tools/geometry.mjs", "tools/claim-instant.mjs", "tools/class-properties.mjs", "tools/consent.mjs", "tools/enter-exit.mjs", "tools/mark-kind.mjs", "tools/mark-name.mjs",
  "tools/mark-standing.mjs", "tools/mists-keep.mjs", "tools/portals.mjs", "tools/record-sources.mjs", "tools/region-outsiders.mjs", "tools/walk.mjs", "tools/walker-roster.mjs", "tools/water.mjs", "tools/where-is.mjs"];

export function backfillBytes({ files = DEFAULT_SERVED, repo = REPO } = {}) {
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "buffer", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  const tags = git("tag", "-l", "settlement/S*").toString().trim().split("\n").filter(Boolean).sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
  return tags.map((tag) => {
    const sha = git("rev-list", "-n", "1", tag).toString().trim();
    let raw = 0, gz = 0; const missing = [];
    for (const f of files) {
      let b; try { b = git("show", `${sha}:${f}`); } catch { missing.push(f); continue; }
      raw += b.length; gz += gzipSync(b).length;
    }
    return {
      kind: "bytes-backfill", schema: 1, settlement: tag.replace("settlement/", ""), commit: sha, files: files.length - missing.length, files_missing: missing,
      repo_bytes_raw: raw, repo_bytes_gzip: gz,
      basis: "sum of git blob sizes (raw, and gzip -6) at the settlement tag of the repo-served files the World page requests; NOT a browser cold load (no site assets, no images, no HTTP headers, whatever the CDN compressed) and NOT a timing replay. The file set is today's served list applied to every tag: a file not yet in the repo at that tag is listed in files_missing and counts as nothing, so early rows are lower bounds on that set, not the page of their day",
    };
  });
}

// ── the command line ─────────────────────────────────────────────────────────────────────────────────────────
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1]; };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--backfill-bytes")) {
    for (const row of backfillBytes()) console.log(JSON.stringify(row));
  } else {
    const row = await runAudit({ origin: arg("--origin", PROD).replace(/\/$/, ""), samples: Number(arg("--samples", 3)), cpu: Number(arg("--cpu", 4)), worldPath: arg("--world-path", "/world/") });
    console.log(JSON.stringify(row));
    if (!row.valid) { console.error(`INVALID ROW — not a baseline. ${row.invalid.length} problem(s):\n  ` + row.invalid.join("\n  ")); process.exitCode = 2; }
  }
}
