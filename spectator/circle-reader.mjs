// circle-reader.mjs — THE ONE CIRCLE READER (CORE-82, CORE-70's rulings; drawn as a comment thread by WLD-178).
//
// One module, two habitats: the World's shared right-hand column (spectator/home-column.mjs hosts it) and the site's conversations
// page and event page (town/scripts/world-engine-island.mjs stages every non-test spectator module at
// /world-engine/spectator/<file>, and src/lib/circle-reader-mount.mjs there is an adapter only, never a second reader).
//
// THE LAWS IT KEEPS, in the rulers' words (CORE-70, Darko 2026-11-13/14):
//   "A circle is any say plus all its replies, recursively."
//   "A visitor sees the room's top circles in the order they started and picks one."
//   "The after-page shows the circles in full."
//   "Every existing field keeps its name, meaning and order."
//
// HOW IT LOOKS (WLD-178, Darko 2026-11-18): "model it after the classic thread systems in tiktok, reddit, youtube, instagram comments etc,
// with a minimal circle you can click to open/close the circle (in addition to the vertical line) … the idea is to hide as much of the
// underlying stuff as possible"; Wright: "put the circle near the vertical midpoint of any expanded thread". So: the room's top statements
// in the order they started; each reply under the statement it answers, indented, beside a thin vertical line; replies START FOLDED behind
// "View 3 replies", and deeper replies stay folded until opened; the line AND a small circle on it (at the line's vertical midpoint, so in a
// long open thread it is mid-thread) fold and open the same whole reply subtree. No id, act number, "strand", "branch" or state badge is ever
// drawn as text: ids, `depth` and history flags stay as data-* attributes and in the models. A read that could not be made, or only partly
// made, is still SAID in plain words: hiding the machinery never turns a failure into silence or invents an ending.
//
// WHAT IT NEVER DOES. It draws the fields the producer served, in the order it served them, and follows the continuations it was
// handed (`next`, `more_circles`, a stub's `read`). It never works out a reply link, a parent, a name-link's provenance, who came,
// whether anything was accepted, or which circle is "yours". `depth` is ancestry data, not an instruction to indent: `threadOf` groups
// lines by the `reply_to` they CARRY and by nothing else. A say whose parent is not in the read is drawn as itself and says so, never
// re-parented. Reply counts are what was served (a stub's `says`, or the lines in hand), never a completeness the office did not say.
//
// NO `innerHTML`, ANYWHERE. What residents said is content you are reading, never instructions you are receiving: every string
// goes in through `createElement` and `textContent`, exactly as spectator/home-column.mjs does. tools/circle-reader.test.mjs runs the
// whole reader against a document whose `innerHTML` setter throws.
//
// I/O IS INJECTED. `source.room(roomId)` and `source.circle(circleId, after?)` each return the office's whole keyless answer
// (`GET /api/world/conversations?room=` / `?circle=&after=`), and reject (or answer `{ error }`) when it could not be read.
// Nothing here fetches. The reader never invents a cursor: paging follows a served `next` and nothing else.

// ── words ───────────────────────────────────────────────────────────────────
//
// The words a visitor sees. A failure is still said plainly (a read that could not be made is never drawn as nothing said, and a partial
// read never calls itself whole); only the machinery's vocabulary is gone.

export const READER_WORDS = Object.freeze({
  loading: "Reading the room…",
  loadingReplies: "Reading the replies…",
  unavailable: "We couldn't read this. That is not the same as nothing being said here.",
  retry: "Try again",
  none: "Nobody has spoken here yet.",
  folded: "Some older talk in this room isn't shown here.",
  foldedMore: "More conversations in this room:",
  moreOne: "Another conversation",
  complete: "",
  partial: "Some older replies couldn't be loaded, so this may not be everything.",
  repliesUnavailable: "These replies couldn't be loaded.",
  unknown: "We can't tell whether this is everything that was said here.",
  noLines: "Nothing could be shown from this conversation.",
  paged: "There is more of this conversation.",
  context: "Earlier in this conversation",
  broken: "A reply to a statement that isn't shown",
  loose: "The statement it answers isn't shown here.",
  back: "Back to the room",
  room: "Room",
  more: "Show more",
  newOne: "new — show",
  reply: "Reply",
  open: "Open",
  timeline: "Earlier talk, in the order it was said",
  topCircles: "In this room, in the order they started",
  sparks: "Sparks",
  yours: "Yours",
  elsewhere: "Elsewhere in the room",
  foldedBranch: "More of yours",
  earlier: "an earlier statement",
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

/** The named back path: each id resolved against what the read holds (a line it carries, a stub it was handed); an id it cannot name is "an earlier statement" (the id stays in `id`, never as text). */
export function crumbsOf(path, known) {
  return arr(path).filter(isId).map((id) => {
    const hit = known.get(String(id));
    return { id, label: hit ? `${hit}'s statement` : READER_WORDS.earlier, named: !!hit };
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
 * Flat lines -> blocks, using ONLY the `reply_to` each line carries. (The reader no longer draws these; WLD-178 draws `threadOf`. The
 * grouping stays exported because the producer-side tooling and the lane's falsifier count lines through it.)
 *
 *   { type: 'strand', lines: [...], loose?: true }  a run of replies with no fork in it
 *   { type: 'fork', line, children: [block, ...] }   follows the strand that ends in `line`, when `line` has two or more replies
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

/**
 * WLD-178: flat lines -> a comment thread, using ONLY the `reply_to` each line carries (the same rule as shapeLines, drawn the way familiar
 * comment threads draw it).
 *
 *   roots   the statements with no parent in the set, in served order; each is `{ line, replies: [node…], total, loose? }`
 *   plain   lines with no `id` (old talk): a timeline, never a thread
 *
 * `replies` are the lines that answer `line`, in served order; `total` is how many statements sit under it, however deep (what "View 3 replies"
 * counts: only what was served, never a completeness the office did not say). A line whose `reply_to` is not among `lines` or `known` is a
 * `loose` root (never re-parented). Every line served appears in exactly one node (a cycle in served data places each leftover line as its
 * own loose root, so nothing is lost and nothing loops).
 *
 * @param {object[]} lines
 * @param {{ known?: Iterable<number|string> }} [opts]   ids that exist outside `lines` (context lines), so a reply to one is not loose
 */
export function threadOf(lines, { known = [] } = {}) {
  const all = arr(lines);
  const plain = all.filter((l) => !isId(l?.id));
  const withId = all.filter((l) => isId(l?.id));
  const byId = new Map(withId.map((l) => [String(l.id), l]));
  const outside = new Set([...known].map(String));
  const kids = new Map();
  const rootLines = [];
  for (const l of withId) {
    const p = isId(l.reply_to) ? String(l.reply_to) : null;
    if (p !== null && byId.has(p) && p !== String(l.id)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(l);
    } else rootLines.push({ line: l, loose: p !== null && !outside.has(p) });
  }
  const seen = new Set();
  const nodeOf = (line, loose) => {
    seen.add(String(line.id));
    const replies = [];
    for (const k of kids.get(String(line.id)) ?? []) if (!seen.has(String(k.id))) replies.push(nodeOf(k, false));
    return { line, replies, total: replies.reduce((n, r) => n + 1 + r.total, 0), ...(loose ? { loose: true } : {}) };
  };
  const roots = rootLines.filter((r) => !seen.has(String(r.line.id))).map((r) => nodeOf(r.line, r.loose));
  for (const l of withId) if (!seen.has(String(l.id))) roots.push(nodeOf(l, true));
  return { roots, plain };
}

/** Every statement the nodes carry, parents before their replies, in served order. */
export function linesOfThread(nodes) {
  const out = [];
  for (const n of arr(nodes)) { out.push(n.line); out.push(...linesOfThread(n.replies)); }
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
[data-circle-reader] .cr-strand { margin: 0 0 .7em; padding: 0; border-left: 3px solid var(--cr-rule, currentColor); padding-left: .7em; }
[data-circle-reader] .cr-say { margin: 0 0 .8em; overflow-wrap: anywhere; }
[data-circle-reader] .cr-say .cr-who { font-weight: 700; }
[data-circle-reader] .cr-say .cr-said { display: block; white-space: pre-wrap; }
[data-circle-reader] .cr-reply, [data-circle-reader] .cr-open { margin: .15em .5em 0 0; padding: .1em .5em; min-height: 0; font-size: .82em; }
[data-circle-reader] .cr-open { border-color: transparent; text-decoration: underline; opacity: .8; }
[data-circle-reader] .cr-replies { list-style: none; margin: 0; padding: 0; }
/* THE THREAD (WLD-178): replies sit under the statement they answer, indented, beside a thin line. The line is one wide, quiet button (it
   folds and opens the whole reply subtree) and the circle is a second one sitting ON the line at its vertical midpoint (top: 50% of the
   thread's own height, so in a long open thread it is mid-thread, never pinned beside the first reply). The line is drawn in two pieces
   so the circle needs no background of the host's: the gap in the middle is the circle's own room. */
[data-circle-reader] .cr-thread { position: relative; margin: .4em 0 0; padding-left: 1.9em; min-height: 2.1em; }
[data-circle-reader] .cr-thread > .cr-line { position: absolute; left: 0; top: 0; bottom: 0; width: 1.5em; min-height: 0; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: pointer; }
[data-circle-reader] .cr-thread > .cr-line::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); opacity: .42; border-radius: 1px;
  background: linear-gradient(to bottom, var(--cr-rule, currentColor) 0, var(--cr-rule, currentColor) calc(50% - .75em), transparent calc(50% - .75em), transparent calc(50% + .75em), var(--cr-rule, currentColor) calc(50% + .75em), var(--cr-rule, currentColor) 100%); }
[data-circle-reader] .cr-thread > .cr-line:hover::before { opacity: .85; }
[data-circle-reader] .cr-thread > .cr-line:hover { background: transparent; }
[data-circle-reader] .cr-thread > .cr-dot { position: absolute; left: .75em; top: 50%; width: 1.1em; height: 1.1em; min-height: 0; padding: 0; border: 2px solid var(--cr-rule, currentColor); border-radius: 50%; background: transparent; transform: translate(-50%, -50%); opacity: .8; cursor: pointer; }
[data-circle-reader] .cr-thread > .cr-dot:hover { opacity: 1; background: color-mix(in srgb, currentColor 18%, transparent); }
[data-circle-reader] .cr-thread[data-open="false"] > .cr-dot { background: color-mix(in srgb, currentColor 22%, transparent); }
[data-circle-reader] .cr-thread > .cr-line:focus-visible, [data-circle-reader] .cr-thread > .cr-dot:focus-visible { outline: 2px solid var(--cr-accent, currentColor); outline-offset: 2px; opacity: 1; }
[data-circle-reader] .cr-thread > .cr-view { display: block; margin: 0; padding: .35em .2em; min-height: 2.1em; border: 0; background: transparent; text-align: left; font-size: .9em; font-weight: 600; opacity: .9; }
[data-circle-reader] .cr-thread > .cr-view:hover { text-decoration: underline; background: transparent; }
[data-circle-reader] .cr-thread-note { margin: .3em 0; font-size: .9em; }
[data-circle-reader] .cr-context { margin: 0 0 .7em; padding: .4em .6em; border: 1px dashed var(--cr-rule, currentColor); border-radius: 4px; opacity: .92; }
[data-circle-reader] .cr-context .cr-label { display: block; font-size: .82em; opacity: .85; margin-bottom: .25em; }
[data-circle-reader] .cr-notice { margin: .5em 0; padding: .4em .6em; border-left: 3px solid var(--cr-accent, currentColor); font-size: .92em; overflow-wrap: anywhere; }
[data-circle-reader] .cr-notice[data-notice="unavailable"] { border-left-style: double; border-left-width: 5px; }
[data-circle-reader] .cr-actions { display: flex; flex-wrap: wrap; gap: .4em; margin: .5em 0; }
[data-circle-reader] .cr-new { margin: 0 0 .6em; }
[data-circle-reader] a { color: inherit; text-decoration: underline; }
[data-circle-reader] a:focus-visible { outline: 2px solid var(--cr-accent, currentColor); outline-offset: 2px; }
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

let READER_UID = 0;

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
  const uid = ++READER_UID;
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
    open: new Set(),         // the threads the visitor has opened (a statement's replies); everything starts folded, and a refresh keeps these
    loaded: new Map(),       // room view: a top statement's circle read, by circle id -> { pages: [model…] }, once its replies were asked for
    loading: new Set(),      // circle ids whose replies are being read now
    failed: new Map(),       // circle id -> why its replies could not be read
    shownRoom: new Set(),    // room view: ids of the loaded statements on screen, to tell new ones from old
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
  /** redraw whichever view is up, in place: scroll and focus come back, nothing is re-read */
  const redraw = (k = keep()) => {
    if (state.view === "circle" && state.pages.length) drawCircle(state.pages);
    else if (state.view === "room" && state.roomModel) drawRoom(state.roomModel);
    else return;
    restore(k);
  };

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

  // ── the thread ──

  /** one statement: who, when, what, a Reply; its replies (the `thread` element) are appended by the caller */
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
    if (replyOn && isId(l.id) && !context) li.appendChild(replyButton({ id: l.id, handle: s(l.handle), said: s(l.said), at_ms: l.at_ms ?? null, circle: l.circle ?? null }));
    return li;
  };
  const replyButton = (target) => {
    const r = button(W.reply, `reply-${target.id}`, { "data-reply": target.id, "aria-label": `${W.reply} to ${s(target.handle)}` });
    r.className = "cr-reply";
    r.addEventListener("click", () => { if (replyFn) replyFn(target); });
    return r;
  };

  const repliesWord = (n) => plural(n, "reply", "replies");
  /**
   * The thread under a statement: a thin line and a small circle on it, both of which fold and open the whole reply subtree; a "View 3
   * replies" text while folded. `kids` is the replies' content (an array of nodes already built, or null while they are not in hand),
   * `status` is 'loading' | 'failed' | null for replies that must be read first.
   */
  const threadEl = ({ key, count, nodes, status, why, onOpen, onRetry, more }) => {
    const open = state.open.has(key);
    const id = `cr${uid}-${key}`;
    const wrap = build(doc, "div", "cr-thread");
    attr(wrap, "data-thread", key);
    attr(wrap, "data-open", open ? "true" : "false");
    const label = `${open ? "Hide" : "View"} ${repliesWord(count)}`;
    const toggle = () => {
      const k = keep();
      if (state.open.has(key)) state.open.delete(key); else { state.open.add(key); if (onOpen) onOpen(); }
      // the "View" text is gone once open: focus follows to the circle, which is on the line in both states
      if (/^view-/.test(k.focus ?? "")) k.focus = `dot-${key}`;
      redraw(k);
    };
    const controls = { "aria-expanded": open ? "true" : "false", "aria-controls": id, "aria-label": label, title: label };
    const line = button("", `line-${key}`, { "data-thread-line": "", ...controls });
    line.className = "cr-line";
    line.addEventListener("click", toggle);
    const dot = button("", `dot-${key}`, { "data-thread-dot": "", ...controls });
    dot.className = "cr-dot";
    dot.addEventListener("click", toggle);
    wrap.appendChild(line);
    wrap.appendChild(dot);
    if (!open) {
      const view = button(`View ${repliesWord(count)}`, `view-${key}`, { "data-thread-view": "", ...controls });
      view.className = "cr-view";
      view.addEventListener("click", toggle);
      wrap.appendChild(view);
    }
    const list = build(doc, "ul", "cr-replies");
    attr(list, "id", id);
    if (!open) attr(list, "hidden", "");
    else {
      if (status === "loading") list.appendChild(build(doc, "li", "cr-quiet cr-thread-note", W.loadingReplies));
      else if (status === "failed") {
        const li = build(doc, "li", "cr-thread-note");
        li.appendChild(notice("unavailable", why ? `${W.repliesUnavailable} (${why})` : W.repliesUnavailable));
        const r = button(W.retry, `retry-${key}`, { "data-retry-replies": "" });
        r.addEventListener("click", () => { if (onRetry) onRetry(); });
        li.appendChild(r);
        list.appendChild(li);
      } else for (const n of nodes ?? []) list.appendChild(n);
      if (more) list.appendChild(more);
    }
    wrap.appendChild(list);
    return wrap;
  };

  /** the nodes of a reply thread as statements, each with its own folded thread beneath it */
  const nodeEls = (nodes) => nodes.map((node) => {
    const li = sayLine(node.line);
    if (node.loose) { attr(li, "data-loose", ""); li.appendChild(notice("broken", W.loose, { "data-loose-note": "" })); }
    if (node.replies.length) li.appendChild(threadEl({ key: `t-${node.line.id}`, count: node.total, nodes: nodeEls(node.replies) }));
    return li;
  });

  /** old talk (lines with no id): a plain timeline, never a thread */
  const timelineEl = (lines) => {
    const ul = build(doc, "ul", "cr-lines cr-strand");
    attr(ul, "data-timeline", "");
    for (const l of lines) ul.appendChild(sayLine(l));
    return ul;
  };

  /** a thread of served lines (the circle view's, or the reader's own path): top statements, replies folded under each */
  const threadListEl = (lines, known = []) => {
    const t = threadOf(lines, { known });
    const ul = build(doc, "ul", "cr-lines cr-list");
    attr(ul, "data-thread-list", "");
    for (const li of nodeEls(t.roots)) ul.appendChild(li);
    return { el: ul, plain: t.plain };
  };

  // ── a top statement in the room view, whose replies are read when it is opened ──
  const stubStatement = (st) => {
    const circle = st.read?.circle ?? st.circle;
    const li = build(doc, "li", "cr-say");
    attr(li, "data-say", isId(st.circle) ? st.circle : "");
    attr(li, "data-circle-stub", "");
    attr(li, "data-circle", st.circle);
    const head = build(doc, "span", "cr-head-line");
    head.appendChild(build(doc, "span", "cr-who", st.handle));
    head.appendChild(build(doc, "span", "cr-time", ` ${dateTimeOf(st.started) || whenOf(st.started)}`));
    li.appendChild(head);
    li.appendChild(build(doc, "span", "cr-said", st.opener));
    if (replyOn && isId(st.circle)) li.appendChild(replyButton({ id: st.circle, handle: st.handle, said: st.opener, at_ms: null, circle: st.circle }));
    // a conversation can still be opened on its own, with its named way back (the circle view, and the host's permalink for it)
    if (st.read) {
      const o = button(W.open, `open-${circle}`, { "data-circle-open": circle, "aria-label": `${W.open} ${s(st.handle)}'s conversation` });
      o.className = "cr-open";
      o.addEventListener("click", () => showCircle(circle));
      li.appendChild(o);
    }
    const replies = Math.max(0, st.says - 1);
    if (replies > 0 && st.read) {
      const id = String(circle);
      const held = state.loaded.get(id);
      let nodes = null;
      let more = null;
      if (held) {
        const all = held.pages.flatMap((p) => p.lines);
        const t = threadOf(all, { known: held.pages[0]?.context?.map((l) => l.id) ?? [] });
        const root = t.roots.find((r) => String(r.line.id) === id);
        nodes = nodeEls(root ? root.replies : t.roots);
        const last = held.pages[held.pages.length - 1];
        if (last?.next) {
          const mb = button(held.loadingMore ? "…" : W.more, `more-${id}`, { "data-next": "" });
          mb.addEventListener("click", () => moreStub(id));
          more = mb;
        }
      }
      const status = state.loading.has(id) ? "loading" : state.failed.has(id) ? "failed" : held ? null : "loading";
      li.appendChild(threadEl({
        key: `s-${circle}`, count: replies, nodes, status, why: state.failed.get(id),
        onOpen: () => { if (!state.loaded.has(id) && !state.loading.has(id)) loadStub(circle); },
        onRetry: () => { state.failed.delete(id); loadStub(circle); redraw(); },
        more,
      }));
    }
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
      m.summary ? `${plural(m.summary.says, "statement", "statements")} · ${plural(m.summary.people, "speaker", "speakers")}` : "",
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
      sec.appendChild(threadListEl(m.lines).el);
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
        const ul = build(doc, "ul", "cr-stubs cr-list");
        for (const st of m.folded) ul.appendChild(stubStatement(st));
        sec.appendChild(ul);
      }
      root.appendChild(sec);
    }
    if (m.stubs.length) {
      root.appendChild(build(doc, "h4", "cr-title", m.yours !== null ? W.elsewhere : W.topCircles));
      const ul = build(doc, "ul", "cr-stubs cr-list");
      attr(ul, "data-stubs", "");
      for (const st of m.stubs) ul.appendChild(stubStatement(st));
      root.appendChild(ul);
    }
    if (m.moreCircles.length) {
      const n = notice("folded", W.foldedMore, { "data-more-circles": m.moreCircles.join(",") });
      root.appendChild(n);
      const row = build(doc, "div", "cr-actions");
      m.moreCircles.forEach((id, i) => {
        const b = button(W.moreOne, `more-${id}`, { "data-circle-more": id, "aria-label": `${W.moreOne} (${i + 1} of ${m.moreCircles.length})` });
        b.addEventListener("click", () => showCircle(id));
        row.appendChild(b);
      });
      root.appendChild(row);
    }
    for (const br of m.broken) root.appendChild(notice("broken", `${W.broken}: ${s(br.handle)}. ${s(br.note)}`.trim()));
    if (m.timeline.length) {
      root.appendChild(build(doc, "h4", "cr-title", W.timeline));
      root.appendChild(timelineEl(m.timeline));
    }
    state.shownRoom = new Set([...state.loaded.values()].flatMap((h) => h.pages.flatMap((p) => p.lines)).filter((l) => isId(l.id)).map((l) => String(l.id)));
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
    const title = build(doc, "h3", "cr-title", first.crumbs.length ? first.crumbs[first.crumbs.length - 1].label : (first.room.place || W.room));
    attr(title, "tabindex", "-1");
    attr(title, "data-key", "circle-title");
    head.appendChild(title);
    head.appendChild(build(doc, "div", "cr-meta", metaLine([plural(first.says, "statement", "statements"), plural(first.people, "speaker", "speakers")])));
    if (hrefForCircle && hrefForCircle(first.circle)) {
      const a = build(doc, "a", "cr-meta", "link to this conversation");
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
    const listed = threadListEl(all, known);
    body.appendChild(listed.el);
    if (listed.plain.length) body.appendChild(timelineEl(listed.plain));
    root.appendChild(body);
    const lastModel = models[models.length - 1];
    if (lastModel.next) {
      root.appendChild(notice("paged", W.paged));
      const nb = button(state.loadingMore ? "…" : W.more, "next", { "data-next": "" });
      nb.addEventListener("click", () => more());
      root.appendChild(nb);
    } else if (!all.length) {
      root.appendChild(notice("unavailable", W.noLines));
    } else if (W.complete && lastModel.complete && lastModel.history !== "folded" && !models.some((m) => m.partial)) {
      root.appendChild(notice("complete", W.complete));   // a host may bring words back (labels.complete); by default a whole thread says nothing
    }
    // the lines the office did serve stay on screen; a history that could not be read is said aloud and never called everything
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
          li.appendChild(build(doc, "span", "", `${s(x.body)}${x.credit?.by ? ` — ${s(x.credit.by)}` : ""}${on ? "" : " (deeper in this conversation)"}`));
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
  // the room view: a top statement's replies are read when the visitor opens them (the stub's own served `read`), and kept for every redraw after
  async function loadStub(circle) {
    const id = String(circle);
    state.loading.add(id); state.failed.delete(id);
    const mine = state.token;
    let answer;
    try { answer = await source.circle(circle); } catch (e) { answer = { error: String(e?.message ?? e) }; }
    state.loading.delete(id);
    if (mine !== state.token || state.view !== "room") return;    // a later navigation (Back, a circle, destroy) supersedes this answer
    if (refused(answer, "circle")) state.failed.set(id, whyOf(answer));
    else state.loaded.set(id, { pages: [modelOfCircle(answer)] });
    redraw();
  }
  async function moreStub(id) {
    const held = state.loaded.get(id);
    const last = held?.pages[held.pages.length - 1];
    if (!last?.next || held.loadingMore) return;
    held.loadingMore = true;
    const mine = state.token;
    const k = keep();
    let answer;
    try { answer = await source.circle(last.next.circle, last.next.after); } catch (e) { answer = { error: String(e?.message ?? e) }; }
    held.loadingMore = false;
    if (mine !== state.token || state.view !== "room") return;
    if (refused(answer, "circle")) { state.failed.set(id, whyOf(answer)); redraw(k); return; }
    held.pages.push(modelOfCircle(answer));
    redraw(k);
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
      // the replies the visitor opened are read again too (their first page and the pages they have already asked for), so what they see stays current
      const reread = new Map();
      for (const [id, held] of state.loaded) {
        if (!state.open.has(`s-${id}`)) { reread.set(id, held); continue; }       // nothing on screen to patch: kept as it was
        const pages = [];
        let a;
        try { a = await source.circle(id); } catch { reread.set(id, held); continue; }
        if (mine !== state.token) return;
        if (refused(a, "circle")) { reread.set(id, held); continue; }              // a failed background read leaves what was shown standing
        pages.push(modelOfCircle(a));
        for (let i = 1; i < held.pages.length && pages[i - 1].next; i++) {
          try { a = await source.circle(pages[i - 1].next.circle, pages[i - 1].next.after); } catch { break; }
          if (mine !== state.token) return;
          if (refused(a, "circle")) break;
          pages.push(modelOfCircle(a));
        }
        reread.set(id, { pages });
      }
      const oldIds = new Set((state.roomModel?.stubs ?? []).map((x) => String(x.circle)));
      const freshStubs = next.stubs.filter((x) => !oldIds.has(String(x.circle)));
      const freshLines = [...reread.values()].flatMap((h) => h.pages.flatMap((p) => p.lines)).filter((l) => isId(l.id) && !state.shownRoom.has(String(l.id)));
      const fresh = freshStubs.length + freshLines.length;
      if (quiet && fresh && state.roomModel) {
        state.pending = { model: next, count: fresh, loaded: reread };
        const k = keep(); drawRoom(state.roomModel); restore(k);                      // counts stay as they were; the button offers what is new
        return;
      }
      state.roomModel = next;
      state.loaded = reread;
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
    if (state.view === "room") { state.roomModel = p.model; if (p.loaded) state.loaded = p.loaded; drawRoom(p.model); }
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
