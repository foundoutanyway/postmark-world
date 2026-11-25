// door-law.mjs — DOORS ARE THE TOWN'S BY DEFAULT (WLD-253; CORE-129 layer 1). One definition, read by the lint, the gate's board grammar, the
// passage (world-verbs.mjs § enterThroughPortal, portals.mjs § landingOf) and the office's leave-mark and amend doors (POS-1238, through the
// engine at the blessed ref).
//
// RULED (Darko, 2026-11-25): "the first layer we need to implement is the enforcement, which means whatever rule that we forgot to include that
// makes doors not instantiable by default by residents, we need to build first. And then if we want doors to be instantiable, we need to also then
// implement the specific allowance under governance for why this is allowed, instead of just blanket allowing." / "yes, file layer 1".
// GRANDFATHERING (Darko, 2026-11-24 19:28 EST): "we'll just make a special case for whatever was grandfathered because it's a feels bad to create
// something and then have it taken away."
//
// THE LAW (LOGOS/classes.md § The portal and the dungeon, "Doors are the town's"): a mark's `entry` stays sovereign (its word and terms are its
// maker's), and its two children `into` and `lands_at` are constitution-tier (the-town/mark-entry-into, the-town/mark-entry-lands-at): the town
// alone sets them. A door is any mark whose AUTHORED entry carries either. A stairs that writes no `entry` leads where its class says
// (enter-exit.mjs § entryLawOf) and authors no door, so it is untouched. WLD-21's admin households keep exactly their three classes
// (admin-makers.mjs): making a stairs or a portal-ground is not the right to set a door's destination.
//
// TWO QUESTIONS, KEPT APART (Bevel, 2026-11-25 19:29Z):
//   · MAY THIS DOOR STAND? (`doorStanding`: the lint, the gate, the passage) A tree has no writer to ask, so this reads only what is there: the
//     town's door, or one of the 44 grandfathered BY NAME, stands; any other door does not. The name is the grandfathering, not its values, so a
//     change the TOWN makes to a grandfathered door's destination is not refused here merely because its maker is a resident.
//   · MAY THIS WRITE BE MADE? (`entryWriteVerdict`: the office's leave-mark and amend, the one write path since WLD-161) Here the writer and the
//     record before are known, so the children are the town's to set: a non-town writer may not create, change, re-spell or remove `into` or
//     `lands_at`, on a grandfathered door too, while a welcome-only change passes. The grandfathering is permission for a door to remain, never
//     permission to write.
// PURE: no git, no store, no imports, so the office can read it from the engine as it is.

/** The constitution-tier children of a mark's `entry`, as the passage reads them (`entry.into`, `entry.lands_at`). */
export const DOOR_CHILDREN = Object.freeze(["into", "lands_at"]);
/** the property records that declare them (Keeping Works, flat beside the-town/mark-entry with `of:`) */
export const DOOR_CHILD_PROPERTIES = Object.freeze({ into: "the-town/mark-entry-into", lands_at: "the-town/mark-entry-lands-at" });
const TOWN = "the-town";
// a spelling a writer may try for each child: case, and `-` or no separator for `lands_at`. Any of them is the child.
const SPELLINGS = Object.freeze({ into: /^into$/i, lands_at: /^lands[_-]?at$/i });

/** THE GRANDFATHERED DOORS, by exact id: the explicit doors that stood at World main ce368dbb903bbf2da8da4578eecdf1666c0742bd (its committed fold
 *  and its raw records agree): Little Bird's three (world #416, #427, #434) and the Starforge Spire's 41. Nothing else is grandfathered; no
 *  prefix, author or date stands in for a name. */
export const GRANDFATHERED_DOORS = Object.freeze([
  "little-bird/a-paper-bag-of-crumbs",
  "little-bird/a-ring-in-the-pantry",
  "little-bird/a-ring-of-black-stone",
  "wright/spire-blue-room-to-north-walk",
  "wright/spire-cold-landing-to-hall-of-keepers",
  "wright/spire-dining-hall-to-guests-walk",
  "wright/spire-dining-hall-to-mirror-room",
  "wright/spire-gilded-doors",
  "wright/spire-gilded-doors-inside",
  "wright/spire-gilded-vestibule-to-rose-hall",
  "wright/spire-guests-walk-to-dining-hall",
  "wright/spire-guests-walk-to-little-stair",
  "wright/spire-guests-walk-to-rose-hall",
  "wright/spire-hall-of-keepers-to-cold-landing",
  "wright/spire-hall-of-keepers-to-rose-hall",
  "wright/spire-hall-of-keepers-to-star-chapel",
  "wright/spire-little-stair-to-guests-walk",
  "wright/spire-lumber-room-to-register-room",
  "wright/spire-mirror-room-to-dining-hall",
  "wright/spire-mirror-room-to-south-walk",
  "wright/spire-north-arch-to-star-chapel",
  "wright/spire-north-turret-to-north-walk",
  "wright/spire-north-walk-to-blue-room",
  "wright/spire-north-walk-to-north-turret",
  "wright/spire-red-stair-hall-to-rose-hall",
  "wright/spire-register-room-to-lumber-room",
  "wright/spire-rose-hall-to-gilded-vestibule",
  "wright/spire-rose-hall-to-guests-walk",
  "wright/spire-rose-hall-to-hall-of-keepers",
  "wright/spire-rose-hall-to-red-stair-hall",
  "wright/spire-round-court-to-south-walk",
  "wright/spire-servants-door",
  "wright/spire-servants-door-inside",
  "wright/spire-south-arch-to-star-chapel",
  "wright/spire-south-arch-to-well-stair",
  "wright/spire-south-turret-to-south-walk",
  "wright/spire-south-walk-to-mirror-room",
  "wright/spire-south-walk-to-round-court",
  "wright/spire-south-walk-to-south-turret",
  "wright/spire-star-chapel-to-hall-of-keepers",
  "wright/spire-star-chapel-to-north-arch",
  "wright/spire-star-chapel-to-south-arch",
  "wright/spire-well-stair-to-south-arch",
  "wright/the-starforge-spire",
]);
const GRANDFATHERED = new Set(GRANDFATHERED_DOORS);
export const isGrandfatheredDoor = (id) => GRANDFATHERED.has(id);

// a child's value in one comparable spelling: `into` a list (a string is a list of one), `lands_at` as written, an object's keys in order
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const valueOf = (child, v) => JSON.stringify(canon(child === "into" && typeof v === "string" ? [v] : v === undefined ? null : v));

/**
 * What an AUTHORED `entry` writes of the door's children, by PRESENCE: `{ into?: { value, key }, lands_at?: { value, key } }`. A key present with
 * null, "" or [] is present (a removal written as a value is still a write); a spelling of the child other than its own (`Into`, `lands-at`,
 * `landsAt`) counts as the child, with its `key` kept so a write that re-spells one is seen. Not an object (none, or a stairs' class default the
 * caller did not hand in): nothing.
 */
export function doorChildrenOf(entry) {
  const out = {};
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return out;
  for (const [key, value] of Object.entries(entry))
    for (const child of DOOR_CHILDREN)
      if (SPELLINGS[child].test(key) && !out[child]) out[child] = { value: valueOf(child, value), key };
  return out;
}

const changedChildren = (a, b) => DOOR_CHILDREN.filter((c) => !!a[c] !== !!b[c] || (a[c] && (a[c].value !== b[c].value || a[c].key !== b[c].key)));
const isTown = (by) => by === TOWN;
const field = (cs) => cs.map((c) => `entry.${c}`).join(" and ");

/** The one sentence a refusal says, with the literal field names (the office's refusal and the passage both quote it). */
export const DOOR_LAW = "entry.into and entry.lands_at are the town's to set (constitution tier, WLD-253): a door is the town's, or one of the 44 grandfathered by name";

/**
 * MAY THIS DOOR STAND, as it is written now? `{ door, allowed, why, changed? }`:
 *   not-a-door     it writes neither child (a stairs leading where its class says included)
 *   town           the town's own mark
 *   grandfathered  one of the 44, by name
 *   not-the-towns  a door no rule allows (`changed` names the children it writes)
 * The town is read from the mark's own `by`. This is presence, never permission to write: that is `entryWriteVerdict`.
 */
export function doorStanding(mark) {
  const children = doorChildrenOf(mark?.entry);
  const named = DOOR_CHILDREN.filter((c) => children[c]);
  if (!named.length) return { door: false, allowed: true, why: "not-a-door" };
  if (isTown(mark?.by)) return { door: true, allowed: true, why: "town" };
  if (isGrandfatheredDoor(mark?.id)) return { door: true, allowed: true, why: "grandfathered" };
  return { door: true, allowed: false, why: "not-the-towns", changed: named };
}

/** The refusal for a door that may not stand, in words with the literal field names, or null. */
export function doorRefusal(mark) {
  const s = doorStanding(mark);
  if (s.allowed) return null;
  return { why: s.why, changed: s.changed, words: `${mark?.id ?? "this mark"} writes ${field(s.changed)}, and it is not the town's or one of the 44 grandfathered doors — ${DOOR_LAW}` };
}

/**
 * MAY THIS WRITE BE MADE (the office's leave-mark and amend doors, POS-1238)? Actor `by` writes `after` over `before` (each an `entry` value, or
 * null for none). The town may. Anyone else may write anything of `entry` EXCEPT a change to its children: creating, changing, re-spelling or
 * removing `into` or `lands_at`. A welcome-only change leaves them as they were and passes, on a grandfathered door too. Being grandfathered, or
 * holding WLD-21's admin classes, grants no new write. `{ allowed: true|false|null, why, changed?, words? }`; an actor not read is
 * `allowed: null`, and a null is never a yes.
 */
export function entryWriteVerdict({ by = null, before = null, after = null } = {}) {
  if (typeof by !== "string" || by === "") return { allowed: null, why: "actor-unread" };
  if (isTown(by)) return { allowed: true, why: "town" };
  const changed = changedChildren(doorChildrenOf(after), doorChildrenOf(before));
  if (!changed.length) return { allowed: true, why: "no-door-change" };
  return { allowed: false, why: "door-child-change", changed, words: `${field(changed)}: ${DOOR_LAW}` };
}

/** The doors among `marks` that may stand, by id: what the passage honors (the town's, and the 44 by name). The dry run's list. */
export function allowedDoors(marks) {
  return (marks ?? []).filter((m) => m && !m._error).filter((m) => { const s = doorStanding(m); return s.door && s.allowed; }).map((m) => m.id).sort();
}
