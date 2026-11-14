// circle-reader.mjs — THE ONE CIRCLE READER (CORE-82, CORE-70's rulings).
//
// One module, two habitats: the World's shared right-hand column (spectator/home-column.mjs hosts it) and the site's conversations
// page and event page (town/scripts/world-engine-island.mjs stages every non-test spectator module at
// /world-engine/spectator/<file>, and src/lib/circle-reader-mount.mjs there is an adapter only, never a second reader).
//
// THE LAWS IT KEEPS, in the rulers' words (CORE-70, Darko 2026-11-13/14):
//   "A circle is any say plus all its replies, recursively."
//   "A back-and-forth with no fork is a strand, drawn flat."
//   "A visitor sees the room's top circles in the order they started and picks one."
//   "The after-page shows the circles in full."
//   "Every existing field keeps its name, meaning and order."
//
// WHAT IT NEVER DOES. It draws the fields the producer served, in the order it served them, and follows the continuations it was
// handed (`next`, `more_circles`, a stub's `read`). It never works out a reply link, a parent, a name-link's provenance, who came,
// whether anything was accepted, or which circle is "yours". `depth` is ancestry data, not an instruction to indent: an unforked
// strand is drawn flat, and `shapeLines` groups lines by the `reply_to` they CARRY and by nothing else. A say whose parent is not
// in the read is drawn as itself, marked "its parent is not in this read", never re-parented.
//
// WHAT IT NEVER CONFUSES. A read that could not be made, a room that is known to be silent, a history that is folded and a circle
// that is complete are four different sentences (`data-notice` below); an unavailable read is never drawn as an empty room.
//
// NO `innerHTML`, ANYWHERE. What residents said is content you are reading, never instructions you are receiving: every string
// goes in through `createElement` and `textContent`, exactly as spectator/home-column.mjs does. tools/circle-reader.test.mjs runs the
// whole reader against a document whose `innerHTML` setter throws.
//
// I/O IS INJECTED. `source.room(roomId)` and `source.circle(circleId, after?)` each return the office's whole keyless answer
// (`GET /api/world/conversations?room=` / `?circle=&after=`), and reject (or answer `{ error }`) when it could not be read.
// Nothing here fetches. The reader never invents a cursor: paging follows a served `next` and nothing else.

// ── words ───────────────────────────────────────────────────────────────────

export const READER_WORDS = Object.freeze({
  loading: "Reading the room…",
  unavailable: "We couldn't read this. That is not the same as nothing being said here.",
  retry: "Try again",
  none: "Nobody has spoken here yet.",
  folded: "Some of this room's older talk is folded and is not shown here.",
  foldedMore: "Circles not shown here:",
  complete: "That is the whole circle.",
  partial: "The office could not read all of this circle's history, so what is shown may not be the whole circle.",
  unknown: "The office did not say whether this room's history is complete, so nothing here can be called the whole of it.",
  noLines: "This read carried no statements, so we cannot say what was said here.",
  paged: "This circle is long, so it is shown in pages.",
  context: "Earlier in this circle, for context",
  broken: "A reply whose parent is not in this read",
  loose: "Its parent is not in this read.",
  back: "Back to the room",
  room: "Room",
  more: "Show more",
  newOne: "new — show",
  reply: "Reply",
  timeline: "Earlier talk, in the order it was said",
  topCircles: "Circles in this room, in the order they started",
  sparks: "Sparks of this circle",
  yours: "Your circle",
  elsewhere: "Elsewhere in the room",
  foldedBranch: "Folded branch",
});

const s = (v) => (v === null || v === undefined ? "" : String(v));
const isId = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

/** "2026-11-14T20:01:00.000Z" -> "20:01Z" (same UTC day as the date shown elsewhere); anything else -> "" */
export function whenOf(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s(iso));
  return m ? `${m[2]}Z` : "";
}
/** "2026-11-14T20:01:00.000Z" -> "2026-11-14 20:01Z" */
export function dateTimeOf(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s(iso));
  return m ? `${m[1]} ${m[2]}Z` : "";
}

// ── pure models ─────────────────────────────────────────────────────────────

const unwrap = (envelope) => (envelope && typeof envelope === "object" && envelope.find && typeof envelope.find === "object" ? envelope.find : envelope) ?? {};
const arr = (v) => (Array.isArray(v) ? v : []);

/** A served stub, as drawn: the fields it carries and nothing derived. */
function stubOf(raw) {
  const st = raw && typeof raw === "object" ? raw : {};
  return {
    circle: st.circle,
    handle: s(st.handle),
    opener: s(st.opener),
    says: Number(st.says) || 0,
    people: Number(st.people) || 0,
    started: s(st.started),
    latest: s(st.latest),
    read: st.read && isId(st.read.circle) ? { circle: st.read.circle } : isId(st.circle) ? { circle: st.circle } : null,
    under: Number.isFinite(Number(st.under)) ? Number(st.under) : null,
  };
}

/**
 * `GET ?room=` (or the whole answer holding it) -> what the room view draws.
 * `empty` is only ever true for a room the producer says it READ and found silent (`history: 'complete'` and nothing to show):
 * an unavailable history is `unavailable`, never empty.
 */
export function modelOfRoom(envelope) {
  const find = unwrap(envelope);
  const room = find.room && typeof find.room === "object" ? find.room : {};
  const circles = find.circles && typeof find.circles === "object" ? find.circles : {};
  const history = ["complete", "folded", "unavailable"].includes(find.history) ? find.history : null;
  const stubs = arr(circles.elsewhere).map(stubOf);
  const folded = arr(circles.folded).map(stubOf);
  const lines = arr(circles.lines);
  const timeline = arr(circles.timeline);
  const moreCircles = arr(circles.more_circles).filter(isId);
  const broken = arr(circles.broken);
  const nothingToShow = !stubs.length && !folded.length && !lines.length && !timeline.length && !moreCircles.length && !broken.length;
  return {
    kind: "room",
    room: {
      id: room.id, live: room.live === true, place: s(room.place), started: s(room.started), latest: s(room.latest),
      participants: arr(room.participants).map(s), voiceCount: Number(room.voice_count) || 0, aboard: room.aboard === true, at: room.at ?? null,
    },
    summary: circles.room && typeof circles.room === "object" ? { says: Number(circles.room.says) || 0, people: Number(circles.room.people) || 0, topCircles: Number(circles.room.top_circles) || 0 } : null,
    history, source: s(find.source), note: s(find.note),
    yours: isId(circles.yours) ? circles.yours : null,
    lines, folded, stubs, moreCircles, broken, timeline,
    timelineFolded: Number(circles.timeline_folded) || 0,
    ownPath: circles.own_path && typeof circles.own_path === "object" ? circles.own_path : null,
    counts: circles.counts ?? null,
    unavailable: history === "unavailable",
    empty: history === "complete" && nothingToShow,
    // no flag at all and nothing to draw: the office did not say, so the card must not be an answer-shaped blank
    unknown: history === null && nothingToShow,
  };
}

/** The named back path: each id resolved against what the read holds (a line it carries, a stub it was handed); an id it cannot name stays "say <id>". */
export function crumbsOf(path, known) {
  return arr(path).filter(isId).map((id) => {
    const hit = known.get(String(id));
    return { id, label: hit ? `${hit}'s circle` : `say ${id}`, named: !!hit };
  });
}

/** `GET ?circle=[&after=]` (or the answer holding it) -> what the circle view draws. */
export function modelOfCircle(envelope) {
  const find = unwrap(envelope);
  const read = find.circle_read && typeof find.circle_read === "object" ? find.circle_read : {};
  const room = find.room && typeof find.room === "object" ? find.room : {};
  const lines = arr(read.lines);
  const context = arr(read.context);
  const history = ["complete", "folded", "unavailable"].includes(find.history) ? find.history : null;
  const known = new Map();
  for (const l of [...context, ...lines]) if (isId(l?.id) && l.handle) known.set(String(l.id), s(l.handle));
  const sparks = find.sparks && typeof find.sparks === "object" ? { on: arr(find.sparks.on), below: arr(find.sparks.below) } : null;
  return {
    kind: "circle",
    circle: find.circle ?? read.circle,
    after: find.after,
    path: arr(read.path),
    crumbs: crumbsOf(read.path, known),
    says: Number(read.says) || 0,
    people: Number(read.people) || 0,
    context, lines,
    next: read.next && isId(read.next.circle) && isId(read.next.after) ? { circle: read.next.circle, after: read.next.after } : null,
    complete: read.complete === true,
    history, source: s(find.source), note: s(find.note), memoryNote: s(find.memory_note),
    sparks, sparksNote: s(find.sparks_note),
    room: { id: room.id, place: s(room.place), live: room.live === true },
    unavailable: history === "unavailable" && !lines.length,
    // lines served alongside an unavailable history are kept and drawn, but never called the whole circle
    partial: history === "unavailable" && lines.length > 0,
  };
}

/**
 * Flat lines -> blocks, using ONLY the `reply_to` each line carries.
 *
 *   { type: 'strand', lines: [...], loose?: true }  a run of replies with no fork in it: drawn flat, however deep `depth` says it is
 *   { type: 'fork', line, children: [block, ...] }   follows the strand that ends in `line`, when `line` has two or more replies:
 *                                                    each child block is one branch, in the order the lines were served
 *
 * Every line served appears in exactly one block, in the served order within its run (nothing is dropped at a fold and nothing is
 * duplicated). A line whose `reply_to` is not among `lines` or `known` is `loose` (its strand says so): it is never re-parented.
 * Lines without an `id` are not circle material at all: `shapeLines` returns them as one `{ type: 'plain', lines }` timeline.
 *
 * @param {object[]} lines
 * @param {{ known?: Iterable<number|string> }} [opts]   ids that exist outside `lines` (context lines), so a reply to one is not loose
 */
export function shapeLines(lines, { known = [] } = {}) {
  const all = arr(lines);
  const plain = all.filter((l) => !isId(l?.id));
  const withId = all.filter((l) => isId(l?.id));
  const byId = new Map(withId.map((l) => [String(l.id), l]));
  const outside = new Set([...known].map(String));
  const children = new Map();          // parent id -> [line…] in served order
  const roots = [];                    // lines with no parent in the set
  for (const l of withId) {
    const p = isId(l.reply_to) ? String(l.reply_to) : null;
    if (p !== null && byId.has(p) && p !== String(l.id)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(l);
    } else roots.push({ line: l, loose: p !== null && !outside.has(p) });
  }
  const seen = new Set();
  const walk = (start, loose) => {
    // one run: follow the single child while there is exactly one
    const run = [];
    let cur = start;
    for (;;) {
      if (seen.has(String(cur.id))) break;       // a cycle in served data: never loop, never drop what was already placed
      seen.add(String(cur.id));
      run.push(cur);
      const kids = children.get(String(cur.id)) ?? [];
      if (kids.length === 1) { cur = kids[0]; continue; }
      const blocks = [{ type: "strand", lines: run, ...(loose ? { loose: true } : {}) }];
      if (kids.length > 1) blocks.push({ type: "fork", line: cur, children: kids.map((k) => walk(k, false)).flat() });
      return blocks;
    }
    return [{ type: "strand", lines: run, ...(loose ? { loose: true } : {}) }];
  };
  const out = [];
  for (const r of roots) out.push(...walk(r.line, r.loose));
  // a cycle in served data would leave lines unplaced: place each as its own loose strand so nothing is lost
  for (const l of withId) if (!seen.has(String(l.id))) { seen.add(String(l.id)); out.push({ type: "strand", lines: [l], loose: true }); }
  if (plain.length) out.push({ type: "plain", lines: plain });
  return out;
}

/** Every served line the blocks carry, in block order (the lane falsifier counts these against what was served). */
export function linesOfBlocks(blocks) {
  const out = [];
  for (const b of arr(blocks)) {
    if (b.type === "strand" || b.type === "plain") out.push(...b.lines);
    else if (b.type === "fork") out.push(...linesOfBlocks(b.children));
  }
  return out;
}

// ── the dress ───────────────────────────────────────────────────────────────
//
// Colours INHERIT (the host decides the ground: the dark column, the paper card) and the reader only dims, rules and underlines with
// `currentColor`, so it reads on both. A host may set --cr-accent and --cr-rule; both have fallbacks that follow the text colour.
export const READER_CSS = `
[data-circle-reader] { color: inherit; font: inherit; line-height: 1.45; text-align: left; }
[data-circle-reader] * { box-sizing: border-box; }
[data-circle-reader] .cr-head { margin: 0 0 .6em; }
[data-circle-reader] .cr-title { margin: 0 0 .15em; font-size: 1.05em; }
[data-circle-reader] .cr-meta, [data-circle-reader] .cr-time, [data-circle-reader] .cr-quiet { opacity: .78; font-size: .86em; }
[data-circle-reader] button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--cr-rule, currentColor); border-radius: 4px; padding: .3em .65em; cursor: pointer; min-height: 2em; }
[data-circle-reader] button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
[data-circle-reader] button:focus-visible { outline: 2px solid var(--cr-accent, currentColor); outline-offset: 2px; }
[data-circle-reader] .cr-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: .3em .5em; margin: 0 0 .7em; font-size: .9em; }
[data-circle-reader] .cr-crumbs button { border-style: dashed; }
[data-circle-reader] .cr-crumbs [aria-current] { font-weight: 700; }
[data-circle-reader] .cr-sep { opacity: .6; }
[data-circle-reader] .cr-stubs, [data-circle-reader] .cr-lines, [data-circle-reader] .cr-list { list-style: none; margin: 0; padding: 0; }
[data-circle-reader] .cr-stub { display: block; width: 100%; text-align: left; margin: 0 0 .5em; padding: .55em .7em; }
[data-circle-reader] .cr-stub .cr-opener { display: block; font-weight: 600; overflow-wrap: anywhere; }
[data-circle-reader] .cr-stub .cr-meta { display: block; margin-top: .15em; }
[data-circle-reader] .cr-strand { margin: 0 0 .7em; padding: 0; border-left: 3px solid var(--cr-rule, currentColor); padding-left: .7em; }
[data-circle-reader] .cr-fork { margin: 0 0 .7em; padding-left: .6em; border-left: 1px dashed var(--cr-rule, currentColor); }
[data-circle-reader] .cr-fork .cr-fork { padding-left: .4em; }
[data-circle-reader] .cr-say { margin: 0 0 .45em; overflow-wrap: anywhere; }
[data-circle-reader] .cr-say .cr-who { font-weight: 700; }
[data-circle-reader] .cr-say .cr-said { display: block; white-space: pre-wrap; }
[data-circle-reader] .cr-reply { margin-left: .5em; padding: .1em .5em; min-height: 0; font-size: .82em; }
[data-circle-reader] .cr-context { margin: 0 0 .7em; padding: .4em .6em; border: 1px dashed var(--cr-rule, currentColor); border-radius: 4px; opacity: .92; }
[data-circle-reader] .cr-context .cr-label { display: block; font-size: .82em; opacity: .85; margin-bottom: .25em; }
[data-circle-reader] .cr-notice { margin: .5em 0; padding: .4em .6em; border-left: 3px solid var(--cr-accent, currentColor); font-size: .92em; overflow-wrap: anywhere; }
[data-circle-reader] .cr-notice[data-notice="unavailable"] { border-left-style: double; border-left-width: 5px; }
[data-circle-reader] .cr-actions { display: flex; flex-wrap: wrap; gap: .4em; margin: .5em 0; }
[data-circle-reader] .cr-new { margin: 0 0 .6em; }
[data-circle-reader] .cr-sparks a { color: inherit; text-decoration: underline; }
`;

/**
 * THE REPLY TARGET'S DRESS in the World viewer's SAY sheet ("replying to <handle>: …", its Clear, and the office's own note under the
 * answer). It rides with the reader's CSS (HOME_COLUMN_CSS carries both), so the viewer's own STYLE, which a digest pins, does not move.
 */
export const SAY_REPLY_CSS = `
.wv-say-sheet .wv-say-reply { font-size:.74rem; line-height:1.35; }
.wv-say-sheet .wv-say-reply[hidden] { display:none; }
.wv-say-sheet .wv-say-reply-text { overflow-wrap:anywhere; }
.wv-say-sheet .wv-say-reply-clear { border:1px solid var(--line); border-radius:4px; background:transparent; color:var(--paper); font:inherit; font-size:.72rem; padding:2px 8px; cursor:pointer; flex:none; }
.wv-say-sheet .wv-say-note-linked { margin:.3rem 0 0; font-size:.74rem; color:var(--dim); }
`;

// ── the DOM builder ─────────────────────────────────────────────────────────

function build(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
const attr = (node, name, value) => { node.setAttribute(name, String(value)); return node; };
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

function metaLine(parts) { return parts.filter(Boolean).join(" · "); }

/**
 * Mount the reader on `host`.
 *
 * @param {object} o
 * @param {Document} o.doc
 * @param {Element}  o.host
 * @param {{ room(roomId): Promise<object>, circle(circleId, after?): Promise<object> }} o.source
 * @param {number|string} [o.roomId]
 * @param {boolean}  [o.canReply]        a Reply button on every line that has an id (the host owns the form)
 * @param {(t: { id, handle, said, at_ms, circle }) => void} [o.onReply]
 * @param {(state: string, detail?: object) => void} [o.onState]   'loading' | 'room' | 'circle' | 'unavailable'
 * @param {(circleId) => string|null} [o.hrefForCircle]   a permalink for a circle (the page's anchor); drawn as a plain link when given
 * @param {Element} [o.scroller]         the element that scrolls the reader (its position is kept across a refresh); default: the nearest scrolling ancestor
 * @param {object} [o.labels]            word overrides (READER_WORDS keys)
 */
export function createCircleReader({ doc, host, source, roomId = null, canReply = false, onReply = null, onState = null, onNavigate = null, hrefForCircle = null, labels = null, scroller = null } = {}) {
  if (!doc || !host || !source) throw new Error("createCircleReader needs a document, a host and a source");
  const W = { ...READER_WORDS, ...(labels ?? {}) };
  // the host may learn that the visitor can (or can no longer) act while the reader is open: both are read at draw time, never frozen at mount
  let replyOn = !!canReply, replyFn = onReply;
  const root = build(doc, "div", "cr-root");
  attr(root, "data-circle-reader", "");
  attr(root, "data-state", "loading");
  attr(root, "aria-live", "polite");
  host.appendChild(root);

  const state = {
    roomId, view: "room",
    roomModel: null,
    circleId: null,
    pages: [],               // circle models, page 1 first
    shown: new Set(),        // ids of says on screen (circle view), to tell new ones from old
    pending: null,           // a refreshed model the reader holds back until asked
    loadingMore: false,
    replyTarget: null,
    expanded: new Set(),     // fork keys the reader has open
    token: 0,                // a later request supersedes an earlier answer
  };

  const setState = (name, detail) => { root.setAttribute("data-state", name); if (onState) onState(name, detail ?? {}); };

  // ── scroll, focus and open state survive a rebuild (the one place a refresh may touch the DOM) ──
  // the nearest ancestor that scrolls (the column's own scroller); with no computed styles (a stand-in document) the direct parent
  const scrollParent = () => {
    if (scroller) return scroller;
    const view = doc.defaultView;
    for (let n = root.parentElement; n; n = n.parentElement) {
      let oy = "";
      try { oy = view?.getComputedStyle?.(n)?.overflowY ?? ""; } catch { /* no styles to read */ }
      if (/(auto|scroll)/.test(oy)) return n;
    }
    return doc.scrollingElement ?? root.parentElement ?? null;
  };
  const keep = () => ({
    scroller: scrollParent(),
    top: scrollParent()?.scrollTop ?? 0,
    focus: doc.activeElement && root.contains?.(doc.activeElement) ? doc.activeElement.getAttribute?.("data-key") ?? null : null,
  });
  const restore = (k) => {
    if (k.scroller && typeof k.scroller.scrollTop === "number") k.scroller.scrollTop = k.top;
    if (k.focus) {
      const target = findByKey(root, k.focus);
      if (target?.focus) target.focus();
    }
  };
  function findByKey(node, key) {
    if (node.getAttribute?.("data-key") === key) return node;
    for (const c of node.children ?? []) { const hit = findByKey(c, key); if (hit) return hit; }
    return null;
  }

  // ── pieces ──
  const notice = (kind, text, extra) => {
    const n = build(doc, "p", "cr-notice", text);
    attr(n, "data-notice", kind);
    if (extra) for (const [k, v] of Object.entries(extra)) attr(n, k, v);
    return n;
  };
  const button = (text, key, extraAttrs = {}) => {
    const b = build(doc, "button", "", text);
    attr(b, "type", "button");
    if (key) attr(b, "data-key", key);
    for (const [k, v] of Object.entries(extraAttrs)) attr(b, k, v);
    return b;
  };

  const sayLine = (l, { context = false } = {}) => {
    const li = build(doc, "li", "cr-say");
    // a context line is an ancestor shown for orientation: it is not one of the circle's own says, so it wears its own attribute
    if (context) attr(li, "data-context-say", isId(l.id) ? l.id : "");
    else if (isId(l.id)) attr(li, "data-say", l.id);
    else attr(li, "data-say-plain", "");
    const head = build(doc, "span", "cr-head-line");
    const who = build(doc, "span", "cr-who", l.handle);
    const when = build(doc, "span", "cr-time", ` ${dateTimeOf(l.at) || whenOf(l.at) || s(l.ago)}`);
    head.appendChild(who); head.appendChild(when);
    li.appendChild(head);
    li.appendChild(build(doc, "span", "cr-said", l.said));       // content: textContent, never markup
    if (replyOn && isId(l.id) && !context) {
      const r = button(W.reply, `reply-${l.id}`, { "data-reply": l.id, "aria-label": `${W.reply} to ${s(l.handle)}` });
      r.className = "cr-reply";
      r.addEventListener("click", () => { if (replyFn) replyFn({ id: l.id, handle: s(l.handle), said: s(l.said), at_ms: l.at_ms ?? null, circle: l.circle ?? null }); });
      li.appendChild(r);
    }
    return li;
  };

  const strandEl = (b) => {
    const ul = build(doc, "ul", "cr-lines cr-strand");
    attr(ul, "data-strand", "");
    if (b.loose) attr(ul, "data-loose", "");
    for (const l of b.lines) ul.appendChild(sayLine(l));
    if (b.loose) ul.appendChild(notice("broken", W.loose, { "data-loose-note": "" }));
    return ul;
  };
  const blocksEl = (blocks, container) => {
    for (const b of blocks) {
      if (b.type === "strand") container.appendChild(strandEl(b));
      else if (b.type === "plain") {
        const ul = build(doc, "ul", "cr-lines cr-strand");
        attr(ul, "data-timeline", "");
        for (const l of b.lines) ul.appendChild(sayLine(l));
        container.appendChild(ul);
      } else if (b.type === "fork") {
        const wrap = build(doc, "div", "cr-fork");
        attr(wrap, "data-fork", b.line?.id ?? "");
        blocksEl(b.children, wrap);
        container.appendChild(wrap);
      }
    }
  };

  const stubButton = (st) => {
    const li = build(doc, "li", "");
    const b = button("", `stub-${st.circle}`, { "data-circle-stub": "", "data-circle": st.circle });
    b.className = "cr-stub";
    b.appendChild(build(doc, "span", "cr-opener", `${st.handle ? `${st.handle}: ` : ""}${st.opener}`));
    b.appendChild(build(doc, "span", "cr-meta", metaLine([
      plural(st.says, "statement", "statements"), plural(st.people, "speaker", "speakers"),
      st.started ? `began ${dateTimeOf(st.started)}` : "", st.latest ? `latest ${dateTimeOf(st.latest)}` : "",
      st.under !== null ? `${plural(st.under, "say", "says")} folded here` : "",
    ])));
    if (st.read) b.addEventListener("click", () => showCircle(st.read.circle));
    li.appendChild(b);
    return li;
  };

  // ── the room view ──
  function drawRoom(m) {
    clear(root);
    const head = build(doc, "div", "cr-head");
    head.appendChild(build(doc, "h3", "cr-title", m.room.place || "This room"));
    const live = m.room.live ? "live" : "gone quiet";
    head.appendChild(build(doc, "div", "cr-meta", metaLine([
      m.room.id !== undefined ? live : "",
      m.summary ? `${plural(m.summary.says, "statement", "statements")} · ${plural(m.summary.people, "speaker", "speakers")} · ${plural(m.summary.topCircles, "top circle", "top circles")}` : "",
      m.room.started ? `began ${dateTimeOf(m.room.started)}` : "", m.room.latest ? `latest ${dateTimeOf(m.room.latest)}` : "",
    ])));
    root.appendChild(head);
    if (state.pending) root.appendChild(newButton());
    if (m.unavailable) {
      const n = notice("unavailable", m.note ? `${W.unavailable} ${m.note}` : W.unavailable);
      root.appendChild(n);
      root.appendChild(retryButton());
      setState("unavailable", { reason: "history" });
      return;
    }
    if (m.unknown) {
      root.appendChild(notice("unavailable", m.note ? `${W.unknown} ${m.note}` : W.unknown));
      root.appendChild(retryButton());
      setState("unavailable", { reason: "unknown" });
      return;
    }
    if (m.empty) { root.appendChild(notice("none", W.none)); setState("room", { empty: true }); return; }
    if (m.history === "folded" || m.timelineFolded) {
      root.appendChild(notice("folded", m.timelineFolded ? `${W.folded} (${plural(m.timelineFolded, "older line", "older lines")})` : W.folded));
    }
    // a signed-in default: the reader's own path first, exactly as served
    if (m.yours !== null && m.lines.length) {
      const sec = build(doc, "section", "cr-own");
      sec.appendChild(build(doc, "h4", "cr-title", W.yours));
      blocksEl(shapeLines(m.lines), sec);
      if (m.ownPath?.paged) {
        sec.appendChild(notice("paged", `${W.paged} ${plural(m.ownPath.shown, "line", "lines")} of ${m.ownPath.says} shown.`));
        if (m.ownPath.next && isId(m.ownPath.next.circle)) {
          const nb = button(W.more, `own-next`, { "data-next": "" });
          nb.addEventListener("click", () => showCircle(m.ownPath.next.circle, m.ownPath.next.after));
          sec.appendChild(nb);
        }
      }
      if (m.folded.length) {
        sec.appendChild(build(doc, "h4", "cr-meta", W.foldedBranch));
        const ul = build(doc, "ul", "cr-stubs");
        for (const st of m.folded) ul.appendChild(stubButton(st));
        sec.appendChild(ul);
      }
      root.appendChild(sec);
    }
    if (m.stubs.length) {
      root.appendChild(build(doc, "h4", "cr-title", m.yours !== null ? W.elsewhere : W.topCircles));
      const ul = build(doc, "ul", "cr-stubs");
      attr(ul, "data-stubs", "");
      for (const st of m.stubs) ul.appendChild(stubButton(st));
      root.appendChild(ul);
    }
    if (m.moreCircles.length) {
      const n = notice("folded", `${W.foldedMore} ${m.moreCircles.length}`, { "data-more-circles": m.moreCircles.join(",") });
      root.appendChild(n);
      const row = build(doc, "div", "cr-actions");
      for (const id of m.moreCircles) {
        const b = button(`circle ${id}`, `more-${id}`, { "data-circle-more": id });
        b.addEventListener("click", () => showCircle(id));
        row.appendChild(b);
      }
      root.appendChild(row);
    }
    for (const br of m.broken) root.appendChild(notice("broken", `${W.broken}: ${s(br.handle)} (say ${s(br.id)}). ${s(br.note)}`));
    if (m.timeline.length) {
      root.appendChild(build(doc, "h4", "cr-title", W.timeline));
      const ul = build(doc, "ul", "cr-lines cr-strand");
      attr(ul, "data-timeline", "");
      for (const l of m.timeline) ul.appendChild(sayLine(l));
      root.appendChild(ul);
    }
    setState("room", { stubs: m.stubs.length });
  }

  // ── the circle view ──
  function crumbsEl(models) {
    const first = models[0];
    const nav = build(doc, "nav", "cr-crumbs");
    attr(nav, "data-crumbs", "");
    attr(nav, "aria-label", "where you are in this room");
    const back = button(W.back, "back", { "data-back": "" });
    back.addEventListener("click", () => showRoom());
    nav.appendChild(back);
    nav.appendChild(build(doc, "span", "cr-sep", "›"));
    const roomCrumb = build(doc, "span", "cr-crumb", first.room.place || W.room);
    nav.appendChild(roomCrumb);
    const crumbs = first.crumbs;
    crumbs.forEach((c, i) => {
      nav.appendChild(build(doc, "span", "cr-sep", "›"));
      const last = i === crumbs.length - 1;
      if (last) {
        const cur = build(doc, "span", "cr-crumb", c.label);
        attr(cur, "aria-current", "page");
        attr(cur, "data-crumb", c.id);
        nav.appendChild(cur);
      } else {
        const b = button(c.label, `crumb-${c.id}`, { "data-crumb": c.id });
        b.addEventListener("click", () => showCircle(c.id));
        nav.appendChild(b);
      }
    });
    return nav;
  }
  function drawCircle(models) {
    clear(root);
    const first = models[0];
    root.appendChild(crumbsEl(models));
    if (first.unavailable) {
      root.appendChild(notice("unavailable", first.note ? `${W.unavailable} ${first.note}` : W.unavailable));
      root.appendChild(retryButton());
      setState("unavailable", { reason: "history" });
      return;
    }
    const head = build(doc, "div", "cr-head");
    const title = build(doc, "h3", "cr-title", first.crumbs.length ? first.crumbs[first.crumbs.length - 1].label : `Circle ${first.circle}`);
    attr(title, "tabindex", "-1");
    attr(title, "data-key", "circle-title");
    head.appendChild(title);
    head.appendChild(build(doc, "div", "cr-meta", metaLine([plural(first.says, "statement", "statements"), plural(first.people, "speaker", "speakers")])));
    if (hrefForCircle && hrefForCircle(first.circle)) {
      const a = build(doc, "a", "cr-meta", "link to this circle");
      attr(a, "href", hrefForCircle(first.circle));
      attr(a, "data-key", "permalink");           // a refresh redraws the view: the key is how focus on the link comes back
      head.appendChild(a);
    }
    root.appendChild(head);
    if (state.pending) root.appendChild(newButton());
    const known = new Set([...first.context.map((l) => l.id)]);
    if (first.context.length) {
      const ctx = build(doc, "div", "cr-context");
      attr(ctx, "data-context", "");
      ctx.appendChild(build(doc, "span", "cr-label", W.context));
      const ul = build(doc, "ul", "cr-lines");
      for (const l of first.context) ul.appendChild(sayLine(l, { context: true }));
      ctx.appendChild(ul);
      root.appendChild(ctx);
    }
    const all = models.flatMap((m) => m.lines);
    state.shown = new Set(all.filter((l) => isId(l.id)).map((l) => String(l.id)));
    const body = build(doc, "div", "cr-body");
    blocksEl(shapeLines(all, { known }), body);
    root.appendChild(body);
    const lastModel = models[models.length - 1];
    if (lastModel.next) {
      root.appendChild(notice("paged", W.paged));
      const nb = button(state.loadingMore ? "…" : W.more, "next", { "data-next": "" });
      nb.addEventListener("click", () => more());
      root.appendChild(nb);
    } else if (!all.length) {
      root.appendChild(notice("unavailable", W.noLines));
    } else if (lastModel.complete && lastModel.history !== "folded" && !models.some((m) => m.partial)) {
      root.appendChild(notice("complete", W.complete));
    }
    // the lines the office did serve stay on screen; an unavailable history is said aloud and never called the whole circle
    if (models.some((m) => m.partial)) root.appendChild(notice("unavailable", lastModel.note ? `${W.partial} ${lastModel.note}` : W.partial));
    if (lastModel.history === "folded") root.appendChild(notice("folded", lastModel.note || W.folded));
    if (first.memoryNote) root.appendChild(notice("folded", first.memoryNote));
    if (first.sparks) {
      const items = [...first.sparks.on.map((x) => ({ x, on: true })), ...first.sparks.below.map((x) => ({ x, on: false }))];
      if (items.length) {
        const sec = build(doc, "div", "cr-sparks");
        sec.appendChild(build(doc, "h4", "cr-title", W.sparks));
        const ul = build(doc, "ul", "cr-list");
        for (const { x, on } of items) {
          const li = build(doc, "li", "");
          attr(li, "data-spark", x.id ?? "");
          li.appendChild(build(doc, "span", "", `${s(x.body)}${x.credit?.by ? ` — ${s(x.credit.by)}` : ""}${on ? "" : " (deeper in this circle)"}`));
          ul.appendChild(li);
        }
        sec.appendChild(ul);
        root.appendChild(sec);
      }
    } else if (first.sparksNote) root.appendChild(notice("none", first.sparksNote));
    setState("circle", { circle: first.circle, pages: models.length });
  }

  function retryButton() {
    const r = button(W.retry, "retry", { "data-retry": "" });
    r.addEventListener("click", () => (state.view === "circle" ? showCircle(state.circleId) : showRoom()));
    return r;
  }
  function newButton() {
    const b = button(`${state.pending.count} ${W.newOne}`, "new", { "data-new": "" });
    b.className = "cr-new";
    b.addEventListener("click", () => applyPending());
    return b;
  }

  // ── reads ──
  // A read is refused when the office said so (`error`), when nothing answered, or when it answered in a shape that is not the circles
  // read (an office that does not serve `?room=` / `?circle=` yet answers the old list): that is "could not read", never "nothing here".
  const NOT_SERVED = "the office did not answer with the circles of this room";
  const refused = (answer, need) => {
    if (!answer || typeof answer !== "object" || answer.error) return true;
    const f = unwrap(answer);
    if (need === "room") return !(f.circles && typeof f.circles === "object");
    if (need === "circle") return !(f.circle_read && typeof f.circle_read === "object");
    return false;
  };
  const whyOf = (answer) => String(answer?.defect ?? answer?.error ?? (answer && typeof answer === "object" ? NOT_SERVED : ""));
  async function showRoom(id) {
    if (id !== undefined && id !== null) state.roomId = id;
    state.view = "room"; state.pending = null; state.pages = []; state.circleId = null;
    if (onNavigate) onNavigate({ view: "room", roomId: state.roomId });
    const mine = ++state.token;
    if (!state.roomModel) { clear(root); root.appendChild(build(doc, "p", "cr-quiet", W.loading)); setState("loading"); }
    let answer;
    try { answer = await source.room(state.roomId); } catch (e) { answer = { error: String(e?.message ?? e) }; }
    if (mine !== state.token) return;
    if (refused(answer, "room")) { return failed(whyOf(answer)); }
    state.roomModel = modelOfRoom(answer);
    drawRoom(state.roomModel);
    focusHeading();
  }
  async function showCircle(circleId, after) {
    state.view = "circle"; state.circleId = circleId; state.pending = null;
    if (onNavigate) onNavigate({ view: "circle", circleId });
    const mine = ++state.token;
    if (after === undefined) { state.pages = []; clear(root); root.appendChild(build(doc, "p", "cr-quiet", W.loading)); setState("loading"); }
    let answer;
    try { answer = await source.circle(circleId, after); } catch (e) { answer = { error: String(e?.message ?? e) }; }
    if (mine !== state.token) return;
    if (refused(answer, "circle")) return failed(whyOf(answer));
    const m = modelOfCircle(answer);
    if (after === undefined) state.pages = [m]; else state.pages.push(m);
    drawCircle(state.pages);
    focusHeading();
  }
  async function more() {
    const last = state.pages[state.pages.length - 1];
    if (!last?.next || state.loadingMore) return;
    state.loadingMore = true;
    const mine = state.token;            // a later navigation (another circle, Back, destroy) supersedes this answer
    const k = keep();
    let answer;
    try { answer = await source.circle(last.next.circle, last.next.after); } catch (e) { answer = { error: String(e?.message ?? e) }; }
    state.loadingMore = false;
    if (mine !== state.token) return;
    if (refused(answer, "circle")) { drawCircle(state.pages); root.appendChild(notice("unavailable", `${W.unavailable} ${whyOf(answer)}`.trim())); restore(k); return; }
    state.pages.push(modelOfCircle(answer));
    drawCircle(state.pages);
    restore(k);
  }
  function failed(why) {
    clear(root);
    if (state.view === "circle") root.appendChild(crumbsFallback());
    root.appendChild(notice("unavailable", why ? `${W.unavailable} (${why})` : W.unavailable));
    root.appendChild(retryButton());
    setState("unavailable", { reason: "read", why });
  }
  function crumbsFallback() {
    const nav = build(doc, "nav", "cr-crumbs");
    attr(nav, "data-crumbs", "");
    const back = button(W.back, "back", { "data-back": "" });
    back.addEventListener("click", () => showRoom());
    nav.appendChild(back);
    return nav;
  }
  function focusHeading() {
    const h = findByKey(root, "circle-title");
    if (h?.focus && state.view === "circle") h.focus();
  }

  // ── refresh: patch in place, keep the reader where they were, offer what is new ──
  async function refresh({ quiet = true } = {}) {
    // every answer below is bound to the navigation it was asked in: a poll that is slow while the visitor opens a circle, presses Back
    // or the host destroys the reader is dropped, never drawn over what they chose since
    const mine = state.token;
    if (state.view === "room") {
      let answer;
      try { answer = await source.room(state.roomId); } catch { return; }          // a failed background refresh leaves the last good view standing
      if (mine !== state.token) return;
      if (refused(answer, "room")) return;
      const next = modelOfRoom(answer);
      const oldIds = new Set((state.roomModel?.stubs ?? []).map((x) => String(x.circle)));
      const fresh = next.stubs.filter((x) => !oldIds.has(String(x.circle)));
      if (quiet && fresh.length && state.roomModel) {
        state.pending = { model: next, count: fresh.length };
        const k = keep(); drawRoom(state.roomModel); restore(k);                      // counts stay as they were; the button offers the new circles
        return;
      }
      state.roomModel = next;
      const k = keep(); drawRoom(next); restore(k);
      return;
    }
    // circle view: re-read the pages the reader holds, by the served continuations
    const pages = [];
    let answer;
    try { answer = await source.circle(state.circleId); } catch { return; }
    if (mine !== state.token) return;
    if (refused(answer, "circle")) return;
    pages.push(modelOfCircle(answer));
    for (let i = 1; i < state.pages.length && pages[i - 1].next; i++) {
      try { answer = await source.circle(pages[i - 1].next.circle, pages[i - 1].next.after); } catch { return; }
      if (mine !== state.token) return;
      if (refused(answer, "circle")) return;
      pages.push(modelOfCircle(answer));
    }
    const ids = pages.flatMap((p) => p.lines).filter((l) => isId(l.id)).map((l) => String(l.id));
    const fresh = ids.filter((id) => !state.shown.has(id));
    if (quiet && fresh.length) {
      state.pending = { pages, count: fresh.length };
      const k = keep(); drawCircle(state.pages); restore(k);       // scroll and focus are read when the view is redrawn, not before the wait
      return;
    }
    state.pages = pages;
    const k = keep(); drawCircle(pages); restore(k);
  }
  function applyPending() {
    const p = state.pending; state.pending = null;
    const k = keep();
    if (!p) return;
    if (state.view === "room") { state.roomModel = p.model; drawRoom(p.model); }
    else { state.pages = p.pages; drawCircle(p.pages); }
    restore(k);
  }

  function setReplyTarget(t) { state.replyTarget = t ?? null; }
  // The host learned something about the visitor (signed in, signed out) while the reader was open: the Reply buttons follow, and the view
  // is redrawn in place, keeping scroll and focus, never re-asked and never reset to the room.
  function setCanReply(on, handler) {
    if (handler !== undefined) replyFn = handler;
    const next = !!on;
    if (next === replyOn) return;
    replyOn = next;
    const shown = root.getAttribute("data-state");
    const k = keep();
    if (shown === "circle" && state.pages.length) drawCircle(state.pages);
    else if (shown === "room" && state.roomModel) drawRoom(state.roomModel);
    else return;
    restore(k);
  }
  function destroy() { state.token++; clear(root); if (root.parentElement) root.parentElement.removeChild(root); }

  return {
    root,
    showRoom, showCircle, refresh, setReplyTarget, setCanReply, destroy,
    getState: () => ({ view: state.view, roomId: state.roomId, circleId: state.circleId, pages: state.pages.length, pending: state.pending ? state.pending.count : 0, replyTarget: state.replyTarget }),
  };
}

/**
 * Convenience for a host that wants the reader and its stylesheet in one call (a scratch page, the site's adapter).
 * `host` must be inside `doc`; the style element is added once per document.
 */
export function mountCircleReader(opts) {
  const { doc } = opts;
  const head = doc.head ?? doc.documentElement ?? null;
  if (head && !(doc.getElementById?.("circle-reader-css"))) {
    const style = doc.createElement("style");
    style.setAttribute("id", "circle-reader-css");
    style.textContent = READER_CSS;
    head.appendChild(style);
  }
  const reader = createCircleReader(opts);
  reader.showRoom();
  return reader;
}
