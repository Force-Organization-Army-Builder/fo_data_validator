# Proposal: exchanging a special rule through an effect

Status: **Option A implemented in validator 2.5.0** (see `CHANGELOG.md`, the authoring guide and the data schema spec §5.4 for what shipped). One change from the draft below: `remove` and `replace.from` ids only need to exist in some loaded game, faction or sub-faction, not where the effect is defined, so a game-level effect can take away a faction's rule. `examples/full` uses Skirmisher (X) and Armoured (1) in place of Raider and Holder. The open questions at the end are still open.

## The rule

A data source needs to model a group (a detachment) whose rule reads, in generic terms:

> When adding a unit in this group to the list, all models in that unit with the Raider (X) special rule may have it exchanged for the Holder (1) special rule.

Raider (X) and Holder (X) are configurable faction special rules. Today the rule can only be left as description text.

## Requirements

1. **Remove or replace a special rule through an effect.** `specialRule` effects (`{ kind, profiles?, rule, when? }`) can only add a rule. Trait effects already have `add` / `remove` / `replace`. The exchange drops Raider whatever its X is, and gives Holder a fixed value of 1.
2. **Only models that hold the rule.** The exchange reaches only profiles that hold Raider. A `ProfileFilter` matches profile type and tags, not special rules. Either a replace is implicitly limited to profiles holding a `from` rule, or filters and selectors gain a special-rule match.
3. **Optional, per unit, in one group.** The player decides for each unit in that group. Units in other groups can't take it.
4. **No edits to unit records.** The only workaround today is a free checkbox upgrade, with option `effects` and a `when`, added to every eligible unit. In the motivating source that is about 45 units across a faction file and 18 sub-faction files. A design where the group offers the choice means no unit records change, and new units with the rule qualify automatically.
5. **App behaviour and checks.** The design has to fit the effect order, show the choice sensibly, and give the validator something to check: unknown rule ids, values on configurable rules.

## What exists today that helps

- **Slot options already give an optional, per-slot choice.** A slot with a tag offers that tag's slot options. The player picks at most one per tag per slot, and the list records it as `slotOptions: { [tag]: { option } }`. A slot holds one unit, so this is a per-unit choice.
- **A group can give a tag to its slots.** A group `effects` entry `{ "kind": "slotTag", "add": [tag] }` (validator 2.2.0) tags every slot of the group that holds a unit, including sourced slots and slots added later. A plain slot `tags` entry does the same slot by slot.
- **A slot option's `units` selector decides where it is offered.** It is matched against the unit as it stands before slot-option effects.
- **Slot options are applied last** (order: the unit's own traits, sub-faction unit modifiers, list choice values, options, the group, the slot's `effects`, slot options). So an exchange made there sees the rule wherever it came from.
- **The app adds special-rule effects per profile.** `applyProfileEffects` (`force_org` `src/api/list/profiles.ts`) appends the rule to each profile the filter picks, skipping an exact `(id, value)` duplicate. There is no removal.

Requirement 3 is mostly covered already. Two things are missing: a way to **remove or replace** a rule (requirement 1), and a way for a selector to **match on a special rule** (requirement 2), so the choice is only offered where it does something.

## Shared building blocks (needed by every option)

### B1. `remove` and `replace` on the special-rule effect

This mirrors the trait effect. `rule` (add) becomes optional, and at least one of `rule`, `remove` or `replace` is required:

```json
{ "kind": "specialRule", "rule": { "id": "fearless" } }
{ "kind": "specialRule", "remove": ["raider"] }
{ "kind": "specialRule", "replace": { "from": ["raider"], "to": { "id": "holder", "value": "1" } } }
{ "kind": "specialRule", "profiles": { "anyOf": ["infantry"] },
  "replace": { "from": ["raider"], "to": { "id": "holder", "value": "1" } } }
```

Semantics, per profile the `profiles` filter picks (all of them when it is left out):

- `remove`: the profile loses every selection of those rule ids, whatever their value.
- `replace`: the profile loses every selection of a `from` id. Only if it held one does it gain `to`. A profile holding none of `from` is untouched, so requirement 2 needs no filter.
- `to` is a `SpecialRuleSelection`. A `value` given to a rule that isn't `configurable` is the existing warning. Left out, a configurable rule takes its `defaultValue`, as for any selection.
- `from` ids match any value: Raider (2) and Raider (3) are both exchanged. A rule may appear in both `from` and `to`, which re-values it (`from: ["armoured"]`, `to: { "id": "armoured", "value": "1" }`).
- If the profile already holds `to` with the same value, it isn't listed twice, as for adds today. Holding `to` with another value is left as two selections; how they stack is the game's rules text.
- Within one effect, the steps run in this order: `remove`, then `replace`, then `rule` (add). This is the same order as the trait effect's `remove` / `replace` / `add`.
- Unit-level `specialRules` (a unit with no profiles, or rules written on the unit) are changed the same way as a profile's.

Alternative shape: a separate kind, `{ "kind": "specialRuleChange", "remove"?, "replace"? }`, which keeps `specialRule.rule` required. That avoids a type change in the app, but it splits one concept across two kinds and breaks the trait effect's pattern. Recommended: extend `specialRule`.

### B2. `specialRules` in selectors

`UnitSelector` (and its `exclude` entries) gains `specialRules: [ruleId, …]`. A unit matches when any profile, or the unit itself, holds any of them, with any value:

```json
"units": { "specialRules": ["raider"] }
"units": { "roles": ["troop"], "exclude": [{ "specialRules": ["holder"] }] }
```

- What it sees follows the trait rules. A group's and its slots' `units` see the unit before the group's effects. A slot option's `units` sees the unit before slot-option effects, so rules from options, the group and the slot count. A sourced slot's `units` sees only the unit's own rules.
- An optional extra, not needed here: `specialRules` on `ProfileFilter`, to pick profiles by rule for stat effects ("models with Raider get +1 Move"). Leave it out until a source needs it.

## Design options for offering the choice

### Option A: a slot tag and a slot option (reuse what exists)

Only B1 and B2 are new. The data declares a slot tag for the group's benefit, a slot option that does the exchange, and has the group tag its slots.

Game (`game.json`):

```json
"slotTags": {
    "prime": { "id": "prime", "name": "Prime", "optionLabel": "Prime Option" },
    "garrison": { "id": "garrison", "name": "Garrison", "optionLabel": "Garrison Option",
                  "description": "A unit in a Garrison Detachment may take a Garrison option" }
}
```

Faction (the rules are faction records, so the slot option sits in the faction, where their ids resolve):

```json
"slotOptions": {
    "garrison-exchange": {
        "id": "garrison-exchange",
        "name": "Hold the line",
        "text": "Every model with Raider (X) exchanges it for Holder (1).",
        "slotTag": "garrison",
        "units": { "specialRules": ["raider"] },
        "effects": [{ "kind": "specialRule",
                      "replace": { "from": ["raider"], "to": { "id": "holder", "value": "1" } } }]
    }
},
"groups": {
    "garrison-detachment": {
        "id": "garrison-detachment",
        "name": "Garrison Detachment",
        "type": "core",
        "slots": [ { "roles": ["command"], "required": true }, { "roles": ["troop"], "repeat": { "min": 1 } } ],
        "effects": [{ "kind": "slotTag", "add": ["garrison"] }]
    }
}
```

How it plays: every slot of the group that holds a unit with Raider offers "Garrison Option: Hold the line". The player ticks it per unit. Units without Raider are never offered it. Units with Raider in other groups don't get the tag.

- **Pros:** the smallest change. Picking, saving, cost, `units` offering and the "one per slot" limit all exist already. No unit records change. Applied last, so Raider from any source is exchanged. Works for groups in the game or a faction. A later group with a different exchange can reuse the tag, kept apart by `category` and the slot-tag effect's `categories`.
- **Cons:** the rule isn't really about a slot, so the data has to invent a tag. The tag shows in the app's slot palette (colour and icon), which may read oddly. Only one option per tag per slot, so two independent exchanges in one group need two tags. The exchange lives in `slotOptions`, away from the group record that motivates it.

### Option B: `unitOptions` offered by a group or slot (new first-class concept)

B1, B2 and a new group (and slot) field: optional per-unit choices, each shown as a checkbox on matching units in the group:

```json
"garrison-detachment": {
    "id": "garrison-detachment",
    "name": "Garrison Detachment",
    "type": "core",
    "slots": [ … ],
    "unitOptions": {
        "hold-the-line": {
            "id": "hold-the-line",
            "name": "Hold the line",
            "text": "Every model with Raider (X) exchanges it for Holder (1).",
            "units": { "specialRules": ["raider"] },
            "effects": [{ "kind": "specialRule",
                          "replace": { "from": ["raider"], "to": { "id": "holder", "value": "1" } } }]
        }
    }
}
```

A list slot would record picks as `unitOptions: ["hold-the-line"]`. Effects would apply in a new step after the slot's `effects` and before slot options, or with slot options. The order has to be decided.

- **Pros:** the data reads like the rule. No invented tag. Several independent choices per group. Tied to the group, so a unit moved out of the group loses it.
- **Cons:** a second mechanism next to slot options that does nearly the same thing (`units`, `cost`, `effects`, one pick per unit). It needs a new list-save field, new app UI, a new effect step, and its own validator checks. That is more to build and more to explain in the guide.

### Option C: the group adds an upgrade to matching units

B1, B2 and a group-level copy of the sub-faction `addUpgrade` action. The group adds a faction upgrade, a free checkbox, to every matching unit in it:

```json
"upgrades": {
    "hold-the-line": {
        "id": "hold-the-line", "name": "Garrison Detachment",
        "perModel": { "type": "single" }, "multiSelect": true,
        "options": {
            "exchange": { "id": "exchange", "name": "Exchange Raider for Holder (1)", "cost": {},
                          "effects": [{ "kind": "specialRule",
                                        "replace": { "from": ["raider"], "to": { "id": "holder", "value": "1" } } }] }
        }
    }
},
"groups": {
    "garrison-detachment": {
        …,
        "unitModifiers": [{ "id": "garrison-exchange", "name": "Hold the line",
                            "selector": { "specialRules": ["raider"] },
                            "actions": [{ "kind": "addUpgrade", "upgradeId": "hold-the-line" }] }]
    }
}
```

- **Pros:** reuses the upgrade UI and the list's upgrade picks. Authors already know `addUpgrade` from sub-factions. The choice shows with the unit's other upgrades.
- **Cons:** the exchange runs at the options step, before the group's, the slot's and slot options' effects, so a Raider those add later isn't exchanged. The app has to drop the added upgrade, and its pick, when the unit leaves the group. The game has no `upgrades`, so a game-level group can't use it. It also reuses an upgrade's full machinery (`perModel`, `multiSelect`) for a single tick box.

### Not recommended: non-optional or per-unit workarounds

- A group `effects` entry with B1 alone would exchange the rule for every unit in the group automatically. That is wrong for an optional rule, but it's the right tool for a non-optional "models in this group replace X with Y".
- Adding a checkbox upgrade to every eligible unit (today's workaround) fails requirement 4.

## Trade-offs at a glance

| | A: slot tag + slot option | B: group `unitOptions` | C: group `addUpgrade` |
|---|---|---|---|
| New schema surface | B1, B2 | B1, B2, `unitOptions`, list field | B1, B2, group `unitModifiers` |
| New app UI | none (existing slot option picker) | new checkbox row, new save field | none (upgrade UI), plus clean-up on leaving the group |
| Effect order | last: sees every rule | new step to define | options step: misses later rules |
| Unit records touched | none | none | none |
| Game-level groups | yes | yes | no (game has no upgrades) |
| Reads like the rule | fair (invented tag) | good | fair |

## Recommendation

**Option A for 2.5.0: B1 (special-rule `remove` / `replace`) and B2 (`specialRules` in selectors), with the choice offered by a slot tag and slot option.**

It meets every requirement with the least new surface. The app already stores, prices and offers slot options per slot, and slot options run last, so the exchange sees the rule from any source. B1 and B2 are useful on their own: a group, list choice or sub-faction modifier can now say "models replace X with Y", and any selector can pick units by a rule.

If the invented tag reads badly in the app, Option B can follow later as a separate proposal. B1 and B2 carry over unchanged, so nothing in 2.5.0 is wasted.

## App behaviour to consider

- **Effect order is unchanged.** `remove` and `replace` act at whichever step their effect sits, on the rules as they stand after earlier steps. A rule added by a later step isn't affected. In a slot option (Option A) nothing comes later.
- **Applying.** `applyProfileEffects` must handle `remove` / `replace` / `rule` per profile, in that order, and treat `rule` as optional. `slot_option_summary.ts` also reads `effect.rule` and needs a text for replace ("Raider → Holder (1)") and remove. `SpecialRuleEffect.rule` becoming optional is a TypeScript change the app's compiler will flag.
- **Rule-driven mechanics follow the final rules.** A removed rule's `grants` (contingent resources) and `slots` (added slots) must stop applying, and a gained rule's must start. Compute them from the rules after every step. A slot option that removes a rule whose `slots` added that very slot would remove itself; the validator can't see this, so the app should just apply the final state.
- **Selectors.** `matchesUnitSelector` needs `specialRules`, fed with the unit's rules as they stand at that selector's point in the order (see B2).
- **Display.** The slot option shows under the tag's `optionLabel` like any other. The datasheet and profile view should show the rule's new value and drop the old rule's text when no model holds it any more. Highlighting a changed rule, as `adjustedStats` does for stats, would help.
- **Saved lists.** A pick is stored by tag on the slot. If the slot's unit changes to one the option's `units` no longer matches, the pick should be dropped or flagged, as for any slot option.

## Validator checks

Errors:

- An unknown rule id in `remove`, `replace.from` or `replace.to` (the existing `unknown special rule` check, against the faction with its sub-faction, then the game).
- An empty `remove` or `replace.from`.
- A `specialRule` effect with none of `rule`, `remove` and `replace` (shape).

Warnings:

- `replace.to.value` on a rule that isn't `configurable` (the existing check).
- A configurable `to` with no `value` and no `defaultValue`.
- A rule id listed twice.
- A rule both added and removed in one effect.
- Selector `specialRules`: an unknown rule id. This should be a warning, as for selector `traits`: a game-level selector may name a faction's rule.
- Optional: a selector `specialRules` id that no unit in the source holds, which offers nothing.

Scopes for `when` are unchanged (special-rule effects keep `profile`).

## What changes, and where

Validator 2.5.0 (minor: additive, so `schemaVersion` and `expressionVersion` stay 1):

- `src/game_data/schema.ts`: `SpecialRuleEffectSchema` (optional `rule`, plus `remove`, `replace`, and a refine requiring at least one) and `unitMatch` (`specialRules`). Then run `npm run generate-schema` to update `schema/`.
- `src/game_data/validate.ts`: rule checks for `remove` / `replace`, and selector `specialRules` checks.
- `src/game_data/versions.ts` (`VALIDATOR_VERSION`) and `package.json`: 2.5.0.
- `docs/data_authoring_guide.md`: Effects (the special-rule forms next to the trait ones), Selectors (`specialRules`), Slot options (an exchange example).
- `docs/specs/data_schema_spec_2026-10-17.md`: special-rule effects (beside §5.2 trait effects), §5.2 order note, §8 selectors, §3.8 slot options.
- `CHANGELOG.md`: a 2.5.0 entry with a "For the app" paragraph, as in earlier releases.
- `examples/full`: Raider/Holder-style rules, a group, a slot tag and a slot option using them, and `"minValidatorVersion": "2.5.0"`.
- Tests: shape, checks and the example list.

Data using it sets `"minValidatorVersion": "2.5.0"` and needs an app that applies `remove` / `replace` and selector `specialRules`.

## Open questions

1. Should `replace.to` be able to keep the `from` rule's value (`"value": "from"`)? It isn't needed for this rule.
2. Should B2 also add a `rule:` expression reference (`unit.is(rule:raider)`, `profile.is(rule:raider)`) for `when`? That changes the expression spec; not needed here.
3. Option A's tag: is a slot-palette badge acceptable for a group benefit, or should a slot tag be able to hide its badge?
