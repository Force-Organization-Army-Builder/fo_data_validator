# Force Org data authoring guide

How to write Force Org game data as JSON files directly, by hand or with a coding agent, instead of using the Data Editor. Everything the list builder knows comes from these files; the app has no game rules in code.

Read this first, then use the pointers at the end for exact types, the full expression language and worked examples.

## 1. The loop

1. Copy `examples/starter/` (a complete, valid game with one faction) or the closest example source, and edit it.
2. Check it: `fo-validate <source folder>` (in this repository: `node bin/fo-validate.mjs <source folder>`)
3. Fix every `ERROR` and repeat until it reports `0 errors`. Add `--json` for machine-readable output.
4. Try it in the Force Org app by adding your source's address under Sources in its settings. A single faction file can also be imported through Data Editor → Factions → New Faction → Import from JSON, for the game that is open. The Data Editor downloads whatever it edits as these same files.

`fo-validate` runs two passes:

- **Shape** (against the JSON Schema in `schema/`, generated from the zod schemas in `src/game_data/schema.ts`): wrong types, misspelt keys, missing required fields, bad enum values. Errors are `file path: message`, where the path walks the JSON (`units/carrier/profiles`). If there are shape errors, the second pass is skipped.
- **Meaning** (`validateGameData`): every id equals its key, every reference resolves, stats match their templates, every expression parses and type-checks for its field. Expression errors print the expression with the bad part underlined and a "did you mean" hint where there is one.

Only edit what the errors point at. Don't hand-fix unrelated records.

**Working in your own data repo?** The validator lives in https://github.com/Force-Organization-Army-Builder/fo_data_validator. Add it as a dependency pinned to a release tag (`"@force-org/data-validator": "git+https://github.com/Force-Organization-Army-Builder/fo_data_validator.git#v2.0.0"`), run `npm install`, and check your folder with `npx fo-validate /path/to/my-data`. (For an extension source, pass the base source first: `npx fo-validate /path/to/base /path/to/my-data`.) To run the check on every push and pull request, use either the validator's GitHub Action or the `npx` workflow; both are in "Validate in CI" in its README.

## 2. Source layout

A **source** is a folder (or repo) with a `forceorg.json` manifest at its root:

```
my-data/
  forceorg.json
  game.json
  factions/warband.json
  sub-factions/veterans.json
```

```json
{
    "schemaVersion": 1,
    "expressionVersion": 1,
    "name": "My game data",
    "description": "optional",
    "disclaimer": "Unofficial. Not endorsed by <rights holder>.",
    "provides": [
        {
            "game": "game.json",
            "factions": ["factions/warband.json"],
            "subFactions": ["sub-factions/veterans.json"]
        }
    ]
}
```

- `provides` lists whole games: one `GameSystem` file plus its `Faction` and `SubFaction` files. Paths are relative to the manifest. A file that isn't listed isn't loaded.
- `extends` adds factions or sub-factions to a game another source provides, instead of `provides`: `{ "game": "full-game", "versions": ">=1.0.0 <2.0.0", "factions": [...], "subFactions": [...] }`. Validate with `fo-validate <base source> <extension source>`.
- `examples` (example lists) is accepted but not yet checked.
- `schemaVersion` is `1`: the version of the data format. `expressionVersion` is `1`: the version of the expression language your expressions are written for. Both only go up when a change would break existing data, and Force Org refuses a source whose version is newer than it understands (with a message to update the app). A missing `expressionVersion` is read as `1` with a warning, so always write it.
- `minValidatorVersion` (optional, e.g. `"1.14.0"`) is the oldest validator release your source needs. New fields arrive in minor releases (the changelog says which release added each), so when you start using one, set this to that release: someone on an older validator then gets "this source needs validator 1.15.0 or newer, but this is 1.14.0; update" instead of a list of unknown properties. Only use it for features from 1.14.0 or later. Validators 1.13 and older don't know the field and reject it as an unknown property, so leave it out until you need it.

| File | Schema (in `schema/`) | Holds |
| --- | --- | --- |
| `forceorg.json` | `source-manifest.schema.json` | what the source provides |
| game file | `game.schema.json` | the game's vocabulary and the records every faction shares |
| faction file | `faction.schema.json` | one faction's units, gear, upgrades, rules, groups |
| sub-faction file | `sub-faction.schema.json` | a modifier of one faction |

## 3. Rules that apply everywhere

- **Ids are slugs** (`[a-z0-9]+(-[a-z0-9]+)*`, e.g. `infantry-squad`: lowercase letters and digits, with single hyphens between words; no capitals, spaces, underscores or leading, trailing or doubled hyphens) and **every record's `id` equals the key it sits under**: `"carrier": { "id": "carrier", ... }`. The shape check enforces this on ids, record keys and `@selector` references, because an id that breaks it can't be used in an expression. Ids never change once published, because saved army lists point at them.
- **The game defines its vocabulary.** Roles, unit types, group types, slot tags, resources, stat templates and list choices are all declared in the game file; factions refer to them by id. Nothing is built in.
- **Costs are per resource**: `{ "points": 100 }`, or `{ "credits": 4, "slots": 1 }`. A value is a number or an expression string.
- **Typed rules before expressions.** Restrictions, `replaces`, `limitBy`, list rules and slot/group limits enforce themselves and fix picks. Use an expression only where no typed form fits (section 7).
- **Rules carry a player-facing `message`.** A condition is `{ "if": "<expression>", "message": "why" }`.
- **Stats are strings** (`"3+"`, `"6\""`), keyed by the stat ids of the profile's template, and every stat in the template must be present.
- **Individual models aren't tracked.** The list holds amounts of gear, not which model carries what.
- Formatting: 4-space indent JSON; the app doesn't care, but keep diffs small.

## 4. The game file (`GameSystem`)

Required: `id`, `version`, `name`, `roles`, `unitTypes`, `groupTypes`, `resources`, `stats`.

| Key | Meaning |
| --- | --- |
| `terms` | the game's own words per concept (`group`, `root`, `contingent`, `list`, `unit`, `faction`, `subFaction`, `gear`…): `{ "singular", "plural", "word"? }`. A `word` on a built-in scope (`"group": { "word": "formation" }`) can be written in expressions in place of the built-in name. |
| `roles` | what fills a slot (Troops, Elites). `grants` gives the contingent resources when a slot of that role is filled. |
| `unitTypes` | Infantry, Vehicle… (matched by `type:` references and selectors). `description` holds the type's rules text, the rules every unit of the type follows. |
| `subTypes` | (validator ≥1.12.0, optional) the unit sub-types units and profiles carry as `tags`: `{ "sergeant": { "id": "sergeant", "name": "Sergeant", "description": "…" } }`, with `description` holding the rules every model with the sub-type follows. A tag matches a sub-type by name, case-insensitively, or by id (`Gun-crew` → `gun-crew`). When the game has `subTypes`, a unit or profile tag, a `tag:` reference, or a ProfileFilter value that is not a unit type id and matches no sub-type is a warning. Left out, tags are not checked against anything. |
| `traits` | (validator ≥2.0.0, optional) the unit traits units and profiles carry in `traits`: `{ "field-army": { "id": "field-army", "name": "Field Army", "description": "…" } }`. A trait matches by name, case-insensitively, or by id. When the game has `traits`, a unit or profile trait, a trait an effect gives or takes, a selector's `traits` entry or a `trait:` reference that matches none is a warning. Left out, only selectors and `trait:` references are checked, against the traits in use. |
| `groupTypes` | kinds of container (group, team, formation). `contingent: "root"` starts a contingent (`source: "main"`, `"ally"` or `"any"`, see below); `contingent: { "linksTo": ["core"] }` attaches to a root group. `min`/`max` limit how many; `cost` is what a group spends. |
| `slotTags` | tags a slot can carry (`prime`); slot options attach to a tag. `optionLabel` names the options. `color` and `icon` (validator ≥1.5.0) pick the tag's look in the app's palette (`amber`, `red`, `orange`, `green`, `teal`, `blue`, `violet`, `pink`, `slate`; `star`, `spark`, `diamond`, `hex`, `cross`, `flag`, `swords`, `crown`, `fleur`, `circle`, `triangle`, `square`, `target`, `bolt`); left out or unknown, the app picks from the id. |
| `resources` | anything spent or capped. `scope: "list"` (points, set by the player: `defaultLimit`, `suffix`), `"unit"` (per-unit capacity from a profile stat: `capacityStat`), `"contingent"` (granted and spent within a contingent: `message` is the overspent issue). `usedFor` limits where an amount in it may be given (`unit`, `additionalModels`, `option`, `slotOption`, `group`, `grant`). |
| `stats` | `unit` and `weapon` stat templates: `{ "id", "name", "stats": [{ "id", "label", "numeric"? }] }`. A numeric stat can be shifted by effects (`3+` −1 → `2+`); an `add` on a stat that isn't marked `numeric` is a warning. |
| `choices` | list-level choices (stance, battle size): `{ "id", "name", "values": {...}, "default"? }`. Read in expressions with `choice(id)`. A value may have `effects` and `units` (validator ≥1.13.0, see Effects): while it is picked, its effects apply to every matching unit in the list. |
| `listRules` | typed list-wide rules (below). |
| `groups` | groups every faction may take. |
| `specialRules`, `selectors`, `slotOptions`, `subChoices` | shared versions of the faction records of the same name. |

**Where a contingent's faction comes from.** A root group type's `source` says which faction (and sub-factions) its contingent uses; the groups linked to it share that faction.

- `"main"` (the default): the list's main faction and sub-faction. The contingent it starts is the list's main contingent, what `main` reads in expressions.
- `"ally"`: a faction the player picks that differs from the main one.
- `"any"` (validator ≥2.1.0): any faction of the game the player picks, **the main one included**. Use it for a contingent that may be of any faction, such as a detachment a list may take once, of any faction as long as all its units come from that faction: `"detachment": { "id": "detachment", "name": "Detachment", "contingent": "root", "source": "any", "max": 1 }` (as in `examples/full`). A contingent from an `any` root is never the main contingent, even when it takes the main faction, and its groups can't be a faction's `defaultGroup`. A source that uses it should set `"minValidatorVersion": "2.1.0"` in its manifest.

**List rules** (`listRules`, each with `kind` and `message`):

- `resourceCap`: `{ "kind": "resourceCap", "id", "resource": "points", "units"?: <selector>, "contingentTypes"?: [...], "max": { "percentOfLimit": 25, "round": "up" } | { "value": 500 }, "message" }`
- `count`: `{ "kind": "count", "id", "units"?: <selector>, "groupTypes"?: [...], "scope": "group" | "contingent" | "list", "min"?, "max"?, "message" }`
- `expression`: `{ "kind": "expression", "id", "scope"?: "list" | "group", "groupTypes"?: [...], "when": { "if", "message" } }`. With `"scope": "group"` (validator 1.4.0+) the condition is checked once for each group (only those of `groupTypes`, if given) with `group`, `contingent`, `root`, `main` and `list` available, and the message is reported for each group that fails. A rule only flags the list; it never prevents anything.

A faction or sub-faction may hold `listRules` too (validator 1.4.0+), applying to contingents using that faction or a sub-faction the contingent took. A sub-faction replaces a parent's rule by listing it in `overrides` with `"kind": "listRules"`.

## 5. The faction file (`Faction`)

Required: `id`, `version`, `name`, `game: { "id", "versions" }` and all of `units`, `weapons`, `equipment`, `upgrades`, `specialRules`, `groups` (use `{}` when empty). `defaultGroup` is the root group a new list starts with; the checker requires a root group for a main faction.

### Units

```json
"infantry-squad": {
    "id": "infantry-squad",
    "name": "Infantry Squad",
    "role": "troop",
    "type": "infantry",
    "tags": ["Line"],
    "cost": { "points": 100 },
    "modelCount": 10,
    "additionalModels": { "max": 10, "cost": { "points": 10 } },
    "profiles": [
        { "id": "trooper", "name": "Trooper", "template": "infantry",
          "stats": { "m": "7", "ws": "4" } },
        { "id": "sergeant", "name": "Sergeant", "template": "infantry",
          "tags": ["Sergeant"], "stats": { "m": "7", "ws": "4" } }
    ],
    "defaultGear": [{ "kind": "weapon", "id": "rifle", "perModel": true,
                         "excludeProfiles": { "anyOf": ["sergeant"] } }],
    "upgrades": { },
    "limit": { "max": 1, "scope": "list", "message": "Unique" },
    "when": { "if": "…", "message": "…" }
}
```

- `role`, `type` and profile `template` are ids from the game. `tags` are free text, matched case-insensitively (`tag:heavy-assault` for `Heavy Assault`); when the game defines `subTypes`, each tag should name one (otherwise a warning), so its rules text comes from the game.
- `traits` are the unit's traits (a faction trait, "Gun Line"): free text, matched case-insensitively by `trait:` references and selector `traits`. Effects can add, remove or replace them (see Effects).
- `profiles[].traits` (validator 1.11.0) are traits only that profile's models have, e.g. a Shield trait for the shield-bearers but not their standard bearer: `"traits": ["Shield"]` on the `shield-bearer` profile (`sergeant` and `gunner` in `examples/full`, read by `veterans`' `tower-shields` and `trained-spotters`). A profile sees the unit's traits plus its own (`profile.is(trait:shield)`); the unit counts as holding a trait when any of its profiles does (selector `traits`, `unit.is(trait:…)`, `count(trait:…)`), as with profile `tags`. Put a trait every model has on the unit.
- `profiles[].id` is what upgrades, default gear and sub-faction rules point at (`profileId`).
- `defaultGear` is carried without any upgrade; `perModel` makes the amount follow the model count; `excludeProfiles` leaves out one model per matching profile. With `perModel` and `profileId`, each model of that profile carries one. `note` (validator 1.11.0) is a short text shown next to that gear, such as where it is mounted: `{ "kind": "weapon", "id": "cannon", "note": "Hull mounted" }`. See "Gear notes" under Upgrades and options.
- `limit` caps how many of the unit a `group`, `contingent` or the `list` may hold (a number or expression).

### Composition: how many models of each profile

`modelCount` and `additionalModels` say how big a unit is, but not which profile each model uses. When that matters (a Sergeant and 9 Troopers, extra models that are always Troopers, a crew of two different models bought together), describe the unit as **composition blocks**. A block is a set of models bought together; the unit holds between `min` and `max` copies of it:

```json
"gun-team": {
    "cost": { "points": 40 },
    "modelCount": 2,
    "composition": [
        { "id": "gun-crew", "name": "Gun Crew",
          "profiles": { "gunner": 1, "loader": 1 },
          "min": 1, "max": 3, "cost": { "points": 35 } }
    ],
    "profiles": [ { "id": "gunner", … }, { "id": "loader", … } ]
}
"infantry-squad": {
    "modelCount": 10,
    "composition": [
        { "id": "sergeant", "profiles": { "sergeant": 1 } },
        { "id": "troopers", "name": "Troopers", "profiles": { "trooper": 1 },
          "min": 9, "max": 19, "cost": { "points": 10 } }
    ]
}
```

- `profiles` gives the models of each profile in **one copy** of the block (whole numbers, at least 1). A profile is in at most one block; one in no block has no models (a warning).
- `min` (default 1) is the number of copies the unit's `cost` buys, and `max` (default `min`) is the most it may hold. `max` may be an expression (see below). A block whose `max` is above `min`, or an expression, needs a `cost` for each extra copy. `min: 0` makes a block optional.
- `modelCount` is still required and must equal the blocks at their `min` (Σ `min` × models per copy), so older apps still read the unit. Don't use `additionalModels` alongside `composition`.
- The app counts each profile's models from the copies taken, which drives `unit.models()`, `perModel` default gear, and per-model upgrades. A `perModel` upgrade with a `profileId` counts only that profile's models, so "each Loader may exchange…" is `"profileId": "loader", "perModel": { "type": "some" }`.
- Needs validator 1.2.0+ and an app that supports composition blocks.
- **`replaces`** (validator 1.4.0+): a block may take the place of models in another block instead of adding models, e.g. "one Sapper may be upgraded to a Foreman for +10 points":

    ```json
    "composition": [
        { "id": "sapper", "profiles": { "sapper": 1 }, "min": 6, "max": 9, "cost": { "points": 20 } },
        { "id": "foreman", "profiles": { "foreman": 1 }, "min": 0, "max": 1, "cost": { "points": 10 },
          "replaces": { "block": "sapper", "profile": "sapper" } }
    ]
    ```

    Each copy of the replacing block takes as many models of `profile` off the target block as it holds itself, so the unit's size and the target's cost stay the same and only the profile counts move (5 Sappers and 1 Foreman). The replacer's `max` can't exceed what the target holds at its `min`, and `modelCount` is Σ `min` × models per copy, less the models replaced at the replacer's `min`. A replacing block can't itself be replaced.
- **`max` as an expression** (validator 1.10.0): a block's `max` may be an expression, for caps that follow the unit, e.g. "5 Pioneers, up to 10 more at +15 points each; for every 5 models in the unit, 1 Pioneer may be replaced with 1 Pioneer Chief for +20 points":

    ```json
    "modelCount": 5,
    "composition": [
        { "id": "pioneer", "profiles": { "pioneer": 1 }, "min": 5, "max": 15, "cost": { "points": 15 } },
        { "id": "pioneer-chief", "profiles": { "pioneer-chief": 1 }, "min": 0, "max": "floor(unit.models() / 5)", "cost": { "points": 20 },
          "replaces": { "block": "pioneer", "profile": "pioneer" } }
    ]
    ```

    - It is evaluated live for the unit as it stands, every block's copies included, and sees the same scopes as the unit's `when` (`unit`, `slot`, `group`, `contingent`, `root`, `main`, `list`). A result that isn't whole rounds down; a negative one counts as 0.
    - The app won't let the player add a copy above the cap. When the cap falls below the copies already taken (fewer Pioneers, so fewer Pioneer Chiefs allowed), it flags the unit and leaves the copies for the player to remove.
    - Only a block that `replaces` models may read `unit.models()` in its `max`: its copies don't change the unit's size. A block that adds models would change its own cap with every copy, so that is an error. Write its cap against something its copies don't change (another unit, a list choice), or model the models as replacements.
    - The block needs a `cost`, as it can grow. Where the `max` reads nothing but `unit.models()`, the checker works it out at every size the unit can have: below `min` at the size as bought is an error, never above `min` a warning, and a replacing block may never take more models than the target can hold at that size (counting the other blocks that add models as grown first). A `max` that reads anything else is only checked by the app, live.
    - See `pioneer-squad` in `examples/full`.

### Weapons, equipment, special rules

- `weapons`: `{ id, name, template, profiles: [{ name, template?, stats, traits?, specialRules? }] }`, `template` a weapon stat template of the game. A profile's own `template` (validator 1.11.0) replaces the weapon's for that profile, for a weapon with a shooting and a close-combat profile: a spear with `"template": "ranged"` whose `Spear (Melee)` profile has `"template": "melee"` and the melee stats. Keep it one weapon rather than two records, so gear refs, swaps and counts treat it as one item (`spear` in `examples/full`).
- `equipment`: `{ id, name, text, weapon? }`.
- **Equipment with a weapon profile** (validator 2.3.0): `weapon: { template, profiles: [...] }` on an equipment record gives it an attack its holder may use, with the same `template` and `profiles` as a weapon. Use it for gear whose rules only *allow* an attack in some situation, such as grenades thrown instead of shooting, a demolition charge or a bomb, so that the item stays equipment and `text` says when the profile may be used:

    ```json
    "grenades": {
        "id": "grenades",
        "name": "Grenades",
        "text": "Once per game, instead of shooting, one model with grenades may throw one using this profile.",
        "weapon": {
            "template": "ranged",
            "profiles": [
                { "name": "Grenade (thrown)", "stats": { "range": "6\"", "attacks": "1", "damage": "1" },
                  "specialRules": [{ "id": "armoured", "value": "1" }] }
            ]
        }
    }
    ```

    - The item is equipment and nothing else: units get it with `{ "kind": "equipment", "id": "grenades" }` in `defaultGear` and `equipmentRefs` in options, and restrictions, `limitBy`, swaps, `equipment:grenades` and `count` / `has` all see the equipment. The profile is not a weapon the unit holds, so `weapon:` references, weapon restrictions and weapon swaps never match it.
    - The app shows the profile with the equipment, laid out like a weapon of that template.
    - The profiles are checked as a weapon's are: the template and any profile's own `template` must be the game's, `stats` must match the template, and special rules must exist. An empty `profiles` is a warning.
    - Don't also keep a weapon record for the same attack. A weapon with the same id as the equipment is a warning: the weapon is held and counted on its own, so a unit given both would show the attack twice. When moving a profile from a weapon onto equipment, delete the weapon and change its gear refs to `"kind": "equipment"`.
    - See `grenades` in `examples/full`.
- `specialRules`: `{ id, name, text, configurable?, defaultValue?, grants?, slots? }`. Units and profiles use them as `{ "id", "value"? }` in `specialRules`. A `value` given to a rule that isn't `configurable` is a warning. `grants` gives contingent resources and may use `rule.value()`. `slots` are slots each unit with the rule adds to its group (see [Slots filled from another faction](#slots-filled-from-another-faction)).

### Upgrades and options

A unit's `upgrades` is a record of `Upgrade`s; each holds `options`.

```json
"squad-options": {
    "id": "squad-options",
    "name": "Squad options",
    "perModel": { "type": "single" },
    "default": "rifle",
    "options": {
        "rifle":  { "id": "rifle", "name": "Rifle", "cost": { "points": 0 }, "weaponRefs": ["rifle"] },
        "launcher":  { "id": "launcher", "name": "Grenade launcher", "cost": { "points": 15 }, "weaponRefs": ["grenade-launcher"],
                     "when": { "if": "choice(stance) == defensive", "message": "Defensive forces only" } },
        "shared":  { "id": "shared", "target": "sergeant-melee" }
    }
}
```

- `perModel.type`: `single` (once), `multiple` (any number of times), `every` (every model), `some` (any number of models), `one-in-x` (`count`, default 1, per `everyX` models). `max` and `excludeProfiles` refine it. See "How picks are controlled" below.
- `perModel.count` (validator 1.9.0, `one-in-x` only): picks allowed per `everyX` models, a whole number of at least 1. "Up to two models in every five may each swap their rifle for …" is `"perModel": { "type": "one-in-x", "everyX": 5, "count": 2 }`: 2 picks for 5 to 9 models, 4 for 10. It is an error on any other type (for a fixed number of picks use `multiple` with `max`), and a warning when it is 1, the default. See `trooper-sidearm` in `examples/full`.
- An option gives gear through `weaponRefs` / `equipmentRefs` (faction weapon/equipment ids). It may also have `swaps`, `subChoices`, `effects`, `when`, `max`.
- `{ "id", "target" }` is an **UpgradeReference** to a faction-level upgrade in the faction's `upgrades`, so a shared gear list is written once. When option ids clash, the upgrade's own option wins, then the first-referenced shared upgrade.
- **Restrictions** (`restrictions: { "exclusions": [...], "required": [...], "requiredAnd": false }`) and `limitBy` point at gear (`{ "kind": "weapon" | "equipment", "id" }`), not at options, so a rifle satisfies a requirement whichever slot it came from. Write an exclusion on one side only; it applies both ways.
- `replaces`: sibling upgrades that a non-default pick takes the place of. `limitBy`: caps non-default picks at Σ `count` × the gear held (zero held blocks it).
- `profileId` puts the upgrade's gear on that profile (for example the sergeant); left out, it belongs to the unit at large. `swaps: [{ "from": <gear ref>, "to": <gear ref> }]` replaces gear that profile holds. `from` may be a list, for one exchange that takes several items: each pick takes one of every listed gear and gives one `to`, and the picks are capped by the scarcest of them held, so it is all or nothing. "May swap its pistol and sword for one pair of twin blades": `"from": [{ "kind": "weapon", "id": "pistol" }, { "kind": "weapon", "id": "sword" }], "to": { "kind": "weapon", "id": "twin-blades" }` (two separate swaps would give two pairs). A list must not be empty or name the same gear twice. See `captain-blades` in `examples/full`.
- `swapFrom: { "kind", "id", "count"? }` on the **upgrade** (not the option) makes every pick of any of its options take `count` (default 1) of that gear off the upgrade's profile, up to what is held, while the option's own `weaponRefs` / `equipmentRefs` give the new gear. It is for options pulled in from a shared list by an UpgradeReference, which cannot carry option-level `swaps` because the same list replaces different gear in different units. It also covers the upgrade's own options, except any option with its own `swaps` (those win), and never the `default` option. "One model in every five may swap its pistol for an item from the sidearms list": `"perModel": { "type": "one-in-x", "everyX": 5 }`, `"swapFrom": { "kind": "weapon", "id": "pistol" }`, options `none` (the default) plus `{ "id": "pistols-list", "target": "pistols-list" }`. The checker warns if the unit holds no such gear by default, unless the upgrade's `restrictions.required` names it: then the swap applies only once an earlier pick has given it ("A model that swapped its halberd for a carbine and a great weapon may then swap that carbine for an item from the carbines list": `"swapFrom": { "kind": "weapon", "id": "carbine" }` with `"restrictions": { "required": [{ "kind": "weapon", "id": "carbine" }], … }`). See `trooper-sidearm` and `captain-axe` in `examples/full`.
- `subChoices` on an option lists ids of `SubChoice`s (defined once in the game or faction): a picker beside the option whose value may add to (`cost`) or multiply (`costMultiplier`) the option's cost.
- `mirrorOf: "<sibling upgrade id>"` (validator 1.8.0) makes an upgrade always take the same option as another upgrade of the unit on a **different profile**. It is for "every model takes the same item" when the models are on different profiles: gear is filed per profile, and an upgrade only gives gear to (and swaps from) its own profile, so one upgrade can't cover both. Split it into one upgrade per profile: the player picks on the source, and the mirror follows. See "Same item for every model: `mirrorOf`" below and `sapper-tools` / `foreman-tools` in `examples/full`.
- **Gear notes** (validator 1.11.0): `gearNote` on an upgrade is a short text shown next to every gear its picks give, such as the mount the rules name for the exchange: `"gearNote": "Hull mounted"` on "may exchange its hull-mounted X for one hull-mounted Y". It covers the options' `weaponRefs` / `equipmentRefs` and swap `to`s, including the `default` option's and those of options pulled in from a shared list (the referencing upgrade's note wins over the shared upgrade's). Use it, and default gear `note`, rather than copying a weapon record per mount: ids stay one per weapon, and restrictions, `limitBy`, swaps and counts ignore notes. Gear in two places at once takes a note naming both, or separate default gear entries. The checker warns about an empty note and about a `gearNote` on an upgrade whose options give no gear. See `walker`, `gun-team`, `carrier` (the same rifle in two places, and a `pintle-weapon` exchange) and `trooper-sidearm` (a shared list) in `examples/full`.

#### How picks are controlled

Three settings decide how many options an upgrade holds at once and how they are shown. (Checked against the Force Org app's `selections.ts`, `restrictions.ts` and `viewers/upgrade.tsx`.)

- **`perModel.type`** sets how many *picks* (units of an option) the upgrade can hold in total, its **cap**:

    | `type` | cap | meaning |
    |---|---|---|
    | `single` | `perModel.max` if given, otherwise the unit's model count | one choice for the unit; with `multiSelect: true`, up to the cap in picks |
    | `multiple` | `perModel.max` (1 if left out) | picks up to `max`, the same option more than once |
    | `every` | models counted (`profileId`, `excludeProfiles` apply) | every model gets the option; picking one sets the amount to every model |
    | `some` | models counted | any number of models, up to one pick per model. `perModel.max` is **not** read for `some`; limit it with `limitBy` |
    | `one-in-x` | `count × floor(models / everyX)` (`count` defaults to 1) | `count` picks per `everyX` models; `everyX` is required |

- **`multiSelect`** (boolean) lets the options be held together, shown as checkboxes. Without it, `single` and `every` upgrades are a single choice; `multiple` and `some` upgrades already hold several picks, shown with amounts. A full multi-select upgrade drops its earliest pick to make room for a new one. If the cap is 1, the options just take turns, whatever `multiSelect` says.
- **Upgrade `min` / `max`** (numbers or expressions) are checked as expressions, but **the app does not enforce them**: nothing counts picks or models against them. Cap picks with `perModel` and `limitBy`, and require a pick with `restrictions.required` or a list rule.

Patterns:

```json
// "Choose two options from this list; the same one may be taken twice"
"perModel": { "type": "multiple", "max": 2 },
"multiSelect": true

// "Each of this model's weapons may be exchanged" (at most as many as are held)
"perModel": { "type": "multiple", "max": 2 },
"multiSelect": true,
"limitBy": [{ "kind": "weapon", "id": "carbine", "count": 1 }]
// ...and on each option:
"swaps": [{ "from": { "kind": "weapon", "id": "carbine" }, "to": { "kind": "weapon", "id": "heavy-rifle" } }]

// "Up to two models in every five may each swap their X for ..."
// (2 picks at 5 to 9 models, 4 at 10; `multiple` with `max: 2` would stay at 2)
"perModel": { "type": "one-in-x", "everyX": 5, "count": 2 }
```

`limitBy` caps the non-default picks at Σ `count` × the gear held, so exchanges follow the gear the unit really has; `swaps` removes the old gear. For "each model of a profile may take one", use `"type": "some"` with a `profileId`.

Pitfall: `min: 2, max: 2` on the upgrade does not make it "pick two", because the app ignores them. Put the limit in `perModel.max`; `multiple` states the intent most clearly.

##### Same item for every model: `mirrorOf`

"Each model takes one item from the heavy weapons list, and every model takes the same item." The Troopers and the Sergeant are different profiles, so write one `every` upgrade per profile and make the Sergeant's a mirror of the Troopers':

```json
"option-1": {
    "id": "option-1",
    "name": "Heavy weapon",
    "profileId": "trooper",
    "perModel": { "type": "every" },
    "swapFrom": { "kind": "weapon", "id": "rifle" },
    "options": { "heavy-weapons": { "id": "heavy-weapons", "target": "heavy-weapons-list" } }
},
"option-1-sergeant": {
    "id": "option-1-sergeant",
    "name": "Heavy weapon (Sergeant)",
    "profileId": "sergeant",
    "perModel": { "type": "every" },
    "mirrorOf": "option-1",
    "swapFrom": { "kind": "weapon", "id": "rifle" },
    "options": { "heavy-weapons": { "id": "heavy-weapons", "target": "heavy-weapons-list" } }
}
```

- The player picks on the **source** (`option-1`). The **mirror** (`option-1-sergeant`) is never picked by hand: it takes the same option id as the source, with its amount set by its own `perModel` and profile (one per Sergeant for `every`, one for `single`). Unpicking the source clears the mirror.
- Each upgrade gives gear to its own profile and applies its own `swapFrom` / option `swaps`, so each profile swaps what it holds.
- Cost is per pick as usual: each profile pays for its own models, at the mirror's option costs. The mirror's own options may therefore cost differently from the source's (a Sergeant's copy free, say).
- Referencing the same shared upgrade from both, as above, is the easiest way to keep the options equal.

Rules the checker enforces (errors unless noted):

- `mirrorOf` names another upgrade of the same unit, not the upgrade itself, and that upgrade has no `mirrorOf` of its own: mirrors don't chain, so there are no cycles. To keep three profiles in step, mirror the same source twice.
- The mirror and its source have different `profileId`s (left out on both counts as the same: the unit at large). A mirror on its source's bucket would add nothing.
- The mirror offers exactly the source's option ids, with UpgradeReferences expanded (own options and referenced ones both count). The mirror may write as own options what the source pulls in by reference, or the other way round; only the ids must match.
- The mirror and its source have the same `default`, or neither has one.
- The mirror's `perModel.type` is `every` or `single`. `some`, `multiple` and `one-in-x` are rejected: they describe how many picks the player chooses, and a mirror's amount isn't chosen.
- The mirror and its source don't `replace` each other (the mirror would remove its own source, or picking the source would remove its mirror). Other `replaces` on a mirror are allowed: they take effect whenever the mirror is filled.
- *Warning*: the mirror's `multiSelect` differs from the source's. A mirror takes every option its source holds, so they should agree.
- *Warning*: the mirror has `restrictions` (on the upgrade or on a reference) or `limitBy`. These can stop the mirror copying a pick the source made, leaving its models without the same item. Put such limits on the source.
- Not checked: the mirror's `when`, `min`/`max` and options' `when`/`max` apply as on any upgrade; a mirror whose `when` is false simply isn't filled.

Sub-faction `addUpgrade` doesn't interact with `mirrorOf`: it adds copies of faction upgrades, which have no `mirrorOf`, and a mirror's source must be one of the unit's own `upgrades`, so it can't name an added copy. `grantedBy` on those copies is unrelated.

### Effects

Stat and special-rule changes on profiles chosen by a **ProfileFilter** `{ "anyOf": [...], "noneOf": [...] }` (matched on profile type and tags, the unit's included, case-insensitively; with game `subTypes`, a value that is neither a unit type id nor a sub-type is a warning):

```json
{ "kind": "stat", "profiles": { "anyOf": ["infantry"] },
  "changes": [{ "stat": "ws", "op": "add", "value": -1 }, { "stat": "m", "op": "set", "value": "8\"" }],
  "when": { "if": "…", "message": "…" } }
{ "kind": "specialRule", "rule": { "id": "fear", "value": "2" } }
```

A special-rule effect can also take rules away (validator ≥2.5.0), for rules such as "models with Skirmisher (X) exchange it for Armoured (1)":

```json
{ "kind": "specialRule", "remove": ["skirmisher"] }
{ "kind": "specialRule", "replace": { "from": ["skirmisher"], "to": { "id": "armoured", "value": "1" } } }
```

- `remove` takes the rules off every profile the filter picks, whatever their value. `replace` takes off any of `from` and gives `to` only to a profile that held one, so it needs no filter to reach "models with the rule": a model without it is untouched. Both also act on the unit's own `specialRules`.
- `from` matches any value: Skirmisher (2) and Skirmisher (3) are both exchanged. The same id in `from` and `to` re-values a rule.
- `to` is a rule selection like `rule`: a value on a rule that isn't `configurable` is a warning. A configurable `to` with no value takes the rule's `defaultValue`, and a warning says when it has none.
- One effect may hold `rule`, `remove` and `replace` together. They apply in that order: `remove`, then `replace`, then `rule`. At least one is needed, and a rule both given and taken away is a warning.
- A rule they name must exist. `rule` and `to` resolve as usual: the faction with its sub-faction, then the game. `remove` and `from` may name a rule of any loaded faction, since they only take away what a unit holds; a game-level list choice can therefore take away a faction's rule.
- An effect only acts on the rules the unit holds at its step (see the order below). In a slot option, the last step, it sees every rule however the unit got it.
- To offer such a change to each unit of a group as the player's choice, see [Slot options](#slot-options-benefits-for-tagged-slots). For a change every unit in the group gets, put the effect in the group's `effects`.

A **trait effect** changes the unit's traits. Without `profiles` it changes the whole unit, and its `when` can't use `profile`:

```json
{ "kind": "trait", "add": ["Gun Line"] }
{ "kind": "trait", "remove": ["Line"] }
{ "kind": "trait", "replace": { "from": ["Disciplined", "Drilled"], "to": "Veteran Corps" } }
```

`replace` removes any of `from` and adds `to` only if the unit had one of them ("models replace their X trait with Y").

With **`profiles`** (validator ≥2.9.0) it changes only the picked profiles' models, for "models with the Sergeant sub-type gain the Promoted trait". `add` gives each picked profile the trait as its own, and `remove` / `replace` take it from them. A trait the whole unit holds stays on the profiles not picked. Its `when` may then use `profile`, checked per profile, so a condition on the model's own traits goes there, since profile filters match types and tags, not traits:

```json
{ "kind": "trait", "profiles": { "anyOf": ["Sergeant"] }, "add": ["Promoted"],
  "when": { "if": "profile.is(trait:shield)", "message": "Only a sergeant with a shield" } }
```

A trait on some profiles still counts for the unit: `unit.is(trait:promoted)`, selector `traits` and `count(trait:promoted)` find the squad, while `profile.is(trait:promoted)` is true only on the sergeant. Leave `profiles` out when the whole unit gains the trait; a filter that happens to pick every profile still gives it profile by profile.

A **slot-tag effect** (validator ≥2.2.0) makes the slot that holds the unit count as having game slot tags: it offers those tags' slot options, and `slot.is(tag:…)` reads true. It tags the slot, not the unit, so it has no profile filter and its `when` can't use `profile`. `categories` limits which of the tag's slot options it offers (see [Slot options](#slot-options-benefits-for-tagged-slots)):

```json
{ "kind": "slotTag", "add": ["prime"] }
{ "kind": "slotTag", "add": ["prime"], "categories": ["honour"],
  "when": { "if": "group.is(type:elite)", "message": "Only in an Elite formation" } }
```

For rules such as "while this sub-faction is taken, units in an Elite formation may each take one Honour option, as if they filled a Prime slot": the sub-faction's unit modifier carries the second effect above. `examples/full`'s `veterans` gives heavy units in an Elite formation a Prime tag limited to `honour` options (`honoured-heavies`).

- Every tag in `add` must be declared in the game's `slotTags` (an error otherwise); `add` needs at least one, and a tag listed twice is a warning.
- Allowed in sub-faction unit modifier `actions`, upgrade option `effects`, group `effects`, slot `effects` (a slot a special rule or slot option adds included) and list choice value `effects`. **Not** in a slot option's `effects`: slot options are applied last, so a tag one added could never offer anything (a shape error says so).
- Its `when` should not read `slot.is(tag:…)` of a tag it adds itself.

A **sub-type effect** (validator ≥2.10.0) gives or takes away sub-types, which units and profiles carry as `tags`. `add` and `remove` are ids of the game's `subTypes` (`remove` first). Without `profiles` it changes the unit's tags; with it, only the picked profiles', and its `when` may then use `profile`:

```json
{ "kind": "subType", "add": ["line"] }
{ "kind": "subType", "profiles": { "anyOf": ["sergeant"] }, "add": ["elite"] }
```

- Later effects' profile filters, selectors and `tag:` references see the result. The gear engine doesn't: default gear, per-model upgrades and `excludeProfiles` keep reading the tags on the unit record and from sub-faction unit modifiers, so an effect never changes which models hold gear or which options are offered.
- With game `subTypes`, an unknown id is an error. Without them, an id no unit or profile has as a tag is a warning.
- Allowed where a slot-tag effect is. **Not** directly in a slot option's `effects`; to give one model a sub-type there, put it inside a `model` effect (below).
- `examples/full`'s `seasoned-sergeants` (veterans) makes a squad's sergeants Elite.

A **`model` effect** (validator ≥2.10.0) is for "one model in the unit, chosen by the player, gains…". Effects with `profiles` change every model of a profile, so a unit whose models share one profile can't single one out. A `model` effect splits one model (or `count`) off its profile into a copy of that profile, and its own `effects` change only the copy:

```json
{ "kind": "model",
  "effects": [
      { "kind": "stat", "changes": [{ "stat": "armour", "op": "add", "value": 1 }] },
      { "kind": "subType", "add": ["sergeant"] }
  ] }
```

- **Where the model comes from:** `profiles` (a profile filter) picks the profiles it may come from, and the first one in record order with a model gives it. Left out, every profile, which is what a one-profile unit needs. Only the unit record's profiles count, so two `model` effects make two separate models.
- **What it shows:** a unit of five shows "4× Battle Construct" and "1× Battle Construct (Lead Construct)": the source profile's name and the name of what gives the effect, or your own `name`. The unit keeps its model count and cost.
- **Gear:** the split-off model keeps its gear and its gear choices. Default gear and per-model upgrades still count it under its source profile, so the options offered and saved picks don't change.
- **Inside:** stat, special-rule, trait and sub-type effects, without `profiles` (a shape error says why). Their `when` may use `profile`, meaning the split-off model. The `model` effect's own `when` decides whether the split happens and can't use `profile`.
- **Allowed** in slot options' `effects`, groups' `effects` and slots' `effects`. Not in upgrade options, sub-faction unit modifiers, list choice values or `listEffects`: a model that every unit of a kind always has belongs on the unit record, as a profile and a composition block.
- Saved lists store nothing new: the split follows from the slot option, group or slot that gives it.
- `examples/full`'s `lead-construct` (game slot options) gives one model of a Foundry unit +1 Armour, +2 Hull and the Sergeant sub-type, and is offered only to units made entirely of Foundry vehicles (see [Selectors](#selectors)).

Effects appear on `Option.effects`, slot options, sub-faction unit modifiers, groups (`effects`, and `listEffects` for units outside the group) and list choice values (`effects`). `when` on an effect holds it back until true. The app applies them in this order: the unit's own traits, sub-faction unit modifiers, list choice values, other groups' `listEffects` (validator ≥2.7.0), options, the group, the slot's own `effects`, slot options. Each step's `when` sees the result of the earlier steps. A `model` effect splits its models off at its own step, so later steps see the split-off profile. Within a sub-faction, `unitModifiers` and each modifier's `actions` apply in the order you list them, so a modifier's `when` sees only the modifiers above it; don't rely on an order across two sub-factions. Slot tags that slot-tag effects add are in place before slot options are offered, so a slot option's `units`, the options a slot offers and `slot.is(tag:…)` all see them.

**List choice values** (validator ≥1.13.0) give effects to every unit in the list while the value is picked, for rules such as "in a Defensive list, every unit has the Dug In trait":

```json
"stance": {
    "id": "stance",
    "name": "Stance",
    "values": {
        "offensive": { "id": "offensive", "name": "Offensive",
                       "effects": [{ "kind": "trait", "add": ["Assault Troops"] }] },
        "defensive": { "id": "defensive", "name": "Defensive",
                       "effects": [{ "kind": "trait", "add": ["Dug In"] }] }
    }
}
```

- `units` (a selector or `@ref`) limits which units get them, e.g. `"units": { "profiles": { "anyOf": ["infantry"] } }`; left out, every unit in the list does, in every contingent, allies included. It sees the unit with its own traits and sub-faction modifiers.
- The value being picked is already the condition, so don't add `when: choice(stance) == defensive`; a `when` is allowed for anything further.
- They apply before options and the group, so a group's `units` selector or an option's `when` can read the trait (`unit.is(trait:dug-in)`).
- `examples/full`'s `stance` gives `@line-troops` the Assault Troops trait when offensive, and every infantry profile +1 Morale (and units of 5 or more the Dug In trait) when defensive.

### Groups

```json
"patrol": {
    "id": "patrol",
    "name": "Patrol",
    "type": "core",
    "slots": [
        { "roles": ["command"], "required": true },
        { "roles": ["troop"], "repeat": { "min": 1, "max": 6 } },
        { "roles": ["heavy", "support"], "tags": ["prime"] }
    ],
    "units": "@line-troops",
    "requires": [{ "units": { "unitIds": ["infantry-squad"] }, "count": 1, "scope": "root" }],
    "requirementText": "Needs an Infantry Squad in its core formation",
    "when": { "if": "list.limit(points) >= 3000", "message": "3000 points or more" },
    "min": 0, "max": "1 + floor(root.count(role:troop) / 2)",
    "cost": { "reserve": 1 }
}
```

- `type` is a group type of the game. A slot is filled by a unit whose role is in `roles`; `tags` mark it for slot options; `repeat` lets the slot be added more than once; `units` (on the group or a slot) restricts which units may fill it, using a selector.
- `tagOptions` (validator ≥2.2.0) limits which slot options one of the slot's tags offers, by the options' `category`: `"tagOptions": { "prime": { "categories": ["honour"] } }`. Each key must be one of the slot's `tags` (an error otherwise). See [Slot options](#slot-options-benefits-for-tagged-slots).
- `requires` lists units the contingent (or its root group) must already hold; `when`, `min`, `max` and `cost` as above. Unavailable groups are disabled in the builder's menus and never removed automatically.
- `effects` (stat, special-rule, trait and slot-tag effects) apply to every unit in the group, including slots added later, for rules such as "Every unit in this group gains the Gun Line trait": `"effects": [{ "kind": "trait", "add": ["Gun Line"] }]`. The group's and slots' `units` selectors see a unit's traits **before** the group's own effects, so a group can't let units in by the trait it gives them. Needs validator 1.2.0+.
- **What `units` sees, and when.** The app judges a unit twice:
    - Offering units for an empty slot, it sees the unit as its records give it, plus list choice values. Upgrades aren't picked until the unit is in the slot.
    - Once the unit is in the slot, it sees the unit with its options' effects, before the group's.

  So a trait that an upgrade gives can't let a unit into a slot: the unit is never offered. Use `unitWhen` for that.
- `unitWhen` on a slot (validator ≥2.6.0) is a condition on the unit filling it, checked against the unit as configured (its options' gear and traits, before the group's effects) and shown as an issue while false. Units are still offered by role and `units`, so the player places the unit, then picks what the condition asks for. The app may hide units that no option could ever make meet the condition, such as a Heavy unit with no cannon option below. It is for "units of a second role may fill this slot, but only with some gear or upgrade":

  ```json
  { "roles": ["officer", "heavy"],
    "unitWhen": { "if": "unit.is(role:officer) or unit.has(weapon:cannon)",
                  "message": "A Heavy unit fills this slot only with a cannon" } }
  ```

  The slot still grants as its first granting role, whichever role fills it. A `unitWhen` that doesn't read `unit` is a warning: use the slot's `when` for whether the slot is there at all. `examples/full`'s `garrison` group has one.
- `addedSlotRoles` (validator ≥2.6.0) limits the slots that slot options picked in the group's slots may add, for rules such as "in this group, options that add slots may not be taken" (`[]`) or "…may only add Support slots" (`["support"]`):
    - Each `slot` effect's `roleChoices` is narrowed to the listed roles, and an option left with none isn't offered. An "add a Support or Transport slot" option is then offered as Support only.
    - Options without a `slot` effect are unaffected. Left out, there is no limit.
    - Roles must be game roles. A role no slot option in any loaded file can add is a warning.

  `examples/full`'s `standard-core` allows only Support.
- `listEffects` (validator ≥2.7.0) gives effects to units **outside** the group while it is in the list, for rules such as "every Walker in a list with this group gains Fearless":

  ```json
  "listEffects": [{ "units": "@vehicles", "effects": [{ "kind": "specialRule", "rule": { "id": "fearless" } }] }]
  ```

    - Each entry has `effects` (stat, special-rule, trait and slot-tag effects, as on a list choice value), an optional `units` selector, and an optional `scope`.
    - `scope: "list"` (the default) reaches every unit in the list, in every contingent, allies included. `"contingent"` reaches only the group's own contingent. The group's own units are reached too, if they match.
    - They apply right after list choice values, before options and groups' own `effects`. A group's `units` or an option's `when` can therefore read what they give.
    - `units` sees each unit with its own traits and sub-faction modifiers. Because it can reach any faction, its `unitIds` may name any loaded faction's units.
    - An effect's `when` sees the unit's own slot and group, not the group giving the effect; use `main.count(group:…)` and the like for conditions about the list.
    - Rule ids resolve where the group is defined, as for a slot's `effects`.
    - It replaces copying a unit modifier into every sub-faction. `examples/full`'s `armoured-spearhead` makes every vehicle in the list Fearless.

### Slots filled from another faction

Some rules add a slot that another faction's units, or units of other sub-factions of your faction, may fill. Give the slot a `source`, pick units with `units`, and change them with the slot's `effects`. Needs validator 1.3.0+.

"Add a slot of any role but Commander, filled by a unit from another order of this army, but not a Veterans unit or one with a Unique model; its Field Army trait becomes Veterans" (a slot option's `slot` effect):

```json
{ "kind": "slot", "roleChoices": ["troop", "support", "heavy"],
  "source": { "faction": "field-army", "subFactions": "any" },
  "units": { "exclude": [{ "traits": ["Veterans"] }, { "profiles": { "anyOf": ["Unique"] } }] },
  "effects": [{ "kind": "trait", "replace": { "from": ["Field Army"], "to": "Veterans" } }] }
```

"When a model with this rule is in a group, add a Heavy slot for one Battle Construct from the Clockwork Guild" (a special rule's `slots`):

```json
"construct-handler": { "id": "construct-handler", "name": "Construct Handler", "text": "…",
  "slots": [{ "roleChoices": ["heavy"], "source": { "faction": "clockwork-guild" },
              "units": { "unitIds": ["battle-construct"] } }] }
```

- `source.faction` is any faction of the game, even one from another source. `subFactions` adds its sub-factions' units: `"any"` or a list of ids. Without it only the faction's own units are offered.
- Prefer a selector that describes the rule (`exclude`, `roles`, `traits`) over a list of `unitIds`: new units then qualify without anyone editing your file. `unitIds` in a sourced slot name the source's units (any entry's, for a list).
- The selector sees only the unit's own `traits`. The group's `units` doesn't apply to the slot; its `effects` do, then the slot's.
- The unit keeps its own gear, rules and upgrades. Its home sub-faction's unit modifiers don't come with it.
- Group `slots` take a `source` too (with `roles`, as usual).

**From more than one faction** (validator 2.8.0). `source` may be a list. The slot offers every entry's units, and each unit filling it may come from any entry, so one copy of a slot can hold a Field Army unit and the next a Clockwork Guild unit. "Its units come from the Field Army or the Clockwork Guild, in any combination; each unit's Field Army or Foundry trait becomes Levy" (`mixed-levy` in `examples/full`):

```json
"slots": [
  { "roles": ["heavy"], "repeat": { "min": 1, "max": 2 },
    "source": [{ "faction": "field-army", "subFactions": "any" }, { "faction": "clockwork-guild" }] },
  { "roles": ["support", "heavy"],
    "source": [{ "faction": "field-army", "units": { "roles": ["support"] } },
               { "faction": "clockwork-guild", "units": { "unitIds": ["siege-construct"] } }] }
],
"effects": [{ "kind": "trait", "replace": { "from": ["Field Army", "Foundry"], "to": "Levy" } }]
```

- An entry's own `units` narrows that faction only, and its `unitIds` name that entry's units. The slot's `units` applies to every entry, and its `unitIds` may name any entry's units.
- List each faction once. A slot `unitIds` entry naming units of two entries is a warning, since either may fill the slot. Name it in one entry's `units` to pick one.
- One trait effect handles every source: `replace` drops each `from` trait the unit holds and adds `to` only if it held one. To change one source's units only, gate the effect on that faction's trait (`when: unit.is(trait:foundry)`).
- The same list form works in a slot option's `slot` effect and a special rule's `slots`. A list of one means the same as the object form.

### Selectors

A **UnitSelector** picks units: `{ "unitIds": [...], "roles": [...], "traits": [...], "profiles": { "anyOf": [...], "noneOf": [...] }, "specialRules": [...], "exclude": [...] }` (omitted field matches all; `traits` matches a unit with any of them, case-insensitively). `exclude` lists units to leave out, each entry matched like a selector: `{ "exclude": [{ "profiles": { "anyOf": ["Unique"] } }] }` leaves out any unit with a Unique profile, which `profiles.noneOf` can't say (it matches a unit with *some* profile that isn't Unique). Needs validator 1.3.0+. `specialRules` (validator ≥2.5.0) matches a unit when it or one of its profiles holds any of the listed rule ids, with any value: `{ "specialRules": ["skirmisher"] }`. A rule id no loaded file defines is a warning. Like `traits`, it sees the unit as it stands at the selector's point: a group's and slot's `units` see the unit before the group's effects, and a slot option's `units` sees it before slot-option effects. Profile filters don't look at traits; on an effect use `when: unit.is(trait:…)`. **"A unit made entirely of…"**: an excluded `profiles.noneOf` leaves out any unit with a profile outside the list, so `{ "traits": ["Foundry"], "exclude": [{ "profiles": { "noneOf": ["vehicle"] } }] }` matches only units whose every model is a vehicle. `traits` already means every model when the trait is the unit's, since every profile holds the unit's traits; a trait only some profiles hold can't be required of all of them. Anywhere one is accepted, `"@name"` refers to a **NamedSelector** in `selectors` (`{ "id", "name", "match": <UnitSelector> }`), looked up in the faction (with its sub-faction), then the game.

### Slot options (benefits for tagged slots)

`slotOptions`: `{ "id", "name", "text", "slotTag", "category"?, "slotRoles"?, "units"?, "when"?, "cost"?, "effects"? }`. A slot with the tag offers one option; `units` (a selector, validator 1.4.0+) limits it to slots whose unit matches, seen before slot-option effects, e.g. `{ "traits": ["Field Army"] }`; effects are stat/special-rule/trait effects and `model` effects (validator ≥2.10.0, for one model of the unit), plus at most one `{ "kind": "slot", "roleChoices": [...] }` (an extra slot, which may take `units`, a `source`, `effects` and, from validator 2.4.0, `count`: how many such slots it adds, each holding its own unit, e.g. `{ "kind": "slot", "roleChoices": ["support"], "count": 3 }` for "add three Support slots"; with several `roleChoices` the player picks one role for all of them. A second `slot` effect is a warning, since only the first is used) and one `{ "kind": "allowedRoles", "roles": [...] }`. A slot option can't have a slot-tag effect, or a sub-type effect except inside a `model` effect.

**`when`** (validator ≥2.6.0) offers the option only while it holds, for rules such as "this option may only be taken in a Gun Line": `"when": { "if": "group.is(group:gun-line)", "message": "Only in a Gun Line" }`. It sees the unit as `units` does, before slot-option effects, and may use `unit`, `slot`, `group`, `contingent`, `root`, `main` and `list` (not `profile`). A pick whose `when` turns false stays, with an issue. `examples/full`'s `flexible-troop` is offered only in core formations. A group's `addedSlotRoles` (see Groups) is the typed form for limiting options that add slots.

**Categories** (validator ≥2.2.0). `category` (an id) says what kind of option it is among its tag's, e.g. `"honour"` for the Honour options among a tag's options. A slot can then offer only some categories for a tag:

- a slot's own `tagOptions`: `{ "prime": { "categories": ["honour"] } }`, for rules such as "units in this group's Prime slots may only take Honour options, and no other Prime options";
- a slot-tag effect's `categories`, for the tags it adds.

**Combining.** When several restrictions apply to one tag on one slot (the slot's `tagOptions` and one or more slot-tag effects adding that tag), only options **every** restricting source allows are offered: the categories are intersected. A source without categories (a plain `tags` entry, a slot-tag effect without `categories`) restricts nothing, so it never widens a restricted one. With no restriction, every option of the tag is offered, as before. An option without a `category` is offered only where its tag is unrestricted.

A category in `tagOptions` or a slot-tag effect that no slot option of the tag has, in the game or any loaded faction or sub-faction, is a warning ("offers nothing"); an empty `categories` list is an error. `examples/full`'s `heavy-detachment` limits its Prime slot to the `honour` category (`honoured-crew`).

**A choice each unit of a group may make** (validator ≥2.5.0). Take a rule such as "when a unit in this group is added to the list, every model in it with Skirmisher (X) may exchange it for Armoured (1)". Declare a slot tag for the group, have the group tag the slots that hold its units, and write the exchange as a slot option that only units with the rule are offered:

```json
// game.json
"slotTags": { "garrison": { "id": "garrison", "name": "Garrison", "optionLabel": "Garrison Option" } }

// the faction (the slot option sits where its rule ids resolve)
"slotOptions": {
    "dig-in": { "id": "dig-in", "name": "Dig In", "text": "…", "slotTag": "garrison",
                "units": { "specialRules": ["skirmisher"] },
                "effects": [{ "kind": "specialRule",
                              "replace": { "from": ["skirmisher"], "to": { "id": "armoured", "value": "1" } } }] }
},
"groups": {
    "garrison": { "id": "garrison", "name": "Garrison", "type": "reserve", "slots": [ … ],
                  "effects": [{ "kind": "slotTag", "add": ["garrison"] }] }
}
```

- Each slot holds one unit, and the player picks at most one option per tag per slot, so the choice is made unit by unit. Units outside the group never get the tag.
- No unit record changes: a unit added later with the rule is offered the choice as well.
- Slot options apply last, so the exchange sees the rule however the unit got it.
- Give each group its own tag. Alternatively, share one tag and keep the groups' options apart with `category` and the slot-tag effect's `categories`.
- `examples/full`'s `garrison` group and `dig-in` slot option do this for the `pioneer-squad`, whose Pioneers hold Skirmisher (2) and whose Pioneer Chief doesn't.

## 6. The sub-faction file (`SubFaction`)

A modifier of a faction (an order, a regiment, a sponsor):

```json
{
    "id": "veterans",
    "version": "1.0.0",
    "name": "Veterans",
    "parent": { "faction": "field-army", "versions": ">=1.0.0 <2.0.0" },
    "overrides": [{ "kind": "specialRules", "id": "field-army" }],
    "specialRules": { },
    "upgrades": { },
    "unitModifiers": {
        "torches-for-all": {
            "id": "torches-for-all",
            "name": "Torches for all",
            "selector": "@line-troops",
            "actions": [
                { "kind": "addUpgrade", "upgradeId": "veterans-torch" },
                { "kind": "stat", "changes": [{ "stat": "t", "op": "add", "value": 1 }] },
                { "kind": "unavailable", "message": "Not available to this order" }
            ]
        }
    }
}
```

- It may hold the same record kinds as a faction (`units`, `weapons`, `upgrades`, `specialRules`, `groups`, …); they merge over the parent's. A record that shares a kind and id with the parent's **replaces** it only if listed in `overrides`; any other collision is an error.
- `unitModifiers` pick units with a selector and add a copy of a faction upgrade (`addUpgrade`, stable id from the modifier), apply stat/special-rule/trait effects, tag the slot holding them (`slotTag`, validator ≥2.2.0), or make the units `unavailable`.

### Several picks per faction (sub-faction groups)

When the rules let an army make more than one independent pick (a doctrine **and** a heritage, or one heritage plus a second under a condition), declare each pick as a group on the **faction** and put each sub-faction in one:

```json
// factions/field-army.json
"subFactionGroups": {
    "doctrine": { "id": "doctrine", "name": "Doctrine", "max": 1 },
    "heritage": {
        "id": "heritage",
        "name": "Heritage",
        "max": "1 + (list.has(unit:walker) ? 1 : 0)"
    }
}

// sub-factions/coastal-heritage.json
"group": "heritage",
"when": { "if": "choice(stance) == defensive", "message": "Coastal heritage is only for defensive lists" }
```

- `min` defaults to 0 and `max` to 1. Both may be expressions over `contingent`, `root`, `main` and `list`.
- Leave `group` out and the sub-faction is in the `default` group (at most one): a faction with a single pick (one regiment) needs no groups at all. Declare `default` in `subFactionGroups` if you want to name it or set `"min": 1`.
- `when` restricts a sub-faction: Defensive-only (`choice(stance) == defensive`), or needing another pick (`list.is(subfaction:…)`). Same scopes as the group limits.
- **Following the main contingent.** `main` is the list's main contingent (the one whose root group has `source: main`, e.g. the core formation and the formations linked to it; never one from an `ally` or `any` root). An allied contingent's sub-faction can follow it: a sub-faction that may only serve alongside a Veterans army is `"when": { "if": "not main.is(faction:field-army) or main.is(subfaction:veterans)", "message": "…" }`. When the sub-faction's own contingent is the main one, `main` is that contingent. Needs validator 1.2.0+.
- Sub-factions that can be taken together (different groups, or a group allowing more than one) must not define the same record or unit modifier id **differently**. Share a rule by copying it identically, or rename one. Two of them overriding the same parent record differently is an error too. Sub-factions in a group of at most one can't meet, so they may reuse ids.
- Needs validator 1.1.0+ and an app that supports several sub-factions per contingent.

Examples: `examples/full/sub-factions/*-doctrine.json` and `*-heritage.json`.

## 7. Expressions

Where no typed rule fits, a string expression computes a number or a condition. They read the list, never change it, always finish, and are checked when the data loads (`fo-validate` reports them).

```
1 + floor(root.count(role:troop) / 2)            a number: max of a group
choice(stance) == defensive                     a condition: when of an option
list.limit(points) >= 3000                        a condition: when of a group
unit.has(weapon:cannon) ? 25 : 15              a number: cost of an option
```

**Where:** `when.if` (bool); `min`/`max` on upgrades, options, groups, group types, count rules, unit `limit.max`, slot `repeat.max`, composition block `max` (validator 1.10.0) (number); cost values and resource `grants` (number).

**Syntax:** numbers; `+ - * /`; `== != < <= > >=` (not chainable); `and or not true false`; `a ? b : c` (spaces around the colon); `( )`. Names are lowercase with single hyphens inside, so write `a - b` with spaces for subtraction. No variables, strings, loops or property access.

**Scopes** (`scope.function(args)`), each seeing its own subject and what contains it. Which scopes a field may use:

| Field | Scopes |
| --- | --- |
| group `when` | `contingent`, `root`, `main`, `list` |
| group `min`/`max` | `group`, `contingent`, `root`, `main`, `list` |
| slot `when`/`repeat.max`, slot option cost | `slot`, `group`, `contingent`, `root`, `main`, `list` |
| slot `unitWhen`, slot option `when` (validator ≥2.6.0) | `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| unit `when`/`limit.max`/cost, composition block `max`/cost | `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| upgrade `when`/`min`/`max` | the unit's, plus `profile` when the upgrade has a `profileId` |
| option `when`/`max`/cost, sub-choice values | `option`, plus an upgrade's |
| stat / special-rule effect `when` | `profile`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` (trait effects with `profiles`, validator ≥2.9.0, too; other trait effects and slot-tag effects: the same without `profile`) |
| special rule `grants` | `rule`, `unit`, `slot`, `group`, `contingent`, `root`, `main`, `list` |
| sub-faction `when`, sub-faction group `min`/`max` | `contingent`, `root`, `main`, `list` |
| group type `min`/`max`, list rules | `main`, `list` (count rules limited to a contingent or group also see those and `root`) |

`main` is the list's main contingent: the one whose root group's type has `source: main`.

**Functions per scope:**

| Scope | Functions |
| --- | --- |
| `rule` | `value()` |
| `option` | `picks()`, `choice(sub-choice)` |
| `profile` | `count(gear)`, `has(gear)`, `is(type:, tag: or trait:)` |
| `unit` | `count(gear)`, `has(gear)`, `is(unit:/role:/type:/tag:/trait:/@sel)`, `sum(resource)`, `limit(unit resource)`, `models()` |
| `slot` | `is(tag: or role:)` |
| `group`, `root` | `count(unit ref or gear)`, `has(...)`, `is(type: or group:)`, `sum(resource[, unit ref])` |
| `contingent`, `main` | `count(unit ref, gear or group:)`, `has(...)`, `is(faction: or subfaction:)`, `sum(resource[, unit ref])` |
| `list` | as `contingent`, plus `limit(list resource)` |

Global: `choice(name)` (a list choice; compare with its value bare: `choice(stance) == defensive`), `floor(x)`, `ceil(x)`, `min(a, b, …)`, `max(a, b, …)`.

**References** are arguments only, `kind:id` with no spaces: `unit:`, `role:`, `type:` (a unit type, or a group type on `group`/`root`), `tag:` (lowercase-hyphen form of a free-text tag; a slot tag on `slot`), `trait:` (lowercase-hyphen form of a unit trait, including traits effects give; an unknown one is a warning), `weapon:`, `equipment:`, `group:` (a group type or group; the game's word works too), `faction:`, `subfaction:`; and `@id` for a named selector. `unit.count(role:troop)` is not allowed (on a unit `count`/`has` only count gear; use `unit.is(role:troop)`).

**Evaluation:** live as the list changes; a candidate is evaluated as if placed; a false `when` disables what isn't picked and raises an alert for what is; non-integer `min`/`max` round down; costs must be ≥ 0; errors (division by zero, negative cost) count the rule as not met instead of crashing.

The complete reference is `docs/specs/expression_language_spec_2026-10-17.md`; the Force Org app's Data Editor → Docs page shows it with the open game's names listed live.

## 8. Common mistakes

- `id` doesn't equal its key, or a key is not a slug (capitals, spaces, underscores).
- A role, unit type, template, group type, resource or choice used in a faction but never declared in the game file.
- A profile missing a stat its template lists, or carrying one it doesn't.
- Options pointing at weapons or equipment that aren't in the faction (`weaponRefs` are weapon ids).
- Restrictions written against option ids; they take gear (`{ "kind", "id" }`).
- `upgrades`, `weapons`, `equipment`, `specialRules` or `groups` left out of a faction instead of `{}`.
- A sub-faction record with the same kind and id as the parent's but no `overrides` entry.
- An expression using a scope the field can't see, a verb the scope doesn't have, or `a-b` for subtraction.
- Writing a rule as an expression when a typed form exists. The checker warns ("use `restrictions.exclusions`", "use a `resourceCap` list rule", …); do as it says.
- No `defaultGroup` on a main faction, or one that isn't a root group of the game.

## 9. Where to look next

- `schema/*.schema.json`: the exact schema of each file kind with a description on every field. Point your editor at them for completion and inline errors: add `"$schema": "<url or relative path>/faction.schema.json"` to a file (Force Org ignores the key), or map them in your editor settings. They are generated from `src/game_data/schema.ts` with `npm run generate-schema`.
- `docs/specs/data_schema_spec_2026-10-17.md`: the reasoning behind the schema. The spec was written before implementation; where it differs from the JSON Schema or the validator, those win.
- `docs/specs/expression_language_spec_2026-10-17.md`: the full expression language.
- `examples/`: complete sources. generic, game-neutral test sources. `starter` (smallest), `full` (uses every part of the schema: contingent and unit resources, slot options, list rules, sub-choices, sub-faction modifiers), `extension` (an extension source for `full`).
- The Force Org app's Data Editor → Docs page: the same material as a page, with the open game's names listed live.
