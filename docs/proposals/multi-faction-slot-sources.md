# Proposal: slots filled from more than one faction

Status: **Option A implemented in validator 2.8.0** (see `CHANGELOG.md`, the authoring guide and the data schema spec §7.1). One change from the draft below: the helper takes the `source` value, `slotSources(slot.source)`. The optional trait-replace lint in §6 was left out. The app changes (§7) and the open questions are still open. Written against validator 2.7.0 and the Force Org app as of 2026-11-20.

A data source has an additional group (a detachment) whose slots may each be filled from either of two other factions, in any mix. A slot's `source` (§7.1, validator 1.3.0) names one faction, so the rule can't be modelled as written. This proposal covers the rule shape, today's workaround, what the app does with sourced slots, design options with example JSON, a recommendation, the checks the validator would add, and open questions. The examples use `examples/full` vocabulary (`field-army` with its Field Army trait, `clockwork-guild` with its Foundry trait). The host faction, `free-company` with a Free Company trait, is invented for the examples; the motivating rule is described generically.

## Summary

| # | Question | Recommendation |
|---|---|---|
| 1 | Several factions in one slot, mixable within a group | `source` takes one source **or a list of sources** (Option A) |
| 2 | Changing the incoming unit's faction trait | no new field: one slot or group trait effect with `replace.from` listing every source's trait |
| 3 | Sub-factions per source; home unit modifiers | `subFactions` per entry, as today. Home modifiers still don't come along |
| 4 | `unitIds` / `@named` with several sources | slot `units` matches across all entries; an optional per-entry `units` narrows one source; ambiguous bare ids are a warning |
| 5 | Other slot fields | unchanged. The same list form works in a slot option's `slot` effect and a special rule's `slots` |
| 6 | Compatibility | the single-object form stays valid. `schemaVersion` stays 1; sources using the list form set `minValidatorVersion` |
| 7 | App | the candidate list merges every source's units, labelled by faction. The list format needs no change |
| — | Group-level default `source` (Option B) | optional, low priority |

---

## 1. The rule

**Rule shape.** "An additional group with slots Troop, Support, Transport, Troop, Heavy, Transport. Units filling its slots must come from faction A's list or faction B's list, in any combination. Models in this group replace their A or B faction trait with the host faction's trait." The host's sub-faction decides which of several host traits it becomes. How many of the group a list may hold is a `max` expression on host units, which works today and isn't part of this proposal.

**Requirements.**
1. Each slot accepts a unit from A **or** B. Slot 1 may hold an A unit and slot 2 a B unit in the same group.
2. A trait replace from A's trait or B's trait to the host's (per host sub-faction), either per source or as one shared effect.
3. Optionally the sources' sub-factions, as `source.subFactions` allows today, and a decision on whether a unit's home sub-faction modifiers come with it (today they don't).
4. Clear rules for `unitIds` and `@named` selectors in a slot with several sources, and validator checks for an unknown faction, an id in no listed source, and an id in two sources.
5. It must compose with slot `source`, slot and group `effects`, `unitWhen`, `repeat`, slot options' `slot` effects (with `count`) and special rules' `slots`.
6. Today's `source: { "faction", "subFactions"? }` keeps working.

**Secondary motivation (not designed for here).** The same data source has two sub-factions whose rules read "units X and Y of faction M may fill slots of role R in any of this contingent's groups, replacing their trait with the contingent's". Today those sub-factions hold **copies** of M's unit records. Option A gives the slot shape that rule needs: the contingent's own faction plus M's listed units, `[{ "faction": own }, { "faction": "M", "units": { "unitIds": [...] } }]`. It doesn't give a way for a sub-faction to add that source to every matching slot of the contingent; that needs its own design.

## 2. Today's workaround

The detachment is split into two groups with identical slots:

- Group 1 gives every slot `source: { "faction": A }`. Group 2 gives every slot `source: { "faction": B }`.
- Each group has three group `effects`, each a trait `replace` from that group's source trait to one host trait, gated by `when: contingent.is(subfaction:…)`.
- Each group's `max` is the shared allowance minus `contingent.count(group:<the other group>)`, so together they never exceed it.

In `examples/full` terms, group 1 looks like this (group 2 is the same with `clockwork-guild` and `Foundry`):

```json
"levy-muster-field-army": {
    "id": "levy-muster-field-army", "name": "Levy Muster (Field Army)", "type": "reserve",
    "slots": [
        { "roles": ["troop"],     "source": { "faction": "field-army" } },
        { "roles": ["support"],   "source": { "faction": "field-army" } },
        { "roles": ["transport"], "source": { "faction": "field-army" } }
    ],
    "effects": [{ "kind": "trait", "replace": { "from": ["Field Army"], "to": "Free Company" } }],
    "max": "contingent.count(trait:captain-rank) - contingent.count(group:levy-muster-clockwork-guild)"
}
```

The cost: one detachment is two group records (twelve slots and six effects copied). The player picks a faction per group rather than per slot, so **a mixed group can't be built**, and the group menu shows two entries for one rule.

## 3. What the app does today

Read from the Force Org app source.

- **The list format already records each unit's home.** A unit placed in a sourced slot is stored with `source: { faction, subFactions? }` (`ListUnit.source`, set by `newSourcedUnit` in `src/api/list/slot_edits.ts`; parsed in `list_import.ts`, shared as `s` in `list_share.ts`). The slot's own `source` comes from the data each time the list is built (`slots.ts`), so it isn't saved. **Several sources per slot need no change to saved or shared lists.**
- **Offering units.** For an empty slot with a `source`, `slot_editor.tsx` calls `sourceUnits(listData, slot.source)` (`src/api/list/borrowed.ts`). That returns the faction's own units plus those of the listed sub-factions, each as `{ unit, home }`. Candidates are filtered by `slotAccepts` (`rules.ts`), which skips the group's `units` for a sourced slot and applies the slot's `units` with the **owner's** named selectors. They are then judged by `unitWhenProspect` against the borrowed faction. Each candidate is keyed `${sourceKey(home)}:${unit.id}`, so the same id from two homes already stays distinct. A candidate's `from` label lists only its sub-faction names, not its faction.
- **Playing the unit.** `borrowedFaction(data, owner, home)` merges the home records (gear, upgrades, rules, sub-choices) over the owner's. It takes the owner's slot options, groups, selectors and list rules, and applies the **owner's** unit modifiers. `homeFaction` resolves the home sub-faction's records with `unitModifiers: undefined`, which is why home modifiers don't come along. `slotFaction` picks the borrowed faction for any slot whose unit has a `source`.
- **Live checks.** `sourcedSlotUnit` judges the slot's `units` against the unit's own home record. It falls back to `{ faction: slot.source.faction }` when the list unit has no `source`, which assumes a single source.
- **Costs and counts.**
  - A borrowed unit's cost comes from its home record. It counts toward list resources and resource caps like any unit: `filledSlots` covers every slot.
  - Group `requires` doesn't count borrowed units (`filledUnits` in `rules.ts` skips `slot.unit?.source`).
  - `count(unit:…)` matches by unit id alone (`unitMatches`, `context.ts`), whatever the unit's home.
  - I didn't find where the app enforces a unit's `limit` (Unique and similar). Searching `src/api/list` turns up upgrade limits and resource caps only. Whatever enforces it later needs to count a unit by home plus id.
- **Data editor.** `slot_source_editor.tsx` edits one faction and its sub-factions.

So the app already plays, stores and labels each borrowed unit by its own home. The single-source assumption sits in `sourceUnits`, the `sourcedSlotUnit` fallback, the candidate label and the editor.

---

## 4. Design options

### Option A: `source` takes one source or a list (recommended)

`SlotSource` stays as it is, plus one optional field, `units`. Wherever a slot takes `source` (group slots, a slot option's `slot` effect, a special rule's `slots`), it accepts either one `SlotSource` or a non-empty array of them:

```json
"levy-muster": {
    "id": "levy-muster", "name": "Levy Muster", "type": "reserve",
    "description": "Units come from the Field Army or the Clockwork Guild, in any combination, and become Free Company.",
    "slots": [
        { "roles": ["troop"],     "source": [{ "faction": "field-army" }, { "faction": "clockwork-guild" }] },
        { "roles": ["support"],   "source": [{ "faction": "field-army" }, { "faction": "clockwork-guild" }] },
        { "roles": ["transport"], "source": [{ "faction": "field-army" }, { "faction": "clockwork-guild" }] }
    ],
    "effects": [{ "kind": "trait", "replace": { "from": ["Field Army", "Foundry"], "to": "Free Company" } }],
    "max": "contingent.count(trait:captain-rank)"
}
```

**Semantics.**
- **Offering.** The slot offers the union of every entry's units: each entry's faction, plus its `subFactions`, as today. Each unit keeps its own home, so one copy of a `repeat` slot can hold a Field Army unit and the next a Clockwork Guild unit.
- **A list of one** means the same as the object form.
- **Per-entry `units`** (new, optional) narrows that entry only. Its `unitIds` are that entry's units. The slot's own `units` applies to every entry, and both must match. This settles ambiguous ids and covers "any unit of A, or only X and Y of B":

  ```json
  "source": [
      { "faction": "field-army" },
      { "faction": "clockwork-guild", "units": { "unitIds": ["battle-construct"] } }
  ],
  "units": { "exclude": [{ "profiles": { "anyOf": ["Unique"] } }] }
  ```

- **`subFactions`** is per entry: `[{ "faction": "field-army", "subFactions": "any" }, { "faction": "clockwork-guild" }]`.
- **Home sub-faction unit modifiers** still don't come along. The contingent's own modifiers apply, as for any borrowed unit (§7.1). This keeps one rule for all sourced slots. See open question 2.
- **Changing the unit (requirement 2).** No new field is needed:
  - A trait `replace` drops every `from` trait the unit holds and adds `to` only if it held one. So one effect with `from: ["Field Army", "Foundry"]` handles both sources, and a unit from either ends with one host trait.
  - Per host sub-faction variants keep today's `when: contingent.is(subfaction:…)` gate: three effects instead of six.
  - An effect that should touch only one source's units gates on that source's trait, e.g. `when: unit.is(trait:foundry)` or a `profiles` filter. Every faction's units carry their faction trait, so the trait identifies the source.
- **`unitIds` and `@named`.**
  - Slot `units.unitIds` match a unit of that id in **any** entry. If two entries both define the id, both units match, and the validator warns (§6).
  - An entry's `units.unitIds` name only that entry's units.
  - `@named` selectors, in either place, are the slot owner's, as today (§7.1). A selector's `traits` and `specialRules` see each unit's own records, as for any sourced slot.
  - No qualified-id syntax (`faction/unit`) is added. Per-entry `units` does that job with existing grammar.
- **Composition (requirement 5).**
  - **Group `units`** still doesn't apply to a sourced slot.
  - **Group and slot `effects`** apply as today, group first, to whichever unit is in the slot.
  - **`unitWhen`** is unchanged: it sees the unit as configured, with the borrowed faction's options, so it works per candidate whatever its home.
  - **`repeat`**: each copy chooses its unit, and so its source, independently.
  - **Slot options picked on the slot** are the owner's, as today.
  - **A slot option's `slot` effect** (`AddedSlot.source`) takes the same union, and every slot a `count` adds gets the same source list. So "add three Support slots, each from A or B" is one effect, mixed freely.
  - **A special rule's `slots`** take it too.
  - **`tags` / `tagOptions` / slot `when`** are unaffected.

**Pros.**
- One field and one concept. Existing data is untouched, and the list form reads like the rule ("from A or B").
- The app already keys, stores and plays borrowed units per home, so the change is mostly in `sourceUnits`.
- The workaround's two groups become one, and the cross-subtracting `max`es go away.
- Per-entry `units` serves the secondary motivation's "own faction, plus these units of M" slot.

**Cons.**
- `source` becomes `SlotSource | SlotSource[]`. Every consumer that reads `slot.source.faction` must normalise. In the app that is about five places (§7). In the validator it is `slotUnits` / `sourceUnits`.
- Each slot repeats the array. Option B can remove that.

### Option B: a group-level default source (add-on, low priority)

A group gains `slotSource`, the `source` every slot of the group without its own `source` takes. It includes slots that slot options and special rules add, unless those name their own:

```json
"levy-muster": {
    "id": "levy-muster", "name": "Levy Muster", "type": "reserve",
    "slotSource": [{ "faction": "field-army" }, { "faction": "clockwork-guild" }],
    "slots": [{ "roles": ["troop"] }, { "roles": ["support"] }, { "roles": ["transport"] }],
    "effects": [{ "kind": "trait", "replace": { "from": ["Field Army", "Foundry"], "to": "Free Company" } }]
}
```

- **Pros:** says the rule once ("units filling slots in this detachment…"), and covers slots added later without restating the source.
- **Cons:**
  - A second place a slot's source can come from.
  - It interacts with group `units`, which already "doesn't apply to slots with a `source`": a group with `slotSource` then has a `units` that applies to none of its slots, which needs a warning.
  - There must be a way for a slot to opt out back to the contingent (`"source": "contingent"` or similar).
- Only worth adding if several groups need it. It is independent of A, and works with the single-object form too.

### Option C: a separate `sources` field

Keep `source` as one object and add `sources: [SlotSource, …]`, with exactly one of the two allowed.

- **Pros:** `slot.source.faction` keeps its type, so code that ignores the new field still compiles.
- **Cons:**
  - Two fields for one concept, a mutual-exclusion check, and a doc line explaining which to use.
  - Code that ignores `sources` gives silently wrong behaviour. Option A's type change makes the compiler find every place instead.
  - An older validator rejects either field, so C gains nothing in compatibility (§5).
- Not recommended.

### Option D: a per-group faction choice

The group gets a player choice of source ("this detachment is drawn from A / from B"), applied to all its slots. This formalises the workaround as one group record, but it **doesn't allow mixing**, which the rule requires. Rejected.

### Option E: slot alternatives with their own effects

`source: [{ "faction", "subFactions"?, "units"?, "effects"? }]`: Option A plus per-entry `effects`, applied after the slot's `effects`. This is the "per-source change" form of requirement 2.

- **Pros:** the trait change sits beside the source it belongs to.
- **Cons:** a new effect step in the order (spec §5.2), more to check. A shared effect with a multi-`from` replace, or a trait-gated `when`, already does the job.
- Not recommended now. It can be added to A later without breaking anything if a rule needs genuinely different per-source effects that a trait gate can't express.

**Recommendation: Option A** (with per-entry `units`) for **2.8.0, high priority**. It is a correctness gap: the rule's "in any combination" can't be modelled today. Option B is low priority, to add if more groups need it. Options C, D and E are not recommended.

---

## 5. Backward compatibility

- **Data.** The object form stays valid with identical meaning, so every existing source passes unchanged. The list form is additive, so **`schemaVersion` stays 1**, as for every additive field so far.
- **Older validators** reject an array `source` as a shape error. A source using the list form or per-entry `units` sets `"minValidatorVersion": "2.8.0"`, so an older validator says "update" instead (spec §2).
- **Saved and shared lists** are unaffected: units already record their home (§3).
- **Types.** `SlotSource` gains optional `units`. `Slot.source` and `AddedSlot.source` become `SlotSource | SlotSource[]`. A helper exported from the validator, `slotSources(source): SlotSource[]`, gives consumers one normalised view.

## 6. Validation rules

New or changed checks, for group slots, `AddedSlot`s (slot option `slot` effects, special rule `slots`) and per-entry `units`:

| Check | Level |
|---|---|
| An empty `source` array | error |
| Unknown entry `faction` / unknown or non-child `subFactions` | error (today's check, per entry) |
| The same `faction` in two entries of one slot | error: list it once and merge `subFactions`, so each unit has one home per slot |
| Slot `units.unitIds`: an id in **no** entry's units (the faction's plus its listed sub-factions') | error (today's check, against the union) |
| Slot `units.unitIds`: an id in **two or more** entries | warning: "'walker' is a unit of field-army and clockwork-guild; both may fill the slot. Move it into one entry's `units` to pick one" |
| Entry `units.unitIds`: an id not among that entry's units | error |
| Entry `units` given as `@name` | checked against the owner's selectors, as today |
| A one-entry array | allowed, no finding |
| A trait `replace.from` in the slot's or group's effects naming a trait no unit of any entry carries | warning (lint; optional) |

Spec and guide updates: §7.1 (list form, per-entry `units`, id resolution), §8 (`unitIds` in sourced slots name the union), the authoring guide's "Slots filled from another faction", an `examples/full` group using two sources, the CHANGELOG with "For the app" notes, and the regenerated JSON Schema.

## 7. App impact

What the Force Org app would change (read only; not edited here):

- **`borrowed.ts`.** `sourceUnits` takes the slot's sources (normalised), concatenates each entry's units, and drops units an entry's `units` rejects. It already returns `{ unit, home }` per unit, and the candidate key `${sourceKey(home)}:${unit.id}` already keeps same-id units apart. `sourcedSlotUnit` loses its `slot.source.faction` fallback: every placed unit has `ListUnit.source`, and a legacy unit without one can fall back to the first entry.
- **`rules.ts`.** `slotAccepts` keeps skipping the group's `units` for any sourced slot. The live check gains one issue: a unit whose `ListUnit.source.faction` is no longer among the slot's entries (after a data change) gets "X can't fill this slot any more", like a unit that fails `units`.
- **Candidate picker (`slot_editor.tsx`).** The browser lists every entry's units together. Each candidate's `from` label gains the faction name when the slot has more than one entry (today it shows only sub-faction names). A long list could group by faction or offer a faction filter. That is a presentation choice; the merged, labelled list is enough to start.
- **Costs and limits.**
  - Points and other list resources come from the unit's home record and count in the list and its caps as today. Contingent grants and spends for its role apply as today.
  - Group `requires` still ignores borrowed units.
  - `count(unit:id)` matches by id across homes. Two sources sharing an id would be counted together, which is one reason the validator warns on ambiguous ids.
  - Whatever enforces a unit's `limit` should count by home plus id (see open question 3).
  - List rules (`resourceCap`, `count`) see the unit after its unconditional effects, the host trait from the replace included. So a host-trait selector counts these units, which is what the rule intends.
- **Effects.** No change: group and slot effects already apply to borrowed units, and `replace` with several `from` traits already works.
- **List import / share.** No format change. `list_import.ts` could check that a unit's `source` is one of its slot's entries, or leave that to the live check above.
- **Data editor.** `slot_source_editor.tsx` edits a list of entries (faction, sub-factions, optional `units`). `group_editor.tsx` shows the sources in the slot summary.
- The app needs validator 2.8.0's types and `slotSources` helper.

## 8. Open questions

1. **Sub-factions by default?** When a rule says "from faction A's list", does that include A's sub-faction-only units? Today the default is the faction's own units only, and data adds `subFactions: "any"` when the rule wants more. Keep that default.
2. **Home sub-faction modifiers.** Should an entry be able to say a unit brings its home sub-faction's modifiers (`homeModifiers: true`)? No current rule asks for it. A unit drawn "from another list" normally plays with its own records and the host's rules. Leave it out until a rule needs it.
3. **Unit `limit` across homes.** Should a Unique unit's limit count units with the same id from different homes together? Ids are per faction, so probably not. The app doesn't appear to enforce `limit` yet; decide when it does.
4. **`count(unit:…)` and borrowed units.** An expression in the host naming a source faction's unit id: is it an unknown reference today (the host's vocabulary), and should it resolve against the sources of the group's slots? Not needed for the motivating rule.
5. **Option B's opt-out.** If `slotSource` is added, how does a slot say "from the contingent after all"? `"source": "contingent"` is one candidate.
6. **Contingent-wide sources** (secondary motivation). A sub-faction rule that lets M's units fill every slot of role R in the contingent's groups would need a sub-faction-level way to add an entry to those slots. That deserves its own proposal once Option A exists.
