import type {
    ExpressionVocabulary,
    BuiltInScope,
} from '../expressions/checker';
import { BUILT_IN_SCOPES, tagId } from '../expressions/checker';
import type {
    Faction,
    FactionRecords,
    GameSystem,
    ModelEffect,
    SubFaction,
    SubTypeEffect,
    TraitEffect,
} from '../types';

const keys = (record?: object) => Object.keys(record ?? {});

/* The game's words for built-in scopes, e.g. `{ formation: 'group', primary: 'root' }` */
export function scopeWords(game: GameSystem): Record<string, BuiltInScope> {
    const words: Record<string, BuiltInScope> = {};
    for (const [key, term] of Object.entries(game.terms ?? {})) {
        if (
            term?.word &&
            (BUILT_IN_SCOPES as ReadonlyArray<string>).includes(key)
        ) {
            words[term.word] = key as BuiltInScope;
        }
    }
    return words;
}

/**
 * The game's sub-types as the `tagId` forms a tag may match them by (each
 * one's id and name), or undefined when the game defines no `subTypes`
 */
export function subTypeTags(game: GameSystem): Array<string> | undefined {
    if (!game.subTypes) return undefined;
    return [
        ...new Set(
            Object.values(game.subTypes).flatMap((s) => [
                tagId(s.id),
                tagId(s.name),
            ])
        ),
    ];
}

/**
 * The game's traits as the `tagId` forms a trait may match them by (each
 * one's id and name), or undefined when the game defines no `traits`
 */
export function definedTraits(game: GameSystem): Array<string> | undefined {
    if (!game.traits) return undefined;
    return [
        ...new Set(
            Object.values(game.traits).flatMap((t) => [
                tagId(t.id),
                tagId(t.name),
            ])
        ),
    ];
}

/* Unit and profile tags used anywhere in the records */
function tagsOf(records: Array<Partial<FactionRecords>>) {
    const tags = new Set<string>();
    for (const r of records) {
        for (const unit of Object.values(r.units ?? {})) {
            unit.tags?.forEach((t) => tags.add(t));
            for (const profile of unit.profiles)
                profile.tags?.forEach((t) => tags.add(t));
        }
    }
    return [...tags];
}

/* Records that may name traits: units, and every effect that can give one */
type TraitSource = Partial<
    Pick<
        FactionRecords,
        'units' | 'upgrades' | 'groups' | 'slotOptions' | 'specialRules'
    >
> &
    Partial<Pick<SubFaction, 'unitModifiers'>> &
    Partial<Pick<GameSystem, 'choices'>>;

/*
 * Every effect anywhere in the sources, those inside a `model` effect
 * (validator 2.10.0) included
 */
function eachEffect(
    sources: Array<TraitSource>,
    visit: (effect: { kind: string }) => void
) {
    const fromEffect = (effect: { kind: string }): void => {
        if (effect.kind === 'model')
            (effect as ModelEffect).effects.forEach(fromEffect);
        visit(effect);
    };
    const fromOptions = (options: Record<string, object>) => {
        for (const option of Object.values(options))
            if ('effects' in option)
                (option.effects as Array<{ kind: string }>).forEach(fromEffect);
    };
    for (const s of sources) {
        for (const unit of Object.values(s.units ?? {}))
            for (const upgrade of Object.values(unit.upgrades ?? {}))
                fromOptions(upgrade.options);
        for (const upgrade of Object.values(s.upgrades ?? {}))
            fromOptions(upgrade.options);
        for (const d of Object.values(s.groups ?? {})) {
            d.effects?.forEach(fromEffect);
            d.listEffects?.forEach((e) => e.effects.forEach(fromEffect));
            for (const slot of d.slots) slot.effects?.forEach(fromEffect);
        }
        for (const o of Object.values(s.slotOptions ?? {})) {
            o.effects?.forEach(fromEffect);
            for (const e of o.effects ?? [])
                if (e.kind === 'slot') e.effects?.forEach(fromEffect);
        }
        for (const r of Object.values(s.specialRules ?? {}))
            for (const slot of r.slots ?? []) slot.effects?.forEach(fromEffect);
        for (const m of Object.values(s.unitModifiers ?? {}))
            m.actions.forEach(fromEffect);
        for (const c of Object.values(s.choices ?? {}))
            for (const v of Object.values(c.values))
                v.effects?.forEach(fromEffect);
    }
}

/* Traits units have or trait effects give, anywhere in the sources */
function traitsOf(sources: Array<TraitSource>) {
    const traits = new Set<string>();
    for (const s of sources)
        for (const unit of Object.values(s.units ?? {})) {
            unit.traits?.forEach((t) => traits.add(t));
            for (const profile of unit.profiles)
                profile.traits?.forEach((t) => traits.add(t));
        }
    eachEffect(sources, (effect) => {
        if (effect.kind !== 'trait') return;
        const { add, replace } = effect as TraitEffect;
        add?.forEach((t) => traits.add(t));
        if (replace) traits.add(replace.to);
    });
    return [...traits];
}

/* Sub-types subType effects give (validator 2.10.0), anywhere in the sources */
function givenSubTypes(sources: Array<TraitSource>) {
    const tags = new Set<string>();
    eachEffect(sources, (effect) => {
        if (effect.kind === 'subType')
            (effect as SubTypeEffect).add?.forEach((t) => tags.add(t));
    });
    return [...tags];
}

/**
 * What expressions in a faction (optionally with one of its sub-factions
 * merged in) may refer to: its own records, then the game's. `factions` and
 * `subFactions` are every one available, for `faction:` / `subfaction:`
 * references; the traits they name (when given whole) are known to `trait:`
 * references everywhere, since `main` and `list` see other factions' units.
 */
export function buildVocabulary(
    game: GameSystem,
    records: Array<Partial<FactionRecords>>,
    factions: Array<Pick<Faction, 'id'> & TraitSource>,
    subFactions: Array<Pick<SubFaction, 'id'> & TraitSource>
): ExpressionVocabulary {
    const all = (key: keyof FactionRecords) =>
        records.flatMap((r) => keys(r[key]));
    const subChoices = [game.subChoices, ...records.map((r) => r.subChoices)];

    return {
        scopeWords: scopeWords(game),
        units: all('units'),
        roles: keys(game.roles),
        unitTypes: keys(game.unitTypes),
        groupTypes: keys(game.groupTypes),
        groups: [...keys(game.groups), ...all('groups')],
        weapons: all('weapons'),
        equipment: all('equipment'),
        factions: factions.map((f) => f.id),
        subFactions: subFactions.map((s) => s.id),
        selectors: [...keys(game.selectors), ...all('selectors')],
        slotTags: keys(game.slotTags),
        tags: [
            ...new Set([
                ...tagsOf(records),
                ...givenSubTypes([game, ...records]),
            ]),
        ],
        subTypes: subTypeTags(game),
        traits: traitsOf([game, ...records, ...factions, ...subFactions]),
        definedTraits: definedTraits(game),
        resources: Object.fromEntries(
            Object.values(game.resources).map((r) => [r.id, r.scope])
        ),
        choices: Object.fromEntries(
            Object.values(game.choices ?? {}).map((c) => [c.id, keys(c.values)])
        ),
        subChoices: Object.fromEntries(
            subChoices
                .flatMap((s) => Object.values(s ?? {}))
                .map((c) => [c.id, keys(c.values)])
        ),
    };
}
