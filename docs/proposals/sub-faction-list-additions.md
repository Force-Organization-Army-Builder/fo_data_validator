# Proposal: sub-factions adding options to a shared upgrade list

Status: **draft, not implemented.** Written against validator 2.11.0 and the Force Org app as of 2026-11-24. No schema or code change has been made.

A sub-faction can change a shared faction upgrade (a list that units pull in through an UpgradeReference) only by **replacing the whole record** through `overrides`. That works while one sub-faction at a time changes a list. It breaks when sub-factions that can be taken together each need to **add** options to the same list: the validator requires co-takeable sub-factions to define a record identically, so neither can override it. This proposal compares five ways to let a sub-faction add options without replacing the list, and recommends one: a sub-faction **`addOptions`** section, merged additively across every sub-faction taken (Option A). The examples use `examples/full` vocabulary (the Field Army's `sidearms` list and its `heritage` group, which allows two picks). The motivating data is described generically.

## Summary

| Option | Shape | Shared-list case | Verdict |
|---|---|---|---|
| **A. `addOptions` on the sub-faction** | `addOptions: { "<faction upgrade>": { "<option>": Option } }`, appended to the merged list | each pick adds its own items; other armies see nothing | **recommended** |
| B. Options offered only with some sub-factions | `Option.subFactions: ["…"]` (static), or a hiding `when` | works, but every item moves into the parent's file | runner-up |
| C. Unit-modifier action `addOptions` | `{ kind: "addOptions", upgrade, options }` in `unitModifiers` | works, per unit, order-dependent | no |
| D. Merge co-takeable overrides | `overrides: [{ kind, id, merge: true }]` | works, with the whole list copied into every file | no |
| E. List fragments named by the parent | `FactionUpgrade.includes: ["…"]` | the parent must name every fragment | no |

A companion change (F, below) makes co-takeability smarter. It isn't needed for A, but it would let the data keep plain option ids.

---

## The case

**Rule shape.** A faction has about eight shared wargear lists (pistols, heavy weapons, officer wargear, vehicle-mounted weapons, …), pulled in by about 230 UpgradeReferences in 200 unit upgrades. Of those, 21 have `swapFrom`, so a list's options replace different gear in different units.

- Each sub-faction of the `default` group (one per army) has an **armoury**: a few items its units may also take from those lists. Today 11 of these sub-factions `override` 33 lists in all, only to **add** 36 options. To do that they copy **293** of the parent's options, which must be kept in step with the parent by hand.
- A **mixed army** is a sub-faction in the `default` group that is taken instead of one of those, together with **two or three** picks from a second group (`max` is an expression, 3 with the mixed sub-faction, otherwise 0). Each pick lets the army's models use that pick's armoury, including the items that sit in the shared lists. One pick file mirrors each `default`-group sub-faction.
- The pick files can't override the lists: two picks are co-takeable and would define one list differently. A pick and the `default`-group file it mirrors also count as co-takeable (different groups), although the group's `max` expression keeps them apart in practice.
- The pick files already model the "one armoury per unit" rule. Each armoury option adds a marker trait and has a `when` that fails if the unit has another armoury's trait. So a pick's copy of an item is **not** identical to the `default`-group file's copy, even when the id is the same.

**Today's only workaround** puts the 36 items into the parent's lists, each with a `when` on its pick being taken. Every army that isn't a mixed army then shows them disabled with their messages, since the app shows an option whose `when` fails as disabled rather than hiding it (`optionAllowed`, `src/api/list/conditions.ts` in the app; used by `src/components/list/slot_editor.tsx`). That was rejected.

### What exists today (paths in this repo unless noted)

- **`overrides` and parent collisions.** `src/game_data/validate.ts`, `subFaction()` (about line 860): any record with the same kind and id as the parent's is an error unless `overrides` lists it, and an `overrides` entry the parent doesn't have is an error. Spec §4, `docs/specs/data_schema_spec_2026-10-17.md`.
- **Co-takeable sub-factions.** `combinedSubFactions()` (about line 776). Two sub-factions of one parent are co-takeable when they're in different groups, or in one group whose `max` is an expression or more than 1. For every record kind and `unitModifiers`, an id both define must be `sameData`. Otherwise the error is "… also defines upgrades 'x', differently, and both can be taken together (they're in groups 'a' and 'b') …", or "… also overrides the parent's …" when the parent has the record. Co-takeability looks at groups only, not at `when` or the value of a `max` expression. Spec §4.1, "Combining sub-factions".
- **Resolving references.** Validator `resolveOptions()` (about line 1391) and app `resolveOptions()` / `getAllOptions()` (`src/api/list/options.ts`). The upgrade's own options win, then the first shared upgrade referenced. Later clashes are hidden, and the validator warns about them. `swapFrom` is applied by the app to every resolved non-default option without its own `swaps` (`withSwapFrom`), so it covers options reached through a reference. `perModel`, `profileId` and `gearNote` belong to the referencing upgrade. Spec §6.
- **UpgradeReference** (`src/game_data/schema.ts`, `UpgradeReferenceSchema`): `{ id, target, restrictions? }`. It has no `when` and no way to add options.
- **Unit modifiers** (`UnitModifierActionSchema`): `addUpgrade` (a copy of a faction upgrade, given to each profile the selector picks; app `applyUnitModifier`, `src/api/list/resolve.ts`), `unavailable`, and the held effects (stat, special-rule, trait, sub-type, slot-tag, model). None of them adds options to an upgrade a unit already has.
- **Merging in the app** (`resolveFaction`, `src/api/list/resolve.ts`): records are merged with `Object.assign` in the order the sub-factions are given (parent first, then each sub-faction), so a record is replaced whole. Unit modifiers then run in order over every unit.
- **Saved lists** (app `types/list.d.ts`): `ListUnit.selections` maps an upgrade id to picks by plain option id. A pick whose option isn't offered any more is skipped by the rules check (`src/api/list/rules.ts`, the `if (!option) continue` in the option loop) and isn't reported.

---

## Option A (recommended): `addOptions` on the sub-faction

### Shape

A new optional sub-faction field. The keys are ids of the **parent's faction upgrades**. The values are options, keyed by id, with the same shape as a faction upgrade's options:

```json
// sub-factions/coastal-heritage.json  (group "heritage", which allows two picks)
"weapons": {
    "cutlass": { "id": "cutlass", "name": "Cutlass", "template": "melee", "profiles": [ … ] }
},
"addOptions": {
    "sidearms": {
        "cutlass": { "id": "cutlass", "name": "Cutlass", "cost": { "points": 2 }, "weaponRefs": ["cutlass"] }
    }
}

// sub-factions/highland-heritage.json  (also "heritage"; both may be taken)
"addOptions": {
    "sidearms": {
        "broadsword": { "id": "broadsword", "name": "Broadsword", "cost": { "points": 3 }, "weaponRefs": ["broadsword"] }
    }
}
```

With both heritages taken, every unit that references `sidearms` is offered `knife`, `axe`, `cutlass` and `broadsword`. With neither, only `knife` and `axe`, with nothing disabled.

### Meaning

- **Additions never replace.** After the records are merged (`overrides` included), each sub-faction's additions are appended to the merged list. An id already in the list is a data error (below), so the merge doesn't depend on order.
- **Order shown.** Added options come after the list's own options, in the app's sub-faction merge order (group order, `default` first, then the order picked). This affects display only.
- **Everything else is unchanged.** Once resolved, an added option is an option of the list. UpgradeReferences pull it in, the referencing upgrade's `swapFrom`, `perModel`, `profileId`, `restrictions`, `limitBy` and `gearNote` apply to it, and a unit's own option with the same id hides it as today. Its own `when`, `effects`, `max`, `swaps` and `subChoices` work as on any option.
- **`addUpgrade` copies include additions.** Additions are applied before unit modifiers run, so a sub-faction's `addUpgrade` of the list copies the extended list.
- **Targets.** Only the parent's faction upgrades. A sub-faction can't target its own records (it writes the options there directly), a sibling's records, or unit upgrades. An extension source's sub-faction (`examples/extension`) can extend its parent's lists, which Options B and E can't do.

### Validator checks

Errors:

1. The key isn't one of the parent's faction upgrades (with `didYouMean`).
2. The key is a faction upgrade the sub-faction defines itself, as a new record or an override: "add the options to the record itself".
3. An option id is already one of the parent's options for that list: "to change it, override the list".
4. Option key ≠ `id` (the existing `ids` check).
5. Each option gets the checks of a faction upgrade's option, in the sub-faction's scope (parent and sub-faction merged): costs and resources, `weaponRefs` / `equipmentRefs` / `swaps` exist, `effects`, `when` (`option-when` lint), `subChoices`, `max`.
6. **Co-takeable sub-factions** (extending `combinedSubFactions()`):
    - Two of them add the same option id to the same list and the options aren't `sameData`: "sub-faction 'b' also adds option 'x' to upgrades 'sidearms', differently, and both can be taken together (…)". Identical additions are merged as one.
    - One adds an option id that the other's override of that list also has, and they aren't identical. If they are identical, the app keeps one.

Warnings, lower priority:

7. The list isn't referenced by any unit upgrade in the parent or the sub-faction, and no `addUpgrade` grants it, so the additions are never offered.
8. The existing shared-clash warning (an option id that two lists referenced by one upgrade both offer) and the `mirrorOf` "equal option sets" check should also run with each sub-faction's additions applied. Today they run against the parent's lists only, so overrides have the same gap. Close it for both.

### Saved lists

- Picks are stored by plain option id, and additions change no existing id, so saved lists stay valid.
- If data moves from an override to `addOptions`, it keeps the same ids, so saved lists are unaffected. Only the order of options on screen changes: added ones move to the end.
- If the sub-faction pick is removed, its added options stop being offered and the app skips their picks without saying so. Overrides behave the same way today. The app should report "X is no longer offered" for such a pick. That's a small follow-up that helps both cases.

### Force Org app

1. `resolveFaction` (`src/api/list/resolve.ts`): after `upgrades: merge('upgrades')` and before `withModifiers`, apply each sub-faction's `addOptions` in order: `upgrades[target] = { ...upgrades[target], options: { ...upgrades[target].options, ...additionsNotAlreadyThere } }`. About 15 lines, plus tests: two co-taken sub-factions, an override and an addition together, an `addUpgrade` copy, `swapFrom` reaching an added option.
2. Types come from the validator package (regenerated schema).
3. Data Editor: a sub-faction section "Options added to shared lists" (pick a parent faction upgrade, then edit options with the existing option editor). The record browser and the reference view list each addition under its list, with the sub-faction that adds it.
4. Optional: the "no longer offered" issue above.

Option rendering, `when` handling, `swapFrom`, costs and export need no change, because they read resolved options.

### The shared-list case with A

- Each pick file adds its armoury items to the lists with `addOptions`. Each item has the same marker-trait effect and "one armoury per unit" `when` that the file's armoury upgrades already have. Gear records the items give are copied into the pick file, which is fine because identical copies are allowed.
- **Ids.** A pick and the `default`-group file it mirrors count as co-takeable, and their copies of an item differ (marker and `when`). So the pick file prefixes its ids, as it already does for its upgrades. With F, it could keep the plain ids.
- **The same item in two armouries.** In the data, three items are in two armouries. When both picks are taken, the player is offered two entries, one per armoury, each marking its own armoury. The one-armoury rule needs that anyway.
- **Other armies are unchanged.** The parent's lists gain nothing, so nothing is shown disabled.
- **Bonus:** the 11 `default`-group files can replace their 33 list overrides with additions of their 36 items. That removes the 293 copied parent options, keeps the ids, and lets them drop those `overrides` entries.
- Another group in the same faction, whose picks also let a detachment use one armoury, can use the same mechanism.

---

## Option B: options offered only with some sub-factions

**Shape.** Either a static `Option.subFactions: ["coastal-heritage"]` (offered only when one of these is taken), or a hiding flag on `when` (`{ "if": …, "message": …, "hide": true }`).

**Checks.** The static form needs few checks: the ids are sub-factions of this faction, the list isn't empty, and a warning when the option is an upgrade's `default`. A hiding `when` would have to be limited to facts about the picks (`contingent.is(subfaction:…)`, `main.is(…)`). Otherwise options would appear and vanish as the list changes, and the app would need list context inside `getAllOptions`, which today takes only the upgrade and the faction's upgrades.

**App.** The static form can be filtered once in `resolveFaction`, where the sub-factions taken are known. A picked option that is then filtered out needs the same "no longer offered" issue as A.

**The shared-list case.** All 36 items, with markers and `when`s, plus the gear records they give, move into the parent's lists, each naming its pick. The `default`-group copies can also go there with `subFactions: [<that sub-faction>]`, which removes the overrides as A does.

**Why not.** The parent must name its sub-factions. That reverses the format's direction (a sub-faction modifies its parent) and rules out a sub-faction from another source extending the parent's lists. The parent file also takes on every sub-faction's armoury and gear records. A hiding `when` is also a general way to get around the app showing blocked options with a reason, and the design of the app chose that behaviour on purpose. B is the runner-up if A is turned down: it's a smaller change.

## Option C: a unit-modifier action that adds options

**Shape.** `{ "kind": "addOptions", "upgrade": "sidearms", "options": { … } }` in a sub-faction's `unitModifiers`. It adds the options to each upgrade of a matched unit that references `sidearms`.

**Checks.** The list exists. Option checks as in A. Co-takeable clashes: the modifier ids are already compared, but two modifiers adding the same option id clash only on units both select, so the validator would have to evaluate selectors over every unit to report it.

**App.** A new case in `applyUnitModifier`. It must find upgrades whose options reference the list and insert the options as the upgrade's **own** options, so they would outrank the list's options in clashes (the opposite of A). It runs in modifier order, so an `addUpgrade` from a later modifier misses earlier additions.

**The shared-list case.** It works with an empty selector. That is A with more machinery and order-dependence. The only gain is narrowing by selector, and the option's `when` (or a profile filter) already covers that.

## Option D: let co-takeable overrides merge

**Shape.** `overrides: [{ "kind": "upgrades", "id": "sidearms", "merge": true }]`. The union of options by id is taken across the sub-factions taken, an id that two of them have must be identical, and non-option fields must match.

**Why not.** Every pick file copies the whole list, which multiplies the 293 copies that A removes, and every change to the parent's list must be repeated in each file. It also weakens the "define it identically" rule for one kind of record. Whatever D can express, A expresses without the copies.

## Option E: list fragments named by the parent

**Shape.** `FactionUpgrade.includes: ["sidearms-coastal", "sidearms-highland"]`. Each sub-faction defines its fragment as a new record with its own id, so nothing collides. The parent's list includes whichever fragments are loaded.

**Why not.** As with B, the parent must know every fragment. A also covers the case where nobody wrote the fragment ahead of time.

## Companion F: smarter co-takeability (separate, optional)

`combinedSubFactions()` treats two sub-factions as co-takeable from their groups alone. If sub-faction S's `when` requires `contingent.is(subfaction:X)` (alone, or as one side of an `and`), and X shares a group of at most one with T, then S and T can never be taken together, so the identical-definition rule shouldn't apply to them. With this, the pick files and the `default`-group files could use the same plain ids for their (different) upgrades and added options. That would undo the need for prefixes, which were added only to get past this check. It's worth its own proposal: it needs care with `or`, negation and `main.` / `list.` scopes, and it changes when an existing error fires.

---

## Open questions

1. **Name.** `addOptions` matches `addUpgrade`, but it sits beside records rather than in `unitModifiers`. `extends` (`[{ kind: "upgrades", id, options }]`) would leave room for other kinds later. Recommendation: `addOptions` now, since no other kind is needed.
2. **Override and add the same list.** Recommendation: an error (check 2), so a list's options come from one place per sub-faction.
3. **Targets beyond the parent.** Should a sub-faction be able to extend a list that a sibling defines? Recommendation: no. Siblings aren't always taken together, and the parent is the shared base.
4. **Release.** It's a new optional field, so validator 2.12.0 (minor). Data using it fails on older validators, whose strict objects reject the field. The app must support it before the data ships.
