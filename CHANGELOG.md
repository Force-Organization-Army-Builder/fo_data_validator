# Changelog

## 2.1.0

- **Root group types with `source: "any"`.** A root group type's `source` takes a third value: `"any"` starts a contingent whose faction (and sub-factions) the player picks freely from every faction of the game, **the list's main faction included**. `"ally"` stays "a faction other than the main one" and `"main"` is unchanged. For a detachment that may be of any faction, as long as all its units come from that one faction: `"detachment": { "id": "detachment", "name": "Detachment", "contingent": "root", "source": "any", "max": 1 }`. Until now the only way to let such a detachment take the army's own faction was to link it to the main root, which tied it to the main faction.
- A contingent from an `any` root is never the main contingent, even when it takes the main faction: `main` still means the contingent whose root type has `source: main`. As before, a faction's `defaultGroup` must be of a `main` root type, so a group of an `any` root type there is an error, and `source` on a linked group type is a warning.
- The JSON Schema for game files accepts `"any"`.
- `examples/full` has a `detachment` group type (`source: "any"`, at most one) with a `heavy-detachment` group, and declares `"minValidatorVersion": "2.1.0"`.
- **For the app:** `GroupType['source']` is now `'main' | 'ally' | 'any'`. The builder needs to offer every faction of the game (the main one included) when the player adds a group of an `any` root type, and must not treat that contingent as the main one.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `source: "any"` should set `"minValidatorVersion": "2.1.0"` in its manifest, and needs an app that supports it.

## 2.0.0

A major release, because some data that passed 1.x is now rejected. The `v1` tag and the `@1` JSON Schema URLs stay on 1.14.0; to move, use `@v2` for the GitHub Action, `#v2.0.0` in `package.json`, and `@2` in `$schema` URLs. `schemaVersion` stays 1 and `expressionVersion` stays 1, so a source needs no change to its manifest.

- **Stricter check: counts must be whole numbers.** This can reject data that passed before. A unit's `modelCount`, `additionalModels.max`, an upgrade's `perModel.everyX` and `perModel.count`, `swapFrom.count`, the models in a composition block and a group requirement's `count` must be whole numbers of 1 or more. `perModel.max`, a composition block's `min` and a slot's `repeat.min` must be whole numbers of 0 or more. A `min` or `max` that takes a number or an expression (group types, groups, slot `repeat`, upgrades, options, composition blocks, unit limits, unit-count list rules, sub-faction groups) takes a whole number of 0 or more as its number. A gear limit's `count` must be above 0 and may still be a fraction. The JSON Schema says `integer` with a `minimum` for these, so editors flag them too.
- **Stricter check: a fixed `min` above a fixed `max` is an error** on group types, groups, slot `repeat`, upgrades and unit-count list rules, as it already was on sub-faction groups and composition blocks.
- **Game `traits`.** A game may define its unit traits, `{ "field-army": { "id": "field-army", "name": "Field Army", "description": "…" } }`, as it can its `subTypes`. When it does, a unit or profile trait, a trait an effect gives or takes, a selector's `traits` entry or a `trait:` reference that matches none is a warning. Left out, nothing changes. `examples/full` defines them and declares `"minValidatorVersion": "2.0.0"`. Data that uses `traits` in the game file needs validator ≥2.0.0 and an app that supports it.
- **Versions are read.** A file's `version` that isn't `major.minor.patch`, a version range that can't be read, and a range that leaves out the version it is about are warnings: a faction's `game.versions` against the game, a sub-faction's `parent.versions` against its parent faction, and, in `fo-validate`, an `extends` entry's `versions` against the game it binds to. Ranges are comparators separated by spaces (`>=1.2.0 <2.0.0`), with `||` between alternatives and `^`, `~` and `*` understood.
- **More warnings for fields that are never read:** a resource's `capacityStat`, `defaultLimit` or `message` on a resource of another scope, `perModel.everyX` on an upgrade that isn't `one-in-x`, and `source` on a linked group type.
- **For the app:** `satisfiesRange`, `isVersionRange` and `isRelease` are exported, as are `WholeNumberSchema`, `PositiveWholeNumberSchema`, `CountOrExprSchema`, `TraitSchema` and the `Trait` type. `ExpressionVocabulary` gains `definedTraits`.
- **New warnings.** None of them is an error, so data that passed still passes:
    - a stat effect's `add` on a stat that no unit stat template marks `numeric`;
    - a `value` given to a special rule that isn't `configurable`;
    - a unit with no profiles, an upgrade with no options, and a stat effect with no changes;
    - two factions with the same id, or two sub-factions of one faction with the same id. Two sources may each provide a faction with the same id, so this stays a warning; within one source it is a mistake.
- No change to what data passes, and the JSON Schema files are unchanged. Lists that were declared twice now have one definition each, in `src/game_data/schema.ts`: the built-in scopes (`BUILT_IN_SCOPES`, with the new `TERM_SCOPES` for the nine a game can rename in `terms`), `COST_TARGETS` and the faction record kinds. The stat, special-rule and trait effects that five places listed separately come from one list.
- **For the app:** `TERM_SCOPES`, `UnitEffectSchema` and the `UnitEffect` and `TermScope` types are new exports. `BUILT_IN_SCOPES`, `BuiltInScope` and `COST_TARGETS` keep their names and values; `COST_TARGETS` is now a readonly tuple.

## 1.14.0

- **Stricter check: ids must be lowercase kebab-case.** This can reject data that passed before. Every record id, every reference to one, every record key and every `@selector` reference must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (letters a-z and digits, with single hyphens between words, e.g. `infantry-squad`), the id rule of the expression language. The spec always required this (§1.2), and an id that breaks it could never be referenced from an expression, so a bad id, which used to pass unreported, is now a shape error. A bad key is reported at its own path as `invalid key 'Bad ID': ids are lowercase kebab-case: …`. A term's `word` must also follow the expression name rule, which means starting with a letter. The JSON Schema carries the pattern (`pattern` on ids, `propertyNames` on every id-keyed map), so editors flag bad ids as you type. Every example source and the game template pass unchanged.
- **`minValidatorVersion` in the manifest.** A source may declare the oldest validator release it needs, as exactly `major.minor.patch`: `"minValidatorVersion": "1.14.0"`. An older validator then refuses it with one error, `this source needs validator 1.15.0 or newer, but this is 1.14.0; update Force Org or the validator to use it`, instead of listing the newer fields as unknown properties. A malformed value is an error. Left out, nothing is checked and nothing is reported. **Known limit:** validators 1.13 and older don't know the field and reject it as an unknown property, so it only helps from 1.14.0 on and a value below `1.14.0` is never useful. Set it when the source starts using a feature from 1.14.0 or later, to the release that added that feature.
- **Version checks come first.** `fo-validate` checks each manifest's declared versions (`minValidatorVersion`, `schemaVersion`, `expressionVersion`) on the raw file before reading the rest of the source or checking shapes. If any is an error, only those errors are printed (exit 1). Before, shape errors replaced the version errors, so a too-new `schemaVersion` was hidden behind its unknown properties. Version warnings still appear alongside the later results.
- **For the app:** `VALIDATOR_VERSION` (this release, as a string) and `compareReleases` are exported, and `checkManifestVersions` takes any value (the raw parsed manifest) without throwing. The Force Org app must run `checkManifestVersions` before `checkShapes` in its own load path and stop on its errors, as `fo-validate` now does.
- The shape check's `unknown property` message now ends `(misspelt, or a field from a newer validator release)`. When a union's branches tie, it reports the branch whose value had the right type: a malformed `@ref` reports the reference rule, not "expected object".
- The data checker's own "a selector reference starts with '@'" check is gone, because the schema guarantees it.
- `examples/full` declares `"minValidatorVersion": "1.14.0"`. `examples/starter` doesn't, so it stays the smallest valid source.
- `schemaVersion` stays 1 and `expressionVersion` stays 1. Data that declares `minValidatorVersion` needs validator ≥1.14.0.

## 1.13.0

- **Effects on list choice values.** A list choice's value may carry `effects` (stat, special-rule and trait effects, as on a group) and a `units` selector (or `@ref`): while the value is picked, its effects apply to every matching unit in the list, in every contingent, allies included (`units` left out = every unit). For a stance that gives every unit a trait: `"defensive": { "id": "defensive", "name": "Defensive", "effects": [{ "kind": "trait", "add": ["Dug In"] }] }`, replacing a trait effect with `when: choice(stance) == defensive` repeated in every group. The pick is the condition, so no `choice()` is needed; a `when` is still allowed.
- **Order.** In a played unit, choice value effects apply right after the resolved faction unit (its own traits and sub-faction unit modifiers) and before option effects, then the group's, the slot's and slot options'. `units` sees the resolved faction unit; a group's `units` selector and later `when`s see the traits a choice gives.
- New checks, as for group effects: unknown stats, special rules and selector refs, empty trait effects, `when` expressions (scopes `profile`, except on trait effects, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`) and profile filters; `units` without `effects` is a warning. Traits a choice gives are known to selector `traits` and `trait:` references.
- Fix: the shape check no longer overflows the stack on an effect (or other discriminated union) with an unknown `kind`; it reports the expected kinds.
- `examples/full`'s `stance` values carry effects: `offensive` gives `@line-troops` the Assault Troops trait; `defensive` gives infantry profiles +1 Morale and units of 5 or more models the Dug In trait.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using choice value effects needs validator ≥1.13.0 and an app that supports them.

## 1.12.0

- **Sub-type records.** A game may define `subTypes` next to `unitTypes`, keyed by id, each `{ "id", "name", "description"? }` (the same shape as a unit type): `{ "sergeant": { "id": "sergeant", "name": "Sergeant", "description": "Counts as two models when holding an objective." } }`. `description` holds the rules text every model with the sub-type follows, as a unit type's `description` does for its type. Units and profiles still carry sub-types as `tags`, which match a sub-type by name, case-insensitively, or by id (`Gun-crew` → `gun-crew`). `subTypes` is optional.
- New checks (warnings only, and only when the game defines `subTypes`): a unit or profile tag that matches no sub-type; a `tag:` reference to no sub-type (checked against the game's sub-types instead of the tags the faction uses, so a sub-type no unit has yet is fine); a ProfileFilter `anyOf` / `noneOf` value that is neither a unit type id nor a sub-type. Tags stay free text, so no data has to change. `subTypes` ids must equal their keys (an error, as for every record map).
- `examples/full` has sub-types for every tag it uses (`line`, `sergeant`, `character`, `unique`, `elite`), some with rules text, and a description on the `infantry` unit type. Two of its profile filters named the `trooper` profile id, which filters never match (they match type and tags); they now read `{ "noneOf": ["Sergeant"] }`. The extension's `militia` is tagged `Line`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `subTypes` needs validator ≥1.12.0 and an app that supports it.

## 1.11.0

- **A template per weapon profile.** A weapon profile may name its own `template`, replacing the weapon's for that profile, so one weapon can have a ranged and a melee profile: `{ "id": "spear", "template": "ranged", "profiles": [{ "name": "Spear (Thrown)", "stats": { … } }, { "name": "Spear (Melee)", "template": "melee", "stats": { … } }] }`. Each profile's `stats` are checked against its own template. New checks: an unknown profile template is an error; one equal to the weapon's is a warning. The weapon's `template` stays required and is the template of every profile without one.
- **Traits on unit profiles.** A unit profile may have `traits`, which only that profile's models hold ("Shield (shield-bearers only)"). A profile holds the unit's traits plus its own; the unit holds a trait when any of its profiles does (selector `traits`, `unit.is(trait:…)`, container `count(trait:…)`), the way profile `tags` already count for the unit. Trait effects' `remove` and `replace` also act on profile traits; `add` gives the trait to the unit. Profile traits are known to the checker, so a selector naming one doesn't warn.
- **Gear notes.** A `defaultGear` entry may have a `note`, and an upgrade a `gearNote`: short text shown next to one use of the gear, e.g. its mount, so one weapon can be "Turret mounted" on one unit and "Hull mounted" on another without a second record. `gearNote` covers every gear the upgrade's picks give (its options' `weaponRefs` / `equipmentRefs` and swap `to`s, including the `default` option's and those of options reached through a reference), so a shared list stays note-free and each referencing upgrade gives the mount for its unit; the referencing upgrade's note wins over the shared upgrade's. Notes are display only: matching and counting stay by kind and id. New checks (warnings): an empty note; a `gearNote` on an upgrade whose options give no gear.
- `examples/full` has a `spear` (thrown and melee profiles) carried by the `general`, profile traits (a `Shield` on the squad's `sergeant`, which `veterans`' `tower-shields` replaces with `Tower Shield`, and a `Spotter` on the `gun-team`'s `gunner`, which `veterans`' `trained-spotters` selects the unit by and reads with `profile.is(trait:spotter)`), and gear notes (on the `walker`'s cannon, the `gun-team`'s per-model cannons, and the `carrier`'s two rifles in different places; `gearNote` on the `carrier`'s `pintle-weapon` exchange, whose default option gives the noted gear, and on `trooper-sidearm`, whose gear comes from a shared list).
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using any of these needs validator ≥1.11.0 and an app that supports it.

## 1.10.0

- **Composition `max` as an expression.** A composition block's `max` may be an expression, evaluated live for the unit as it stands (the block's own copies included) in the unit's scopes (`unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`), rounded down, with a negative result counting as 0. For "for every 5 models in the unit, 1 Pioneer may be replaced with 1 Pioneer Chief": `{ "id": "pioneer-chief", "profiles": { "pioneer-chief": 1 }, "min": 0, "max": "floor(unit.models() / 5)", "cost": { "points": 20 }, "replaces": { "block": "pioneer", "profile": "pioneer" } }`. When the cap drops below the copies taken, the app flags the unit; it doesn't remove copies.
- New checks: the expression checks in the unit's scopes; a block with an expression `max` needs a `cost`; only a block that `replaces` models may read `unit.models()` in its `max` (a block that adds models would change its own cap). A `max` that reads nothing but `unit.models()` is worked out at every size the unit can have: below the block's `min` at the size as bought is an error, never above `min` is a warning, and the models a replacing block can take are checked against the fewest the target may hold at each size. A `max` that reads anything else is left to the app.
- `examples/full` has a `pioneer-squad` using it.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using an expression `max` on a block needs validator ≥1.10.0 and an app that supports it.

## 1.9.0

- **`perModel.count` for `one-in-x`.** A `one-in-x` upgrade may set `count`, the picks allowed per `everyX` models, so the cap is `count × floor(models / everyX)`. For "Up to two models in every five may each swap their X …": `"perModel": { "type": "one-in-x", "everyX": 5, "count": 2 }` (2 picks at 5 to 9 models, 4 at 10, where `multiple` with `max: 2` stays at 2). Left out, it is 1, as before. New checks: `count` on any other `perModel.type` is an error (pointing `multiple` / `single` at `max`), as is a `count` that isn't a whole number of at least 1; `count: 1` is a warning, since it is the default.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `count` needs validator ≥1.9.0 and an app that supports it (until then the app allows one pick per `everyX`).

## 1.8.0

- **Upgrade `mirrorOf`.** A unit upgrade may name a sibling upgrade on another profile with `mirrorOf`: it always takes the same option as that source, never chosen by the player, with the amount set by its own `perModel` and profile, and costs per pick as usual. For "every model must have the same item" when the models are on different profiles, e.g. the Troopers' `option-1` (`profileId: trooper`) and the Sergeant's `option-1-sergeant` (`profileId: sergeant`, `mirrorOf: "option-1"`). New checks (errors): the source exists in the unit and isn't the upgrade itself; the source has no `mirrorOf` (no chains or cycles); the two have different `profileId`s; they offer the same option ids, UpgradeReferences expanded, and the same `default`; the mirror's `perModel.type` is `every` or `single`; neither `replaces` the other. Warnings: the mirror's `multiSelect` differs from the source's, or the mirror has `restrictions` or `limitBy` that could block the copy. Only on unit upgrades (faction upgrades and sub-faction `addUpgrade` copies can't mirror).
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `mirrorOf` needs validator ≥1.8.0 and an app that supports it.

## 1.7.0

- **Several gear in one swap.** An option swap's `from` may be a list of gear refs: `{ "from": [{ "kind": "weapon", "id": "pistol" }, { "kind": "weapon", "id": "sword" }], "to": { "kind": "weapon", "id": "twin-blades" } }`. Each pick takes one of every listed `from` off the upgrade's profile and gives one `to`; the picks are capped by the scarcest `from` held, so a pick is all or nothing. A single ref is still valid. `swapFromRefs(swap)` returns a swap's `from` as a list. New checks: every `from` exists, and a `from` list is not empty and doesn't list the same gear twice. Swap issues are now reported at `…/swaps/<index>`.
- **`swapFrom` on gear from another pick.** The warning that the unit doesn't hold an upgrade's `swapFrom` gear by default is not raised when the upgrade's `restrictions.required` names that gear: the swap applies once an earlier pick has given it. Option-level `swaps` were never checked against default gear, so nothing changes there.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using a `from` list needs validator ≥1.7.0 and an app that supports it.

## 1.6.0

- **Upgrade `swapFrom`.** A unit upgrade may have `swapFrom: { kind, id, count? }` (count defaults to 1): each pick of any of its options, including options pulled in by an UpgradeReference to a shared faction upgrade, takes that much of the gear off the upgrade's profile (or the unit at large), up to what is held, besides giving the option's own gear. Options with their own `swaps` keep them instead; the `default` option is not affected. New checks: the gear exists, `count` is positive, and warnings when every option is the default or the unit holds no such gear by default. `schemaVersion` stays 1; additive.

## 1.5.0

- **Slot tag look.** A `slotTags` entry may have `color` and `icon`, names from the app's fixed palette and icon set (colours `amber`, `red`, `orange`, `green`, `teal`, `blue`, `violet`, `pink`, `slate`; icons `star`, `spark`, `diamond`, `hex`, `cross`, `flag`, `swords`, `crown`, `fleur`, `circle`, `triangle`, `square`, `target`, `bolt`). The app marks the tag's slots with them; left out or unknown, it picks a look from the tag's id. The names aren't checked here, so the app can add to its lists without a release.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive.

## 1.4.0

- **Composition blocks that replace models.** A block may carry `replaces: { block, profile }`: each copy takes the place of models of that profile in another block instead of adding models ("one Sapper may be upgraded to a Foreman for +10 points"). The unit's size and the target's cost are unchanged; only the profile counts move. New checks: the target block and profile exist, a replacing block isn't itself replaced, the models replaced never exceed what the target holds at its `min`, and `modelCount` accounts for them.
- **List rules in factions and sub-factions.** `listRules` is allowed in faction and sub-faction files, applying to contingents using that faction or a sub-faction the contingent took. A sub-faction replaces a parent's rule by listing it in `overrides` with `"kind": "listRules"`; a faction rule with the game's id is a warning, like other hidden records.
- **Group-scope expression rules.** An `expression` list rule may have `scope: "group"` and `groupTypes`: the condition is checked once for each group (of those types, if given) with the `group`, `contingent`, `root`, `main` and `list` scopes, and flags the list without preventing anything.
- **Slot options may have `units`**: a selector limiting the option to slots whose unit matches, seen before slot-option effects (a trait from an option or the group counts).
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.4.0 and an app that supports them.

## 1.3.0

- **Slots filled from another faction.** A slot may have a `source`: `{ faction, subFactions?: "any" | [ids] }`, a faction of the same game (possibly from another source) and optionally its sub-factions, whose units may fill the slot whether or not the contingent took them. The slot's `units` selector picks among them (its `unitIds` are the source's units) and sees only each unit's own traits; the group's `units` doesn't apply. Borrowed units keep their own records but not their home sub-faction's unit modifiers.
- **Slot `effects`**: stat, special-rule and trait effects on the unit in the slot, after the group's effects, e.g. replacing a borrowed unit's faction trait.
- `source`, `units` and `effects` are allowed on group slots and on slot options' `slot` effects.
- **Special rules may add slots**: `slots`, each `{ roleChoices, units?, source?, effects? }`, added to the group once per unit with the rule.
- **Selector `exclude`**: units matching any entry (`unitIds`, `roles`, `traits`, `profiles`) don't match, e.g. `{ "exclude": [{ "profiles": { "anyOf": ["Unique"] } }] }` for "no Unique models".
- New checks: unknown source factions and sub-factions, `unitIds` not among the source's units, a slot a mechanic adds with no role.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.3.0 and an app that supports them.

## 1.2.0

- **Composition blocks.** A unit may list `composition`: blocks of models bought together, `{ id, name?, description?, profiles: { profileId: count }, min? (default 1), max? (default min), cost? }`. They give the number of models of each profile and how the unit grows, including multi-model increments (a Gun Crew of a Gunner and a Loader at +35 per crew) and extra models of one profile only. `modelCount` stays required and must match the blocks at their `min`; `additionalModels` isn't allowed alongside. `perModel` default gear with a `profileId` now means one per model of that profile.
- **Trait effects.** `{ "kind": "trait", "add"?, "remove"?, "replace"?: { "from", "to" }, "when"? }`, allowed in option effects, slot-option effects, unit-modifier actions and the new group `effects`.
- **Group `effects`**: stat, special-rule and trait effects applied to every unit in the group ("Every unit in this group gains the Gun Line trait").
- **Traits are matchable**: a `trait:` reference (`unit.is(trait:x)`, `profile.is(trait:x)`, `count`/`has` on groups, contingents and the list), and `traits` on unit selectors. Unknown traits are warnings. `ExpressionVocabulary.traits` (optional) lists the known traits.
- **`main` scope**: the list's main contingent (root group type with `source: main`), with `contingent`'s verbs, available wherever `list` is. E.g. a sub-faction `when` of `not main.is(faction:field-army) or main.is(subfaction:veterans)`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these needs validator ≥1.2.0 and an app that supports them.

## 1.1.0

- **Sub-faction groups.** A faction may declare `subFactionGroups` (each with `min`, default 0, and `max`, default 1, as numbers or expressions in the `contingent` / `root` / `list` scopes), and a sub-faction may name its `group`, so a contingent can take several sub-factions of one faction: one per group, or up to the group's `max`. Sub-factions without a `group` are in the `default` group (max 1), so existing data validates unchanged.
- A sub-faction may have a `when` condition for when it may be taken (`contingent`, `root`, `list` scopes).
- New check: sub-factions that can be taken together must not define the same record or unit modifier differently, or override the same parent record differently.
- `schemaVersion` stays 1; the additions are optional. Data using `group`, `when` on a sub-faction, or `subFactionGroups` needs validator ≥1.1.0 and an app that supports several sub-factions.

## 1.0.0

- First release.
