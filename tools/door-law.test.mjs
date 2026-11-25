// door-law.test.mjs — WLD-253 (CORE-129 layer 1): doors are the town's by default.   node --test tools/door-law.test.mjs
//
// The ruling (Darko, 2026-11-25): "the first layer we need to implement is the enforcement, which means whatever rule that we forgot to include
// that makes doors not instantiable by default by residents, we need to build first." `entry` stays sovereign; `entry.into` and
// `entry.lands_at` are constitution-tier; the 44 doors that stood at World main ce368dbb are grandfathered BY NAME (Darko, 11-24 19:28 EST).
//
// Two questions, kept apart (Bevel, 11-25 19:29Z): MAY THIS DOOR STAND (`doorStanding`: the lint, the gate, the passage) reads presence and
// the name; MAY THIS WRITE BE MADE (`entryWriteVerdict`: the office's leave-mark and amend, POS-1238) reads the actor and the entry before and
// after. These are the falsifiers: drop the gate, widen the list, or let a write slip through an alias, and a test here goes red by name.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  DOOR_CHILDREN, DOOR_CHILD_PROPERTIES, DOOR_LAW, GRANDFATHERED_DOORS, isGrandfatheredDoor,
  doorChildrenOf, doorStanding, doorRefusal, entryWriteVerdict,
} from "./door-law.mjs";
import { loadMarks } from "./marks-fold.mjs";
import { propertyAt } from "./class-properties.mjs";
import { enter } from "./world-verbs.mjs";
import { landingOf } from "./portals.mjs";
import { entryLawOf } from "./enter-exit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKS_DIR = join(HERE, "..", "WORLD", "marks");
const REAL = join(MARKS_DIR, "let-there-be-light");
const LINT = join(HERE, "mark-lint.mjs");
const SCRATCH = [];
after(() => { for (const d of SCRATCH) rmSync(d, { recursive: true, force: true }); });

const TOWN = "the-town";
const LISTED = "little-bird/a-ring-in-the-pantry"; // one of the 44, a resident's
const door = (id, by, entry) => ({ id, kind: "sited", by, at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, body: id, entry });

// ── the graph ────────────────────────────────────────────────────────────────

test("THE GRAPH: entry stays sovereign; entry.into and entry.lands_at are constitution-tier, for every class that can carry a door", () => {
  const live = loadMarks(MARKS_DIR);
  for (const cls of ["mark", "sited", "thing", "stairs", "portal-ground", "dungeon"]) {
    assert.equal(propertyAt(live, cls, ["entry"])?.tier, "sovereign", `${cls}: entry`);
    for (const child of DOOR_CHILDREN) {
      const p = propertyAt(live, cls, ["entry", child]);
      assert.equal(p?.tier, "constitution", `${cls}: entry.${child}`);
      assert.equal(p.node.id, DOOR_CHILD_PROPERTIES[child], `${cls}: entry.${child} is declared by its own record`);
    }
  }
});

// ── the 44 ───────────────────────────────────────────────────────────────────

// The census itself (the live doors at World main ce368dbb are exactly these 44) is the dry run's, at that named ref; the PR carries it. Here:
// the list's shape, that every resident door in the tree today is on it, and that LOGOS names the same 44. A grandfathered door taken away,
// or a new town door, is lawful and leaves these green.
test("THE 44: the list is 3 + 41 distinct names; every resident door in the live tree is on it, and stands; LOGOS names the same 44", () => {
  assert.equal(GRANDFATHERED_DOORS.length, 44);
  assert.equal(new Set(GRANDFATHERED_DOORS).size, 44, "no name twice");
  assert.equal(GRANDFATHERED_DOORS.filter((id) => id.startsWith("little-bird/")).length, 3);
  assert.equal(GRANDFATHERED_DOORS.filter((id) => id.startsWith("wright/")).length, 41);
  const live = loadMarks(MARKS_DIR).filter((m) => m && !m._error);
  const residents = live.filter((m) => doorStanding(m).door && m.by !== TOWN).map((m) => m.id);
  assert.ok(residents.length > 0, "the instrument sees the tree's doors");
  assert.deepEqual(residents.filter((id) => !isGrandfatheredDoor(id)), [], "no resident door off the list");
  assert.deepEqual(live.filter((m) => doorRefusal(m)).map((m) => m.id), [], "no live door is refused");
  const logos = readFileSync(join(HERE, "..", "LOGOS", "classes.md"), "utf8");
  const line = logos.slice(logos.indexOf("- **Doors are the town's"), logos.indexOf("tools/door-law.mjs", logos.indexOf("- **Doors are the town's")));
  const named = [...line.matchAll(/`((?:little-bird|wright)\/[a-z0-9-]+)`/g)].map((m) => m[1]).sort();
  assert.deepEqual(named, [...GRANDFATHERED_DOORS].sort(), "the law line names the same 44");
});

// ── may this door stand ──────────────────────────────────────────────────────

test("STANDING: the town's door, and one of the 44 by name whoever made it, stand; a 45th door and a prefix lookalike do not", () => {
  const into = { word: "neutral", into: "g/room" };
  assert.deepEqual(doorStanding(door("g/town-door", TOWN, into)), { door: true, allowed: true, why: "town" });
  assert.deepEqual(doorStanding(door(LISTED, "little-bird", into)), { door: true, allowed: true, why: "grandfathered" });
  for (const id of ["little-bird/a-new-door", "little-bird/a-ring-in-the-pantry-2", "little-bird/a-ring-in-the-pantr", "wright/spire-new-wing",
                    "Little-Bird/a-ring-in-the-pantry", " little-bird/a-ring-in-the-pantry"]) {
    assert.deepEqual(doorStanding(door(id, "little-bird", into)), { door: true, allowed: false, why: "not-the-towns", changed: ["into"] }, id);
    assert.equal(isGrandfatheredDoor(id), false, id);
  }
  // the grandfathering is the name, not who made it or where it leads: a door the town re-aims still stands
  assert.equal(doorStanding(door(LISTED, "little-bird", { word: "neutral", into: "somewhere/else", lands_at: { x: 1, y: 2 } })).allowed, true);
});

test("STANDING: presence, not truth: null, \"\" and [] are written children, and every spelling of one is the child", () => {
  for (const entry of [{ into: null }, { into: "" }, { into: [] }, { lands_at: null }, { Into: "g/room" }, { INTO: "g/room" },
                       { "lands-at": "g/x" }, { landsAt: "g/x" }, { LANDS_AT: { x: 1, y: 1 } }]) {
    const s = doorStanding(door("g/d", "rena", { word: "neutral", ...entry }));
    assert.equal(s.door, true, JSON.stringify(entry));
    assert.equal(s.allowed, false, JSON.stringify(entry));
  }
  // not a child: an entry with its word and terms only, or a key that merely contains the word
  for (const entry of [{ word: "welcomed" }, { word: "neutral", terms: "pay at the door", requires: { holds: ["k"] } }, { intoit: "g/x" }, { lands: "g/x" }])
    assert.deepEqual(doorStanding(door("g/d", "rena", entry)), { door: false, allowed: true, why: "not-a-door" }, JSON.stringify(entry));
});

test("STANDING: a stairs that writes no entry is no door and stands; an admin's stairs that writes its own into is a door and does not", () => {
  const stair = { id: "home/the-stair", kind: "stairs", by: "home", at: { x: 0, y: 0 }, extent: { w: 2, h: 4 }, body: "A stair." };
  assert.deepEqual(doorStanding(stair), { door: false, allowed: true, why: "not-a-door" }, "its class's default into is not an authored door");
  assert.equal(doorRefusal(stair), null);
  // WLD-21: an admin household may make a stairs; making one is not the right to set where it leads
  const adminStair = { ...stair, by: "wright", entry: { word: "neutral", into: "home/landing" } };
  assert.deepEqual(doorStanding(adminStair), { door: true, allowed: false, why: "not-the-towns", changed: ["into"] });
  const r = doorRefusal(adminStair);
  assert.match(r.words, /^home\/the-stair writes entry\.into, and it is not the town's or one of the 44 grandfathered doors — /);
  assert.ok(r.words.endsWith(DOOR_LAW));
});

// ── may this write be made ───────────────────────────────────────────────────

test("WRITE: a resident's welcome-only change passes, on a grandfathered door too; creating, changing, removing or re-spelling a child does not", () => {
  const was = { word: "neutral", into: "g/room", lands_at: "g/mat" };
  const v = (before, after, by = "little-bird") => entryWriteVerdict({ by, before, after });
  assert.deepEqual(v(was, { ...was, word: "welcomed", terms: "wipe your feet" }), { allowed: true, why: "no-door-change" });
  assert.deepEqual(v(null, { word: "welcomed" }), { allowed: true, why: "no-door-change" }, "an entry with no children, new");
  assert.deepEqual(v(was, { lands_at: "g/mat", word: "neutral", into: ["g/room"] }), { allowed: true, why: "no-door-change" }, "the same into, written as a list of one");
  const refused = (before, after, changed, why) => {
    const r = v(before, after);
    assert.equal(r.allowed, false, why);
    assert.equal(r.why, "door-child-change", why);
    assert.deepEqual(r.changed, changed, why);
    assert.ok(r.words.startsWith(`${changed.map((c) => `entry.${c}`).join(" and ")}: `) && r.words.endsWith(DOOR_LAW), why);
  };
  refused(null, { word: "neutral", into: "g/room" }, ["into"], "create into");
  refused({ word: "neutral" }, { word: "neutral", lands_at: { x: 1, y: 1 } }, ["lands_at"], "create lands_at");
  refused(was, { ...was, into: "g/elsewhere" }, ["into"], "change into");
  refused(was, { ...was, lands_at: { x: 3, y: 3 } }, ["lands_at"], "change lands_at");
  refused(was, { word: "neutral", into: "g/room" }, ["lands_at"], "remove lands_at");
  refused(was, { word: "neutral" }, ["into", "lands_at"], "remove both");
  refused(was, null, ["into", "lands_at"], "remove the entry");
  refused(was, { ...was, into: null }, ["into"], "into written as null");
  refused({ word: "neutral", into: "g/room" }, { word: "neutral", Into: "g/room" }, ["into"], "re-spell into");
  refused({ word: "neutral", lands_at: "g/mat" }, { word: "neutral", "lands-at": "g/mat" }, ["lands_at"], "re-spell lands_at");
});

test("WRITE: every recognised spelling is compared, not only the first (Bevel 19:33Z): an alias added beside the child is a write", () => {
  const v = (before, after) => entryWriteVerdict({ by: "rena", before, after });
  // the counterexample at c559b05a: the extra spelling was dropped, so this compared equal and was allowed
  assert.deepEqual(v({ into: "A" }, { into: "A", Into: "B" }).changed, ["into"]);
  assert.equal(v({ into: "A" }, { into: "A", Into: "B" }).allowed, false);
  assert.equal(v({ into: "A" }, { into: "A", Into: "A" }).allowed, false, "a second spelling, even of the same value, is a new write");
  assert.equal(v({ into: "A", Into: "B" }, { into: "A" }).allowed, false, "and dropping one is a removal");
  assert.equal(v({ into: "A", Into: "B" }, { into: "A", Into: "C" }).allowed, false, "a change to the alias's value is a change");
  assert.equal(v({ lands_at: "x" }, { lands_at: "x", "lands-at": "y" }).allowed, false);
  assert.equal(v({ lands_at: "x" }, { lands_at: "x", landsAt: "x" }).allowed, false);
  // the same spellings and values in another order are the same entry
  assert.deepEqual(v({ into: "A", Into: "B", word: "neutral" }, { word: "welcomed", Into: "B", into: "A" }), { allowed: true, why: "no-door-change" });
  assert.deepEqual(Object.keys(doorChildrenOf({ into: "A", Into: "B", INTO: "C" }).into.spellings).sort(), ["INTO", "Into", "into"]);
});

test("WRITE: the town may; WLD-21's admin classes grant no door write; an actor not read is null, never a yes", () => {
  const before = { word: "neutral", into: "g/room" }, after = { word: "neutral", into: "g/hall", lands_at: { x: 1, y: 1 } };
  assert.deepEqual(entryWriteVerdict({ by: TOWN, before, after }), { allowed: true, why: "town" });
  assert.deepEqual(entryWriteVerdict({ by: TOWN, before: null, after }), { allowed: true, why: "town" });
  for (const admin of ["wright", "jetto"]) assert.equal(entryWriteVerdict({ by: admin, before, after }).allowed, false, admin);
  for (const by of [undefined, null, "", 7, {}]) assert.deepEqual(entryWriteVerdict({ by, before, after }), { allowed: null, why: "actor-unread" }, String(by));
  assert.deepEqual(entryWriteVerdict(), { allowed: null, why: "actor-unread" });
  // grandfathered is permission to stand, never to write: the write question does not read the id at all
  assert.equal(entryWriteVerdict({ by: "little-bird", before, after }).allowed, false);
});

// ── the passage ──────────────────────────────────────────────────────────────

function passageWorld(extra) {
  return { marks: [
    { id: "g/grounds", kind: "sited", by: "g", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "The grounds." },
    { id: "g/room", kind: "sited", by: "g", at: { x: 100, y: 0 }, extent: { w: 40, h: 40 }, body: "A room." },
    { ...door("g/x", "g", { word: "neutral", into: "g/room" }), at: { x: 10, y: 0 } },
    ...extra.map((m) => ({ ...m, at: { x: 10, y: 0 } })),
  ] };
}
const occ = new Map([["ann", ["g/grounds"]]]);
const AT = { x: 10, y: 0, name: "ann" };

test("PASSAGE: an unlisted resident door is refused by name, nothing entered; the town's door and a grandfathered one pass", () => {
  const into = { word: "neutral", into: "g/room" };
  const resident = door("little-bird/a-new-door", "little-bird", into);
  const r = enter(AT, resident.id, passageWorld([resident]), { occupancy: occ, handle: "ann" });
  assert.equal(r.refused, "door-law");
  assert.equal(r.door, resident.id);
  assert.deepEqual(r.changed, ["into"]);
  assert.match(r.error, /^little-bird\/a-new-door writes entry\.into, and it is not the town's or one of the 44 grandfathered doors — entry\.into and entry\.lands_at are the town's to set/);
  assert.equal(r.entered, undefined);
  for (const lawful of [door("g/town-door", TOWN, into), door(LISTED, "little-bird", into)]) {
    const a = enter(AT, lawful.id, passageWorld([lawful]), { occupancy: occ, handle: "ann" });
    assert.equal(a.error, undefined, `${lawful.id}: ${a.error}`);
    assert.deepEqual(a.entered, ["g/room"], lawful.id);
  }
});

test("PASSAGE: a resident room's own lands_at sets no one down; the town's does", () => {
  const room = { id: "t/chamber", kind: "sited", at: { x: 0, y: 15 }, extent: { w: 30, h: 30 }, body: "The chamber.", entry: { lands_at: { x: 0, y: 25 } } };
  const hallSide = door("t/hall-to-chamber", TOWN, { word: "neutral", into: "t/chamber", lands_at: "t/chamber-to-hall" });
  const chamberSide = { ...door("t/chamber-to-hall", TOWN, { word: "neutral", into: "t/hall" }), at: { x: 5, y: 2 } };
  const hall = { id: "t/hall", kind: "sited", by: "t", at: { x: 0, y: -20 }, extent: { w: 40, h: 40 }, body: "The hall." };
  const land = (r) => landingOf(entryLawOf(hallSide), r, new Map([hall, r, hallSide, chamberSide].map((m) => [m.id, m])), { room: r, portal: hallSide });
  assert.equal(land({ ...room, by: TOWN }).by, "room");
  const resident = land({ ...room, by: "t" });
  assert.notEqual(resident.by, "room");
  assert.equal(resident.lands_mark, "t/chamber-to-hall", "the door's own landing, as if the room had written none");
});

// ── the gate ─────────────────────────────────────────────────────────────────

function lintTree(records) {
  const dir = mkdtempSync(join(tmpdir(), "door-law-lint-")); SCRATCH.push(dir);
  const root = join(dir, "let-there-be-light");
  mkdirSync(root, { recursive: true });
  copyFileSync(join(REAL, "mark.md"), join(root, "mark.md"));
  cpSync(join(REAL, "logos"), join(root, "logos"), { recursive: true });
  for (const rel of ["the-town-centre", "the-town-centre/the-keeping-works", "the-town-centre/the-keeping-works/postmark-node",
                     "the-town-centre/the-keeping-works/postmark-node/mark"]) {
    mkdirSync(join(root, rel), { recursive: true });
    copyFileSync(join(REAL, rel, "mark.md"), join(root, rel, "mark.md"));
  }
  // a fixture mark's id is <by>/<dir>
  for (const { by, dir: d, x, entry } of records) {
    mkdirSync(join(root, d), { recursive: true });
    const lines = ["---", "kind: sited", `by: ${by}`, "date: 2026-11-25", `at: { x: ${x}, y: 0 }`, "extent: { w: 2, h: 2 }"];
    if (entry) lines.push(`entry: ${JSON.stringify(entry)}`);
    lines.push("---", "", `${d}.`, "");
    writeFileSync(join(root, d, "mark.md"), lines.join("\n"));
  }
  return dir;
}
function gate(dir) {
  try { return { code: 0, out: execFileSync(process.execPath, [LINT, "--marks-dir", dir], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
}

test("THE GATE: the lint refuses an unlisted resident door with [door-law], by its field names; a grandfathered name passes it", () => {
  const out = gate(lintTree([
    { by: "little-bird", dir: "the-cupboard", x: 300 },
    { by: "little-bird", dir: "a-new-door", x: 310, entry: { word: "neutral", into: "little-bird/the-cupboard" } },
    { by: "little-bird", dir: "a-ring-in-the-pantry", x: 320, entry: { word: "neutral", into: "little-bird/the-cupboard" } },
  ]));
  assert.equal(out.code, 1, out.out);
  assert.match(out.out, /\[ERROR\] [^\n]*a-new-door: \[door-law\] little-bird\/a-new-door writes entry\.into, and it is not the town's or one of the 44 grandfathered doors/);
  assert.doesNotMatch(out.out, /a-ring-in-the-pantry: \[door-law\]/, "one of the 44, by name: the law does not refuse it");
  assert.match(out.out, /^1 error\(s\)/m, "the unlisted door is the tree's one error");
});
