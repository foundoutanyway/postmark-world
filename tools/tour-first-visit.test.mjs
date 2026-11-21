// tour-first-visit.test.mjs — WLD-220 (Darko 2026-11-20: "stale ... too much superfluous information ... straight and to the point for someone visiting the page
// for the first time"), the first-visit tour on the REAL page, on a phone and on a desktop.
//
//   node --test tools/tour-first-visit.test.mjs
//
// The deck is three short steps (what this is / look around / where to go next, and the ? brings it back). What the source tests (viewer-axes.test.mjs) cannot say
// is whether the deck WORKS on the page a visitor gets: that it greets a spectator, that next / back / a dot / done / skip each do their one job on the shorter deck,
// that the ? reopens it, that every control and the whole card sit inside the screen (a clipped next is the CORE-54 finding), that a phone is told drag and tap and a
// desktop its wheel, and that the page underneath comes back intact. The real viewer, served by the real server (the existing page-test rig, tools/page-machine.mjs),
// signed in as nobody: a spectator, no key, no act.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { machineContext } from "./page-machine.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
async function loadChromium() { try { return (await import("playwright")).chromium; } catch { return null; } }
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const CLEANUP = [];
after(() => { for (const stop of CLEANUP.reverse()) { try { stop(); } catch { /* gone */ } } });
async function bootRig() {
  const port = await freePort();
  const proc = spawn(process.execPath, [join(ROOT, "spectator", "server.mjs")], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), ATLAS_ORIGIN: "http://127.0.0.1:1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  CLEANUP.push(() => proc.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the rig did not announce itself in 30s")), 30_000);
    proc.stdout.on("data", (b) => { if (String(b).includes(`localhost:${port}`)) { clearTimeout(timer); resolve(); } });
    proc.on("exit", (c) => { clearTimeout(timer); reject(new Error(`the rig exited ${c} before serving`)); });
  });
  return port;
}

let chromium = null, browser = null, port = null;
before(async () => {
  chromium = await loadChromium();
  if (!chromium) return;
  port = await bootRig();
  browser = await chromium.launch();
  CLEANUP.push(() => browser.close());
});

// the tour as the page has it: where each control and the card stand, and whether every one is wholly on the screen and inside the card
const readTour = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; };
  const card = box(q(".wv-tour-card"));
  const parts = [...document.querySelectorAll(".wv-tour-dot")].map(box).concat([".wv-tour-skip", ".wv-tour-back", ".wv-tour-next"].map((s) => box(q(s))));
  const inside = (b, o) => b.x >= o.x - 0.5 && b.right <= o.right + 0.5 && b.y >= o.y - 0.5 && b.bottom <= o.bottom + 0.5;
  const screen = { x: 0, y: 0, right: innerWidth, bottom: innerHeight };
  return {
    open: !q(".wv-tour")?.hidden && !!card && card.w > 0,
    kicker: q(".wv-tour-kicker")?.textContent ?? null,
    title: q(".wv-tour-title")?.textContent ?? null,
    text: q(".wv-tour-body")?.textContent ?? "",
    dots: document.querySelectorAll(".wv-tour-dot").length,
    onDot: [...document.querySelectorAll(".wv-tour-dot")].findIndex((d) => d.classList.contains("on")),
    next: q(".wv-tour-next")?.textContent ?? null,
    backDisabled: q(".wv-tour-back")?.disabled ?? null,
    cardOnScreen: !!card && inside(card, screen),
    controlsInCard: parts.every((b) => b && b.w > 0 && inside(b, card)),
    controlsOnScreen: parts.every((b) => b && inside(b, screen)),
    phone: matchMedia("(max-width:720px)").matches,
  };
});

async function onThePage(t, { viewport, phone }) {
  if (!chromium) { t.skip("NO PLAYWRIGHT — the first-visit tour went UNGUARDED"); return; }
  const ctx = await machineContext(browser, { viewport, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(`http://localhost:${port}/?lite=0`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // a spectator is greeted on every visit (Keemin 2026-08-12), with no key and no click
  await page.waitForSelector(".wv-tour-card", { state: "visible", timeout: 90_000 });
  const press = (sel) => (phone ? page.tap(sel) : page.click(sel));
  const out = {};

  // ── step 1 of 3: the greeting, whole on the screen ─────────────────────────
  const s1 = await readTour(page);
  assert.equal(s1.phone, !!phone);
  assert.equal(s1.kicker, "The World · 1 / 3");
  assert.equal(s1.title, "Welcome to the world");
  assert.equal(s1.dots, 3, "one dot a step");
  assert.equal(s1.onDot, 0);
  assert.equal(s1.next, "next");
  assert.equal(s1.backDisabled, true, "nothing before the first step");
  assert.ok(s1.cardOnScreen, "the whole card is on the screen");
  assert.ok(s1.controlsInCard, "every dot, skip, back and next lies wholly inside the card");
  assert.ok(s1.controlsOnScreen, "and wholly on the screen: no control is clipped at an edge");
  assert.match(s1.text, /living painting of Postmark's town/);
  out.s1 = s1;

  // ── next: the look-around step, in this screen's words ─────────────────────
  await press(".wv-tour-next");
  const s2 = await readTour(page);
  assert.equal(s2.kicker, "The World · 2 / 3");
  assert.equal(s2.title, "Look around");
  assert.equal(s2.onDot, 1);
  assert.equal(s2.backDisabled, false);
  assert.ok(s2.cardOnScreen && s2.controlsInCard && s2.controlsOnScreen, "step 2 fits whole");
  if (phone) {
    assert.match(s2.text, /Drag to move\./);
    assert.match(s2.text, /\btap\b/);
    assert.doesNotMatch(s2.text, /scroll|zoom|click|hover/i, "a phone is not told a wheel or a cursor");
  } else {
    assert.match(s2.text, /scroll to zoom/);
    assert.match(s2.text, /\bclick\b/);
  }
  out.s2 = s2;

  // ── back, then a dot to the last step, which says done ─────────────────────
  await press(".wv-tour-back");
  assert.equal((await readTour(page)).kicker, "The World · 1 / 3", "back returns to the first step");
  await press('.wv-tour-dot[data-tour-to="2"]');
  const s3 = await readTour(page);
  assert.equal(s3.kicker, "The World · 3 / 3", "a dot jumps");
  assert.equal(s3.title, "Where to go next");
  assert.equal(s3.next, "done", "the last step finishes");
  assert.ok(s3.cardOnScreen && s3.controlsInCard && s3.controlsOnScreen, "step 3 fits whole");
  assert.match(s3.text, /\? opens this tour again/);
  if (phone) { assert.match(s3.text, /\btap a badge\b/); assert.doesNotMatch(s3.text, /click/i); } else assert.match(s3.text, /\bclick a badge\b/);
  out.s3 = s3;

  // ── done closes it, and the page underneath is intact; the ? brings it back ─
  await press(".wv-tour-next");
  await page.waitForSelector(".wv-tour", { state: "hidden", timeout: 10_000 });
  assert.equal((await readTour(page)).open, false, "done closes the tour");
  assert.ok(await page.evaluate(() => !!document.querySelector(".wv-minimap > svg") && !!document.querySelector(".wv-mapctl")), "the map and its controls are there after the tour");
  await press(".wv-tour-open");
  await page.waitForSelector(".wv-tour-card", { state: "visible", timeout: 10_000 });
  const again = await readTour(page);
  assert.equal(again.kicker, "The World · 1 / 3", "the ? reopens the tour at its first step");
  assert.ok(again.cardOnScreen && again.controlsInCard && again.controlsOnScreen);

  // ── skip closes it too, and the same page is there ─────────────────────────
  await press(".wv-tour-skip");
  await page.waitForSelector(".wv-tour", { state: "hidden", timeout: 10_000 });
  assert.ok(await page.evaluate(() => !!document.querySelector(".wv-minimap > svg")), "skip leaves the page as it was");
  assert.deepEqual(errors, [], "no page error across the tour");
  await ctx.close();
  return out;
}

test("the page, on a phone (390 x 844, touch): three steps, each control whole on the screen, drag and tap, done / ? / skip", async (t) => {
  await onThePage(t, { viewport: { width: 390, height: 844 }, phone: true });
});

test("the page, on a desktop (1440 x 900): the same three steps in the cursor's words", async (t) => {
  await onThePage(t, { viewport: { width: 1440, height: 900 }, phone: false });
});
