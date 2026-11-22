# Changelog

## 2.10.1

- **`examples/full` is now "Sample Skirmish".** The full example is renamed so the app can offer it as its default example game: the game's `name` is "Sample Skirmish" and its `id` is `sample-skirmish` (was `full-game`). The source's `name`, `description` and `disclaimer` now read as a sample game, not a test fixture. The folder stays `examples/full`, so paths and URLs to it don't change.
    - **Breaking for data that names the game:** a faction, sub-faction or extension source that extends this game must use `sample-skirmish`. `examples/extension` and the docs' examples are updated. Saved lists for the old id don't carry over.
- **`examples/full`: `lead-construct` can now be picked.** The game's `standard-core` group gains a last, optional heavy slot tagged `prime`. Before, no slot both held a heavy unit and offered Prime options without a category limit: the Heavy Detachment's Prime slots take only Honour options. So the option couldn't be offered in a list built from the example alone. A Clockwork Guild list's Construct Pack in that slot is offered it. The slot is added last, so existing slot positions don't move. No schema or check change.
- No schema, check or data format change: `schemaVersion`, `expressionVersion` and the example's `minValidatorVersion` (2.10.0) stay as they are.

## 2.10.0

- **Benefits for one model: `model` effects.** A `model` effect splits one model of the unit (or `count`) off its profile into a copy of that profile, and its own `effects` change only that copy. It is for "one model in the unit, chosen by the player, gains +1 Armour and the Sergeant sub-type": `{ "kind": "model", "effects": [{ "kind": "stat", "changes": [ … ] }, { "kind": "subType", "add": ["sergeant"] }] }`.
    - **Source:** the first profile in record order that `profiles` picks (every profile when left out) and that has a model. Only the unit record's profiles are sources, so two `model` effects make two separate models.
    - **Counting:** the source's count falls by `count` and the copy holds them, as with a replacing composition block. `unit.models()` and the unit's cost don't change.
    - **Name:** `name`, or the source profile's name with the name of what gives the effect in brackets.
    - **Inside:** stat, special-rule, trait and sub-type effects without `profiles`. Their `when` may use `profile`, meaning the split-off model. The `model` effect's own `when` can't.
    - **Gear:** the gear engine still counts the model under its source profile, so it keeps its gear and gear choices and saved picks stay valid.
    - **Where:** slot options' `effects`, groups' `effects` and slots' `effects`; not upgrade options, unit modifiers, list choice values or `listEffects`.
    - **Saved lists** store nothing new: the split follows from the pick that gives it.
    - **Why:** effects reached whole profiles, so a unit whose models share one profile couldn't give one of them a benefit. Several slot options in a motivating source have that shape.
- **Sub-type effects.** `{ "kind": "subType", "profiles"?, "add"?, "remove"?, "when"? }` gives or takes away game `subTypes` (as `tags`): the unit's, or with `profiles` the picked profiles', whose `when` may then use `profile`. Later effects' profile filters, selectors and `tag:` references see the result; the gear engine doesn't.
    - **Where:** unit-modifier actions, upgrade option effects, group and slot effects, list choice values, `listEffects`, and inside a `model` effect. Not directly in a slot option's `effects` (a shape error points to the `model` effect).
    - **Checks:** with game `subTypes`, an unknown id is an error; without them, an id no unit or profile has as a tag is a warning, and the ids it gives are known to `tag:` references. An effect with neither `add` nor `remove` is an error; an id listed twice, or both given and taken away, is a warning.
    - **Why:** rules that give a sub-type were written as a trait named like it, which profile filters and `tag:` references don't see.
- **Checks for `model` effects.** Errors: no nested effects, a blank `name`, `profile` in its own `when`. Shape errors, each saying why: `profiles` on a nested effect, a nested `model` / `slotTag` / `slot` / `allowedRoles` effect, a `model` effect where it isn't allowed. Nested effects are checked as they are anywhere, and the traits they give count as traits in use.
- **Shape check messages.** An unknown property that a schema gives its own message for (such as `profiles` inside a `model` effect) shows that message instead of "unknown property".
- **Docs: "a unit made entirely of…".** `{ "traits": ["Foundry"], "exclude": [{ "profiles": { "noneOf": ["vehicle"] } }] }` matches only units whose every model is a vehicle with the trait (the data schema spec §8, the authoring guide's Selectors). No schema change.
- **New exports:** `SubTypeEffectSchema`, `ModelEffectSchema`, `SplitModelEffectSchema` and the `SubTypeEffect`, `ModelEffect` and `SplitModelEffect` types. `HeldUnitEffect` now includes `SubTypeEffect`; `GroupEffect`, `SlotUnitEffect` and `SlotOptionEffect` include `ModelEffect`.
- `examples/full` gains the Clockwork Guild's `construct-pack` (two to four battle constructs), the game's `lead-construct` prime option (the selector idiom and a `model` effect), and veterans' `seasoned-sergeants` (a `subType` effect with `profiles`). The source declares `"minValidatorVersion": "2.10.0"`. The authoring guide (Effects, Selectors, Slot options), the data schema spec (§5.2, §5.5, §5.6, §8), the expression spec's scope table, the README and the proposals (`docs/proposals/single-model-benefits.md`, part 2 of `docs/proposals/profile-trait-effects.md`) say so.
- **For the app:**
    - Apply a `subType` effect wherever trait effects apply: to the unit's `tags`, or with `profiles` to the picked profiles' `tags`, with `when` per profile. Keep the gear engine (default gear, per-model upgrades, `excludeProfiles`, `limitBy`) on the record's tags and those from unit modifiers.
    - Apply a `model` effect in `playEffects` at its step: pick the source, copy it as it stands under an id of the app's own (never saved), move `count` from the source's live count to the copy (as `unitModels` does for a replacing block), and apply the nested effects to the copy through the per-profile path. Do nothing, with an issue on the pick, when no picked profile has a model.
    - Show the copy as its own profile line with its count, name, stats, rules and tags, and lower the source's count; hide a source left with none. Show the copy with its source's per-model gear.
    - Keep the gear engine on the record's profiles and counts, not the played unit's split counts.
    - The data editor offers a sub-type effect editor, and a "one model" editor holding the stat, special-rule, trait and sub-type editors without their profile filters.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `subType` or `model` effects should set `"minValidatorVersion": "2.10.0"` in its manifest, and needs an app that supports them.
- **Docs: the order of a sub-faction's unit modifiers.** The data schema spec (§5.2, Order) and the authoring guide (Effects) now say a sub-faction's `unitModifiers` apply in the order the file lists them, and each modifier's `actions` in their own order. So an effect's `when` sees what came before it and nothing after it. `examples/full`'s veterans already depend on this: `sergeants-fine` reads the sergeant's Shield before `tower-shields` replaces it. Across several sub-factions the order isn't specified. No schema or check change.
- **For the app (unit-modifier order):** play a sub-faction's unit modifiers and their actions in record order, conditional and unconditional effects alike, so a `when` sees only the modifiers before it.

## 2.9.0

- **Trait effects on some profiles.** A trait effect may take `profiles`, the `ProfileFilter` stat and special-rule effects have. It is for "models with the Sergeant sub-type gain the Promoted trait": `{ "kind": "trait", "profiles": { "anyOf": ["Sergeant"] }, "add": ["Promoted"] }`.
    - `add` gives each picked profile the traits as its own; the unit's traits don't change.
    - `remove` / `replace` take them from the picked profiles. A trait of the whole unit moves down to the profiles not picked, so only the picked models lose it.
    - Its `when` may use `profile`, checked per profile, e.g. `profile.is(trait:shield)` for models holding a trait.
    - Without `profiles` nothing changes: the effect acts on the whole unit and its `when` has no `profile`.
    - Reading is unchanged: a profile's traits count for its unit (validator 1.11.0) in `unit.is(trait:…)`, selector `traits` and `count(trait:…)`, and `profile.is(trait:…)` is true only on the picked profiles.
    - **Why:** a trait effect had no profile filter, so "some models gain a trait" gave it to the whole unit.
- **Empty profile filters.** An empty `anyOf` (matches no profile) or `noneOf` (leaves none out) on any `ProfileFilter` (effects, selectors, `excludeProfiles`) is a warning, whether or not the game has `subTypes`.
- `examples/full`'s `sergeants-fine` modifier (veterans) gives Promoted to a squad's shield-bearing sergeant only, and the source declares `"minValidatorVersion": "2.9.0"`. The authoring guide (Effects), the data schema spec (§5, §5.2, §7), the expression spec's scope table, the README and the proposal (`docs/proposals/profile-trait-effects.md`) say so.
- **For the app:**
    - Apply a trait effect with `profiles` like a stat or special-rule effect: the filter picks profiles, `when` is checked per profile, and the effect changes the picked profiles' own traits.
        - `add` goes on each picked profile.
        - `remove` / `replace` drop a profile's own trait; a unit trait moves to the profiles not picked.
    - Do this wherever trait effects apply: unit-modifier actions (`resolve.ts`), option, group, slot and slot-option effects, list choice values and `listEffects` (`playEffects`).
    - Give a trait effect with `profiles` the `profile` scope in its `when` (`TRAIT_EFFECT_SCOPES` applies only without `profiles`).
    - Display and reading already handle profile-only traits ("Promoted (Sergeant)").
    - The data editor's trait effect editor shows the profile filter.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `profiles` on a trait effect should set `"minValidatorVersion": "2.9.0"` in its manifest, and needs an app that supports it.

## 2.8.0

- **Slots filled from more than one faction.** A slot's `source` may be a non-empty list of `{ "faction", "subFactions"?, "units"? }` as well as one such object. The slot offers every entry's units, and each unit filling it may come from any entry. This is for "units come from faction A or faction B, in any combination". Example: `"source": [{ "faction": "field-army" }, { "faction": "clockwork-guild" }]`.
    - **Where:** group slots, a slot option's `slot` effect (each slot a `count` adds takes the same list) and a special rule's `slots`.
    - **Per-entry `units`** (new, on the object form too) narrows that entry only; its `unitIds` are that entry's units. The slot's `units` applies to every entry, and its `unitIds` may name any entry's units.
    - **Changing the units:** one trait effect handles every entry, e.g. `{ "kind": "trait", "replace": { "from": ["Field Army", "Foundry"], "to": "Levy" } }`. Gate an effect on a faction's trait to change one entry's units only.
    - **Why:** a group drawn from two factions used to be modelled as two copies of the group, one per faction, with `max` expressions subtracting each other, so the factions couldn't be mixed.
    - Home sub-faction unit modifiers still don't come with a sourced unit.
- **Checks.** Each entry is checked as a single source is, at `source/<index>`. New: a faction listed in two entries is an error; an entry's `unitIds` that aren't among that entry's units are an error; a slot `unitIds` entry naming units of two entries is a warning. An empty list is a shape error.
- **Shape check messages.** In a union, a branch whose value has the wrong type outright no longer wins over a branch of the right type with several problems. A list of slot sources with a bad entry now reports that entry's problems instead of "expected object, received array".
- **New exports:** `SlotSourcesSchema`, the `SlotSources` type (`SlotSource | SlotSource[]`) and `slotSources(source)`, which returns a slot's `source` as a list (empty when left out).
- `examples/full`'s `mixed-levy` group draws from the Field Army (with every sub-faction) and the Clockwork Guild, with per-entry `units` on its second slot. The game gains a Levy trait, and the source declares `"minValidatorVersion": "2.8.0"`. The authoring guide ("Slots filled from another faction"), the data schema spec (§2, §7.1) and the README say so.
- **For the app:**
    - `Slot.source` and `AddedSlot.source` are now `SlotSource | SlotSource[]`. Read them through `slotSources`.
    - Offer every entry's units for an empty sourced slot, each with its own home (`ListUnit.source` already records one per unit, so saved and shared lists don't change). Apply an entry's `units` to that entry's units only, and the slot's `units` to all.
    - Show each candidate's faction when the slot has more than one entry.
    - A placed unit whose home faction is no longer among the slot's entries is a slot issue.
    - The data editor's slot source editor edits a list of entries.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using the list form or per-entry `units` should set `"minValidatorVersion": "2.8.0"` in its manifest, and needs an app that supports them.
- **Docs: offering units for a slot with `unitWhen`.** The data schema spec (§7), the authoring guide and the schema's description of `unitWhen` now allow an app to judge `unitWhen` optimistically when offering units. Gear, traits and rules that any of the unit's options could give count as held. A unit that fails even then can never qualify and may be hidden; one that could qualify may be marked with the message. A placed unit is still checked live. No schema or check change.

## 2.7.0

- **Effects a group gives units outside it.** A group's `listEffects` is a list of `{ "units"?, "scope"?, "effects" }`. While the group is in the list, each entry's effects apply to every matching unit in reach. Example: `"listEffects": [{ "units": "@vehicles", "effects": [{ "kind": "specialRule", "rule": { "id": "fearless" } }] }]` for "every Walker in a list with this group gains Fearless".
    - **Reach:** `scope: "list"` (the default) reaches every unit in the list, allies included; `"contingent"` reaches the group's contingent.
    - **Effects:** stat, special-rule, trait and slot-tag, as on a list choice value. They apply right after list choice values and before options, and `units` sees each unit with its own traits and sub-faction modifiers.
    - **Why:** it replaces copying a unit modifier into every sub-faction because the rule's group lives in one faction and the affected units anywhere.
- **Checks.** The effects and selector are checked as a choice value's are, except that `unitIds` may name any loaded faction's units. An entry with no effects is a warning. Traits that `listEffects` give count as traits in use for `trait:` references and selectors.
- `examples/full`'s `armoured-spearhead` makes every vehicle in the list Fearless, and the source declares `"minValidatorVersion": "2.7.0"`. The authoring guide (Groups, Effects order), the data schema spec (§5.2, §7) and the README say so.
- **For the app:**
    - For each group in the list with `listEffects`, apply each entry's effects to every matching unit in reach (the whole list, or the group's contingent), at the step after list choice values.
    - Match `units` against the unit with its own traits and sub-faction modifiers, and evaluate each effect's `when` in the unit's own scopes.
    - Resolve rule ids in the group's faction.
    - Include them where list choice effects are included today: the played unit, `staticUnit` counts, and candidates offered for a slot.
    - `Group` gains `listEffects`; `GroupListEffectsSchema` and the `GroupListEffects` type are new exports.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `listEffects` should set `"minValidatorVersion": "2.7.0"` in its manifest, and needs an app that supports it.

## 2.6.0

- **A condition on the unit filling a slot.** A slot's `unitWhen` (`{ "if", "message" }`) is checked live against the unit in it, as configured: its options' gear and traits are included, seen before the group's effects. While false, it is an issue on the slot. It is for "units of a second role may fill this slot, but only with some gear or upgrade": `{ "roles": ["officer", "heavy"], "unitWhen": { "if": "unit.is(role:officer) or unit.has(weapon:cannon)", "message": "…" } }`. Units are still offered by role and `units`: the app judges a unit offered for an empty slot on its own records plus list choice values, before any upgrade is picked. A selector on an upgrade-given trait therefore never offers the unit, which `unitWhen` avoids. Scopes: `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`.
- **Limiting the slots that slot options add.** A group's `addedSlotRoles` narrows the `roleChoices` of the `slot` effects of slot options picked in its slots to the listed roles. An option left with none isn't offered, so `[]` means "options that add slots may not be taken" and `["support"]` means "they may only add Support slots". Options without a `slot` effect are unaffected, and options added later, in any file, are covered without marking each one.
- **A condition on a slot option.** A slot option's `when` offers it only while true, seeing the unit as its `units` does (scopes as for `unitWhen`), e.g. `{ "if": "group.is(group:gun-line)", "message": "Only in a Gun Line" }`. A pick whose `when` turns false stays, with an issue.
- **New checks.**
    - Errors: a `unitWhen` or slot option `when` expression that fails, or uses `profile`; a missing message; an unknown role in `addedSlotRoles`.
    - Warnings: a `unitWhen` that never reads `unit`; a role listed twice in `addedSlotRoles`; an `addedSlotRoles` role that no loaded slot option's `roleChoices` holds.
- `examples/full`:
    - The `garrison` group gains an Officer-or-Heavy slot whose `unitWhen` lets a Heavy unit in only with a cannon.
    - `standard-core` allows only Support slots to be added.
    - `flexible-troop` is offered only in core formations.
    - It declares `"minValidatorVersion": "2.6.0"`.
- **Docs.** The authoring guide (Groups, Slot options, the scope table), the data schema spec (§3.8, §7), the expression spec (§3, §8.2) and the README say so. The guide now also says what a slot's `units` sees when units are offered and once one is placed. `docs/proposals/group-rule-gaps.md` is the review these came from.
- **For the app:**
    - Evaluate a slot's `unitWhen` with the placed unit as the live `units` check sees it (`beforeGroup`), and report it on the slot.
    - Narrow each picked or offered slot option's `slot` effect `roleChoices` by the group's `addedSlotRoles`. Don't offer an option left with none, and flag such a pick.
    - Evaluate a slot option's `when` when offering it (with the unit before slot-option effects) and flag a pick whose `when` is false, alongside stranded options.
    - `Slot` gains `unitWhen`, `Group` gains `addedSlotRoles` and `SlotOption` gains `when`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using these should set `"minValidatorVersion": "2.6.0"` in its manifest, and needs an app that supports them.

## 2.5.0

- **Taking special rules away.** A `specialRule` effect may now `remove` rules, and `replace` them: `{ "kind": "specialRule", "remove": ["skirmisher"] }` and `{ "kind": "specialRule", "replace": { "from": ["skirmisher"], "to": { "id": "armoured", "value": "1" } } }`. They work like the trait effect's: `remove` takes every selection of those ids off the profiles the `profiles` filter picks (all of them when it is left out) and off the unit's own `specialRules`, whatever their value. `replace` takes any of `from` and gives `to` only where one was taken. So "models with X exchange it for Y" needs no filter: a model without X is untouched. `from` matches any value, and the same id in `from` and `to` re-values a rule. `rule` (the rule given) is now optional; an effect needs at least one of `rule`, `remove` and `replace`, and applies them in that order.
- **Selectors match special rules.** A `UnitSelector` (and its `exclude` entries) takes `specialRules: [...]`. A unit matches when it or one of its profiles holds any of the listed rules, with any value. It sees the rules at the selector's point in the effect order, as `traits` does.
- **A choice each unit of a group may make.** The two together cover a rule such as "each unit in this group may exchange Skirmisher (X) for Armoured (1)" without touching a unit record. The game declares a slot tag, the group tags its slots (`{ "kind": "slotTag", "add": ["garrison"] }`), and a slot option of that tag with `units: { "specialRules": ["skirmisher"] }` holds the `replace`. Units added later with the rule get the choice too. Slot options apply last, so the exchange sees the rule however the unit got it. The authoring guide describes this under Slot options.
- **New checks.**
    - Errors: a `rule` or `replace.to` id unknown where the effect is defined, as before for `rule`; a `remove` or `replace.from` id that no loaded game, faction or sub-faction defines (a game-level effect may take away a faction's rule); an empty `remove` or `from`; a special-rule effect with none of the three. A non-slug id in `remove`, `from` or a selector's `specialRules`, or a `replace` without `to`, is a shape error.
    - Warnings: a value on a `to` rule that isn't `configurable`, as for any selection; a configurable `to` with no value and no `defaultValue`; an id listed twice; a `rule` that `remove` or `from` also names; a selector's `specialRules` id that no loaded file defines.
- `examples/full` gives the Pioneers of `pioneer-squad` the new configurable faction rule Skirmisher (X), declares a `garrison` slot tag, and adds a `garrison` group whose `dig-in` slot option exchanges Skirmisher for Armoured (1). It declares `"minValidatorVersion": "2.5.0"`. The authoring guide (Effects, Selectors, Slot options), the data schema spec (new §5.4, §5.2 order, §8) and the README say so.
- **For the app:**
    - Apply a special-rule effect's `remove`, then `replace`, then `rule`, to each picked profile and to the unit's own rules. `SpecialRuleEffect.rule` is now optional, so code that reads `effect.rule` (applying effects, describing a slot option) must handle its absence and describe a replace ("Skirmisher → Armoured (1)") and a removal.
    - Match selector `specialRules` against the unit's rules as they stand at that selector's step.
    - Work out a rule's `grants` and `slots` from the rules the unit holds after every step, so a removed rule stops granting and a gained one starts.
    - Show the changed rules on the datasheet.
    - `SpecialRuleEffect` gains `remove` and `replace`; `UnitSelector` and `UnitExclusion` gain `specialRules`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `remove`, `replace` or selector `specialRules` should set `"minValidatorVersion": "2.5.0"` in its manifest, and needs an app that supports them.

## 2.4.0

- **A count on a slot option's `slot` effect.** `{ "kind": "slot", "roleChoices": ["support"], "count": 3 }` adds three slots to the group, each holding its own unit, for a rule such as "add three Support slots". `count` is a whole number of 1 or more and defaults to 1. With several `roleChoices` the player picks one role, which all of the slots take. Only the slot option's `slot` effect takes it: group slots and a special rule's `slots` (already a list) are unchanged.
- **New warning.** A slot option with more than one `slot` effect: only the first is used, so the message suggests one effect with `count`. The authoring guide already said a slot option has at most one; it is a warning, not an error, so published data written with repeated effects keeps loading. `count` that is 0 or a fraction is a shape error.
- The authoring guide, the data schema spec (§7.1) and the README say so.
- **For the app:** add `count` slots (default 1) for a slot option's `slot` effect. When it has several `roleChoices`, ask for the role once and give it to every slot. `SlotEffect` gains `count`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `count` should set `"minValidatorVersion": "2.4.0"` in its manifest, and needs an app that supports it.

## 2.3.0

- **Equipment with a weapon profile.** An equipment record may carry `weapon: { "template", "profiles": [...] }`, with the same `template` and profiles (`name`, `template?`, `stats`, `traits?`, `specialRules?`) as a weapon. It is for gear whose rules only let its holder make an attack in some situation, such as grenades thrown instead of shooting: the item stays equipment, its `text` says when the attack may be made, and the profile is structured weapon data rather than prose. `"grenades": { "id": "grenades", "name": "Grenades", "text": "Once per game, instead of shooting, …", "weapon": { "template": "ranged", "profiles": [{ "name": "Grenade (thrown)", "stats": { "range": "6\"", "attacks": "1", "damage": "1" } }] } }`.
- **Only the equipment is held.** `defaultGear` (`kind: "equipment"`), `equipmentRefs`, swaps, restrictions, `limitBy` and `equipment:` / `count` / `has` treat it like any other equipment. The profile has no weapon id, so `weapon:` references, weapon restrictions, `limitBy` and swaps never match it.
- **Checks.** The profiles are checked as a weapon's are: an unknown template is an error, a profile `template` equal to the `weapon`'s a warning, missing or extra stats and unknown special rules errors. New warnings: a `weapon` with no profiles; a weapon with the same id as the equipment (in the faction, or the sub-faction with its parent), which is usually a weapon left behind after its profile moved onto the equipment and which a unit holding both would show twice.
- `examples/full`'s `grenades` equipment has a thrown profile, and the source declares `"minValidatorVersion": "2.3.0"`. The authoring guide, the data schema spec (§4.2) and the README say so.
- **For the app:** show an equipment's `weapon` profiles with the equipment wherever its rules are shown (datasheet, list view), laid out like a weapon of that template, and don't add them to the unit's weapons. `EquipmentWeaponSchema` and the `EquipmentWeapon` type are new exports; `Equipment` gains `weapon`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using `weapon` on equipment should set `"minValidatorVersion": "2.3.0"` in its manifest, and needs an app that supports it.

## 2.2.0

- **A `slotTag` effect.** `{ "kind": "slotTag", "add": ["prime"], "categories"?: [...], "when"?: { "if", "message" } }` makes the slot that holds the unit count as having those game slot tags: it offers their slot options, and `slot.is(tag:prime)` reads true. It tags the slot, not the unit, so like a trait effect it takes no `profiles` filter and its `when` can't use `profile` (it can use `unit`, `slot`, `group`, `contingent`, `root`, `main` and `list`, e.g. `group.is(type:elite)`). It is allowed in sub-faction unit modifier `actions`, upgrade option `effects`, group `effects`, slot `effects` (slots a special rule or slot option adds included) and list choice value `effects`. For a rule such as "while this sub-faction is taken, units in a group of one type may each take one option of a given kind, as if they filled a slot with the tag", the sub-faction's unit modifier is `{ "kind": "slotTag", "add": ["prime"], "categories": ["honour"], "when": { "if": "group.is(type:elite)", "message": "…" } }`.
- **Not in slot options.** A slot option's `effects` can't hold a `slotTag` effect: slot options are applied last, so a tag one added could never offer anything. The shape check rejects it with that reason, and the JSON Schema leaves it out there.
- **Slot option categories and per-tag restrictions.** A slot option may name a `category` (an id), e.g. `"honour"`. A slot's new `tagOptions` limits what one of its tags offers to some categories: `"tagOptions": { "prime": { "categories": ["honour"] } }`, for a rule such as "units in this group's tagged slots may only take options of this kind, and no others", which data has had to work around by hand until now. A `slotTag` effect's `categories` does the same for the tags it adds.
- **Combining.** When several restrictions apply to one tag on one slot (its `tagOptions` entry and any `slotTag` effects adding the tag with `categories`), only options every restricting source allows are offered: the categories are intersected. A source without categories restricts nothing and never widens a restricted one; with none, every option of the tag is offered, as before. An option without a `category` is offered only where its tag is unrestricted. The data schema spec (§3.8, §5.3) and the authoring guide say so.
- **New checks.** Errors: a `slotTag` effect's tag that the game's `slotTags` doesn't declare; a `slotTag` effect with nothing in `add`; a `tagOptions` key that isn't a declared slot tag or isn't one of the slot's `tags`; an empty `categories` list. Warnings: a tag or category listed twice; a category named in `tagOptions` or a `slotTag` effect that no slot option of the tag has, in the game or any loaded faction or sub-faction ("offers nothing"). `category` is an id, so the shape check rejects one that isn't lowercase kebab-case.
- **Order.** The app's effect order is unchanged (the unit's own traits, sub-faction unit modifiers, list choice values, options, the group, the slot's own `effects`, slot options). Every `slotTag` effect comes from a step before slot options, so the tags it adds are in place before slot options are offered. The expression spec notes that `slot.is(tag:…)` counts them.
- `examples/full` uses both: the `heavy-detachment` group's slot is Prime with `tagOptions` limiting it to the new `honour` category (the `honoured-crew` slot option), and `veterans` gives heavy units in an Elite formation a Prime tag limited to `honour` (`honoured-heavies`). It declares `"minValidatorVersion": "2.2.0"`.
- **For the app:** before offering slot options for a slot, apply every `slotTag` effect in force on the unit in it (from its sub-faction unit modifiers, picked list choice values, picked options, the group and the slot, with their `when`s) to the slot holding it, so the slot offers the added tags' options. Filter each tag's options by category with the combining rule above. Make `slot.is(tag:…)` see the added tags. `SlotTagEffectSchema`, `TagOptionsSchema` and `HeldUnitEffectSchema` (a unit effect or a `slotTag` effect) are new exports, as are the `SlotTagEffect`, `TagOptions` and `HeldUnitEffect` types. `GroupEffect`, `SlotUnitEffect`, `ListChoiceValueEffect`, an option's `effects` and `UnitModifierAction` now include `SlotTagEffect`; `UnitEffect` and `SlotOptionEffect` don't. `Slot` gains `tagOptions` and `SlotOption` gains `category`.
- `schemaVersion` stays 1 and `expressionVersion` stays 1; everything is additive. Data using a `slotTag` effect, `category` or `tagOptions` should set `"minValidatorVersion": "2.2.0"` in its manifest, and needs an app that supports them.

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
