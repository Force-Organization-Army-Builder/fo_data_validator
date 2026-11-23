# Proposal: trait effects on some profiles, and effects that add sub-types

Status: **part 1, Option A, implemented in validator 2.9.0**, with the empty-filter warning (see `CHANGELOG.md`, the authoring guide and the data schema spec §5.2). Using `profile` in a filter-less trait effect's `when` keeps today's generic "'profile' isn't available here" error. **Part 2, Option S1, implemented in validator 2.10.0** together with the `model` effect of `single-model-benefits.md` (see `CHANGELOG.md`, the authoring guide and the data schema spec §5.5). Two changes from the draft below: a `subType` effect is allowed inside a `model` effect, in slot options too; and without game `subTypes`, an id no unit or profile has as a tag is a warning (the ids it gives are then known to `tag:` references). The gear engine reads only record and unit-modifier tags, as S1 proposes (open question 4). From validator 2.11.0 a `subType` effect may also go directly in a slot option's `effects` (the whole unit, or with `profiles` some profiles), on the same grounds as inside a `model` effect: a sub-type given last still shows on the unit and counts in list rules and `tag:` references. Open questions 1–3 are still open. Written against validator 2.8.0 and the Force Org app as of 2026-11-20.

A data source has rules that give a trait to some models of a unit, not the whole unit. A trait effect has no profile filter, so today the whole unit gains the trait. A related gap is that no effect can give a model a sub-type (a profile or unit tag). This proposal takes both, with design options and example JSON, a recommendation, the checks the validator would add, and open questions. The examples use `examples/full` vocabulary: the `squad` unit has a `trooper` profile and a `sergeant` profile tagged Sergeant, and the game defines a Promoted trait. The motivating rules are described generically.

## Summary

| # | Question | Recommendation | Priority |
|---|---|---|---|
| 1 | A trait effect that reaches only some profiles | `profiles` on the trait effect (Option A). `add`, `remove` and `replace` then act on the picked profiles' own traits | **high** |
| 2 | Allowed where? | everywhere a trait effect is today | — |
| 3 | What reads them | no change. A profile's traits already count for its unit (validator 1.11.0) in `unit.is(trait:…)`, selector `traits` and `count(trait:…)` | — |
| 4 | `profile` in the effect's `when` | allowed when the effect has `profiles`, checked per profile, as for stat effects | high |
| 5 | Empty `anyOf` / `noneOf` | a warning on every profile filter, not just this one | low |
| 6 | Effects that give a sub-type | a `subType` effect, with its own semantics for gear (part 2) | medium, separate |

---

## Part 1: trait effects on some profiles

### The rule

**Rule shape.** "Any model with trait F and the Sergeant or Command sub-type, in a group with this option, gains trait P and special rule R." Only those models gain P. The rest of the unit doesn't.

**Today's workaround.** A sub-faction unit modifier with:
- `selector: { "profiles": { "anyOf": ["sergeant", "command"] } }`, which picks every **unit** that has such a profile;
- a special-rule effect with the same `profiles` filter, which reaches only those profiles (correct);
- a trait effect `{ "kind": "trait", "add": ["P"] }`, which has no filter, so the **whole unit** gains P.

So the app shows P on the whole squad, and anything reading the troopers' traits sees P there too.

### What exists today

- **Profiles already have their own traits** (validator 1.11.0, spec §5.1). A profile holds its unit's traits plus its own. The unit holds a trait when it, or any of its profiles, does. That applies to selector `traits`, `unit.is(trait:…)` and container `count` / `has` / `sum` with `trait:`, just as profile `tags` count for the unit.
- **Trait effects already touch profile traits, partly** (spec §5.2). `remove` and `replace` also act on each profile's own `traits`, so a faction-trait swap reaches every model. `add` always gives the trait to the unit.
- **In the app**, `applyUnitTraitEffect` (`force_org` `src/api/list/traits.ts`) applies `add` to `unit.traits` and `remove` / `replace` to each profile's own traits too. `unitTraits` and `profileTraits` give what a unit and a profile hold. `traitLabels` / `traitChips` show a profile-only trait as "Shield (Sergeant)". `playEffects` (`effects.ts`) checks a trait effect's `when` once for the whole unit (`profileId` undefined). A stat or special-rule effect's `when` is checked per profile, and the effect applies to the profiles where it holds (`applyEffect` with `profileIds`).
- **In the validator**, `effect()` strips the `profile` scope from a trait effect's `when`, and `TRAIT_EFFECT_SCOPES` in the app mirrors that.

So the storage (profile `traits`), the reading (unit holds it if any profile does) and the display all exist. Only the effect lacks a way to aim.

### Option A: `profiles` on a trait effect (recommended)

`TraitEffect` gains the `profiles` field stat and special-rule effects already have:

```json
{ "kind": "trait", "profiles": { "anyOf": ["sergeant"] }, "add": ["Promoted"] }
{ "kind": "trait", "profiles": { "anyOf": ["sergeant", "command"] }, "add": ["Promoted"],
  "when": { "if": "profile.is(trait:disciplined)", "message": "Only Disciplined models" } }
```

The motivating unit modifier then reads:

```json
"actions": [
    { "kind": "addUpgrade", "upgradeId": "promotion" },
    { "kind": "trait", "profiles": { "anyOf": ["sergeant", "command"] }, "add": ["Promoted"] },
    { "kind": "specialRule", "profiles": { "anyOf": ["sergeant", "command"] }, "rule": { "id": "battle-hardened" } }
]
```

**Semantics with `profiles`.** For each profile the filter picks, and that meets the `when` if there is one:
- **`add`:** the profile gains the traits as its own. `unit.traits` is unchanged. A profile that already holds the trait, whether its own or the unit's, doesn't gain it twice.
- **`remove`:** the profile stops holding the traits.
  - If the profile holds the trait as its own, it loses it.
  - If the trait is the **unit's**, it moves down: the unit loses it, and every profile the filter did **not** pick gains it as its own. The picked models lose it and the rest keep it. That is the exact meaning of "these models lose X", and the display (`profileOnlyTraits`) already shows the result correctly.
- **`replace`:** as `remove` for `from`. Each picked profile that held one of `from` (its own or the unit's) then gains `to` as its own.
- **A unit with no profiles:** the filter matches the unit itself, as for stat effects, and the effect acts on `unit.traits`.

**Without `profiles`** behaviour is unchanged: `add` gives the trait to the unit, and `remove` / `replace` act on the unit and every profile's own traits. An effect with a `profiles` filter that matches every profile is still a profile effect: `add` writes to each profile, not to the unit. The difference shows only in display, where the trait appears as "(Trooper, Sergeant)" instead of on the unit, and data that means the whole unit should leave `profiles` out.

**Where (requirement 2).** Everywhere a trait effect is allowed today, with the same shape: unit-modifier `actions`, option `effects`, group and slot `effects`, list choice values' `effects`, groups' `listEffects`, and slot-option `effects`.

**Reading (requirement 3): no change, documented.** A trait a profile gains counts for its unit, as profile traits do since 1.11.0:
- `unit.is(trait:promoted)`, selector `traits: ["Promoted"]` and `contingent.count(trait:promoted)` find the squad;
- `profile.is(trait:promoted)` is true on the sergeant only;
- a stat or special-rule effect later in the order with `when: profile.is(trait:promoted)` reaches only the sergeant.

The order (spec §5.2) is unchanged. Each step's conditions see the traits the steps before it gave, now per profile.

**`when` (requirement 4).** A trait effect with `profiles` may use the `profile` scope in its `when`, which is checked per picked profile, as for stat effects. Its scopes are then those of a stat effect: `profile`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`. Without `profiles`, `when` keeps today's scopes (no `profile`), because the effect still acts on the unit as a whole. This is how "models with trait F and the Sergeant sub-type" is written: the filter takes the sub-type, and `when: profile.is(trait:f)` takes the trait, since a profile filter matches type and tags, not traits.

**Pros.**
- It is the same field, and the same meaning, as on the stat and special-rule effects beside it, so one modifier can aim all three at the same models.
- It needs no new storage. Profile traits, the "unit holds it if any profile does" reading and the display already exist.
- Existing data is untouched.

**Cons.**
- Moving a unit trait down on a profile `remove` / `replace` is new behaviour to implement and explain. The alternative (Option A′, below) is simpler but inexact.
- `when`'s scopes depend on whether `profiles` is given, so the checker has to look at both.

**Option A′ (simpler `remove`).** With `profiles`, `remove` and `replace` act only on the picked profiles' **own** traits, and a unit-level trait is left alone, with a warning when a `from` / `remove` trait is known only as a unit trait. This is easier to implement, but "the sergeant loses F" silently does nothing when F is the unit's. Not recommended, though it would be acceptable if `add` were the only case data needs. All current motivating data uses only `add`.

### Option B: make a unit modifier's `selector.profiles` aim its trait actions

A trait action in a unit modifier would act on the profiles the modifier's selector matched.

- This changes the meaning of existing data. Today the selector picks units, and every action applies unit-wide unless it has its own filter.
- It helps only unit modifiers, not options, groups or choice values.
- Rejected.

### Option C: a separate effect kind, `profileTrait`

- **Pros:** `TraitEffect` keeps its type.
- **Cons:** two kinds for one concept, unlike stat and special-rule effects, which take `profiles` directly.
- Rejected for the same reason the special-rule exchange proposal kept `remove` / `replace` on `specialRule`.

**Recommendation: Option A**, 2.9.0, high priority. It is a correctness gap: the app shows and counts a trait on models that don't have it.

### Validation rules

| Check | Level |
|---|---|
| `profiles` values that match no unit type or sub-type | warning (today's check on every `profiles` filter, when the game has `subTypes`) |
| `profile` in a trait effect's `when` without `profiles` | error, as today: "a trait effect without `profiles` acts on the whole unit" |
| `profile` in a trait effect's `when` with `profiles` | allowed |
| A trait both given and taken away by one effect | warning (today's check) |
| `anyOf: []` (matches nothing) or `noneOf: []` (has no effect) on any profile filter | warning (new, for every `ProfileFilter`: stat, special-rule and trait effects, selectors, `excludeProfiles`), whether or not the game has `subTypes` |

Traits a profile-targeted effect gives count as known traits for `trait:` references and selectors, as `add` does today (`vocabulary.ts` already collects every trait effect's `add` and `replace.to`).

### App impact

- **`traits.ts`:** `applyUnitTraitEffect` takes the picked profile ids. With `effect.profiles`, it applies `add` / `remove` / `replace` to those profiles' own traits, moving a removed unit trait down to the unpicked profiles. Without `profiles` it behaves as today.
- **`effects.ts` (`playEffects` / `applyEffect`):** a trait effect with `profiles` follows the stat and special-rule path. The filter picks profiles, `when` is checked per profile, and the effect applies to the profiles where it holds. `TRAIT_EFFECT_SCOPES` applies only to trait effects without `profiles`.
- **`resolve.ts`:** a unit-modifier trait action with `profiles` and no `when` applies through the same function, so the faction unit carries profile-only traits.
- **Display:** no change. `traitChips` already shows profile-only traits with their profile names ("Promoted (Sergeant)").
- **Reading:** no change. `unitTraits`, `profileTraits` and the context views already read profile traits.
- **Data editor:** the trait effect editor shows the profile filter that stat and special-rule effects already have.

---

## Part 2: effects that give a sub-type (separate, later)

### The rules

1. "All models in this unit gain sub-type S." (an always-on rule, e.g. a unit modifier)
2. "Models of this kind may be given sub-type S." (a player's choice, an option)

**Today's workaround.** A trait named like the sub-type. Profile filters, selector `profiles` and `profile.is(tag:s)` don't see a trait, so anything keyed to the sub-type misses these models.

### Why this is harder than traits

Profile tags feed more than conditions. In the app, `profileTypes` (`profiles.ts`) gives a profile's type and tags, and they decide:
- which profiles every later effect's `profiles` filter picks;
- selector `profiles` matches;
- `tag:` references;
- the gear engine: `excludeProfiles` and per-model default gear in `restrictions.ts` read the same tags.

A sub-type given at the option step could change which models take default gear, which changes which options are offered. That is a loop the trait effect never has.

### Option S1: a `subType` effect (recommended for part 2)

```json
{ "kind": "subType", "add": ["line"] }
{ "kind": "subType", "profiles": { "anyOf": ["sergeant"] }, "add": ["character"], "remove": ["line"] }
```

- `add` / `remove` are game `subTypes` ids. Without `profiles` they change the unit's `tags`; with it, the picked profiles' `tags`. `profile` is allowed in `when` only with `profiles`, as in part 1.
- **What sees them:** later effects' `profiles` filters, selector `profiles` at their point in the order, and `tag:` references.
- **What doesn't:** the gear engine (`excludeProfiles`, default gear, swaps, `limitBy`). It reads the tags the unit's own record and its sub-faction modifiers give, so options never change which models hold gear. The authoring guide would say so.
- **Where:** unit-modifier actions, option effects, group and slot effects, list choice values and `listEffects`. Not slot options, which come last, so a sub-type they gave could only reach conditions. (Validator 2.11.0 allows them in slot options too; see the status above.)
- **Validator:**
  - an unknown sub-type is an error when the game declares `subTypes` (a warning otherwise);
  - a sub-type both given and taken by one effect is a warning;
  - empty `add` and `remove` together is an error.

### Option S2: `tags` on the trait effect

`{ "kind": "trait", "add": ["P"], "tags": { "add": ["line"] } }` puts two concepts in one effect. A trait is free text, while a sub-type feeds profile filters and needs the gear exclusion above. Rejected.

**Recommendation:** Option S1, medium priority, as its own change after part 1. It depends on part 1's profile-targeting semantics and needs the app's gear engine to keep reading record tags, so it is worth its own proposal review once part 1 has shipped.

---

## If accepted: what changes (part 1)

- `src/game_data/schema.ts`: `TraitEffectSchema.profiles` and its description.
- `src/game_data/validate.ts`:
  - keep the `profile` scope when a trait effect has `profiles`;
  - add the empty-filter warning to every profile filter (the `profileFilters` walk already visits every `profiles` key, so the new field is checked automatically).
- The expression spec's scope table: "Trait effect `when`: as a stat effect's; without `profiles`, no `profile`".
- The data schema spec §5.1 (profile traits) and §5.2 (trait effects).
- The authoring guide's Effects section.
- `examples/full`: a group or modifier giving Promoted to the `squad`'s sergeant only.
- The CHANGELOG with "For the app" notes, the version, and a regenerated JSON Schema.

The app needs the per-profile trait path described above.

## Open questions

1. **A profile filter matching every profile.** Should it write the trait to each profile (as specified) or collapse to the unit? Writing per profile is predictable, and data can leave `profiles` out to mean the unit. Collapsing would make the display tidier but makes the result depend on how many profiles the unit happens to have.
2. **Models added later.** Profiles come from the unit record, and composition blocks add models of existing profiles. So a trait on the sergeant profile covers every sergeant model, and no new profile appears mid-list. Confirm nothing in the composition engine creates profiles.
3. **Unit-level `when` with `profiles`.** A `when` that reads only `unit` or `contingent` gives the same answer for every profile. That is fine, and evaluating it once is an app optimisation, not a data question.
4. **Part 2 and the gear engine.** Is "the gear engine reads record tags only" acceptable for every known sub-type rule? If a rule says "models with sub-type S may take gear G", the sub-type must be in place before options, which S1 allows only in unit modifiers and list-level steps.
