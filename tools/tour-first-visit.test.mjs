// tour-first-visit.test.mjs — WLD-220 (Darko 2026-11-20: "stale ... too much superfluous information ... straight and to the point for someone visiting the page
// for the first time"), the first-visit tour on the REAL page, on a phone and on a desktop.
//
//   node --test tools/tour-first-visit.test.mjs
//
// The deck is five short steps (what this is / houses and residents / everything is a mark [Darko 2026-11-21 09:12, the two map-meaning cards] / look around / where to
// go next, and the ? brings it back). What the source tests (viewer-axes.test.mjs) cannot say
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
    // the type (the join flow's large words) and the PICTURE the step shows: drawn with the map's own pieces, whole inside the card, its labels not clipped
    type: { title: parseFloat(getComputedStyle(q(".wv-tour-title")).fontSize), body: parseFloat(getComputedStyle(q(".wv-tour-body")).fontSize), titleColor: getComputedStyle(q(".wv-tour-title")).color },
    visual: (() => {
      const v = q(".wv-tour-visual"); if (!v || v.hidden) return null;
      const r = v.getBoundingClientRect(), c = q(".wv-tour-card").getBoundingClientRect(), svg = v.querySelector("svg"), sr = svg?.getBoundingClientRect() ?? null;
      const within = (b, o) => !!o && b.x >= o.x - 0.5 && b.right <= o.right + 0.5 && b.y >= o.y - 0.5 && b.bottom <= o.bottom + 0.5;
      const walker = v.querySelector(".wv-walker-far:not(.moving) > .wv-walker-frame");
      return { w: r.width, h: r.height, insideCard: within(r, c), svgW: sr?.width ?? 0, svgH: sr?.height ?? 0,
        labels: [...v.querySelectorAll("svg text")].map((t) => t.textContent), labelsInside: [...v.querySelectorAll("svg text")].every((t) => within(t.getBoundingClientRect(), sr)),
        walkers: v.querySelectorAll(".wv-walker-frame").length, movers: v.querySelectorAll(".wv-walker-far.moving").length, leg: !!v.querySelector(".wv-walk-leg"), legDash: getComputedStyle(v.querySelector(".wv-walk-leg") ?? v).strokeDasharray,
        pips: v.querySelectorAll(".ov-pip").length, parcels: v.querySelectorAll("polygon.wv-fp").length, images: v.querySelectorAll("svg image").length,
        walkerStroke: walker ? getComputedStyle(walker).stroke : null, ctls: [...v.querySelectorAll(".tv-ctl")].map((e) => e.textContent), search: !!v.querySelector(".tv-search") };
    })(),
    // for a failure message: where the screen, the card and every part stood
    geometry: { screen: [innerWidth, innerHeight], card, parts: parts.map((b) => b && [b.x, b.y, b.right, b.bottom].map(Math.round)) },
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
  // the card glides to each step's place (transform .22 s, slower on a throttled or busy machine): a read is taken once it has ARRIVED. Arrived means the card has NO
  // transition or animation still running (the page's own account of a glide: getAnimations() flushes the style change that starts it, so a glide that has not yet
  // begun is seen as running) AND two reads 150 ms apart are alike. Two alike reads alone are not enough: a starved main thread paints no frame, so a glide that is
  // under way reads the same twice (found on a desktop run, the card read at its start position, left 0 under a centring translate).
  const settle = async () => {
    let before = null;
    for (let i = 0; i < 120; i++) {
      const r = await readTour(page);
      const running = await page.evaluate(() => (document.querySelector(".wv-tour-card")?.getAnimations?.() ?? []).filter((a) => a.playState !== "finished" && a.playState !== "idle").length);
      const key = JSON.stringify([r.kicker, r.cardOnScreen, running]) + JSON.stringify(await page.evaluate(() => document.querySelector(".wv-tour-card")?.getBoundingClientRect().toJSON()));
      if (running === 0 && key === before) return;
      before = key;
      await page.waitForTimeout(150);
    }
    assert.fail("the tour card never came to rest");
  };
  const press = async (sel) => { await (phone ? page.tap(sel) : page.click(sel)); await settle(); };
  const out = {};
  await settle();

  // ── step 1 of 5: the greeting, whole on the screen ─────────────────────────
  const s1 = await readTour(page);
  assert.equal(s1.phone, !!phone);
  assert.equal(s1.kicker, "The World · 1 / 5");
  assert.equal(s1.title, "Welcome to the world");
  assert.equal(s1.dots, 5, "one dot a step");
  assert.equal(s1.onDot, 0);
  assert.equal(s1.next, "next");
  assert.equal(s1.backDisabled, true, "nothing before the first step");
  assert.ok(s1.cardOnScreen, "the whole card is on the screen");
  assert.ok(s1.controlsInCard, "every dot, skip, back and next lies wholly inside the card");
  assert.ok(s1.controlsOnScreen, "and wholly on the screen: no control is clipped at an edge");
  assert.match(s1.text, /^The people and agents who live here write the world in words\.The world is told, not drawn\.$/, "the welcome: the accepted sentence (the people, humans included, and the agents; Wright 2026-11-21 07:43) and its one bold line, nothing more");
  // the join flow's big type (a large gold headline, a large soft caption) and a picture on paper, whole inside the card
  assert.ok(s1.type.title >= 27 && s1.type.body >= 17, `large type: headline ${s1.type.title}px, caption ${s1.type.body}px`);
  assert.equal(s1.type.titleColor, "rgb(246, 220, 174)", "the join flow's gold");
  const picture = (s, what) => { assert.ok(s.visual, `${what} shows a picture`); assert.ok(s.visual.insideCard && s.visual.svgW >= 250 && s.visual.svgH >= 120 || s.visual.ctls.length, `${what}: the picture is whole inside the card and big enough to read (${JSON.stringify(s.visual && { w: s.visual.w, h: s.visual.h, svgW: s.visual.svgW })})`); return s.visual; };
  const v1 = picture(s1, "step 1");
  assert.ok(v1.labels.includes("the lamp is always lit") && v1.labelsInside, "the welcome draws the sentence and the lit lamp it puts on a parcel, its words whole");
  assert.ok(v1.parcels === 1 && v1.pips === 1, "on the map's parcel footprint, with the map's pip");
  out.s1 = s1;

  // ── next: Darko's two map-meaning cards (2026-11-21 09:12 EST), the same words on both screens ──
  await press(".wv-tour-next");
  const sp = await readTour(page);
  assert.equal(sp.kicker, "The World · 2 / 5");
  assert.equal(sp.title, "Houses and residents");
  assert.equal(sp.onDot, 1);
  assert.equal(sp.backDisabled, false);
  assert.ok(sp.cardOnScreen && sp.controlsInCard && sp.controlsOnScreen, `step 2 fits whole: ${JSON.stringify({ card: sp.cardOnScreen, inCard: sp.controlsInCard, onScreen: sp.controlsOnScreen, geometry: sp.geometry })}`);
  assert.match(sp.text, /^A house is a parcel\.Green figures are residents\.A dotted line means walking now\.$/, "a few large words: a house is a parcel, green figures are residents, a dotted line means walking now");
  assert.doesNotMatch(sp.text, /click|tap|drag|scroll|zoom|hover|wheel/i, "no input is named: a phone reads the same words");
  const vp = picture(sp, "step 2");
  // the picture IS the meaning, in the map's own drawing: a parcel with its house, a resident at home and a resident walking with the dashed leg, each labelled
  assert.equal(vp.parcels, 1, "the parcel footprint");
  assert.equal(vp.pips, 1, "the house (the map's home pip)");
  assert.equal(vp.walkers, 2, "two residents");
  assert.equal(vp.movers, 1, "one of them walking");
  assert.ok(vp.leg, "with the dashed leg to where they are going");
  assert.ok(vp.legDash && vp.legDash !== "none", `the leg is dotted (stroke-dasharray ${vp.legDash})`);
  assert.equal(vp.walkerStroke, "rgb(132, 201, 143)", "a resident is the map's green");
  for (const word of ["house", "resident", "walking now"]) assert.ok(vp.labels.includes(word), `the picture labels the ${word}`);
  assert.ok(vp.labelsInside, "every label is whole inside its picture");
  out.sp = sp;
  await press(".wv-tour-next");
  const sm = await readTour(page);
  assert.equal(sm.kicker, "The World · 3 / 5");
  assert.equal(sm.title, "Everything is a mark");
  assert.equal(sm.onDot, 2);
  assert.ok(sm.cardOnScreen && sm.controlsInCard && sm.controlsOnScreen, `step 3 fits whole: ${JSON.stringify({ card: sm.cardOnScreen, inCard: sm.controlsInCard, onScreen: sm.controlsOnScreen, geometry: sm.geometry })}`);
  assert.match(sm.text, /^Every picture and shape on the map is a mark, made by an agent\.$/);
  const vm = picture(sm, "step 3");
  // a mark's picture (the record's own image when one is loaded, else the map's pip) and a mark's shape (the map's footprint), each labelled, and said to be an agent's
  assert.ok(vm.images === 1 || vm.pips >= 2, `a picture mark is drawn (${vm.images} images, ${vm.pips} pips)`);
  assert.equal(vm.parcels, 1, "and a shape mark (a footprint)");
  for (const word of ["picture", "shape", "made by an agent"]) assert.ok(vm.labels.includes(word), `the picture labels: ${word}`);
  assert.ok(vm.labelsInside);
  out.sm = sm;

  // ── next: the look-around step, in this screen's words ─────────────────────
  await press(".wv-tour-next");
  const s2 = await readTour(page);
  assert.equal(s2.kicker, "The World · 4 / 5");
  assert.equal(s2.title, "Look around");
  assert.equal(s2.onDot, 3);
  assert.equal(s2.backDisabled, false);
  assert.ok(s2.cardOnScreen && s2.controlsInCard && s2.controlsOnScreen, `step 4 fits whole: ${JSON.stringify({ card: s2.cardOnScreen, inCard: s2.controlsInCard, onScreen: s2.controlsOnScreen, geometry: s2.geometry })}`);
  if (phone) {
    assert.match(s2.text, /^Drag to move\.Tap a dot to read it\.$/);
    assert.doesNotMatch(s2.text, /scroll|zoom|click|hover/i, "a phone is not told a wheel or a cursor");
  } else {
    assert.match(s2.text, /^Drag to move\.Scroll to zoom\.Click a dot to read it\.$/);
  }
  const v2 = picture(s2, "step 4");
  assert.ok(v2.search && v2.ctls.join("") === "⛶💬?", `the map's own search and its fit, conversations and tour buttons are drawn (${v2.ctls.join(" ")})`);
  out.s2 = s2;

  // ── back (to the marks card), then a dot to the last step, which says done ─
  await press(".wv-tour-back");
  assert.equal((await readTour(page)).kicker, "The World · 3 / 5", "back returns one step");
  await press('.wv-tour-dot[data-tour-to="4"]');
  const s3 = await readTour(page);
  assert.equal(s3.kicker, "The World · 5 / 5", "a dot jumps");
  assert.equal(s3.title, "Where to go next");
  assert.equal(s3.next, "done", "the last step finishes");
  assert.ok(s3.cardOnScreen && s3.controlsInCard && s3.controlsOnScreen, "step 5 (the last) fits whole");
  assert.match(s3.text, /^💬 is where the town is talking\.\? brings this tour back\.Read the docs$/);
  const v3 = picture(s3, "step 5");
  assert.ok(v3.ctls.join("") === "💬?", "the conversations and tour buttons, drawn large");
  out.s3 = s3;

  // ── the last step's one link, /docs/ (Wright 2026-11-21 06:17): whole on the screen, keyboard-usable, and the tour's own click handling does not swallow it ──
  assert.match(s3.text, /Read the docs$/);
  const link = await page.evaluate(() => {
    const a = document.querySelector('.wv-tour-body a'); if (!a) return null;
    const card = document.querySelector(".wv-tour-card").getBoundingClientRect(), r = a.getBoundingClientRect();
    const all = [...document.querySelectorAll(".wv-tour-body a")];
    a.focus();
    return { count: all.length, href: a.getAttribute("href"), text: a.textContent, whole: r.width > 0 && r.x >= card.x && r.right <= card.right && r.y >= card.y && r.bottom <= card.bottom && r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      focusable: document.activeElement === a, underline: getComputedStyle(a).textDecorationLine, color: getComputedStyle(a).color, body: getComputedStyle(document.querySelector(".wv-tour-body")).color };
  });
  assert.ok(link, "the last step has a link");
  assert.equal(link.count, 1, "one link, and no other in the tour");
  assert.equal(link.href, "/docs/");
  assert.equal(link.text, "Read the docs");
  assert.ok(link.whole, "the link lies wholly on the screen and inside the card");
  assert.ok(link.focusable, "a keyboard reaches it (it takes focus)");
  assert.ok(link.underline.includes("underline") || link.color !== link.body, `the link reads as a link (underline ${link.underline}, colour ${link.color} against the body's ${link.body})`);
  // a real press on it: nothing in the page's click handling cancels the navigation. A listener AFTER the page's own delegate records whether it was cancelled, then cancels it
  // itself so the test page stays put (this fixture does not serve the Site's /docs/, and is not asked to).
  await page.evaluate(() => { window.__docsClick = null; document.addEventListener("click", (e) => { if (e.target.closest?.('.wv-tour-body a')) { window.__docsClick = { cancelledByPage: e.defaultPrevented }; e.preventDefault(); } }); });
  await (phone ? page.tap('.wv-tour-body a') : page.click('.wv-tour-body a'));
  assert.deepEqual(await page.evaluate(() => window.__docsClick), { cancelledByPage: false }, "the tour's handler leaves the link's navigation alone");
  assert.equal((await readTour(page)).open, true, "following it is the visitor's choice; the tour is not closed under them by the press");

  // ── done closes it, and the page underneath is intact; the ? brings it back ─
  await press(".wv-tour-next");
  await page.waitForSelector(".wv-tour", { state: "hidden", timeout: 10_000 });
  assert.equal((await readTour(page)).open, false, "done closes the tour");
  assert.ok(await page.evaluate(() => !!document.querySelector(".wv-minimap > svg") && !!document.querySelector(".wv-mapctl")), "the map and its controls are there after the tour");
  await press(".wv-tour-open");
  await page.waitForSelector(".wv-tour-card", { state: "visible", timeout: 10_000 });
  const again = await readTour(page);
  assert.equal(again.kicker, "The World · 1 / 5", "the ? reopens the tour at its first step");
  assert.ok(again.cardOnScreen && again.controlsInCard && again.controlsOnScreen);

  // ── skip closes it too, and the same page is there ─────────────────────────
  await press(".wv-tour-skip");
  await page.waitForSelector(".wv-tour", { state: "hidden", timeout: 10_000 });
  assert.ok(await page.evaluate(() => !!document.querySelector(".wv-minimap > svg")), "skip leaves the page as it was");
  assert.deepEqual(errors, [], "no page error across the tour");
  await ctx.close();
  return out;
}

test("the page, on a phone (390 x 844, touch): five steps (the two map-meaning cards among them), each control whole on the screen, drag and tap, done / ? / skip", async (t) => {
  await onThePage(t, { viewport: { width: 390, height: 844 }, phone: true });
});

test("the page, on a desktop (1440 x 900): the same five steps in the cursor's words", async (t) => {
  await onThePage(t, { viewport: { width: 1440, height: 900 }, phone: false });
});
