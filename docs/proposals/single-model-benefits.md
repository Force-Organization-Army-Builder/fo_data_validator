# Proposal: benefits for one model of a unit

Status: **Option A and requirement 3 implemented in validator 2.10.0**, together with part 2 (S1) of `profile-trait-effects.md` (see `CHANGELOG.md`, the authoring guide and the data schema spec §5.5, §5.6, §8). Requirement 1's idiom is documented (§8, the authoring guide's Selectors). The app side is still to do. Written against validator 2.9.0 and the Force Org app as of 2026-11-22.

**Decisions taken before implementing** (they settle the open questions below, except 3's second half):

1. `model` and `subType` ship together in one release.
2. `model` is allowed in slot options' `effects`, groups' `effects` and slots' `effects` only. Upgrade options are left out for now: how picks there would multiply `count` is undecided.
3. The source is the first matching profile in record order. There's no player choice and no saved-list change.
4. Only the unit record's profiles are sources, so two `model` effects on one unit always make two separate models.
5. With no model to split, the effect does nothing and the app shows an issue on the pick.
6. The kind is named `model`.
7. The default name is the source profile's name followed by the holder's name in brackets, with an optional `name` override.

The low-priority warning in the validation table (a selector naming unit ids whose profiles the filter never picks) was not implemented.

A data source has slot options whose benefits go to **one model** of the unit, not to the whole unit or to a whole profile. Effects today reach the whole unit, or every model of the profiles a filter picks (`profiles` on stat, special-rule and, from 2.9.0, trait effects). A unit whose models all share one profile can't single one out. This proposal covers that gap and three smaller requirements of the motivating rule, with design options and example JSON, a recommendation for each, the checks the validator would add, and open questions. The examples use `examples/full` vocabulary: the Clockwork Guild's `battle-construct` (a vehicle with the Foundry trait), the `prime` slot tag and the Sergeant sub-type. The motivating rules are described generically.

## Summary

| # | Requirement | Recommendation | Change needed |
|---|---|---|---|
| 1 | Offered only to a unit made **entirely** of models of type T with trait F | already expressible: `exclude` + `profiles.noneOf` for the type, `traits` for a unit-wide trait (1A). Document the idiom | none (docs only) |
| 2 | **One model**, chosen by the player, gets stat changes | a `model` effect that splits models off their profile into a derived profile, with its own nested effects (Option A) | new effect kind, **high** |
| 3 | That model gains a **sub-type** | a nested `subType` effect, the one part 2 of `profile-trait-effects.md` proposes (S1), allowed inside a `model` effect in slot options | depends on S1, medium |
| 4 | That model **counts as** another kind of model for one battlefield rule only | not list building: leave it to the option's `text` | none |

---

## The rule

**Rule shape.** A slot option (a prime benefit) reads:

> Only for a unit made entirely of models with the Vehicle type and the Foundry trait. One model in the unit, chosen by the player, gains +1 Armour and +2 Hull, and gains the Sergeant sub-type. That model also counts as a model of another kind, for one battlefield rule only.

The units it is meant for each have one profile and 1 to 10 models (some with `composition`, some with only `modelCount`).

**Today.** The slot option has `units: { "traits": ["Foundry"] }` and no `effects`. So the type half of the eligibility is missing, and nothing shows the benefits.

### Other rules with the same shape

The same data source has several more slot options that give one model a benefit. All describe "one model in the unit", and none can be modelled exactly today:

| Rule (generic) | Modelled today as | Exact? |
|---|---|---|
| "One model with the Sergeant sub-type gains +1 to three stats and the Character sub-type" (game level, and a copy in a sub-faction) | a stat effect with `profiles: { "anyOf": ["sergeant"] }`, and a marker trait | only while the sergeant profile has one model; no sub-type |
| "One model in a command-slot unit gains +1 to three stats" | a stat effect on every profile | only for one-model units |
| "One model gains the Character sub-type and a special rule" | no effects | no |
| "One model in this unit (and one in another unit) gains a special rule" | a special-rule effect on every profile, and a marker trait | no |

A general "one model" effect covers all of them. The second unit in the last rule is out of scope here.

---

## 1. "Made entirely of models of type T with trait F": already expressible

### What exists today

- **Selector `profiles`** matches a unit when **one** of its profiles matches the filter (the unit itself, if it has no profiles). A profile matches on its type (its own, or its unit's) and its tags (its own and its unit's), as case-insensitive text.
- **`exclude`** (validator 1.3.0) leaves out a unit that matches any entry. The data schema spec §8 (Selectors) already notes the inversion: an excluded `profiles.noneOf` leaves out a unit with *some* profile outside the list.
- **Selector `traits`** matches when the unit holds any of the traits, which it does when it or any of its profiles does. A trait on the unit record, or given by a trait effect without `profiles`, is held by **every** profile.

### Option 1A: `exclude` with `noneOf` (recommended, no change)

```json
"units": {
    "traits": ["Foundry"],
    "exclude": [{ "profiles": { "noneOf": ["vehicle"] } }]
}
```

- `exclude: [{ "profiles": { "noneOf": ["vehicle"] } }]` leaves out any unit with a profile that isn't a vehicle, so what's left is "every profile is a vehicle".
- `traits: ["Foundry"]` then needs the trait. When the trait is the unit's (on the record, or given unit-wide by an option or group), every profile holds it, so this is "every model has the trait".
- The slot option's `units` sees the unit as it stands before slot-option effects, option effects included. This matters for the motivating data: a unit of another type can gain trait F from an upgrade option, and the `traits`-only selector it has today offers it the slot option. The `exclude` fixes that.
- Checked against the motivating data with validator 2.9.0: no errors or warnings. `vehicle` is a unit type id, so the "matches no type or sub-type" warning doesn't fire.

**Pros:** no change. **Cons:** "every" is written as "not any not", which isn't obvious. The authoring guide's selector section should show it as the way to write "a unit made entirely of…".

### The remaining gap: a trait only some profiles hold

"Every profile holds trait F" can't be written when F is a profile-only trait (profile `traits`, or a trait effect with `profiles`). A profile filter matches type and tags, not traits, so the `noneOf` inversion has nothing to invert. No motivating data has this case: every unit the rule is meant for holds F unit-wide.

### Option 1B: `allProfiles` on selectors (only if a source needs it)

```json
"units": { "allProfiles": { "anyOf": ["vehicle"], "traits": ["Foundry"] } }
```

- A unit matches when **every** profile (the unit itself, if it has none) passes `anyOf` / `noneOf` as a profile filter does, and holds one of `traits` (its own or its unit's).
- It reads as the rule does and covers profile-only traits.
- **Cons:** a second way to write the type half, and a trait match inside a profile filter that no other filter has. The group rule gaps proposal (Option C) rejected new negation fields in selectors for the same reason: one way to write each thing.

**Recommendation:** 1A now, documented. 1B is low priority, only once a source has a profile-only trait in an "entirely of" rule.

---

## 2. One model gets stat changes (the core gap)

### What exists today

- **Profiles are kinds of models.** A unit's `profiles` list the kinds, and `composition` says how many models of each the unit holds. Without `composition`, a unit has `modelCount` (plus `additionalModels`) models, and per-profile counts are unknown unless it has one profile.
- **Effects reach whole profiles.** Stat and special-rule effects change each picked profile, so every model of that profile. A trait effect with `profiles` does the same (2.9.0). There's no way to change part of a profile.
- **Replacing blocks** (validator 1.4.0) already move models from one profile to another: a block with `replaces: { block, profile }` lowers the target profile's live count by its own size per copy. `unit.models()` and the target's cost are unchanged. The app's `unitModels` (`force_org` `src/api/list/models.ts`) does this, and the display, per-model default gear and per-model upgrades count from the result.
- **Slot options apply last** in the effect order, and the saved list already records the pick (`slotOptions: { [tag]: { option } }`).

So the counting to move one model out of a profile exists, but only for profiles and blocks written on the unit record. A slot option is shared by many units and can't name their profiles.

### Option A: a `model` effect that splits models off into a derived profile (recommended)

The effect takes `count` models (default 1) of a picked profile and makes them a profile of their own, a copy of the source profile, and its nested `effects` change only that copy:

```json
{
    "kind": "model",
    "name": "Lead Construct",
    "effects": [
        { "kind": "stat", "changes": [
            { "stat": "armour", "op": "add", "value": 1 },
            { "stat": "hull", "op": "add", "value": 2 }
        ] },
        { "kind": "subType", "add": ["sergeant"] }
    ]
}
```

**Fields.**

| Field | Meaning |
|---|---|
| `profiles` | a `ProfileFilter`: the profiles the models may come from. Left out, every profile. The first picked profile in record order that has a model takes the split |
| `count` | models split off (a positive whole number, default 1), for "two models in the unit gain…" |
| `name` | shown for the split-off model, e.g. "Lead Construct". Left out, the source profile's name followed by the effect holder's name: "Battle Construct (Lead Construct)" |
| `effects` | stat, special-rule, trait and (with S1) sub-type effects, applied to the split-off model only. Their `when` may use `profile`, meaning the split-off model. They may not have their own `profiles` |
| `when` | whether the split happens at all, in the scopes of a stat effect's `when` without `profile` |

**Semantics, at the effect's point in the order.**

1. The source is the first profile the filter picks that has at least one model: its live count from `composition`, or, for a unit with one profile and no `composition`, `modelCount` plus additional models.
2. A **derived profile** is made: a copy of the source **as it stands** (stats, special rules, tags and traits after every earlier effect), with the `name` above.
3. Its models are taken from the source: the source's count falls by `count` (by what it has, if fewer) and the derived profile holds them. This is the same counting a replacing block does: `unit.models()` and the unit's cost are unchanged.
4. The nested `effects` apply to the derived profile, in order.

**What sees the split-off model.**

- **Display.** The unit shows "4× Battle Construct" and "1× Lead Construct" with its own stats, rules and sub-types. A one-model unit shows only the derived profile. This is the main point: the player sees the right numbers on the right model.
- **Later effects and conditions.** The derived profile keeps its source's type and tags, so a later effect's `profiles` filter and `profile.is(…)` see it, together with what the nested effects gave it. What it holds counts for the unit, as any profile's traits and tags do: selector `traits`, `unit.is(…)`, `count(tag:…)` and list rules see it.

**What doesn't see it: the gear engine.** Default gear, per-model upgrade counts, `excludeProfiles`, `profileId` upgrades and `limitBy` keep counting the model under its **source** profile, from the record's composition. So the split-off model keeps its gear and its share of every per-model pick, the upgrades offered don't change, and saved gear picks stay valid. This is the rule part 2 of the trait-effects proposal sets for sub-types, for the same reason: a slot option, applied last, must not change which options were offered before it. The authoring guide would say "a split-off model keeps its gear and the gear choices of its source".

**Saved lists: nothing new is stored.** The split follows from the pick the list already saves (the slot option, or an upgrade option). Picking the option makes the split, and removing it undoes it. Old lists load unchanged. Data using the new effect needs the new validator, as with any new effect kind.

**Where.**

- **Slot-option effects** (the motivating case), **upgrade option effects** ("one model may be upgraded and gains…") and **group and slot `effects`** ("one model in each unit in this group…"). These are all applied per unit with an existing saved pick.
- **Not** sub-faction unit-modifier actions: a split every unit of a kind always has belongs on the unit record, as a profile and a block. **Not** list choice values or `listEffects` for now (see the open questions).

**Pros.**

- One effect covers every rule in the table above, not just the motivating one. The data names no unit profiles, so the option keeps working for units added later.
- It reuses what exists: the replacing-block counting, the effect kinds and their `profiles`-free forms, and the saved pick.
- Gear and saved lists are untouched.
- The display is exact where today it shows the benefit on every model or on none.

**Cons.**

- A new idea in the effect engine: a profile that exists only in the played unit, not the record. The app's display and condition code must handle a profile id that no record has.
- With several profiles and no `composition`, the source's count is unknown. The derived profile is then shown with `count` models, and the source's count stays unknown, as today.
- "Chosen by the player" is reduced to "the first matching profile". That is exact whenever one profile matches, which covers every rule in the table, but not a unit where the player could choose between two kinds of model (see the open questions).

### Option B: a profile and a replacing block on every eligible unit, switched on by the pick

Each eligible unit record gets a second profile (the boosted model) and a block `{ min: 0, max: …, replaces: … }`, with a `max` that reads the slot option pick, e.g. `"slot.has(option:lead-construct) ? 1 : 0"`.

- It needs a new expression reference (`option:` on `slot`), and edits to every eligible unit record (eight in the motivating data, more for the sergeant rules, across sub-factions).
- The boosted profile repeats the source's stats and gear, and has to be kept in step by hand.
- The block becomes a count the player sets and the list saves, instead of following from the pick.
- **Rejected**, for the reason the special-rule exchange proposal gave: designs that change no unit records come first, and new units should qualify on their own.

### Option C: a slot-option effect that adds a composition block

`{ "kind": "composition", "block": { "id": "lead", "profiles": { … }, "replaces": { … } } }`

- A block names profile ids, which a shared slot option can't know for every unit. It would need a "copy of the source profile" anyway, which is Option A with a block's fields around it.
- Blocks are player-adjusted counts with costs and saved copies, none of which this rule has.
- **Rejected:** Option A gives the same counting without them.

### Option D: `models: N` on each stat and special-rule effect

`{ "kind": "stat", "models": 1, "changes": [ … ] }`

- Several effects in one option can't say they reach the **same** model. The display would split off a model per effect.
- **Rejected:** Option A groups them under one split.

### Option E: leave it to rules text

Keep the effects out and rely on the option's `text`, as today.

- A partial interim: a stat effect with `"when": { "if": "unit.models() == 1", "message": "…" }` is exact for one-model units and does nothing for larger ones. It doesn't help most motivating units, and it shows a condition the rule doesn't have.
- **Not recommended** as the end state. It is what data should do until Option A ships: keep the `units` fix (requirement 1) and leave `effects` out, rather than show the benefit on every model.

**Recommendation: Option A**, high priority. It is a correctness gap that recurs across several rules, and the alternatives either edit unit records or show the wrong numbers.

---

## 3. The sub-type: use part 2 of the trait-effects proposal

Sub-types are profile and unit `tags`. Part 2 of `profile-trait-effects.md` proposes a `subType` effect (Option S1: `{ "kind": "subType", "profiles"?, "add"?, "remove"? }`) that later effects, selectors and `tag:` references see, and the gear engine doesn't. This proposal reuses it as a nested effect:

```json
{ "kind": "model", "effects": [ { "kind": "subType", "add": ["sergeant"] } ] }
```

- Inside a `model` effect it has no `profiles`, like the other nested effects. Validation is S1's: an unknown sub-type is an error when the game declares `subTypes`.
- **One change to S1:** it leaves slot options out, because a sub-type given there could only reach conditions. For a split-off model the sub-type's job is to show on that model and to count in later conditions and list rules (`count(tag:sergeant)`), so S1 should allow `subType` inside a `model` effect, in slot options too. It still never reaches the gear engine.
- **Order:** S1 and Option A can ship together, or Option A first with the nested `subType` arriving with S1. Data could carry the stat changes as soon as Option A ships.

**Alternatives, rejected.**

- **`tags` on the `model` effect** (the derived profile's own extra tags). It's simple, but it duplicates S1 and leaves two ways to give a sub-type.
- **A marker trait named like the sub-type**, as the sergeant rule above does today. Profile filters and `tag:` references don't see a trait, and earlier decisions avoid marker traits.

---

## 4. "Counts as another kind of model, for one battlefield rule only": not list building

The rule's last sentence lets the split-off model count as a model of another kind with trait F, for one other rule only. That other rule is about play: which units may hold and contest objectives.

- In the motivating data, nothing that builds or checks a list reads that rule. The only list rule involving trait F counts units by the trait (through a named selector), and the units this option is for already hold F, so "counts as having F" changes nothing it reads.
- **Recommendation:** leave it in the option's `text`. A general "counts as X for rule R" would need rules to name what they count, which the format has no use for outside play.

---

## The motivating rule in the proposed form

```json
"lead-construct": {
    "id": "lead-construct",
    "name": "Lead Construct",
    "text": "Only for a unit made entirely of Vehicle models with the Foundry trait. One model in the unit, chosen by the player, gains +1 Armour and +2 Hull and the Sergeant sub-type. …",
    "slotTag": "prime",
    "units": {
        "traits": ["Foundry"],
        "exclude": [{ "profiles": { "noneOf": ["vehicle"] } }]
    },
    "effects": [
        {
            "kind": "model",
            "effects": [
                { "kind": "stat", "changes": [
                    { "stat": "armour", "op": "add", "value": 1 },
                    { "stat": "hull", "op": "add", "value": 2 }
                ] },
                { "kind": "subType", "add": ["sergeant"] }
            ]
        }
    ]
}
```

A unit of five battle constructs in a prime slot with this option shows 4× Battle Construct and 1× Battle Construct (Lead Construct), the latter with the boosted stats and the Sergeant sub-type. It still has five models, costs the same, and keeps the same gear choices.

The sergeant rule in the table above becomes exact the same way:

```json
{ "kind": "model", "profiles": { "anyOf": ["sergeant"] },
  "effects": [
      { "kind": "stat", "changes": [ { "stat": "skill", "op": "add", "value": 1 } ] },
      { "kind": "subType", "add": ["character"] }
  ] }
```

**Today, with no format change,** the first block's `units` is valid and correct. The `effects` wait for Option A (and S1 for the sub-type).

---

## Validation rules

| Check | Level |
|---|---|
| `model` effect with no nested `effects` | error |
| a nested effect with its own `profiles` | error: "a split-off model's effects reach that model only" |
| a nested `model`, `slotTag`, `slot` or `allowedRoles` effect | error |
| `profile` in a nested effect's `when` | allowed (the split-off model); in the `model` effect's own `when`, the existing "'profile' isn't available here" error |
| `count` not a positive whole number | error (schema) |
| `profiles` values matching no unit type or sub-type | warning (the existing check on every profile filter) |
| `model` effect in a unit-modifier action, list choice value or `listEffects` | error, naming where it is allowed |
| a unit the holder's selector matches whose profiles the filter never picks (when the selector names unit ids) | warning, low priority |

Traits and sub-types the nested effects give count as known for `trait:` and `tag:` references, as they do today for every trait effect's `add`.

## App impact

- **`effects.ts`:** `playEffects` handles a `model` effect: pick the source profile, copy it with a derived id (`<source>~<holder>`, never stored), and apply the nested effects to the copy through the existing per-profile path. The played unit records the split (`{ derived, source, count }`) next to its profiles.
- **`models.ts`:** the played unit's per-profile counts move `count` from the source to the derived profile, as `unitModels` already does for a replacing block. `unit.models()` is unchanged.
- **Gear engine (`restrictions.ts`, default gear, per-model upgrades):** keeps reading the record's profiles and counts, so it needs no change, as long as it isn't handed the played unit's split counts. Where gear is shown per profile, the derived profile shows its source's per-model gear for its models.
- **Display:** the unit card lists the derived profile with its count, name, stats, rules and tags, and lowers the source's count. A source left with no models isn't shown.
- **Data editor:** a "one model" effect editor that holds a list of the existing stat, special-rule, trait and sub-type editors without their profile filters.

## If accepted: what changes

- `src/game_data/schema.ts`: `ModelEffectSchema` (`kind`, `profiles`, `count`, `name`, `effects`, `when`), with a nested-effect union of stat, special-rule, trait and (with S1) sub-type effects without `profiles`. It is added to the slot-option, option, group and slot effect unions, not to unit-modifier actions, list choice values or `listEffects`.
- `src/game_data/validate.ts`: the checks above. The nested `when` keeps the `profile` scope. The vocabulary walk visits nested effects.
- The data schema spec: a new subsection after §5.1 (composition), and the effect order section.
- The expression spec's scope table: "`model` effect `when`: as a trait effect without `profiles`; its nested effects: as a stat effect".
- The authoring guide: the "made entirely of" selector idiom (requirement 1), and the new effect with its gear rule.
- `profile-trait-effects.md` part 2: allow `subType` inside a `model` effect in slot options.
- `examples/full`: a multi-model Foundry unit, and a prime slot option that splits one model off with a stat change.
- The CHANGELOG with "For the app" notes, the version, and a regenerated JSON Schema.

## Open questions

1. **Choosing between profiles.** When the filter picks several profiles with models (say a unit of troopers and two kinds of specialists, where "one model" may be any), the first in record order is taken. Should the player pick instead? That would need a saved field on the pick (`slotOptions: { [tag]: { option, model: profileId } }`). Every known rule has one matching profile, so first-match is proposed until one doesn't.
2. **No model to split.** If the picked profiles have no models (a replacing block took them all), the effect does nothing. Should the app flag the pick, as it does for a slot option whose `when` turns false?
3. **Two splits on one unit.** Two options that each give "one model" a benefit make two split-off models. The rules may allow the player to give both to the same model. Is two separate models acceptable, or should a second split be able to take its model from the first's derived profile (for example, by a `profiles` filter matching the first's sub-type)?
4. **List-wide splits.** Is there a rule like "one model in every unit in the list gains…", which would need the effect in list choice values or `listEffects`?
5. **Name of the kind.** `model` reads well in data (`{ "kind": "model", "count": 1 }`), but sits close to `unit.models()` and `modelCount`. `split` or `someModels` are alternatives.
