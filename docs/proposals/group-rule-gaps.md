# Review: group-rule gaps found while porting detachment rules

Status: items **1 (`unitWhen`), 2d (`addedSlotRoles`) and 2c (slot option `when`) implemented in validator 2.6.0**, as recommended below (see `CHANGELOG.md`). The rest is still open. Written against validator 2.5.0 and the Force Org app as of 2026-11-19.

A data source added several primary groups (detachments). Their rules mostly fit the schema, but some needed workarounds: marker traits, whole-list expression rules, copied records and gear-count hacks. This review takes each gap and says whether it needs a schema change. Where it does, it gives design options with example JSON, a recommendation and a priority. The examples use `examples/full` vocabulary; the motivating rules are described generically.

## Summary

| # | Gap | Schema change? | Recommendation | Priority |
|---|---|---|---|---|
| 1 | A slot that units of a second role may fill only when they carry some gear or trait | yes | slot `unitWhen`: a live condition on the unit in the slot | **high** |
| 2d | "Slot options that add slots may not be taken" / "…may only add slots of role R" | yes | group `addedSlotRoles` | **high** |
| 2c | A slot option offered only in one group | yes | slot option `when` | medium |
| 2a | Effects on every matching unit while a group is in the list | yes | group `listEffects` (or faction `unitModifiers`) | medium |
| 2a | Game-level expressions can't name faction groups | small | accept any loaded group id, with a warning | low |
| 2b | "Units without rule X" named by unit id | no (2.5.0) | selector `specialRules` in `exclude` | — |
| 2e | Requiring gear by its mount | yes | `note` on a gear condition | low |
| 2f | Unclear app semantics | no | answers below; one doc fix | — |
| 2g | Units that must start embarked | no | leave as rules text | none |

Items 1, 2d and 2c could ship together as 2.6.0. Item 2a (`listEffects`) could be in the same release or the next.

---

## 1. A slot open to a second role, on a condition (main ask)

**Rule shape.** "Models with upgrade A may fill the Commander slot of this group; models with any other upgrade of that family may fill its Officer slots." The models are vehicles, which normally fill Heavy slots, and the upgrades are ordinary per-unit options that give a piece of equipment.

**Today's workaround.**
- The Commander slot gets `roles: ["commander", "heavy"]` and each Officer slot `["officer", "heavy"]`. A slot still grants as its first granting role (data schema spec §3.3), so contingent grants are unaffected.
- The slot `units` filter needs "a heavy unit only if it has trait X", and a selector can't say that. Nested `exclude` is rejected, and there's no trait negation inside an exclusion.
- So the heavy units allowed in are whitelisted by `unitIds`, and a group expression rule compares `group.count(role:heavy)` with the number of upgraded units. That is exact for the single Commander slot but loose for the Officer slots.

**What the app does.**
- Candidates offered for an empty slot are judged on the bare unit plus list-choice effects only (`withChoiceEffects`, `slot_editor.tsx`). Upgrades aren't picked until the unit is in the slot.
- The live slot check (`slotAccepts` in `rules.ts`) judges the placed unit before group effects, so option effects (traits) are seen.

This rules out every design that admits the unit by something an option gives it. A selector on an option-given trait never offers the unit, because the upgrade can't be picked before the unit is placed. The same holds for an option effect that grants a role.

### Option A: `unitWhen` on a slot (recommended)

A slot gains `unitWhen`, a condition on the unit filling it. It is checked live against the unit as configured, with its options' gear and traits, and shown as an issue on the slot when false. Candidates are still offered by role and `units`, so the player can place a heavy unit and then pick the upgrade.

```json
{ "roles": ["commander", "heavy"],
  "unitWhen": { "if": "unit.is(role:commander) or unit.has(equipment:command-array)",
                "message": "A Heavy unit fills this slot only with a command array" } },
{ "roles": ["officer", "heavy"],
  "unitWhen": { "if": "unit.is(role:officer) or unit.has(equipment:signal-array) or unit.has(equipment:relay-array)",
                "message": "A Heavy unit fills this slot only with a signal or relay array" } }
```

- **Scopes:** `unit`, `slot`, `group`, `contingent`, `root`, `main` and `list`, like an effect's `when` without `profile`. It sees the unit before the group's effects, the same point as the live `units` check.
- **Pros:**
  - Expressions already have `or`, `not`, `has(gear)`, `is(trait:…)` and `is(role:…)`, so the selector grammar doesn't grow.
  - Reading the equipment the upgrade gives needs no marker trait.
  - Exact per slot, so the group-level count rule goes away.
- **Cons:**
  - Candidates aren't narrowed: a heavy unit that can never take the upgrade is offered, and shows an issue once placed.
  - It is a new field with a new scope set to check.
- **Validator:** check the expression in those scopes. Warn when it can't read `unit`, since it can't then judge the unit.

### Option B: per-role filters on a slot

`roleUnits: { "heavy": <selector> }` narrows which units of one role may fill the slot.

```json
{ "roles": ["officer", "heavy"], "roleUnits": { "heavy": { "upgrades": ["signal-array", "relay-array"] } } }
```

This only works if the selector matches what the unit *can* take: a new selector field, `upgrades`, matching a unit that has an upgrade with one of those ids. Matching what it *has taken* would hit the placement problem above. So it narrows candidates well, but needs both `roleUnits` and a new selector field. It also still needs Option A to require that the upgrade is actually picked. Worth adding later only if A's unnarrowed menus prove annoying.

### Option C: selector negation (`traitsNoneOf`, nested `exclude`, `anyOf`)

```json
"units": { "anyOf": [{ "roles": ["officer"] }, { "roles": ["heavy"], "traits": ["Signal Officer"] }] }
```

This grows the selector grammar and still fails the placement problem for option-given traits. Not recommended for this rule. Nested `exclude` or `anyOf` may be worth it later for rules about a unit's own traits, but no current data needs it.

### Option D: a role-granting option effect

`{ "kind": "role", "add": ["officer"], "when": { "if": "group.is(group:…)" } }` on the upgrade's option. It has the same placement problem, and it would change what `role:` references, role grants and counts mean everywhere. Not recommended.

**Recommendation: Option A**, 2.6.0, high priority.

---

## 2a. Effects across the list while a group is taken; game-level references to faction groups

**Rule shapes.**
1. "Every Walker in a list using this primary group gains rule R."
2. "A list with this primary group may only include these additional groups."

**Today's workarounds.**
- Shape 1 is a unit modifier copied into every sub-faction: factions have no `unitModifiers`, and the additional groups are game records.
- Shape 2 is a faction list rule that counts groups by type and subtracts the allowed ones.
- Game-level expressions can't name a faction group (`main.count(group:…)` in `game.json` is "unknown group type or group"). The game's vocabulary has only the game's groups.

### Option A: group `listEffects` (recommended for shape 1)

While the group is in the list, its `listEffects` apply to every unit in the list matching `units`. This is the list choice value mechanism (§3.7) attached to a group.

```json
"armoured-column": {
    "id": "armoured-column", "name": "Armoured Column", "type": "core", "slots": [ … ],
    "listEffects": { "units": "@vehicles",
                     "effects": [{ "kind": "specialRule", "rule": { "id": "fearless" } }] }
}
```

- It applies at the list-choice step: after sub-faction unit modifiers, before options. So a group's `units` selector can read what it gives, as for choice values.
- **Pros:** the rule lives on the record that causes it, reaches every contingent, and needs no copies.
- **Cons:** a second list-wide effect source beside choice values. Which units it reaches (whole list, or the group's contingent) needs deciding. Default to the whole list, like choice values, and allow `scope: "contingent"`.

### Option B: `unitModifiers` on a faction

The sub-faction field, allowed on the faction too, with the group as each effect's `when`:

```json
"unitModifiers": { "column-drill": { "id": "column-drill", "name": "Column Drill", "selector": "@vehicles",
    "actions": [{ "kind": "specialRule", "rule": { "id": "fearless" },
                  "when": { "if": "main.count(group:armoured-column) > 0", "message": "With an Armoured Column" } }] } }
```

- **Pros:** reuses an existing record and app step, and is also generally useful (faction-wide modifiers).
- **Cons:** it only reaches the faction's own units, and the condition sits apart from the group.

### Option C: game-level expressions may name any loaded group

Make an unknown `group:` id in game files a warning ("no loaded faction has this group") instead of an error, when some loaded faction defines it. Game group `when`s and game list rules can then name faction groups. This is cheap, but it moves knowledge of faction records into the game. Use it for shape 2 only if the typed form below isn't wanted.

For shape 2, a typed group field could let menus disable disallowed groups instead of reporting an issue afterwards. An example is `additionalGroups: { "only": [ids or types], "max": { "id": 1 } }` on a primary group. The faction list rules work today, so this is **low** priority.

**Recommendation:** Option A for shape 1 (medium priority). Keep the list rules for shape 2 for now, and do Option C if the game-side rules come up again.

---

## 2b. "Units without rule X" by unit id: no change needed

The selectors listed unit ids of the units that hold the rule, and sub-factions overrode them to add their own units. Validator 2.5.0 covers this:

```json
"match": { "profiles": { "anyOf": ["officer", "specialist"] },
           "exclude": [{ "specialRules": ["artificer"] }] }
```

- `exclude` entries take `specialRules`, which matches any value of a configurable rule.
- A unit is excluded when **any** of its profiles holds the rule, so the selector judges units, not models. That is right for single-model units. A multi-model unit with one officer model lacking the rule would be excluded by another model's rule. A per-model form would need `specialRules` on `ProfileFilter`, which 2.5.0 left out.
- In `list.count(@…)` the selector sees each unit after unconditional effects (see 2f), so a rule an option or slot option gives counts.
- Needs `"minValidatorVersion": "2.5.0"`, and an app that matches selector `specialRules`. The app doesn't yet: `matchesUnitSelector` (`profiles.ts`) ignores the field. An exclusion holding only `specialRules` would then match every unit, the selector would match none, and the rule would silently never fire. Wait for the app before migrating.

---

## 2c. A slot option offered only in one group

**Rule shape.** "Option O may only be taken for tagged slots in group G."

**Today:** O gives a marker trait, and a group rule fails when a unit outside G has it.

### Option A: `when` on a slot option (recommended)

```json
"veteran-gunners": { "id": "veteran-gunners", "name": "Veteran Gunners", "text": "…", "slotTag": "prime",
                     "when": { "if": "group.is(group:gun-line)", "message": "Only in a Gun Line" } }
```

- **Scopes:** `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`, seeing the unit before slot-option effects, as its `units` does.
- While false, the option isn't offered. A pick whose `when` turns false gets an issue, like an option stranded by a lost tag (`strandedOptions` in the app).
- The same `when` covers other conditions ("only at 3000 points or more").

### Option B: `groups: [ids]` on a slot option

Simpler, but it covers only this one shape.

### Option C: categories that add rather than intersect

A slot's `tagOptions` would gain `addCategories`, admitting options no other slot offers. This inverts 2.2.0's intersection rule and makes combining hard to explain. Not recommended.

**Recommendation: Option A**, 2.6.0, medium priority. If the option is a game record and G a faction group, it also needs 2a Option C, or the option moved into the faction.

---

## 2d. "Slot options that add slots may not be taken" (or "…may only add role R")

**Rule shapes.**
1. "With this primary group, slot options that add slots may not be selected."
2. "With this primary group, they may only add Heavy slots."

**Today:** every such slot option gives a marker trait, and a list rule counts those traits. Each new slot-adding option, in any sub-faction, has to be added to the rule by hand. In the motivating data one such sub-faction option is already missing from the count.

### Option A: `addedSlotRoles` on a group (recommended)

`addedSlotRoles` limits the roles that the `slot` effects of options picked in the group's slots may add:

```json
"strike-force": { …, "addedSlotRoles": [] }
"siege-train":  { …, "addedSlotRoles": ["heavy"] }
```

- Each `slot` effect's `roleChoices` is narrowed to the listed roles. An option left with no role isn't offered, and an existing pick of one gets an issue. `[]` therefore means "no slot-adding options". Options without a `slot` effect are unaffected. Left out, there is no limit.
- **Pros:** nothing to maintain per option. Future options are covered, and roles are narrowed correctly ("may only add Heavy slots" keeps an "add a slot of any role" option, as Heavy only).
- **Cons:** the rule applies to the group's own slots. If a rule means slot options anywhere in the list, it would need a list-level form, which can wait until it's needed.
- **Validator:** roles must be game roles. Warn when a listed role appears in no slot option's `roleChoices`.

### Option B: `excludeCategories` on `tagOptions`, with every slot-adding option given a category

This works within 2.2.0's model, but has the same maintenance problem as the traits: every option across every file must carry the category.

### Option C: a group switch that hides every option with a `slot` effect (`slotOptions: { "addSlots": false }`)

Simpler than A, but it can't say "only Heavy".

**Recommendation: Option A**, 2.6.0, high priority (it fixes a correctness gap, not just ergonomics).

---

## 2e. Requiring gear by its mount

**Rule shape.** "This upgrade needs a pintle-mounted weapon."

**Today:** there's no way to match on a gear note, so the data counts a weapon's copies by parity and can't cover sub-faction weapons.

### Option A: `note` on a gear condition (recommended)

`GearCondition` (`restrictions.required`, `limitBy`) gains `note`, with `id` optional when `note` is given. It matches held gear of that kind whose note matches, case-insensitively:

```json
"restrictions": { "exclusions": [], "required": [{ "kind": "weapon", "note": "Pintle mounted" }], "requiredAnd": false }
```

The app already tracks notes per held copy: swaps take copies "under its own note first" (`restrictions.ts`). The validator would warn on a note that no `defaultGear` `note` or `gearNote` in the faction uses.

### Option B: an expression reference, `unit.has(note:pintle-mounted)`

More flexible (usable in `when`), but it is a new reference kind in the expression spec.

**Recommendation: Option A**, low priority (one rule today).

---

## 2f. App semantics: answers

Checked in the Force Org app source.

- **What do `list.count(@selector)`, `count(trait:…)` and list rules see?** Each filled slot's unit as `staticUnit` plays it (`effects.ts`, `filledSlots`): its own traits, sub-faction modifiers, list choices, options, the group, the slot and slot options. Only effects **without** a `when` are included. A trait from an option or slot option counts, but one from a conditional effect doesn't.
- **And slot `units`?**
  - The live slot check sees the unit before the group's effects, options included.
  - Candidates offered for an empty slot see only the bare unit plus list-choice effects.
  - **Doc fix:** the authoring guide and spec §5.2 say slot selectors see traits "before the group's effects", but don't say that the candidate list sees only the bare unit. Add that, since it is what makes option-given traits useless for admitting units (item 1).
- **Does `repeat: { min: 0, max: expr }` start with no copies?** Not confirmed. The app reads `repeat.min` in the group menu summary, where it counts as 0 ("×0–n"), and the validator accepts it. I didn't find where the app adds and removes repeat copies, so check this in the app.
- **Can a tag apply only when the slot is filled by one of its roles?** Yes, today. Instead of `tags: ["prime"]`, give the slot a conditional slot-tag effect:

  ```json
  { "roles": ["troop", "support"],
    "effects": [{ "kind": "slotTag", "add": ["prime"],
                  "when": { "if": "unit.is(role:troop)", "message": "Prime only when holding a Troop unit" } }] }
  ```

  The app evaluates the `when` on the placed unit (`played.ts`). A pick made while the slot was Prime gets the "isn't Prime any more" issue if the unit changes. Caveats:
  - The group menu summary won't count the slot as Prime.
  - A slot option's `slotRoles` matches the slot's roles, not the filling unit's; use the option's `units: { "roles": [...] }` to judge the unit.

## 2g. Units that must start embarked: no change

"Every unit must be a flyer or start embarked on a flying transport" and "every other unit must start embarked" are about deployment, not list composition. Nothing in the schema or the list model records embarkation.
- **Modelling it:** it would need a transport-assignment feature in the app (which unit rides in which, capacity by model count and type), which is much larger than these gaps.
- **Until then:** a list rule can approximate it, e.g. "no more non-flyer units than flying transports", if the data wants a warning. Otherwise keep it as rules text on the group.

Not worth a proposal now.

---

## If accepted: what changes

For 2.6.0 (1, 2d, 2c; optionally 2a A):
- `src/game_data/schema.ts`:
  - `SlotSchema.unitWhen`
  - `GroupSchema.addedSlotRoles`
  - `SlotOptionSchema.when`
  - optionally `GroupSchema.listEffects`
- `src/game_data/validate.ts`: scope sets and checks for each.
- The expression spec's scope table.
- Authoring guide: Groups, Slot options, Effects order (and the doc fix in 2f).
- Data schema spec §3.8, §5.2, §7.
- `examples/full`, CHANGELOG with "For the app" notes, version, and a regenerated JSON Schema.

The app needs:
- live `unitWhen` issues;
- role narrowing for added slots;
- slot option `when` in offering and stranding;
- `listEffects` at the choice step;
- 2.5.0's selector `specialRules` and special-rule `remove` / `replace`.
