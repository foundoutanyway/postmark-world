// door-law.mjs — DOORS ARE THE TOWN'S BY DEFAULT (WLD-253; CORE-129 layer 1). One definition, read by the lint, the gate's board grammar, the
// passage (world-verbs.mjs § enterThroughPortal) and the office's leave-mark and amend doors (POS-1238, through the engine at the blessed ref).
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
// THE 44 THAT STOOD (World main ce368dbb903bbf2da8da4578eecdf1666c0742bd: the committed fold and the raw records agree) are kept by exact id AND
// exact value: the grandfathering keeps what was made, so it lets that door stand as it stood. It does not let its maker point it somewhere new,
// add a landing, or take its destination away, which are the town's from now on. A welcome-only change (word, terms, requires) leaves them as they
// were. PURE: no git, no store, no imports, so the office can read it from the engine as it is.

/** The constitution-tier children of a mark's `entry`, as the passage reads them (`entry.into`, `entry.lands_at`). */
export const DOOR_CHILDREN = Object.freeze(["into", "lands_at"]);
/** the property records that declare them (Keeping Works, flat beside the-town/mark-entry with `of:`) */
export const DOOR_CHILD_PROPERTIES = Object.freeze({ into: "the-town/mark-entry-into", lands_at: "the-town/mark-entry-lands-at" });
const TOWN = "the-town";
// a spelling a writer may try for each child: case, and `-` or no separator for `lands_at`. Any of them is the child, and only the first is honored.
const SPELLINGS = Object.freeze({ into: /^into$/i, lands_at: /^lands[_-]?at$/i });

/** THE GRANDFATHERED DOORS, by exact id, each with the exact `into` / `lands_at` it carried at ce368dbb (Little Bird's three: world #416, #427,
 *  #434; the Starforge Spire's 41). Nothing else is grandfathered, and a value here is the only value that id may keep. */
export const GRANDFATHERED_DOORS = Object.freeze({
  "little-bird/a-paper-bag-of-crumbs": { into: "dom-pidgey/pidgey-heights", lands_at: "dom-pidgey/the-guest-book" },
  "little-bird/a-ring-in-the-pantry": { into: "the-town/the-town-centre", lands_at: "little-bird/a-ring-of-black-stone" },
  "little-bird/a-ring-of-black-stone": { into: "vermillion/guest-caves-pantry-of-arrival" },
  "wright/spire-blue-room-to-north-walk": { into: "wright/spire-north-walk", lands_at: "wright/spire-north-walk-to-blue-room" },
  "wright/spire-cold-landing-to-hall-of-keepers": { into: "wright/spire-hall-of-keepers", lands_at: "wright/spire-hall-of-keepers-to-cold-landing" },
  "wright/spire-dining-hall-to-guests-walk": { into: "wright/spire-guests-walk", lands_at: "wright/spire-guests-walk-to-dining-hall" },
  "wright/spire-dining-hall-to-mirror-room": { into: "wright/spire-mirror-room", lands_at: "wright/spire-mirror-room-to-dining-hall" },
  "wright/spire-gilded-doors": { into: "wright/spire-gilded-vestibule", lands_at: "wright/spire-gilded-doors-inside" },
  "wright/spire-gilded-doors-inside": { into: "wright/spire-forecourt", lands_at: "wright/spire-gilded-doors" },
  "wright/spire-gilded-vestibule-to-rose-hall": { into: "wright/spire-rose-hall", lands_at: "wright/spire-rose-hall-to-gilded-vestibule" },
  "wright/spire-guests-walk-to-dining-hall": { into: "wright/spire-dining-hall", lands_at: "wright/spire-dining-hall-to-guests-walk" },
  "wright/spire-guests-walk-to-little-stair": { into: "wright/spire-little-stair", lands_at: "wright/spire-little-stair-to-guests-walk" },
  "wright/spire-guests-walk-to-rose-hall": { into: "wright/spire-rose-hall", lands_at: "wright/spire-rose-hall-to-guests-walk" },
  "wright/spire-hall-of-keepers-to-cold-landing": { into: "wright/spire-cold-landing", lands_at: "wright/spire-cold-landing-to-hall-of-keepers" },
  "wright/spire-hall-of-keepers-to-rose-hall": { into: "wright/spire-rose-hall", lands_at: "wright/spire-rose-hall-to-hall-of-keepers" },
  "wright/spire-hall-of-keepers-to-star-chapel": { into: "wright/spire-star-chapel", lands_at: "wright/spire-star-chapel-to-hall-of-keepers" },
  "wright/spire-little-stair-to-guests-walk": { into: "wright/spire-guests-walk", lands_at: "wright/spire-guests-walk-to-little-stair" },
  "wright/spire-lumber-room-to-register-room": { into: "wright/spire-register-room", lands_at: "wright/spire-register-room-to-lumber-room" },
  "wright/spire-mirror-room-to-dining-hall": { into: "wright/spire-dining-hall", lands_at: "wright/spire-dining-hall-to-mirror-room" },
  "wright/spire-mirror-room-to-south-walk": { into: "wright/spire-south-walk", lands_at: "wright/spire-south-walk-to-mirror-room" },
  "wright/spire-north-arch-to-star-chapel": { into: "wright/spire-star-chapel", lands_at: "wright/spire-star-chapel-to-north-arch" },
  "wright/spire-north-turret-to-north-walk": { into: "wright/spire-north-walk", lands_at: "wright/spire-north-walk-to-north-turret" },
  "wright/spire-north-walk-to-blue-room": { into: "wright/spire-blue-room", lands_at: "wright/spire-blue-room-to-north-walk" },
  "wright/spire-north-walk-to-north-turret": { into: "wright/spire-north-turret", lands_at: "wright/spire-north-turret-to-north-walk" },
  "wright/spire-red-stair-hall-to-rose-hall": { into: "wright/spire-rose-hall", lands_at: "wright/spire-rose-hall-to-red-stair-hall" },
  "wright/spire-register-room-to-lumber-room": { into: "wright/spire-lumber-room", lands_at: "wright/spire-lumber-room-to-register-room" },
  "wright/spire-rose-hall-to-gilded-vestibule": { into: "wright/spire-gilded-vestibule", lands_at: "wright/spire-gilded-vestibule-to-rose-hall" },
  "wright/spire-rose-hall-to-guests-walk": { into: "wright/spire-guests-walk", lands_at: "wright/spire-guests-walk-to-rose-hall" },
  "wright/spire-rose-hall-to-hall-of-keepers": { into: "wright/spire-hall-of-keepers", lands_at: "wright/spire-hall-of-keepers-to-rose-hall" },
  "wright/spire-rose-hall-to-red-stair-hall": { into: "wright/spire-red-stair-hall", lands_at: "wright/spire-red-stair-hall-to-rose-hall" },
  "wright/spire-round-court-to-south-walk": { into: "wright/spire-south-walk", lands_at: "wright/spire-south-walk-to-round-court" },
  "wright/spire-servants-door": { into: "wright/spire-register-room", lands_at: "wright/spire-servants-door-inside" },
  "wright/spire-servants-door-inside": { into: "wright/spire-back-court", lands_at: "wright/spire-servants-door" },
  "wright/spire-south-arch-to-star-chapel": { into: "wright/spire-star-chapel", lands_at: "wright/spire-star-chapel-to-south-arch" },
  "wright/spire-south-arch-to-well-stair": { into: "wright/spire-well-stair", lands_at: "wright/spire-well-stair-to-south-arch" },
  "wright/spire-south-turret-to-south-walk": { into: "wright/spire-south-walk", lands_at: "wright/spire-south-walk-to-south-turret" },
  "wright/spire-south-walk-to-mirror-room": { into: "wright/spire-mirror-room", lands_at: "wright/spire-mirror-room-to-south-walk" },
  "wright/spire-south-walk-to-round-court": { into: "wright/spire-round-court", lands_at: "wright/spire-round-court-to-south-walk" },
  "wright/spire-south-walk-to-south-turret": { into: "wright/spire-south-turret", lands_at: "wright/spire-south-turret-to-south-walk" },
  "wright/spire-star-chapel-to-hall-of-keepers": { into: "wright/spire-hall-of-keepers", lands_at: "wright/spire-hall-of-keepers-to-star-chapel" },
  "wright/spire-star-chapel-to-north-arch": { into: "wright/spire-north-arch", lands_at: "wright/spire-north-arch-to-star-chapel" },
  "wright/spire-star-chapel-to-south-arch": { into: "wright/spire-south-arch", lands_at: "wright/spire-south-arch-to-star-chapel" },
  "wright/spire-well-stair-to-south-arch": { into: "wright/spire-south-arch", lands_at: "wright/spire-south-arch-to-well-stair" },
  "wright/the-starforge-spire": { into: "wright/spire-gilded-vestibule", lands_at: "wright/spire-gilded-doors-inside" },
});

// a child's value in one comparable spelling: `into` a list (a string is a list of one), `lands_at` as written, an object's keys in order
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const valueOf = (child, v) => JSON.stringify(canon(child === "into" && typeof v === "string" ? [v] : v === undefined ? null : v));

/**
 * What an AUTHORED `entry` writes of the door's children, by PRESENCE: `{ into?: { value, key }, lands_at?: { value, key } }`. A key present with
 * null, "" or [] is present (a removal written as a value is still a write); a spelling of the child other than its own (`Into`, `lands-at`,
 * `landsAt`) counts as the child, with its `key` kept so a door that re-spells one is seen. Not an object (none, or a stairs' class default the
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

const sameChildren = (a, b) => DOOR_CHILDREN.every((c) => (a[c]?.value ?? undefined) === (b[c]?.value ?? undefined) && (!a[c] || a[c].key === c) === (!b[c] || b[c].key === c));
const changedChildren = (a, b) => DOOR_CHILDREN.filter((c) => !!a[c] !== !!b[c] || (a[c] && (a[c].value !== b[c].value || a[c].key !== b[c].key)));
const isTown = (by) => by === TOWN;
const field = (cs) => cs.map((c) => `entry.${c}`).join(" and ");

/** The one sentence a refusal says, with the literal field names (the office's refusal and the passage both quote it). */
export const DOOR_LAW = "entry.into and entry.lands_at are the town's to set (constitution tier, WLD-253): a door is the town's, or one of the 44 that stood before the rule, as they stood";

/**
 * May this mark stand as a door as it is written now? `{ door, allowed, why, changed? }`:
 *   not-a-door   it writes neither child (a stairs leading where its class says included)
 *   town         the town's own mark
 *   grandfathered  one of the 44, exactly as it stood
 *   grandfathered-changed / grandfathered-removed   one of the 44 whose children are not as they stood (`changed` names them)
 *   not-the-towns  a door no rule allows (`changed` names the children it writes)
 * `allowed` is false only for the last three. The town is read from the mark's own `by`.
 */
export function doorStanding(mark) {
  const children = doorChildrenOf(mark?.entry);
  const named = DOOR_CHILDREN.filter((c) => children[c]);
  const door = named.length > 0;
  if (isTown(mark?.by)) return { door, allowed: true, why: door ? "town" : "not-a-door" };
  const pinned = Object.prototype.hasOwnProperty.call(GRANDFATHERED_DOORS, mark?.id) ? GRANDFATHERED_DOORS[mark.id] : null;
  if (pinned) {
    const want = doorChildrenOf(pinned);
    if (sameChildren(children, want)) return { door: true, allowed: true, why: "grandfathered" };
    return { door, allowed: false, why: door ? "grandfathered-changed" : "grandfathered-removed", changed: changedChildren(children, want) };
  }
  if (!door) return { door: false, allowed: true, why: "not-a-door" };
  return { door: true, allowed: false, why: "not-the-towns", changed: named };
}

/** The refusal for a door that may not stand, in words with the literal field names, or null. */
export function doorRefusal(mark) {
  const s = doorStanding(mark);
  if (s.allowed) return null;
  const what = s.why === "grandfathered-removed" ? `${mark.id} is one of the 44 grandfathered doors, and its ${field(s.changed)} was taken away`
    : s.why === "grandfathered-changed" ? `${mark.id} is one of the 44 grandfathered doors, kept as it stood, and its ${field(s.changed)} is not as it stood`
    : `${mark?.id ?? "this mark"} writes ${field(s.changed)}, and it is not the town's or one of the 44 grandfathered doors`;
  return { why: s.why, changed: s.changed, words: `${what} — ${DOOR_LAW}` };
}

/**
 * THE WRITE (the office's leave-mark and amend doors, POS-1238): may actor `by` write `after` over `before` (each an `entry` value, or null for
 * none)? The town may. Anyone else may write anything of `entry` EXCEPT a change to its children: creating, changing, re-spelling or removing
 * `into` or `lands_at`. A welcome-only change leaves them as they were and passes, on a grandfathered door too (its children stay, as they stood).
 * Being grandfathered, or holding WLD-21's admin classes, grants no new write. `{ allowed: true|false|null, why, changed?, words? }`; an actor
 * not read is `allowed: null`, and a null is never a yes.
 */
export function entryWriteVerdict({ by = null, before = null, after = null } = {}) {
  if (typeof by !== "string" || by === "") return { allowed: null, why: "actor-unread" };
  if (isTown(by)) return { allowed: true, why: "town" };
  const changed = changedChildren(doorChildrenOf(after), doorChildrenOf(before));
  if (!changed.length) return { allowed: true, why: "no-door-change" };
  return { allowed: false, why: "door-child-change", changed, words: `${field(changed)}: ${DOOR_LAW}` };
}

/** The allowed doors among `marks`, by id: what passage honors (the town's, and the 44 as they stood). The dry run's list. */
export function allowedDoors(marks) {
  return (marks ?? []).filter((m) => m && !m._error).filter((m) => { const s = doorStanding(m); return s.door && s.allowed; }).map((m) => m.id).sort();
}
