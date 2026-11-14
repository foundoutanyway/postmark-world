// viewer-reconverge-exports.test.mjs — what the World now exports so the 3D view stops copying it (WLD-105: A2, A19, A20),
// and that the 2D page still says exactly what it did.
//
//   1. Each CSS slice (PIP_CSS, PIP_BADGE_CSS, WV_BUBBLE_CSS, WV_NAMEPLATE_CSS, WV_SEARCH_PILL_CSS, WV_SEARCH_CSS) appears in
//      the STYLE `mountViewer` really emits exactly once. The STYLE's bytes as a whole are pinned by viewer-shell-css.test.mjs
//      (this PR does not re-pin it: the slices are cut from STYLE in place and interpolated back, so the digest holds).
//   2. markNameplateMarkup, searchResultsHTML and walkerRoster answer, on invented inputs, exactly what the code they
//      replaced answered inline (the old expressions are written out below as the control).
//   3. sizeSearchInput measures the way the closure did: it leaves a field in use alone, resets then measures the
//      placeholder, and writes the width only when the text overflows the floor.
//
// Invented data only. No resident or record is read.
import assert from "node:assert/strict";
import test from "node:test";

import { mountViewer, markNameplateMarkup, searchResultsHTML, sizeSearchInput, PIP_CSS, PIP_BADGE_CSS, WV_BUBBLE_CSS, WV_NAMEPLATE_CSS, WV_SEARCH_PILL_CSS, WV_SEARCH_CSS } from "../spectator/viewer.mjs";
import { walkerRoster } from "./where-is.mjs";
import { iconsHTML } from "../spectator/mark-icons.mjs";

function emittedStyle() {
  const STOP = new Error("style captured");
  let captured = null;
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: (tag) => ({ tag, textContent: "" }) };
  const host = { classList: { add() {} }, appendChild(el) { if (el.tag === "style") { captured = el.textContent; throw STOP; } } };
  try { mountViewer(host); } catch (e) { if (e !== STOP) throw e; } finally {
    if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document;
  }
  assert.equal(typeof captured, "string");
  return captured;
}
const STYLE = emittedStyle();
const count = (hay, needle) => hay.split(needle).length - 1;

test("slices: each export is in the emitted STYLE exactly once, and non-empty", () => {
  for (const [name, css] of Object.entries({ PIP_CSS, PIP_BADGE_CSS, WV_BUBBLE_CSS, WV_NAMEPLATE_CSS, WV_SEARCH_PILL_CSS, WV_SEARCH_CSS })) {
    assert.ok(css.length > 40, `${name} is not empty`);
    assert.equal(count(STYLE, css), 1, `${name} appears exactly once in what 2D emits`);
  }
  // the control: a slice that drifted from STYLE by one byte is not found
  assert.equal(count(STYLE, PIP_CSS.replace("opacity:.65", "opacity:.66")), 0, "control: a changed byte is not in STYLE");
});

test("slices: what each one carries (the rules 3D drew a copy of)", () => {
  assert.match(PIP_CSS, /\.ov-pip \{ fill:var\(--pm-gold\); opacity:\.65; \}/);
  assert.match(PIP_CSS, /\.ov-pip\.t-constitution \{ fill:var\(--blue\); \}/);
  assert.match(PIP_CSS, /\.ov-pip-door \{ fill:var\(--night\); opacity:\.8; \}/);
  assert.match(PIP_BADGE_CSS, /^\.ov-badge-bg \{/);
  assert.match(WV_BUBBLE_CSS, /^\.wv-bubble \{ position:absolute;/);
  assert.match(WV_BUBBLE_CSS, /\.wv-bubble\.t-market \{ --wv-mark-accent:var\(--pm-gold\); \}$/);
  assert.match(WV_NAMEPLATE_CSS, /\.wv-np-dot\.is-draft \{ background:var\(--draft\); \}$/);
  assert.match(WV_SEARCH_CSS, /^\.wv-search-input \{/);
  assert.match(WV_SEARCH_CSS, /\.wv-search-none \{[^}]*\}$/);
  assert.match(WV_SEARCH_PILL_CSS, /^\.wv-search \{/);
});

// ── A20: the nameplate's markup ─────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// the closure's own body before it was hoisted (viewer.mjs § markNameplateHTML at main dd3f9f3b), as the control
const inlineNameplate = (full, identity, icons, classes) => {
  const what = icons[0]?.kind === "what" ? icons[0] : null;
  const states = what ? icons.slice(1) : icons;
  return `<div class="wv-nameplate" data-nameplate="${esc(full.id)}">`
    + (what ? `<span class="wv-np-what">${iconsHTML([what])}</span>` : `<span class="wv-np-dot ${classes}" aria-hidden="true"></span>`)
    + `<span class="wv-np-name${identity.determined ? " is-determined" : ""}">${esc(identity.name || full.id)}</span>`
    + (states.length ? `<span class="wv-np-icons">${iconsHTML(states)}</span>` : "")
    + `</div>`;
};
const icon = (kind, key) => ({ kind, key, glyph: "x", label: key, words: key });

test("markNameplateMarkup: the same markup the closure built inline, for every shape of plate", () => {
  const m = { id: "invented/a-lamp" };
  const cases = [
    { identity: { name: "A Lamp", determined: false }, icons: [], classes: "t-market" },                                   // plain dot
    { identity: { name: "A Lamp", determined: true }, icons: [], classes: "t-home" },                                      // determined name
    { identity: { name: "", determined: false }, icons: [], classes: "t-constitution is-draft" },                           // falls back to the id
    { identity: { name: "A <Lamp> & \"co\"", determined: false }, icons: [], classes: "t-market" },                         // escaped
    { identity: { name: "A Lamp", determined: false }, icons: [icon("what", "thing")], classes: "t-market" },              // what, no states
    { identity: { name: "A Lamp", determined: false }, icons: [icon("what", "thing"), icon("state", "draft")], classes: "t-market" }, // what + state
    { identity: { name: "A Lamp", determined: false }, icons: [icon("state", "draft")], classes: "t-market" },              // states only: the dot stays
  ];
  for (const c of cases) {
    assert.equal(markNameplateMarkup(m, c), inlineNameplate(m, c.identity, c.icons, c.classes), JSON.stringify(c.identity) + JSON.stringify(c.icons.map((i) => i.kind)));
  }
  const withWhat = markNameplateMarkup(m, cases[5]);
  assert.ok(withWhat.includes('class="wv-np-what"') && withWhat.includes('class="wv-np-icons"') && !withWhat.includes("wv-np-dot"));
  assert.ok(markNameplateMarkup(m, cases[2]).includes(">invented/a-lamp<"), "an unnamed mark reads as its id");
});

// ── A19: the result rows ────────────────────────────────────────────────────
const inlineResults = (rows, note) => rows.length
  ? rows.map((r) => `<li><button type="button" class="wv-search-hit"`
      + ` data-kind="${esc(r.kind)}" data-hit="${esc(r.kind === "person" ? r.handle : r.id)}">`
      + `${esc(r.label)}<span class="sub">${esc(r.kind === "person" ? `resident · ${r.sub}` : r.sub)}</span>`
      + `</button></li>`).join("")
  : `<li class="wv-search-none">${esc(note)}</li>`;

test("searchResultsHTML: the rows 2D's renderSearchResults wrote, and the empty note", () => {
  const rows = [
    { kind: "mark", id: "invented/the-lamp", label: "The Lamp", sub: "a house" },
    { kind: "person", handle: "invented-h", label: "Hana <H>", sub: "the Lanterns" },
  ];
  assert.equal(searchResultsHTML(rows, "Nothing by that name."), inlineResults(rows, "Nothing by that name."));
  assert.equal(searchResultsHTML([], "Nothing by that name. & more"), inlineResults([], "Nothing by that name. & more"));
  const out = searchResultsHTML(rows, "n");
  assert.ok(out.includes('data-hit="invented-h"') && out.includes('data-hit="invented/the-lamp"') && out.includes("resident · the Lanterns"));
  assert.ok(out.includes("Hana &lt;H&gt;"), "labels are escaped");
});

test("sizeSearchInput: leaves a field in use alone; otherwise resets, measures the placeholder, and widens only on overflow", () => {
  const had = { gcs: globalThis.getComputedStyle, doc: Object.getOwnPropertyDescriptor(globalThis, "document") };
  try {
    const field = (over) => {
      const f = { placeholder: "find a house or resident", value: "", style: { width: "132px" }, scrollWidth: 200, clientWidth: 150,
        getBoundingClientRect: () => ({ width: 150 }), ...over };
      return f;
    };
    globalThis.document = { activeElement: null };
    globalThis.getComputedStyle = () => ({ borderLeftWidth: "1px", borderRightWidth: "1px" });
    assert.equal(sizeSearchInput(null), 0, "no field");
    assert.equal(sizeSearchInput(field({ placeholder: "" })), 0, "no placeholder");
    assert.equal(sizeSearchInput(field({ value: "ha" })), 0, "somebody has typed: not touched");
    const busy = field(); globalThis.document = { activeElement: busy };
    assert.equal(sizeSearchInput(busy), 0, "focused: not touched");
    assert.equal(busy.style.width, "132px", "and its width is left as it was");
    globalThis.document = { activeElement: null };
    const over = field();
    // 200 text px over a 150 box: width = ceil(200 + 2 border + 3 headroom), written inline
    assert.equal(sizeSearchInput(over), 205);
    assert.equal(over.style.width, "205px");
    assert.equal(over.value, "", "the borrowed value is put back");
    const fits = field({ scrollWidth: 140 });
    assert.equal(sizeSearchInput(fits), 150, "the CSS floor already holds it: its own width is answered");
    assert.equal(fits.style.width, "", "and the inline width stays cleared");
  } finally {
    if (had.gcs === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = had.gcs;
    if (had.doc) Object.defineProperty(globalThis, "document", had.doc); else delete globalThis.document;
  }
});

// ── A2: the roster ──────────────────────────────────────────────────────────
test("walkerRoster: walkers first, then parcel households, empties dropped; the same list spectator/server.mjs built inline", () => {
  const inline = (departures, worldState) => [
    ...departures.map((d) => d.handle),
    ...((worldState?.parcels ?? []).map((pc) => pc.household)),
  ].filter(Boolean);
  const deps = [{ handle: "a" }, { handle: "b" }, { handle: "a" }, { handle: "" }];
  const world = { parcels: [{ household: "c" }, { household: "a" }, { household: null }, {}] };
  assert.deepEqual(walkerRoster(deps, world), ["a", "b", "a", "c", "a"]);
  assert.deepEqual(walkerRoster(deps, world), inline(deps, world));
  assert.deepEqual(walkerRoster(deps, null), inline(deps, null), "a ledger-only answer");
  assert.deepEqual(walkerRoster(undefined, { parcels: [{ household: "z" }] }), ["z"]);
  assert.deepEqual(walkerRoster([], {}), []);
});
