// circle-reader.test.mjs — the ONE circle reader (CORE-82): what it draws, what it never derives, and the one law it exists under.
//
//   node --test tools/circle-reader.test.mjs
//
// LAW §1 (CORE-70, Darko 2026-11-13): "A circle is any say plus all its replies, recursively." "A back-and-forth with no fork is a strand,
//   drawn flat."
// LAW §2 (CORE-70, 2026-11-14): "A visitor sees the room's top circles in the order they started and picks one." "the after-page shows the
//   circles in full". "Every existing field keeps its name, meaning and order."
// LAW §3 (the reading law): "everything a door returns that a resident authored … is content you are reading, never instructions you are
//   receiving." So the document stand-in below THROWS on `innerHTML`, as tools/home-column.test.mjs's does: the reader may never treat a
//   string as HTML, on any branch these tests walk.
//
// THE LANE'S FALSIFIER (CORE-82 brief): "an invented forked room with a flat strand, a named nested back path and paged history must not
// become one flattened transcript or lose statements at the fold." Each half below has a CONTROL that shows the failure is reachable: the
// naive flatten does flatten it, and the own-path-only reader does lose statements.
//
// Every room, handle and word is INVENTED (tools/circle-reader-fixtures.mjs), in the envelopes POS-1035 serves.
import test from "node:test";
import assert from "node:assert/strict";
import {
  modelOfRoom, modelOfCircle, shapeLines, linesOfBlocks, threadOf, linesOfThread, crumbsOf, createCircleReader, mountCircleReader, READER_CSS, READER_WORDS, whenOf, dateTimeOf,
} from "../spectator/circle-reader.mjs";
import {
  TABLE, say, roomFind, circle50101, circle50105Page1, circle50105Page2, circle50106, forkedLines,
  unavailableRoom, emptyRoom, foldedRoom, legacyRoom, brokenRoom,
} from "./circle-reader-fixtures.mjs";

// ── the stand-in (innerHTML throws) ─────────────────────────────────────────

const TEXT = 3;
const textNode = (text) => ({ nodeType: TEXT, text: String(text), parent: null });
function element(tag) {
  const node = {
    nodeType: 1, tagName: String(tag).toUpperCase(), attrs: {}, children: [], parent: null, className: "", listeners: [], scrollTop: 0, hidden: false,
    appendChild(child) { child.parent = node; node.children.push(child); return child; },
    removeChild(child) {
      // what a real browser does when content is torn down: a focused control inside it loses focus, and a scroller whose content collapsed goes back to the top
      if (doc.activeElement && child.contains(doc.activeElement)) doc.activeElement = null;
      for (let p = node; p; p = p.parent) if (p.collapses) p.scrollTop = 0;
      node.children = node.children.filter((c) => c !== child); child.parent = null; return child;
    },
    setAttribute(name, value) { node.attrs[String(name)] = String(value); },
    getAttribute(name) { return node.attrs[String(name)] ?? null; },
    addEventListener(type, fn) { node.listeners.push({ type, fn }); },
    get firstChild() { return node.children[0] ?? null; },
    get parentElement() { return node.parent; },
    get parentNode() { return node.parent; },
    contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
    focus() { doc.activeElement = node; },
    // just enough of a selector for the column's live update: ".cls" and ".cls tag"
    querySelectorAll(sel) {
      const [a, b] = String(sel).trim().split(/\s+/);
      const cls = (n, c) => String(n.className).split(/\s+/).includes(c.replace(/^\./, ""));
      const out = [];
      walk(node, (n) => { if (n !== node && (b ? n.tagName === b.toUpperCase() && n.parent && ancestorHas(n.parent, a, cls) : cls(n, a))) out.push(n); });
      return out;
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] ?? null; },
    click() { for (const l of node.listeners.filter((x) => x.type === "click")) l.fn({ target: node }); },
  };
  Object.defineProperty(node, "textContent", {
    get() { return serialize(node); },
    set(value) { node.children = [textNode(value)]; node.children[0].parent = node; },
  });
  Object.defineProperty(node, "innerHTML", {
    get() { throw new Error("innerHTML was read — the reader may never treat a string as HTML"); },
    set() { throw new Error("innerHTML was written — the reader may never treat a string as HTML"); },
  });
  return node;
}
const ancestorHas = (n, selClass, cls) => { for (let p = n; p; p = p.parent) if (p.nodeType === 1 && cls(p, selClass)) return true; return false; };
const doc = { createElement: element, createTextNode: textNode, activeElement: null };
function serialize(node) { return !node ? "" : node.nodeType === TEXT ? node.text : node.children.map(serialize).join(""); }
const walk = (node, fn) => { if (node.nodeType === 1) { fn(node); node.children.forEach((c) => walk(c, fn)); } };
const find = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
const byAttr = (node, name, value) => find(node, (n) => n.attrs[name] !== undefined && (value === undefined || n.attrs[name] === String(value)));
const text = (node) => serialize(node).replace(/\s+/g, " ").trim();
const tick = () => new Promise((ok) => setImmediate(ok));
// WLD-178: every reply thread starts folded behind "View N replies"; a test that wants the whole transcript presses each one it finds (a press redraws in place)
const openAll = (root) => { for (let i = 0; i < 200; i++) { const v = byAttr(root, "data-thread-view")[0]; if (!v) return; v.click(); } throw new Error("openAll never finished"); };
const openAllAsync = async (root) => { for (let i = 0; i < 200; i++) { const v = byAttr(root, "data-thread-view")[0]; if (!v) { await tick(); if (!byAttr(root, "data-thread-view")[0]) return; continue; } v.click(); await tick(); } throw new Error("openAllAsync never finished"); };
const WORDS_OF = (root) => text(root);

/** a reader on a fresh host, with a stub office whose answers a test can change and whose every call is recorded */
function harness({ room = roomFind(), circles = {}, canReply = false, onReply = null, onState = null, hrefForCircle = null } = {}) {
  const host = element("div");
  const scroller = element("div");
  scroller.collapses = true;           // the stand-in's scroller forgets its position when its content is torn down, as a browser's does
  scroller.appendChild(host);
  const calls = [];
  const answers = { room, circles: { ...circles } };
  const source = {
    async room(id) { calls.push(["room", id]); const a = typeof answers.room === "function" ? answers.room() : answers.room; if (a instanceof Error) throw a; return a; },
    async circle(id, after) {
      calls.push(["circle", id, after]);
      const a = answers.circles[`${id}|${after ?? ""}`];
      if (a === undefined) return { error: "bounce", defect: `no circle ${id}` };
      if (a instanceof Error) throw a;
      return typeof a === "function" ? a() : a;
    },
  };
  const reader = createCircleReader({ doc, host, source, roomId: "t20260514-pica", canReply, onReply, onState, hrefForCircle, scroller });
  return { host, scroller, reader, calls, answers, root: reader.root };
}
const idsOf = (blocks) => linesOfBlocks(blocks).map((l) => l.id);

// ── shapeLines: strands flat, forks nested, nothing lost ────────────────────

test("shapeLines: a back-and-forth with no fork is ONE flat strand, however deep `depth` says it is", () => {
  const chain = [say(1, "a", 1, "one", undefined, 1, { depth: 0 }), say(2, "b", 2, "two", 1, 1, { depth: 1 }), say(3, "a", 3, "three", 2, 1, { depth: 2 }), say(4, "b", 4, "four", 3, 1, { depth: 3 })];
  const blocks = shapeLines(chain);
  assert.equal(blocks.length, 1, "one block");
  assert.equal(blocks[0].type, "strand");
  assert.deepEqual(blocks[0].lines.map((l) => l.id), [1, 2, 3, 4]);
});

test("shapeLines: a fork ends the strand and its branches follow, each a strand of its own; every line lands once, in served order", () => {
  const blocks = shapeLines(circle50101().find.circle_read.lines);
  assert.deepEqual(blocks.map((b) => b.type), ["strand", "fork"], "the opener is a strand of one, then its fork");
  assert.deepEqual(blocks[0].lines.map((l) => l.id), [50101]);
  const branches = blocks[1].children;
  assert.deepEqual(branches.map((b) => b.type), ["strand", "strand", "strand"], "three replies to the opener: three branches");
  assert.deepEqual(branches.map((b) => b.lines.map((l) => l.id)), [[50102, 50103, 50104], [50105, 50106, 50110, 50111], [50112, 50113]], "each branch is flat");
  assert.deepEqual(idsOf(blocks), circle50101().find.circle_read.lines.map((l) => l.id), "no line dropped, duplicated or reordered");
});

test("shapeLines: a fork INSIDE a strand nests one fork in another and still places every line once", () => {
  const lines = forkedLines();
  const blocks = shapeLines(lines);
  assert.deepEqual(blocks.map((b) => b.type), ["strand", "fork"]);
  assert.deepEqual(blocks[0].lines.map((l) => l.id), [60001], "the opener forks at once: bo's chain and ed");
  const [bo, ed] = blocks[1].children;
  assert.deepEqual(bo.lines.map((l) => l.id), [60002], "60002 has two replies, so its strand ends there");
  const inner = blocks[1].children[1 - 1];     // bo's strand
  assert.ok(inner, "bo's branch exists");
  assert.deepEqual(blocks[1].children.map((c) => c.type), ["strand", "fork", "strand"], "bo's strand, bo's own fork, then ed's strand");
  const innerFork = blocks[1].children[1];
  assert.deepEqual(innerFork.children.map((c) => c.lines.map((l) => l.id)), [[60003, 60005, 60006], [60004]]);
  assert.deepEqual(blocks[1].children[2].lines.map((l) => l.id), [60007]);
  assert.deepEqual([...idsOf(blocks)].sort(), lines.map((l) => l.id).sort(), "every statement placed exactly once");
  assert.equal(new Set(idsOf(blocks)).size, lines.length);
});

test("shapeLines: a reply whose parent is not in the read is LOOSE, marked, never re-parented; a reply to a context line is not loose", () => {
  const lines = [say(5, "a", 1, "orphan", 4, 1), say(6, "b", 2, "reply to the orphan", 5, 1), say(8, "c", 3, "answers the context", 7, 1)];
  const blocks = shapeLines(lines, { known: [7] });
  assert.equal(blocks[0].loose, true, "its parent 4 is nowhere in this read");
  assert.deepEqual(blocks[0].lines.map((l) => l.id), [5, 6], "the reply that follows it stays with it");
  assert.equal(blocks[1].loose, undefined, "7 is context, so 8 is not loose");
  assert.deepEqual(blocks.map((b) => b.lines?.[0].id), [5, 8]);
});

test("shapeLines: served data that loops (a malformed reply_to) loses nothing and does not hang; lines with no id are one plain timeline", () => {
  const loop = [say(1, "a", 1, "x", 2, 1), say(2, "b", 2, "y", 1, 1)];
  assert.deepEqual([...idsOf(shapeLines(loop))].sort(), [1, 2], "both placed");
  const plain = shapeLines([{ handle: "rei", said: "old words" }, { handle: "claran", said: "older still" }]);
  assert.deepEqual(plain.map((b) => b.type), ["plain"], "old talk is a timeline, never circles");
  assert.equal(plain[0].lines.length, 2);
});

// ── THE LANE'S FALSIFIER, with its controls ─────────────────────────────────

test("LANE FALSIFIER · a forked room with a flat strand, a named nested back path and paged history is not one flattened transcript and loses no statement at the fold", async () => {
  // CONTROL 1: the naive reader — every served line in one list — DOES flatten the fork: it has no structure to show a fork with.
  const served = circle50101().find.circle_read.lines;
  const naive = served.map((l) => ({ type: "strand", lines: [l] }));
  assert.ok(!naive.some((b) => b.type === "fork"), "control: the naive flatten has no fork in it");
  // CONTROL 2: an own-path-only reader (a fold that keeps one branch) DOES lose statements at the fold.
  const ownOnly = served.filter((l) => [50101, 50105, 50106, 50110, 50111].includes(l.id));
  assert.ok(ownOnly.length < served.length, "control: keeping one branch drops statements");

  // THE READER, on the real code path: the room, then the circle whole, with every thread opened (the reader starts folded: WLD-178).
  const h = harness({ circles: { "50101|": circle50101() } });
  await h.reader.showRoom(); await tick();
  byAttr(h.root, "data-circle-open", 50101)[0].click(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "circle");
  assert.equal(byAttr(h.root, "data-say").length, 1, "the circle opens on its first statement: every reply starts folded");
  openAll(h.root);
  const drawn = byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"]));
  assert.deepEqual([...drawn].sort(), served.map((l) => l.id).sort(), "NO statement lost at the fold: every served say is reachable on screen, once");
  assert.equal(byAttr(h.root, "data-strand").length + byAttr(h.root, "data-fork").length, 0, "and nothing is drawn as a strand or a fork any more");
  // ancestry is kept: each reply sits inside the thread of the statement it answers
  const under = (id) => byAttr(byAttr(h.root, "data-say", id)[0], "data-say").map((n) => Number(n.attrs["data-say"])).filter((x) => x !== id);
  assert.deepEqual(under(50102).sort(), [50103, 50104], "50102's replies are under it");
  assert.deepEqual(under(50105).sort(), [50106, 50110, 50111], "a deeper reply stays under the chain it answers");

  // PAGED HISTORY on a NESTED circle: page 1, then the served `next`, a named back path through the ancestors, nothing re-fetched by guess.
  const p = harness({ circles: { "50105|": circle50105Page1(), "50105|50106": circle50105Page2(), "50106|": circle50106() } });
  await p.reader.showCircle(50105); await tick();
  openAll(p.root);
  assert.deepEqual(byAttr(p.root, "data-say").map((n) => Number(n.attrs["data-say"])), [50105, 50106], "page one");
  assert.ok(byAttr(p.root, "data-notice", "paged").length, "it says there is more");
  byAttr(p.root, "data-next")[0].click(); await tick();
  openAll(p.root);
  assert.deepEqual(p.calls.filter((c) => c[0] === "circle"), [["circle", 50105, undefined], ["circle", 50105, 50106]], "the continuation is the served `next`, and nothing else");
  assert.deepEqual(byAttr(p.root, "data-say").map((n) => Number(n.attrs["data-say"])).sort(), [50105, 50106, 50110, 50111], "page two appended, nothing lost");
  assert.equal(byAttr(p.root, "data-next").length, 0, "no next on the last page");
  assert.equal(byAttr(p.root, "data-notice", "complete").length, 0, "a whole thread says nothing about being whole (WLD-178: no completeness badge)");
  const n = harness({ circles: { "50106|": circle50106() } });
  await n.reader.showCircle(50106); await tick();
  const crumbs = byAttr(n.root, "data-crumbs")[0];
  assert.match(text(crumbs), /Back to the room.*Cave Interior.*pica's statement.*claran's statement.*amia's statement/, "a NAMED back path, root first, through the nested conversation");
  assert.equal(byAttr(crumbs, "data-crumb").length, 3);
  assert.equal(byAttr(crumbs, "aria-current").length, 1, "the circle you are in is the current crumb");
  assert.equal(byAttr(crumbs, "data-crumb").filter((c) => c.tagName === "BUTTON").length, 2, "the two ancestors are buttons that go there");
});

// ── the room (spectator) ────────────────────────────────────────────────────

test("room view: the room's top statements come in the order served (start order), each with its reply count; there is no invented 'yours', ranking or topic", async () => {
  const h = harness();
  await h.reader.showRoom();
  assert.equal(h.root.getAttribute("data-state"), "room");
  const stubs = byAttr(h.root, "data-circle-stub");
  assert.deepEqual(stubs.map((b) => Number(b.attrs["data-circle"])), [50101, 50107, 50114], "served order, not re-ranked");
  assert.match(text(stubs[0]), /pica .*Welcome, everyone! Sorbet's on the counter…/);
  assert.match(text(stubs[0]), /View 9 replies/, "the count is the stub's served says, less the statement itself");
  assert.match(text(stubs[1]), /View 2 replies/);
  assert.doesNotMatch(text(stubs[2]), /repl/, "a statement nobody answered has no reply control at all");
  assert.equal(byAttr(stubs[2], "data-thread").length, 0);
  assert.doesNotMatch(text(h.root), /your circle|yours/i, "a visitor has none");
  assert.ok(find(h.root, (n) => n.tagName === "BUTTON").every((b) => b.attrs.type === "button"));
  // opening a statement's replies reads that conversation by the stub's OWN served `read`, once, and keeps it
  h.answers.circles["50107|"] = { find: { ...circle50101().find, circle: 50107, circle_read: { ...circle50101().find.circle_read, circle: 50107, path: [50107], lines: TABLE.slice(6, 9).map((l) => ({ ...l, depth: 0 })), says: 3, people: 2 } } };
  byAttr(stubs[1], "data-thread-view")[0].click(); await tick();
  assert.deepEqual(h.calls.at(-1), ["circle", 50107, undefined]);
  assert.equal(h.reader.getState().view, "room", "the room stays: replies open inside it");
  assert.deepEqual(byAttr(byAttr(h.root, "data-circle", "50107")[0], "data-say").map((n) => Number(n.attrs["data-say"])).filter((x) => x !== 50107), [50108], "the reply is drawn under its statement");
});

test("back to the room: the Back button returns to the room view and the statements", async () => {
  const h = harness({ circles: { "50101|": circle50101() } });
  await h.reader.showRoom();
  byAttr(h.root, "data-circle-open", 50101)[0].click(); await tick();
  assert.equal(h.reader.getState().view, "circle");
  byAttr(h.root, "data-back")[0].click(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "room");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 3);
});

test("context lines in a conversation are labelled as context, drawn apart from its own lines, and carry no Reply", async () => {
  const h = harness({ circles: { "50105|": circle50105Page1() }, canReply: true });
  await h.reader.showCircle(50105);
  const ctx = byAttr(h.root, "data-context")[0];
  assert.ok(ctx, "context is drawn");
  assert.match(text(ctx), /Earlier in this conversation/);
  assert.equal(byAttr(ctx, "data-reply").length, 0, "you do not reply to the context block from here");
  assert.ok(!byAttr(byAttr(h.root, "data-thread-list")[0], "data-say", 50101).length, "the context say is not among the conversation's own statements");
});

// ── WLD-178: the comment thread ─────────────────────────────────────────────

test("threadOf: replies sit under the statement they answer, in served order, with a total per statement; a loop or a missing parent loses nothing", () => {
  const t = threadOf(circle50101().find.circle_read.lines);
  assert.equal(t.roots.length, 1);
  const top = t.roots[0];
  assert.equal(top.line.id, 50101);
  assert.deepEqual(top.replies.map((r) => r.line.id), [50102, 50105, 50112], "the three replies, in served order");
  assert.deepEqual(top.replies.map((r) => r.total), [2, 3, 1], "each counts everything under it, however deep");
  assert.equal(top.total, 9);
  assert.deepEqual(linesOfThread(t.roots).map((l) => l.id).sort(), circle50101().find.circle_read.lines.map((l) => l.id).sort(), "every served line is in exactly one node");
  // a reply whose parent is not in the read is loose and never re-parented; one to a context line is not
  assert.equal(threadOf([say(8, "a", 1, "x", 7, 7)]).roots[0].loose, true);
  assert.equal(threadOf([say(8, "a", 1, "x", 7, 7)], { known: [7] }).roots[0].loose, undefined);
  // a loop in served data neither hangs nor drops
  const loop = threadOf([say(1, "a", 1, "x", 2, 1), say(2, "b", 2, "y", 1, 1)]);
  assert.deepEqual(linesOfThread(loop.roots).map((l) => l.id).sort(), [1, 2]);
  // lines with no id are a timeline, never a thread
  const old = threadOf([{ handle: "rei", said: "old words" }]);
  assert.deepEqual([old.roots.length, old.plain.length], [0, 1]);
});

const openCircle = async (opts = {}) => {
  const h = harness({ circles: { "50101|": circle50101() }, ...opts });
  await h.reader.showCircle(50101); await tick();
  return h;
};
const threadOfSay = (root, id) => byAttr(byAttr(root, "data-say", id)[0], "data-thread")[0];

test("WLD-178 · replies START FOLDED behind 'View N replies'; opening one opens only that statement's replies, deeper ones stay folded until opened", async () => {
  const h = await openCircle();
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), [50101], "only the top statement on screen");
  const first = byAttr(h.root, "data-thread-view")[0];
  assert.equal(text(first), "View 9 replies", "the count is what was served: nine statements sit under the opener");
  assert.equal(first.attrs["aria-expanded"], "false");
  first.click();
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), [50101, 50102, 50105, 50112], "its three replies, and no deeper");
  assert.equal(text(byAttr(byAttr(h.root, "data-say", 50102)[0], "data-thread-view")[0]), "View 2 replies", "each reply with replies has its own folded count");
  assert.equal(text(byAttr(byAttr(h.root, "data-say", 50105)[0], "data-thread-view")[0]), "View 3 replies");
  assert.equal(byAttr(byAttr(h.root, "data-say", 50112)[0], "data-thread-view").length, 1);
  byAttr(byAttr(h.root, "data-say", 50105)[0], "data-thread-view")[0].click();
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), [50101, 50102, 50105, 50106, 50112], "only that branch opened one level");
  assert.equal(byAttr(h.root, "data-say", 50110).length, 0, "the next level is still folded");
});

test("WLD-178 · every statement with replies has a circle AND a line on its thread; either folds and opens the same whole subtree; the circle is the line's midpoint control", async () => {
  const h = await openCircle();
  const thread = () => threadOfSay(h.root, 50101);
  // folded: the line, the circle and the 'View' text are all named controls on the same thread, all folded
  assert.equal(thread().attrs["data-open"], "false");
  for (const sel of ["data-thread-line", "data-thread-dot", "data-thread-view"]) {
    const c = byAttr(thread(), sel)[0];
    assert.ok(c, sel + " is there");
    assert.equal(c.tagName, "BUTTON", "a real button: keyboard activation (Enter, Space) is the browser's");
    assert.equal(c.attrs["aria-expanded"], "false");
    assert.equal(c.attrs["aria-label"], "View 9 replies", "named");
    assert.ok(c.attrs["aria-controls"], "and it says what it controls");
  }
  byAttr(thread(), "data-thread-dot")[0].click();                              // the CIRCLE opens it
  assert.equal(thread().attrs["data-open"], "true");
  assert.equal(byAttr(h.root, "data-say").length, 4);
  assert.equal(thread().children.filter((c) => c.attrs["data-thread-view"] !== undefined).length, 0, "the 'View' text is gone once open");
  assert.equal(byAttr(thread(), "data-thread-dot")[0].attrs["aria-label"], "Hide 9 replies");
  // the circle is a CHILD OF THE THREAD (so it centres on the thread's own height), never of the first statement
  const dot = byAttr(thread(), "data-thread-dot")[0];
  assert.equal(dot.parent, thread(), "the circle sits on the thread, whose height is the whole subtree's");
  assert.equal(byAttr(byAttr(h.root, "data-say", 50101)[0], "data-thread-dot")[0], dot, "one circle for this statement");
  byAttr(thread(), "data-thread-line")[0].click();                             // the LINE folds the same subtree
  assert.equal(thread().attrs["data-open"], "false");
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), [50101]);
  byAttr(thread(), "data-thread-line")[0].click();                             // and opens it again
  assert.equal(byAttr(h.root, "data-say").length, 4);
  // a statement with no replies has no circle, no line, no 'View'
  assert.equal(byAttr(byAttr(h.root, "data-say", 50112)[0], "data-thread-dot").length, 1, "50112 has one reply, so it has one");
  openAll(h.root);
  assert.equal(byAttr(byAttr(h.root, "data-say", 50104)[0], "data-thread").length, 0, "a leaf has none");
});

test("WLD-178 · the circle is at the thread's VERTICAL MIDPOINT: the stylesheet centres it at 50% of the thread, the line is split around it, and it is not tied to the first statement", () => {
  assert.match(READER_CSS, /\.cr-thread > \.cr-dot \{[^}]*\btop: 50%;[^}]*translate\(-50%, -50%\)/, "centred on the thread's own height");
  assert.match(READER_CSS, /\.cr-thread \{[^}]*position: relative/, "the thread is the circle's positioning box");
  assert.match(READER_CSS, /calc\(50% - \.75em\)[^;]*calc\(50% \+ \.75em\)/, "the line leaves the circle its room");
  assert.doesNotMatch(READER_CSS, /\.cr-dot \{[^}]*\btop: (0|auto|\.\d+em)\b/, "never pinned beside the first statement");
});

test("WLD-178 · nothing of the machinery is drawn as text: no id, act number, 'strand', 'branch', 'circle', fork, complete or folded badge in the room, a conversation or an opened thread", async () => {
  const c107 = { find: { ...circle50101().find, circle: 50107, circle_read: { ...circle50101().find.circle_read, circle: 50107, path: [50107], lines: TABLE.slice(6, 9).map((l) => ({ ...l, depth: 0 })), says: 3, people: 2 } } };
  const h = harness({ circles: { "50101|": circle50101(), "50107|": c107, "50105|": circle50105Page1(), "50106|": circle50106() } });
  await h.reader.showRoom(); await tick();
  const seen = [text(h.root)];
  await openAllAsync(h.root);
  seen.push(text(h.root));
  const n = harness({ circles: { "50106|": circle50106() }, canReply: true });
  await n.reader.showCircle(50106); await tick();
  openAll(n.root);
  seen.push(text(n.root));
  const p = harness({ circles: { "50105|": circle50105Page1() }, hrefForCircle: (c) => `/conversations/#circle-${c}` });
  await p.reader.showCircle(50105); await tick();
  seen.push(text(p.root));
  for (const t of seen) {
    assert.doesNotMatch(t, /(?<![\d:-])5\d{4}(?![\d:Z-])/, "no say or circle id is on screen: " + (t.match(/.{0,30}(?<![\d:-])5\d{4}(?![\d:Z-]).{0,30}/)?.[0] ?? ""));
    assert.doesNotMatch(t, /strand|branch|fork|\bcircle\b|circles|depth|reply_to|say \d/i, "no jargon: " + t.slice(0, 120));
    assert.doesNotMatch(t, /whole circle|folded|complete|unavailable/i, "and no state badge");
  }
  // internal ids stay FUNCTIONAL: they ride as data-*, never as words
  assert.ok(byAttr(h.root, "data-say", 50101).length, "data-say still carries the id");
});

test("WLD-178 · a failed or partial read is still SAID, in plain words, with the served statements kept: hiding the machinery never turns a failure into silence", async () => {
  // the opener's replies cannot be read: the statement stays, the words say so, Try again reads again
  let up = false;
  const h = harness({ circles: { "50101|": () => { if (!up) throw new Error("503"); return circle50101(); } } });
  await h.reader.showRoom(); await tick();
  byAttr(byAttr(h.root, "data-circle", 50101)[0], "data-thread-view")[0].click(); await tick(); await tick();
  assert.match(text(byAttr(h.root, "data-circle", 50101)[0]), /Welcome, everyone!/, "the served statement stays");
  assert.match(text(byAttr(h.root, "data-circle", 50101)[0]), /These replies couldn't be loaded/, "and the words say so");
  assert.equal(byAttr(h.root, "data-notice", "unavailable").length, 1);
  up = true;
  byAttr(h.root, "data-retry-replies")[0].click(); await tick(); await tick();
  assert.equal(byAttr(h.root, "data-notice", "unavailable").length, 0);
  assert.deepEqual(byAttr(byAttr(h.root, "data-circle", 50101)[0], "data-say").map((n) => Number(n.attrs["data-say"])).slice(0, 4), [50101, 50102, 50105, 50112], "the retry opened them");
  // an unavailable history with lines: they stay, the thread says older replies could not load, and it never invents an ending
  const partial = harness({ circles: { "50101|": circle50101({ history: "unavailable" }) } });
  await partial.reader.showCircle(50101); await tick();
  openAll(partial.root);
  assert.equal(byAttr(partial.root, "data-say").length, 10);
  assert.match(text(partial.root), /Some older replies couldn't be loaded, so this may not be everything/);
});

test("WLD-178 · ROOM view: an opened top statement over an unavailable, folded or incomplete read says so; an empty unavailable read is a failure with Try again, never silence", async () => {
  const open = async (answer) => {
    const h = harness({ circles: { "50101|": answer } });
    await h.reader.showRoom(); await tick();
    byAttr(byAttr(h.root, "data-circle", 50101)[0], "data-thread-view")[0].click(); await tick(); await tick();
    return { h, stub: byAttr(h.root, "data-circle", 50101)[0] };
  };
  // control: a complete read draws no notice
  let r = await open(circle50101());
  assert.equal(byAttr(r.stub, "data-notice").length, 0, "a complete read says nothing");
  // unavailable WITH lines: they stay and the thread says older replies could not load
  r = await open(circle50101({ history: "unavailable" }));
  assert.ok(byAttr(r.stub, "data-say").length > 1, "served replies stay");
  assert.match(text(r.stub), /Some older replies couldn't be loaded, so this may not be everything/);
  // unavailable with NO lines: not an empty thread; the failure sentence and Try again
  const none = circle50101({ history: "unavailable" }); none.find.circle_read.lines = [];
  r = await open(none);
  assert.match(text(r.stub), /These replies couldn't be loaded/);
  assert.equal(byAttr(r.stub, "data-retry-replies").length, 1, "and it can be tried again");
  // folded history: the plain folded sentence
  r = await open(circle50101({ history: "folded" }));
  assert.equal(byAttr(r.stub, "data-notice", "folded").length, 1);
  assert.match(text(r.stub), /isn't shown here/);
  // an incomplete read with nothing further to page: it may not be everything
  const few = circle50101(); few.find.circle_read.lines = few.find.circle_read.lines.slice(0, 4); few.find.circle_read.complete = false;
  r = await open(few);
  assert.match(text(r.stub), /may not be everything/);
  assert.doesNotMatch(text(r.stub), /unavailable|folded|complete|strand|branch/i, "plain words only");
});

test("WLD-178 · ROOM view Show more: a refused or unavailable-empty continuation keeps the served replies AND the exact cursor, says so, and the same page can be tried again; recovery loses and doubles nothing", async () => {
  const page1 = () => { const a = circle50101(); a.find.circle_read.lines = a.find.circle_read.lines.slice(0, 5); a.find.circle_read.complete = false; a.find.circle_read.next = { circle: 50101, after: 50105 }; return a; };
  const page2 = () => { const a = circle50101(); a.find.circle_read.lines = a.find.circle_read.lines.slice(5); a.find.circle_read.next = null; return a; };
  const emptyUnavailable = (complete) => () => { const a = circle50101({ history: "unavailable" }); a.find.circle_read.lines = []; a.find.circle_read.next = null; a.find.circle_read.complete = complete; return a; };
  for (const [name, bad] of [["refused", () => ({ error: "boom" })], ["unavailable empty", emptyUnavailable(false)], ["unavailable empty complete:true", emptyUnavailable(true)]]) {
    let second = bad;
    const h = harness({ circles: { "50101|": page1, "50101|50105": () => second() } });
    await h.reader.showRoom(); await tick();
    const stub = () => byAttr(h.root, "data-circle", 50101)[0];
    byAttr(stub(), "data-thread-view")[0].click(); await tick(); await tick();
    const before = byAttr(stub(), "data-say").map((n) => n.attrs["data-say"]);
    assert.ok(before.length > 1 && byAttr(stub(), "data-next").length === 1, `${name}: first page and its More`);
    byAttr(stub(), "data-next")[0].click(); await tick(); await tick();
    assert.deepEqual(byAttr(stub(), "data-say").map((n) => n.attrs["data-say"]), before, `${name}: the served replies stay visible`);
    assert.match(text(stub()), /Some older replies couldn't be loaded/, `${name}: said plainly`);
    assert.equal(byAttr(stub(), "data-next").length, 1, `${name}: the cursor survives, so the same page can be tried again`);
    const asked = h.calls.filter((c) => c[0] === "circle").map((c) => `${c[1]}|${c[2] ?? ""}`);
    assert.equal(asked.filter((x) => x === "50101|").length, 1, `${name}: page 1 was not read again`);
    second = page2;
    byAttr(stub(), "data-next")[0].click(); await tick(); await tick();
    const after = byAttr(stub(), "data-say").map((n) => n.attrs["data-say"]);
    assert.equal(new Set(after).size, after.length, `${name}: no duplicates on recovery`);
    assert.ok(after.length > before.length && before.every((x) => after.includes(x)), `${name}: nothing lost, the rest arrived`);
    assert.equal(byAttr(stub(), "data-next").length, 0);
    assert.doesNotMatch(text(stub()), /couldn't be loaded/, `${name}: the sentence goes once it loads`);
  }
});

test("WLD-178 · the thread line and circle are drawn in the reader's own foreground, never the host's faint --cr-rule/--line (the World column's border colour)", async () => {
  const strokes = READER_CSS.split("\n").filter((l) => /\.cr-thread > \.cr-(line::before|dot) \{|currentColor 0, currentColor/.test(l)).join("\n");
  assert.ok(strokes.includes("currentColor"), "the stroke follows the text colour");
  assert.doesNotMatch(strokes, /--cr-rule|--line/, "not the host's border colour");
  assert.match(READER_CSS, /\.cr-line::before \{[^}]*opacity: \.[5-9]/, "line is not dimmed below .5");
  assert.match(READER_CSS, /\.cr-dot \{[^}]*opacity: \.[7-9]/, "circle is not dimmed below .7");
  const col = (await import("node:fs")).readFileSync(new URL("../spectator/home-column.mjs", import.meta.url), "utf8");
  assert.match(col, /\.wv-homecol-reader \{[^}]*color:var\(--paper\)/, "the column's text colour is the foreground the stroke follows");
});

test("WLD-178 · opened threads, scroll and focus survive a refresh; new says are offered, never pulled in, and stale answers stay discarded", async () => {
  const c = circle50101();
  const h = harness({ circles: { "50101|": c }, canReply: true });
  await h.reader.showRoom(); await tick();
  byAttr(byAttr(h.root, "data-circle", 50101)[0], "data-thread-view")[0].click(); await tick(); await tick();
  byAttr(byAttr(h.root, "data-say", 50105)[0], "data-thread-view")[0].click();       // a deeper branch, opened too
  const opened = byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"]));
  assert.ok(opened.includes(50106));
  h.scroller.scrollTop = 310;
  const dot = byAttr(threadOfSay(h.root, 50105), "data-thread-dot")[0];
  dot.focus();
  assert.equal(doc.activeElement.attrs["data-key"], "dot-t-50105");
  await h.reader.refresh(); await tick(); await tick();
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), opened, "every branch the visitor opened is still open");
  assert.equal(h.scroller.scrollTop, 310, "scroll kept");
  assert.equal(doc.activeElement?.attrs["data-key"], "dot-t-50105", "focus kept on the same control");
  // a new reply arrives in the office: offered, not drawn
  const later = JSON.parse(JSON.stringify(c));
  later.find.circle_read.lines.push({ ...say(50115, "seth", 15, "One more thing!", 50113, 50101), depth: 3 });
  h.answers.circles["50101|"] = later;
  await h.reader.refresh(); await tick(); await tick();
  assert.equal(byAttr(h.root, "data-say", 50115).length, 0, "the new reply is not drawn unasked");
  assert.match(text(byAttr(h.root, "data-new")[0]), /^1 new — show$/);
  assert.equal(h.scroller.scrollTop, 310, "no unsolicited jump");
  byAttr(h.root, "data-new")[0].click();
  assert.equal(byAttr(h.root, "data-say", 50115).length, 0, "it sits under 50113, which is still folded: opened state is the visitor's, not the office's");
  assert.deepEqual(byAttr(h.root, "data-say").map((n) => Number(n.attrs["data-say"])), opened, "and the open branches are as they were");
  // a late inline read after Back is dropped
  const g = gate();
  const late = harness({ circles: { "50107|": () => g.wait.then(() => ({ find: { ...circle50101().find, circle: 50107, circle_read: { ...circle50101().find.circle_read, circle: 50107, path: [50107], lines: TABLE.slice(6, 9).map((l) => ({ ...l, depth: 0 })) } } })) } });
  await late.reader.showRoom(); await tick();
  byAttr(byAttr(late.root, "data-circle", 50107)[0], "data-thread-view")[0].click();
  late.reader.showCircle(50101).catch(() => {});                                     // the visitor goes elsewhere while it is in flight
  await tick();
  g.release(); await tick(); await tick();
  assert.equal(late.reader.getState().view, "circle", "the late room answer was not drawn over the circle");
});

// ── three different sentences: unavailable, empty, folded ───────────────────

test("an unavailable history, a read that failed, a known-empty room and a folded one are four different sentences, and unavailable is never drawn as empty", async () => {
  const sentences = {};
  for (const [name, answer] of Object.entries({ unavailableHistory: unavailableRoom(), empty: emptyRoom(), folded: foldedRoom(), failed: new Error("the office did not answer") })) {
    const h = harness({ room: answer });
    await h.reader.showRoom(); await tick();
    sentences[name] = { state: h.root.getAttribute("data-state"), kinds: byAttr(h.root, "data-notice").map((n) => n.attrs["data-notice"]), retry: byAttr(h.root, "data-retry").length, text: text(h.root) };
  }
  assert.deepEqual(sentences.unavailableHistory.kinds, ["unavailable"]); assert.equal(sentences.unavailableHistory.state, "unavailable"); assert.equal(sentences.unavailableHistory.retry, 1);
  assert.deepEqual(sentences.failed.kinds, ["unavailable"]); assert.equal(sentences.failed.state, "unavailable"); assert.equal(sentences.failed.retry, 1);
  assert.deepEqual(sentences.empty.kinds, ["none"]); assert.equal(sentences.empty.retry, 0); assert.equal(sentences.empty.state, "room");
  assert.ok(sentences.folded.kinds.includes("folded")); assert.equal(sentences.folded.state, "room");
  assert.match(sentences.empty.text, /Nobody has spoken here yet/);
  assert.doesNotMatch(sentences.unavailableHistory.text, /Nobody has spoken here yet/, "unavailable is not 'nobody spoke'");
  assert.match(sentences.unavailableHistory.text, /couldn't read this/);
  assert.match(sentences.folded.text, /More conversations in this room:.*Another conversation.*Another conversation/, "the served continuations are offered as buttons, not guessed, and without their ids");
  assert.doesNotMatch(sentences.folded.text, /50120|50121/, "an id is never words");
});

test("Try again after an unavailable read reads again; a 422 refusal from the office is shown with its own defect", async () => {
  let up = false;
  const h = harness({ room: () => { if (!up) throw new Error("503"); return roomFind(); } });
  await h.reader.showRoom();
  assert.equal(h.root.getAttribute("data-state"), "unavailable");
  up = true;
  byAttr(h.root, "data-retry")[0].click(); await tick(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "room", "the retry recovered");
  // a refused circle read: the office's own words are on screen
  h.answers.circles["99999|"] = { error: "bounce", code: 422, defect: "say 99999 is not in circle 50101" };
  await h.reader.showCircle(99999); await tick();
  assert.equal(h.root.getAttribute("data-state"), "unavailable");
  assert.match(text(h.root), /say 99999 is not in circle 50101/, "the refusal, verbatim");
});

test("old talk (no ids) is a plain timeline: no statements with threads, no circle pretended", async () => {
  const h = harness({ room: legacyRoom() });
  await h.reader.showRoom();
  assert.equal(byAttr(h.root, "data-circle-stub").length, 0);
  assert.equal(byAttr(h.root, "data-thread").length, 0, "a timeline has no thread controls");
  assert.equal(byAttr(h.root, "data-timeline").length, 1, "one plain list");
  assert.equal(byAttr(h.root, "data-say-plain").length, 2);
  assert.equal(byAttr(h.root, "data-say").length, 0, "no say carries an id it was not given");
  assert.match(text(h.root), /Claran, hello.*hi rei/);
});

test("a reply whose parent the read does not hold is named, with the producer's own note, not drawn as a circle of its own", async () => {
  const h = harness({ room: brokenRoom() });
  await h.reader.showRoom();
  const broken = byAttr(h.root, "data-notice", "broken");
  assert.equal(broken.length, 1);
  assert.match(text(broken[0]), /A reply to a statement that isn't shown: claran\..*this say replies to one this read does not hold/);
  assert.doesNotMatch(text(broken[0]), /50110/, "its id is not words");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 3, "and it did not mint a stub");
});

// ── content is text ─────────────────────────────────────────────────────────

test("what residents said is TEXT: markup in a say, a handle and a stub makes no element, and innerHTML is never touched", async () => {
  const HOSTILE = `<img src=x onerror="window.__pwned=1"> <b>bold?</b> [click](javascript:alert(1))`;
  const room = roomFind();
  room.find.circles.elsewhere[0].opener = HOSTILE;
  room.find.circles.elsewhere[0].handle = `<i>pica</i>`;
  const circle = circle50101();
  circle.find.circle_read.lines[1] = { ...circle.find.circle_read.lines[1], said: HOSTILE, handle: "<script>x</script>" };
  const h = harness({ room, circles: { "50101|": circle }, canReply: true });
  await h.reader.showRoom();
  assert.match(text(byAttr(h.root, "data-circle-stub")[0]), /<i>pica<\/i> .*<img src=x/, "the stub's words, literally");
  byAttr(h.root, "data-circle-open", 50101)[0].click(); await tick();
  openAll(h.root);
  assert.ok(text(h.root).includes(HOSTILE), "the say, literally");
  assert.equal(find(h.root, (n) => ["IMG", "B", "I", "SCRIPT", "A"].includes(n.tagName)).filter((n) => n.tagName !== "A").length, 0, "no element was made from a resident's words");
  assert.equal(find(h.root, (n) => n.tagName === "A").length, 0, "and no link either");
});

// ── reply ───────────────────────────────────────────────────────────────────

test("Reply: with canReply each line that has an id carries one, and pressing it hands the host the target; without canReply there is none", async () => {
  const got = [];
  const h = harness({ circles: { "50101|": circle50101() }, canReply: true, onReply: (t) => got.push(t) });
  await h.reader.showCircle(50101); await tick();
  assert.equal(byAttr(h.root, "data-reply").length, 1, "folded: the one statement on screen carries one");
  openAll(h.root);
  const buttons = byAttr(h.root, "data-reply");
  assert.equal(buttons.length, 10, "one per say");
  byAttr(h.root, "data-reply", 50106)[0].click();
  assert.deepEqual(got, [{ id: 50106, handle: "amia", said: "Iris did, I think.", at_ms: TABLE[5].at_ms, circle: 50101 }]);
  const quiet = harness({ circles: { "50101|": circle50101() }, canReply: false });
  await quiet.reader.showCircle(50101); await tick();
  assert.equal(byAttr(quiet.root, "data-reply").length, 0);
  // legacy lines have no id, so no reply button even where replying is on
  const old = harness({ room: legacyRoom(), canReply: true });
  await old.reader.showRoom();
  assert.equal(byAttr(old.root, "data-reply").length, 0, "a say with no id cannot be replied to");
});

// ── refresh: keep the reader where they were ────────────────────────────────

test("refresh keeps the scroll position and the focused control, and new says are OFFERED ('N new — show'), never pulled in", async () => {
  const c = circle50101();
  const h = harness({ circles: { "50101|": c }, canReply: true });
  await h.reader.showCircle(50101); await tick();
  openAll(h.root);
  h.scroller.scrollTop = 240;
  const reply = byAttr(h.root, "data-reply", 50104)[0];
  reply.focus();
  assert.equal(doc.activeElement, reply);
  // the same data again: nothing moves
  await h.reader.refresh(); await tick();
  assert.equal(h.scroller.scrollTop, 240, "scroll position kept");
  assert.equal(doc.activeElement?.attrs["data-key"], "reply-50104", "focus kept on the same control, by its key");
  assert.equal(byAttr(h.root, "data-new").length, 0, "nothing new, nothing offered");
  // a new say arrives in the office
  const later = JSON.parse(JSON.stringify(c));
  later.find.circle_read.lines.push({ ...say(50115, "seth", 15, "One more thing!", 50113, 50101), depth: 3 });
  later.find.circle_read.says = 11;
  h.answers.circles["50101|"] = later;
  const before = byAttr(h.root, "data-say").length;
  await h.reader.refresh(); await tick();
  assert.equal(byAttr(h.root, "data-say").length, before, "the new say is NOT drawn unasked");
  assert.equal(h.scroller.scrollTop, 240, "no unsolicited jump");
  assert.equal(doc.activeElement?.attrs["data-key"], "reply-50104", "focus did not move");
  const offer = byAttr(h.root, "data-new")[0];
  assert.ok(offer, "the reader offers it");
  assert.match(text(offer), /^1 new — show$/);
  offer.click();
  openAll(h.root);                                   // the new reply sits under a statement the visitor had not opened
  assert.equal(byAttr(h.root, "data-say").length, before + 1, "asked for, it is drawn");
  assert.ok(byAttr(h.root, "data-say", 50115).length);
  assert.equal(h.scroller.scrollTop, 240, "and still the reader's place");
  assert.equal(byAttr(h.root, "data-new").length, 0);
});

test("refresh of a room: a failed background read leaves the last good view standing; a new top circle is offered, not inserted", async () => {
  const h = harness();
  await h.reader.showRoom();
  h.answers.room = () => { throw new Error("offline"); };
  await h.reader.refresh(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "room", "the last good view stands");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 3);
  const grown = roomFind();
  grown.find.circles.elsewhere.push({ circle: 50120, handle: "ada", opener: "A new circle", says: 1, people: 1, started: grown.find.room.latest, latest: grown.find.room.latest, read: { circle: 50120 } });
  h.answers.room = grown;
  await h.reader.refresh(); await tick();
  assert.equal(byAttr(h.root, "data-circle-stub").length, 3, "not inserted unasked");
  byAttr(h.root, "data-new")[0].click();
  assert.equal(byAttr(h.root, "data-circle-stub").length, 4);
});

// ── a signed-in default, rendered by the same module ────────────────────────

test("a signed-in default (own path, folded stubs, elsewhere, paged own path) renders with the served disclosure and continuation, in the served order", async () => {
  const lines = circle50101().find.circle_read.lines.slice(0, 5);
  const find = { room: roomFind().find.room, history: "complete", source: "record", circles: {
    room: { says: 14, people: 7, top_circles: 3 }, yours: 50101, lines,
    folded: [{ circle: 50112, handle: "amia", opener: "Pica, how long did the counter take?", says: 2, people: 2, started: lines[0].at, latest: lines[0].at, read: { circle: 50112 }, under: 2 }],
    elsewhere: roomFind().find.circles.elsewhere.slice(1),
    own_path: { paged: true, says: 16, shown: 5, next: { circle: 50101, after: 50105 } },
    counts: { lines: 5 }, budget: { bytes: 8192, used: 3355 },
  } };
  const h = harness({ room: { find } });
  await h.reader.showRoom();
  assert.match(text(h.root), /Yours/);
  assert.doesNotMatch(text(h.root), /your circle/i);
  assert.ok(byAttr(h.root, "data-notice", "paged").length);
  assert.match(text(byAttr(h.root, "data-notice", "paged")[0]), /5 lines of 16 shown/);
  assert.match(text(h.root), /More of yours/, "the folded side conversation is offered, in plain words");
  byAttr(h.root, "data-next")[0].click(); await tick();
  assert.deepEqual(h.calls.at(-1), ["circle", 50101, 50105], "the served own_path.next, nothing computed");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 0, "the circle view replaced the room");
});

// ── pure models, words and the dress ────────────────────────────────────────

test("modelOfRoom / modelOfCircle read the served keys and invent none; an unavailable history is not 'empty'", () => {
  const room = modelOfRoom(roomFind());
  assert.deepEqual(room.stubs.map((s) => s.circle), [50101, 50107, 50114]);
  assert.equal(room.empty, false); assert.equal(room.unavailable, false); assert.equal(room.yours, null);
  assert.equal(modelOfRoom(emptyRoom()).empty, true);
  const gone = modelOfRoom(unavailableRoom());
  assert.equal(gone.unavailable, true); assert.equal(gone.empty, false);
  assert.equal(modelOfRoom({ find: { circles: { elsewhere: [] } } }).empty, false, "no history said: not claimed empty");
  const circle = modelOfCircle(circle50106());
  assert.deepEqual(circle.path, [50101, 50105, 50106]);
  assert.deepEqual(circle.crumbs.map((c) => c.label), ["pica's statement", "claran's statement", "amia's statement"]);
  assert.deepEqual(crumbsOf([1, 2], new Map([["1", "x"]])).map((c) => [c.label, c.id]), [["x's statement", 1], ["an earlier statement", 2]], "an id it cannot name is 'an earlier statement': the id is data, never words");
  assert.equal(modelOfCircle({ find: { circle: 9, history: "unavailable", circle_read: {} } }).unavailable, true);
  assert.deepEqual(modelOfCircle(circle50105Page1()).next, { circle: 50105, after: 50106 });
});

test("the words and the dress: times print as UTC, every colour in the CSS inherits or follows the text, and the stylesheet carries no innerHTML-shaped trap", () => {
  assert.equal(whenOf("2026-11-14T20:01:00.000Z"), "20:01Z");
  assert.equal(dateTimeOf("2026-11-14T20:01:00.000Z"), "2026-11-14 20:01Z");
  assert.equal(whenOf("not a time"), "");
  assert.ok(READER_WORDS.unavailable.includes("not the same as nothing"));
  assert.doesNotMatch(READER_CSS, /#[0-9a-fA-F]{3,8}\b|rgb\(/, "no literal colour: the host decides the ground and the reader reads on it");
  assert.match(READER_CSS, /\[data-circle-reader\]/);
  // every anchor the reader draws (the circle's permalink, a spark link) wears the host's foreground, never the browser's default link blue,
  // and keeps its underline as the link affordance (the permalink was dark blue on the World column's dark ground)
  assert.match(READER_CSS, /\[data-circle-reader\] a \{ color: inherit; text-decoration: underline; \}/, "any anchor inside the reader inherits the host's colour and stays underlined");
  assert.match(READER_CSS, /\[data-circle-reader\] a:focus-visible \{/, "and shows keyboard focus");
});

test("the circle permalink is an anchor INSIDE the reader's root, so the reader's link rule is the one that dresses it", async () => {
  const h = harness({ circles: { "50101|": circle50101() }, hrefForCircle: (c) => `/conversations/#circle-${c}` });
  await h.reader.showCircle(50101); await tick();
  const anchors = find(h.root, (n) => n.tagName === "A");
  assert.ok(anchors.length >= 1, "the permalink is drawn");
  for (const a of anchors) assert.equal(h.root.contains(a) && h.root.getAttribute("data-circle-reader") !== null, true, "inside [data-circle-reader]");
});

test("mountCircleReader adds its stylesheet once per document and reads the room", async () => {
  const d = { ...doc, head: element("head"), getElementById(id) { return find(this.head, (n) => n.attrs.id === id)[0] ?? null; }, createElement: element };
  const mk = () => ({ host: element("div"), source: { async room() { return roomFind(); }, async circle() { return circle50101(); } }, doc: d });
  const a = mountCircleReader(mk()); await tick();
  mountCircleReader(mk()); await tick();
  assert.equal(find(d.head, (n) => n.attrs.id === "circle-reader-css").length, 1);
  assert.equal(a.root.getAttribute("data-state"), "room");
});

// ── an office that does not serve circles yet, and the column that hosts the reader ──────────────────

test("an office that answers a room read with the OLD list shape (no circles) is 'could not read', never 'nobody spoke'", async () => {
  const h = harness({ room: { live: [], closed: [], earshot_m: 60 } });
  await h.reader.showRoom(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "unavailable");
  assert.deepEqual(byAttr(h.root, "data-notice").map((n) => n.attrs["data-notice"]), ["unavailable"]);
  assert.match(text(h.root), /did not answer with the circles of this room/);
  const c = harness({ circles: { "1|": { live: [] } } });
  await c.reader.showCircle(1); await tick();
  assert.equal(c.root.getAttribute("data-state"), "unavailable", "and the same for a circle read");
});

test("the column's reader slot: the reader mounts where the flat words stood; the flat words show only when the reader could not read, and say so", async () => {
  const { homeColumnModel, renderHomeColumn } = await import("../spectator/home-column.mjs");
  const flat = [{ type: "paragraph", spans: [{ type: "text", text: "rig-ash: the old flat words" }] }];
  const view = (source) => homeColumnModel({ handle: "the-town", kicker: "a conversation · live", title: "Cave Interior", door: { blocks: flat }, footerLink: { href: "/conversations/#t1", text: "all conversations →" },
    reader: { roomId: "t1", source, canReply: true, onReply: () => {} } });
  const host = element("div");
  const good = { async room() { return roomFind(); }, async circle() { return circle50101(); } };
  renderHomeColumn(doc, host, view(good));
  await tick(); await tick();
  const body = find(host, (n) => n.className === "wv-homecol-body")[0];
  assert.equal(body.hidden, true, "the flat words wait behind the reader");
  assert.equal(byAttr(host, "data-circle-stub").length, 3, "the reader drew the room's circles in the column");
  assert.equal(find(host, (n) => n.className === "wv-homecol-all").length, 1, "the footer link to the conversations page is kept");
  assert.ok(host.__circleReader, "the column keeps the reader so it can refresh it in place");
  // an office that cannot answer: the reader says so and the flat words stand in, with their own sentence
  const down = element("div");
  renderHomeColumn(doc, down, view({ async room() { throw new Error("503"); }, async circle() { throw new Error("503"); } }));
  await tick(); await tick();
  assert.equal(find(down, (n) => n.className === "wv-homecol-body")[0].hidden, false, "the words the map holds are shown");
  assert.equal(find(down, (n) => n.className === "wv-homecol-flatnote")[0].hidden, false);
  assert.match(text(find(down, (n) => n.className === "wv-homecol-flatnote")[0]), /circles could not be read/);
  assert.equal(byAttr(down, "data-notice", "unavailable").length, 1, "and the reader's own notice says it could not read");
  // a column with no reader is today's column
  const plain = element("div");
  renderHomeColumn(doc, plain, homeColumnModel({ handle: "the-town", kicker: "k", title: "t", door: { blocks: flat } }));
  assert.equal(find(plain, (n) => n.className === "wv-homecol-body")[0].hidden, false);
  assert.equal(plain.__circleReader, null);
});

test("the SAY sheet: the receipt's own words ride back as served (linked by name), and reply_to is additive and chosen by the reader's Reply", async () => {
  const { worldSayAnswer } = await import("../spectator/viewer.mjs");
  const base = { spoke: true, listeners: ["a"], voices: [], where: { place: "Cave Interior" } };
  const plainAnswer = worldSayAnswer(base);
  assert.equal(plainAnswer.kind, "success"); assert.deepEqual(plainAnswer.notes, [], "no note when the office served none");
  const named = worldSayAnswer({ ...base, said: { id: 50115, reply_to: 50110, linked: "name", note: "linked to claran's say at 20:10 by name; press Reply to choose another" } });
  assert.deepEqual(named.notes, ["linked to claran's say at 20:10 by name; press Reply to choose another"], "exactly the sentence the office served");
  assert.equal(named.said.linked, "name");
  const noId = worldSayAnswer({ ...base, said: { id_note: "this office is not keeping say ids" } });
  assert.deepEqual(noId.notes, ["this office is not keeping say ids"]);
  assert.equal(worldSayAnswer({ ...base, said: { id: 1 } }).notes.length, 0, "an id alone says nothing the browser should add");
  // THE WIRING, as a TEXT PIN (the weakest instrument, labelled so: the sheet lives inside mountViewer): the act is sent with reply_to only when a
  // target is chosen, the target comes from the reader's Reply, and the browser never mentions how a link was resolved.
  const SRC = (await import("node:fs")).readFileSync(new URL("../spectator/viewer.mjs", import.meta.url), "utf8");
  assert.match(SRC, /apexAct\("say", \{ text, \.\.\.\(sayReplyTo \? \{ reply_to: sayReplyTo\.id \} : \{\}\) \}\)/, "reply_to rides additively");
  assert.match(SRC, /onReply: \(target\) => setReplyTarget\(target\)/, "the reader's Reply sets the target");
  assert.match(SRC, /replying to \$\{sayReplyTo\.handle\}/);
  assert.match(SRC, /wv-say-reply-clear/);
  assert.equal(/linked by name|handle_time/.test(SRC.slice(SRC.indexOf("function setReplyTarget"), SRC.indexOf("function syncSayBox"))), false, "no link provenance is derived in the browser's say path");
});

// ── CORE-82 FIX (lead review of 71e36f70): late answers, honest unavailable history, permalink focus, live canReply ──────────────────

const gate = () => { let release; const wait = new Promise((ok) => { release = ok; }); return { wait, release }; };

test("a slow background refresh that answers AFTER the visitor opened a circle does not redraw the room over it", async () => {
  const h = harness({ circles: { "50101|": circle50101() } });
  await h.reader.showRoom(); await tick();
  const g = gate();
  h.answers.room = () => g.wait.then(() => roomFind());
  const polling = h.reader.refresh();                               // the poll is in flight …
  byAttr(h.root, "data-circle-open", 50101)[0].click(); await tick();   // … and the visitor opens a conversation
  assert.equal(h.reader.getState().view, "circle");
  g.release(); await polling; await tick();
  assert.equal(h.reader.getState().view, "circle", "the state still says circle");
  assert.equal(byAttr(h.root, "data-crumbs").length, 1, "the circle's named back path is still drawn");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 0, "the room's stubs were not drawn over it");
  assert.equal(h.root.getAttribute("data-state"), "circle");
});

test("a slow circle refresh that answers AFTER Back does not redraw the circle over the room", async () => {
  const h = harness({ circles: { "50101|": circle50101() } });
  await h.reader.showCircle(50101); await tick();
  const g = gate();
  h.answers.circles["50101|"] = () => g.wait.then(() => circle50101());
  const polling = h.reader.refresh();
  byAttr(h.root, "data-back")[0].click(); await tick();
  assert.equal(h.reader.getState().view, "room");
  g.release(); await polling; await tick();
  assert.equal(h.reader.getState().view, "room");
  assert.equal(byAttr(h.root, "data-crumbs").length, 0, "no circle crumbs over the room");
  assert.equal(byAttr(h.root, "data-circle-stub").length, 3, "the room's stubs stand");
});

test("a 'show more' page that answers after the visitor went elsewhere, or after destroy, is dropped", async () => {
  const p1 = circle50105Page1(), next = p1.find.circle_read.next;
  const mk = () => {
    const h = harness({ circles: { "50105|": circle50105Page1(), "50101|": circle50101() } });
    const g = gate();
    h.answers.circles[`${next.circle}|${next.after}`] = () => g.wait.then(() => circle50105Page2());
    return { h, g };
  };
  {
    const { h, g } = mk();
    await h.reader.showCircle(50105); await tick();
    byAttr(h.root, "data-next")[0].click(); await tick();            // more() in flight
    await h.reader.showRoom(); await tick();                         // the visitor goes back to the room
    g.release(); await tick(); await tick();
    assert.equal(h.reader.getState().view, "room");
    assert.equal(byAttr(h.root, "data-say", 50110).length + byAttr(h.root, "data-say", 50111).length, 0, "the second page was not drawn over the room");
    assert.equal(byAttr(h.root, "data-crumbs").length, 0);
  }
  {
    const { h, g } = mk();
    await h.reader.showCircle(50105); await tick();
    byAttr(h.root, "data-next")[0].click(); await tick();
    h.reader.destroy();
    g.release(); await tick(); await tick();
    assert.equal(h.root.children.length, 0, "a destroyed reader draws nothing when a late answer lands");
  }
});

test("an unavailable history with lines keeps the lines and says so: it is never 'the whole circle'; no lines at all is not a blank", async () => {
  const partial = circle50101({ history: "unavailable" });            // complete:true and history:unavailable together, with ten lines
  const h = harness({ circles: { "50101|": partial } });
  await h.reader.showCircle(50101); await tick();
  openAll(h.root);
  assert.equal(byAttr(h.root, "data-say").length, 10, "every served line is still reachable on screen");
  const kinds = byAttr(h.root, "data-notice").map((n) => n.attrs["data-notice"]);
  assert.ok(kinds.includes("unavailable"), "the unavailable history is said aloud");
  assert.equal(kinds.includes("complete"), false, "and the circle is not called complete");
  assert.doesNotMatch(text(h.root), /whole circle\.$|That is the whole circle/);
  const empty = circle50101(); empty.find.circle_read.lines = []; empty.find.circle_read.says = 0;
  const e = harness({ circles: { "50101|": empty } });
  await e.reader.showCircle(50101); await tick();
  const ek = byAttr(e.root, "data-notice").map((n) => n.attrs["data-notice"]);
  assert.ok(ek.includes("unavailable"), "a read with no statements is not an answer-shaped blank");
  assert.equal(ek.includes("complete"), false, "and it is not called complete");
});

test("a circles-shaped room answer with no history flag and nothing to show is 'could not say', not a blank card", async () => {
  const r = roomFind(); delete r.find.history;
  r.find.circles = { room: { says: 0, people: 0, top_circles: 0 }, yours: null, lines: [], folded: [], elsewhere: [], counts: {} };
  const h = harness({ room: r });
  await h.reader.showRoom(); await tick();
  assert.equal(h.root.getAttribute("data-state"), "unavailable");
  assert.deepEqual(byAttr(h.root, "data-notice").map((n) => n.attrs["data-notice"]), ["unavailable"]);
  assert.equal(byAttr(h.root, "data-retry").length, 1);
  assert.doesNotMatch(text(h.root), /Nobody has spoken here yet/, "and it does not claim the room was silent");
});

test("the circle's permalink keeps keyboard focus through a quiet refresh", async () => {
  const h = harness({ circles: { "50101|": circle50101() }, hrefForCircle: (c) => `/conversations/#circle-${c}` });
  await h.reader.showCircle(50101); await tick();
  const link = byAttr(h.root, "data-key", "permalink")[0];
  assert.ok(link, "the permalink is a keyed control");
  assert.equal(link.attrs.href, "/conversations/#circle-50101");
  link.focus();
  await h.reader.refresh(); await tick();
  assert.equal(doc.activeElement?.attrs["data-key"], "permalink", "focus came back to the link after the redraw");
});

test("the host can switch Reply on or off while the reader is open: the view is redrawn in place, not re-read or reset to the room", async () => {
  const targets = [];
  const h = harness({ circles: { "50101|": circle50101() }, canReply: false });
  await h.reader.showCircle(50101); await tick();
  assert.equal(byAttr(h.root, "data-reply").length, 0);
  openAll(h.root);
  const reads = h.calls.length;
  h.scroller.scrollTop = 120;
  h.reader.setCanReply(true, (t) => targets.push(t.id));
  assert.equal(h.reader.getState().view, "circle", "still in the same circle");
  assert.equal(h.calls.length, reads, "nothing was asked of the office");
  assert.equal(byAttr(h.root, "data-reply").length, 10, "each served say now carries Reply");
  assert.equal(h.scroller.scrollTop, 120, "scroll kept");
  byAttr(h.root, "data-reply", 50104)[0].click();
  assert.deepEqual(targets, [50104], "the new handler is the one called");
  h.reader.setCanReply(false);
  assert.equal(byAttr(h.root, "data-reply").length, 0, "signed out: the buttons go");
  assert.equal(h.reader.getState().view, "circle");
});

test("the column keeps ONE reader for a conversation, yet live metadata and canReply reach it: words are rewritten in place, the reader is not rebuilt or re-read", async () => {
  const { createHomeColumn } = await import("../spectator/home-column.mjs");
  const calls = [];
  const source = { async room() { calls.push("room"); return roomFind(); }, async circle() { calls.push("circle"); return circle50101(); } };
  const host = element("div");
  const col = createHomeColumn({ doc, host });
  const view = (over = {}, readerOver = {}) => ({ handle: "the-town", residentLink: false, key: "convo:t1|circles", kicker: "a conversation · live", title: "Cave Interior", region: "14 statements · 7 speakers",
    door: { blocks: [] }, byline: "in this settlement", facts: [{ label: "now", value: "live: a conversation lasts the settlement" }, { label: "latest", value: "2026-11-14 20:14Z" }],
    reader: { roomId: "t1", source, canReply: false, ...readerOver }, ...over });
  col.open(view()); await tick(); await tick();
  const reader = host.__circleReader;
  assert.ok(reader);
  byAttr(host, "data-circle-open", 50101)[0].click(); await tick(); await tick();
  openAll(host);
  assert.equal(reader.getState().view, "circle");
  assert.equal(byAttr(host, "data-reply").length, 0);
  const reads = calls.length;
  const targets = [];
  // the same key again, with what the office says now: gone quiet, new counts, and the visitor is now signed in
  col.open(view({ kicker: "a conversation · gone quiet", region: "20 statements · 8 speakers", byline: "in an earlier settlement",
    facts: [{ label: "now", value: "gone quiet: an earlier settlement's" }, { label: "latest", value: "2026-11-14 20:40Z" }] }, { canReply: true, onReply: (t) => targets.push(t.id) }));
  assert.equal(host.__circleReader, reader, "the same reader: nothing was rebuilt");
  assert.equal(reader.getState().view, "circle", "still in the circle the visitor opened");
  assert.equal(calls.length, reads, "nothing was re-read for it");
  assert.equal(text(find(host, (n) => n.className === "wv-homecol-kicker")[0]), "a conversation · gone quiet");
  assert.equal(text(find(host, (n) => n.className === "wv-homecol-meta")[0]), "20 statements · 8 speakers");
  assert.equal(text(find(host, (n) => n.className === "wv-homecol-byline")[0]), "in an earlier settlement");
  const dds = find(host, (n) => n.tagName === "DD").map(text);
  assert.deepEqual(dds, ["gone quiet: an earlier settlement's", "2026-11-14 20:40Z"], "the facts follow the office");
  assert.equal(byAttr(host, "data-reply").length, 10, "canReply reached the open reader");
  byAttr(host, "data-reply", 50104)[0].click();
  assert.deepEqual(targets, [50104], "and so did the new reply handler");
});

test("the World's reader is reading-only on a phone: the column hands the reader canReply only for an acting visitor who is NOT on the phone layout (SOURCE PIN; the behaviour is the reader's own canReply, tested above)", async () => {
  const SRC = (await import("node:fs")).readFileSync(new URL("../spectator/viewer.mjs", import.meta.url), "utf8");
  const view = SRC.slice(SRC.indexOf("function convoColumnView"), SRC.indexOf("// What a plain click or hover on the map means for a thread"));
  assert.match(view, /canReply: canAct\(\) && !onPhone\(\)/, "no Reply on the phone World page; the host option, not a stylesheet hide");
  assert.equal(/display\s*:\s*none[^}]*cr-reply|cr-reply[^}]*display\s*:\s*none/.test(READER_CSS), false, "and the shared reader's CSS does not hide Reply (the conversations page keeps it)");
  assert.match(view, /\/conversations\/#circle-/, "the circle's link to the conversations page stays");
  // the reader itself: with canReply false there is no Reply button, the permalink still is drawn
  const h = harness({ circles: { "50101|": circle50101() }, canReply: false, hrefForCircle: (c) => `/conversations/#circle-${c}` });
  await h.reader.showCircle(50101); await tick();
  assert.equal(byAttr(h.root, "data-reply").length, 0, "zero Reply controls");
  assert.equal(byAttr(h.root, "data-key", "permalink").length, 1, "the link to the conversations page remains");
});

test("the SAY sheet: a sheet that is opened plainly starts with no reply target; only an explicit Reply sets one (SOURCE PIN, the weakest instrument: the sheet lives inside mountViewer)", async () => {
  const SRC = (await import("node:fs")).readFileSync(new URL("../spectator/viewer.mjs", import.meta.url), "utf8");
  const open = SRC.slice(SRC.indexOf("function openSayBox()"), SRC.indexOf("function syncSayBox"));
  assert.match(open, /sayReplyTo = null;[^\n]*\n\s*const sheet = document\.createElement\("div"\)/, "a fresh sheet clears the previous target before it is built");
  const set = SRC.slice(SRC.indexOf("function setReplyTarget"), SRC.indexOf("function openSayBox()"));
  assert.ok(set.indexOf("openSayBox()") < set.indexOf("sayReplyTo = {"), "an explicit Reply opens the sheet FIRST and sets its target after, so the chosen target survives the open");
});

// ── WLD-213 · the optional host-provided speaker face ───────────────────────
//
// The host owns what a face IS; the reader only places the fresh decorative node the host's `faceForSpeaker(handle)` returns, inline before the name, on every
// line it draws (a room's openers, a conversation's full lines at every depth, its context lines, old talk), and knows no avatar source, household, photo, URL or
// office field. Absent, null or unusable, the DOM is exactly what it was. FALSIFIER: one path lacks a face, a repeated handle steals an earlier node, a name or time
// disappears, a bare caller changes, or drawing fetches a picture or an identity.
const faceHook = (calls = []) => (handle) => { calls.push(handle); const n = element("span"); n.className = "rig-face"; n.setAttribute("data-face", handle); return n; };
/** the shape of a tree as a string (tags, classes, attributes, text): two draws are the same draw when their shapes are */
const shapeOf = (n) => (n.nodeType === TEXT ? JSON.stringify(n.text) : `<${n.tagName}.${n.className}${Object.entries(n.attrs).sort().map(([k, v]) => ` ${k}=${v.replace(/\bcr\d+-/g, "crN-")}`).join("")}>${n.children.map(shapeOf).join("")}</>`);   // a reader's own instance counter in its ids is not a difference
const faceHost = (opts, { room = roomFind } = {}) => {
  const host = element("div"); const scroller = element("div"); scroller.appendChild(host);
  const calls = [];
  const source = { async room(id) { calls.push(["room", id]); return room(); }, async circle(id, after) { calls.push(["circle", id, after]); return id === 50101 ? circle50101() : id === 50105 ? circle50105Page1() : { error: "bounce" }; } };
  const reader = createCircleReader({ doc, host, source, roomId: "t20260514-pica", scroller, ...opts });
  return { host, reader, root: reader.root, calls };
};
const facesOf = (root) => byAttr(root, "data-face");
const headOf = (li) => li.children.find((c) => c.className === "cr-head-line");

test("WLD-213 · room openers: each opener carries its speaker's face inline BEFORE the name, with the name, time, text and controls intact", async () => {
  const calls = [];
  const h = faceHost({ faceForSpeaker: faceHook(calls) });
  await h.reader.showRoom();
  const stubs = byAttr(h.root, "data-circle-stub");
  assert.equal(stubs.length, 3);
  for (const st of stubs) {
    const head = headOf(st);
    assert.deepEqual(head.children.map((c) => c.className), ["rig-face", "cr-who", "cr-time"], "face, name, time: inline in the one head line");
    assert.equal(head.children[0].attrs["data-face"], text(head.children[1]), "the face is the speaker's own");
    assert.equal(head.children[0].attrs["aria-hidden"], "true", "decorative: the name beside it is the label");
  }
  assert.deepEqual([...calls].sort(), stubs.map((s) => text(headOf(s).children[1])).sort(), "asked once per opener, by handle, and for nothing else");
  assert.match(text(stubs[0]), /pica .*Welcome, everyone!/);
  assert.ok(byAttr(stubs[0], "data-circle-open").length === 1 && byAttr(stubs[0], "data-thread").length === 1, "the Open control and the reply thread are untouched");
});

test("WLD-213 · a conversation's full lines at every depth, its context lines and a repeated speaker: every line has a face of its own, none is shared or moved", async () => {
  const h = faceHost({ faceForSpeaker: faceHook(), canReply: true });
  await h.reader.showCircle(50101);
  openAll(h.root);
  const lines = byAttr(h.root, "data-say");
  assert.equal(lines.length, 10, "all ten statements, once opened");
  const faces = lines.map((li) => headOf(li).children.filter((c) => c.className === "rig-face"));
  assert.ok(faces.every((f) => f.length === 1), "exactly one face on every line, openers and the deepest replies alike");
  const nodes = faces.map((f) => f[0]);
  assert.equal(new Set(nodes).size, nodes.length, "a repeated handle never steals an earlier line's node");
  const who = lines.map((li) => text(headOf(li).children[1]));
  assert.ok(new Set(who).size < who.length, "the fixture does repeat speakers (pica speaks more than once)");
  assert.deepEqual(nodes.map((n) => n.attrs["data-face"]), who, "each face is its own line's speaker's");
  assert.equal(byAttr(h.root, "data-reply").length, 10, "Reply controls are still on every line");
  // the context block (an ancestor shown for orientation) carries faces too
  const c = faceHost({ faceForSpeaker: faceHook() });
  await c.reader.showCircle(50105);
  const ctx = byAttr(byAttr(c.root, "data-context")[0], "data-context-say");
  assert.ok(ctx.length >= 1 && ctx.every((li) => headOf(li).children[0].className === "rig-face" && headOf(li).children[0].attrs["data-face"] === text(headOf(li).children[1])), "context lines have faces");
});

test("WLD-213 · old talk (no ids) is a plain timeline and its lines carry faces too", async () => {
  const h = faceHost({ faceForSpeaker: faceHook() }, { room: legacyRoom });
  await h.reader.showRoom();
  const plain = byAttr(h.root, "data-say-plain");
  assert.equal(plain.length, 2);
  for (const li of plain) assert.deepEqual(headOf(li).children.map((c) => c.className).slice(0, 2), ["rig-face", "cr-who"]);
  assert.match(text(h.root), /Claran, hello.*hi rei/, "the words are intact");
});

test("WLD-213 · absent, null, or unusable output is exactly today's DOM: no empty box, no gutter, no change for a bare caller", async () => {
  const bare = faceHost({});
  await bare.reader.showCircle(50101); openAll(bare.root);
  const bareShape = shapeOf(bare.root);
  const variants = { "a hook that returns null": () => null, "undefined": () => undefined, "a string": () => "<img src=x onerror=alert(1)>", "an object that is not a node": () => ({ nodeType: 3 }), "a hook that throws": () => { throw new Error("no face for you"); } };
  for (const [name, hook] of Object.entries(variants)) {
    const h = faceHost({ faceForSpeaker: hook });
    await h.reader.showCircle(50101); openAll(h.root);
    assert.equal(shapeOf(h.root), bareShape, `${name}: the same DOM as a bare call`);
  }
  // an option that is not a function is ignored, never called
  const odd = faceHost({ faceForSpeaker: "pica" });
  await odd.reader.showCircle(50101); openAll(odd.root);
  assert.equal(shapeOf(odd.root), bareShape, "a non-function option is no option");
  // the room view too
  const b2 = faceHost({}); await b2.reader.showRoom();
  const n2 = faceHost({ faceForSpeaker: () => null }); await n2.reader.showRoom();
  assert.equal(shapeOf(n2.root), shapeOf(b2.root));
});

test("WLD-213 · a node that is already placed is NOT moved off its line: the same node returned twice is placed once, the second line has none", async () => {
  const shared = element("span"); shared.setAttribute("data-face", "shared");
  const h = faceHost({ faceForSpeaker: () => shared });
  await h.reader.showRoom();
  const placed = facesOf(h.root);
  assert.equal(placed.length, 1, "one placement; the other openers were not given the same node");
  assert.equal(shared.parent, headOf(byAttr(h.root, "data-circle-stub")[0]), "and it stayed on the first line");
});

test("WLD-213 · drawing with a hook reads nothing more and asks nobody who a speaker is: the office calls are exactly a bare caller's", async () => {
  const bare = faceHost({}); await bare.reader.showRoom(); byAttr(bare.root, "data-circle-open", 50101)[0].click(); await tick(); openAll(bare.root);
  const withHook = faceHost({ faceForSpeaker: faceHook([]) }); await withHook.reader.showRoom(); byAttr(withHook.root, "data-circle-open", 50101)[0].click(); await tick(); openAll(withHook.root);
  assert.deepEqual(withHook.calls, bare.calls, "the same reads, in the same order: no picture, identity or avatar read of the reader's own");
});

test("WLD-213 · folds and the redraw keep the faces: opening a thread redraws in place and every line, new ones included, still has its own face", async () => {
  const h = faceHost({ faceForSpeaker: faceHook() });
  await h.reader.showCircle(50101);
  assert.equal(facesOf(h.root).length, 1, "folded: only the opener is on screen, with its face");
  byAttr(h.root, "data-thread-view")[0].click();
  const open = byAttr(h.root, "data-thread", "t-50101")[0];
  assert.equal(open.attrs["data-open"], "true", "the thread opened (the fold state kept by the reader)");
  const lines = byAttr(h.root, "data-say");
  assert.ok(lines.length > 1 && lines.every((li) => headOf(li).children[0].className === "rig-face"), "the newly shown replies have their faces");
  assert.match(text(h.root), /Welcome, everyone!/, "text intact");
});

test("WLD-213 · the column hands its reader the host's hook only when it has one: with it the column's reader draws faces, without it the column is today's", async () => {
  const { homeColumnModel, renderHomeColumn } = await import("../spectator/home-column.mjs");
  const flat = [{ type: "paragraph", spans: [{ type: "text", text: "rig-ash: the old flat words" }] }];
  const view = (extra) => homeColumnModel({ handle: "the-town", kicker: "k", title: "Cave Interior", door: { blocks: flat }, reader: { roomId: "t1", source: { async room() { return roomFind(); }, async circle() { return circle50101(); } }, ...extra } });
  const withFace = element("div"); renderHomeColumn(doc, withFace, view({ faceForSpeaker: faceHook([]) })); await tick(); await tick();
  assert.equal(facesOf(withFace).length, 3, "the column's reader placed a face on each opener");
  const without = element("div"); renderHomeColumn(doc, without, view({})); await tick(); await tick();
  assert.equal(facesOf(without).length, 0, "no hook, no faces");
  const none = element("div"); renderHomeColumn(doc, none, view({ faceForSpeaker: null })); await tick(); await tick();
  assert.equal(shapeOf(none), shapeOf(without), "an explicit null is the same as nothing");
  // the World page's own view (viewer.mjs) hands none: its reader object carries no faceForSpeaker
  assert.doesNotMatch((await import("node:fs")).readFileSync(new URL("../spectator/viewer.mjs", import.meta.url), "utf8"), /faceForSpeaker/, "the default World page has no provider");
});
