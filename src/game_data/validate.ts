import { usedFor } from './resources';
import {
    checkExpression,
    ExpressionField,
    ExpressionVocabulary,
    FIELD_SCOPES,
    BuiltInScope,
    BUILT_IN_SCOPES,
    CompiledExpression,
    tagId,
} from '../expressions/checker';
import { evaluateNumber, EvaluationError } from '../expressions/evaluator';
import { isRelease, isVersionRange, satisfiesRange } from './versions';
import { didYouMean } from '../expressions/diagnostics';
import {
    DEFAULT_SUB_FACTION_GROUP,
    FACTION_RECORD_KINDS,
    swapFromRefs,
} from './schema';
import type {
    AddedSlot,
    Condition,
    Group,
    EquipmentWeapon,
    Faction,
    FactionRecords,
    GameSystem,
    NumberOrExpr,
    Option,
    CostTarget,
    CompositionBlock,
    ListChoice,
    ListRule,
    SlotOption,
    SlotSource,
    SlotUnitEffect,
    SlotTagEffect,
    Slot,
    Resource,
    SpecialRule,
    SubChoice,
    SpecialRuleEffect,
    SpecialRuleSelection,
    StatEffect,
    SubFaction,
    TraitEffect,
    SubFactionGroup,
    Unit,
    UnitExclusion,
    UnitSelectorOrRef,
    Upgrade,
    UpgradeReference,
    GearRef,
    GearSwap,
} from '../types';
import { buildVocabulary, definedTraits, subTypeTags } from './vocabulary';

/*
 * Integrity checks for game data in the new schema (data schema spec §11): ids
 * equal keys, every reference resolves, stats match their templates, and every
 * expression checks for its field. Runs on load in the app and in the
 * integrity test. Assumes the files already have the right shape.
 */

export type DataIssue = {
    severity: 'error' | 'warning';
    /** the file, as listed in the manifest */
    file: string;
    /** where in the file, e.g. `units/infantry-squad/upgrades/sgt-pistol` */
    path: string;
    message: string;
    /** expressions only: the source and the problem's span in it */
    expression?: { source: string; start: number; end: number };
};

export type DataFile<T> = { file: string; data: T };

export type GameDataSet = {
    game: DataFile<GameSystem>;
    factions: Array<DataFile<Faction>>;
    subFactions: Array<DataFile<SubFaction>>;
};

const RECORD_KINDS = FACTION_RECORD_KINDS satisfies ReadonlyArray<
    keyof FactionRecords
>;

const keys = (record?: object) => Object.keys(record ?? {});

/* A `ProfileFilter`: only `anyOf` / `noneOf`, each a list of text */
const isProfileFilter = (
    value: unknown
): value is { anyOf?: Array<string>; noneOf?: Array<string> } =>
    typeof value === 'object' &&
    !!value &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
        ([k, v]) =>
            (k === 'anyOf' || k === 'noneOf') &&
            Array.isArray(v) &&
            v.every((x) => typeof x === 'string')
    );

/* Structural equality of JSON data */
function sameData(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return (
        ak.length === bk.length &&
        ak.every(
            (k) =>
                k in b &&
                sameData(
                    (a as Record<string, unknown>)[k],
                    (b as Record<string, unknown>)[k]
                )
        )
    );
}

const TARGET_NAMES: Record<CostTarget, string> = {
    unit: 'unit costs',
    additionalModels: 'additional model costs',
    option: 'option costs',
    slotOption: 'slot option costs',
    group: 'group costs',
    grant: 'grants',
};

/** Whether an expression calls `unit.models()` */
const readsModels = (compiled: CompiledExpression) =>
    [...compiled.scopes].some(
        ([call, scope]) => scope === 'unit' && call.name === 'models'
    );

/**
 * A composition block's `max` expression at each unit size, rounded down and
 * at least 0 as the app takes it; undefined when it reads anything but
 * `unit.models()` (another scope, gear, a list choice), which only the
 * list can answer.
 */
function capAt(
    compiled: CompiledExpression,
    sizes: ReadonlyArray<number>
): Array<number> | undefined {
    try {
        return sizes.map((n) =>
            Math.max(
                evaluateNumber(
                    compiled,
                    {
                        scope: (s) =>
                            s === 'unit' ? { models: () => n } : undefined,
                        choice: () => undefined,
                    },
                    'max'
                ),
                0
            )
        );
    } catch (error) {
        if (error instanceof EvaluationError) return undefined;
        throw error;
    }
}

/** Records a faction (with a sub-faction merged in, if any) and its game define */
type Scope = {
    game: GameSystem;
    records: Partial<FactionRecords>;
    vocabulary: ExpressionVocabulary;
    unitStats: Set<string>;
    /* unit stats some template marks `numeric`, which an `add` can shift */
    numericStats: Set<string>;
};

class Validator {
    readonly issues: Array<DataIssue> = [];

    /* the game's sub-types in `tagId` form, when it defines any */
    private readonly subTypes: Array<string> | undefined;
    /* the game's traits in `tagId` form, when it defines any */
    private readonly definedTraits: Array<string> | undefined;

    constructor(private readonly set: GameDataSet) {
        this.subTypes = subTypeTags(set.game.data);
        this.definedTraits = definedTraits(set.game.data);
    }

    private file = '';

    private report(
        path: string,
        message: string,
        severity: DataIssue['severity'] = 'error'
    ) {
        this.issues.push({ severity, file: this.file, path, message });
    }

    /* ids equal keys in a record map */
    private ids(
        path: string,
        record: Record<string, { id: string }> | undefined
    ) {
        for (const [key, value] of Object.entries(record ?? {})) {
            if (value?.id !== key)
                this.report(
                    `${path}/${key}`,
                    `id is '${value?.id}', but the key is '${key}'`
                );
        }
    }

    private known(
        path: string,
        what: string,
        id: string,
        ids: Iterable<string>
    ) {
        if (![...ids].includes(id))
            this.report(path, `unknown ${what} '${id}'`);
    }

    /* With game `subTypes`: a unit or profile tag that matches none is a warning */
    private tags(path: string, tags: ReadonlyArray<string> | undefined) {
        const subTypes = this.subTypes;
        if (!subTypes) return;
        for (const tag of tags ?? []) {
            if (!subTypes.includes(tagId(tag)))
                this.report(
                    `${path}/tags`,
                    `the tag '${tag}' matches no sub-type${didYouMean(tagId(tag), subTypes)}`,
                    'warning'
                );
        }
    }

    /* With game `traits`: a trait that matches none is a warning */
    private traits(path: string, traits: ReadonlyArray<string> | undefined) {
        const defined = this.definedTraits;
        if (!defined) return;
        for (const trait of traits ?? []) {
            if (trait.trim() && !defined.includes(tagId(trait)))
                this.report(
                    path,
                    `the game defines no trait '${trait}'${didYouMean(tagId(trait), defined)}`,
                    'warning'
                );
        }
    }

    /*
     * With game `subTypes`: a profile filter (`profiles` / `excludeProfiles`
     * anywhere in a file) value that is neither a unit type id nor a sub-type
     * is a warning. Filters match case-insensitively, as in the app.
     */
    private profileFilters(path: string, data: unknown) {
        const subTypes = this.subTypes;
        if (!subTypes || typeof data !== 'object' || !data) return;
        if (Array.isArray(data)) {
            data.forEach((d, i) => this.profileFilters(`${path}/${i}`, d));
            return;
        }
        const unitTypes = keys(this.set.game.data.unitTypes);
        for (const [key, value] of Object.entries(data)) {
            const at = path ? `${path}/${key}` : key;
            if (
                (key === 'profiles' || key === 'excludeProfiles') &&
                isProfileFilter(value)
            ) {
                for (const v of [
                    ...(value.anyOf ?? []),
                    ...(value.noneOf ?? []),
                ]) {
                    if (
                        !unitTypes.includes(v.trim().toLowerCase()) &&
                        !subTypes.includes(tagId(v))
                    )
                        this.report(
                            at,
                            `'${v}' matches no unit type or sub-type${didYouMean(tagId(v), [...unitTypes, ...subTypes])}`,
                            'warning'
                        );
                }
            } else this.profileFilters(at, value);
        }
    }

    private expression(
        path: string,
        source: string,
        scopes: ReadonlyArray<BuiltInScope>,
        result: ExpressionField['result'],
        vocabulary: ExpressionVocabulary,
        lint?: ExpressionField['lint']
    ) {
        const checked = checkExpression(
            source,
            { scopes, result, lint },
            vocabulary
        );
        for (const d of checked.diagnostics) {
            this.issues.push({
                severity: d.severity,
                file: this.file,
                path,
                message: d.message,
                expression: { source, start: d.start, end: d.end },
            });
        }
        return checked;
    }

    private numberOrExpr(
        path: string,
        value: NumberOrExpr | undefined,
        scopes: ReadonlyArray<BuiltInScope>,
        vocabulary: ExpressionVocabulary
    ) {
        if (typeof value === 'string')
            this.expression(path, value, scopes, 'number', vocabulary);
    }

    /* A file's own `version`: a warning when it isn't `major.minor.patch` */
    private version(version: string) {
        if (!isRelease(version))
            this.report(
                'version',
                `'${version}' isn't a version number like 1.2.0, so version ranges can't be checked against it`,
                'warning'
            );
    }

    /*
     * A version range and the version it is about: a warning when the range
     * can't be read, or when it leaves that version out
     */
    private versionRange(
        path: string,
        range: string | undefined,
        what: string,
        version: string
    ) {
        if (range === undefined) return;
        if (!isVersionRange(range)) {
            this.report(
                path,
                `'${range}' can't be read as a version range like '>=1.2.0 <2.0.0'`,
                'warning'
            );
            return;
        }
        if (satisfiesRange(version, range) === false)
            this.report(
                path,
                `${what} is version ${version}, which '${range}' leaves out`,
                'warning'
            );
    }

    /* A fixed `min` above a fixed `max` can never be met */
    private minMax(
        path: string,
        min: NumberOrExpr | undefined,
        max: NumberOrExpr | undefined
    ) {
        if (typeof min === 'number' && typeof max === 'number' && min > max)
            this.report(path, `min ${min} is more than max ${max}`);
    }

    private condition(
        path: string,
        condition: Condition | undefined,
        scopes: ReadonlyArray<BuiltInScope>,
        vocabulary: ExpressionVocabulary,
        lint?: ExpressionField['lint']
    ) {
        if (!condition) return;
        const at = path ? `${path}/when` : 'when';
        if (!condition.message?.trim())
            this.report(at, 'a condition needs a message for players');
        this.expression(at, condition.if, scopes, 'boolean', vocabulary, lint);
    }

    /* ---------------------------------------------------------------- */

    run() {
        const { game, factions, subFactions } = this.set;
        this.sharedIds();
        this.file = game.file;
        this.gameSystem(game.data);
        this.profileFilters('', game.data);

        for (const faction of factions) {
            this.file = faction.file;
            this.faction(faction.data);
            this.profileFilters('', faction.data);
        }
        for (const sub of subFactions) {
            this.file = sub.file;
            this.subFaction(sub.data);
            this.profileFilters('', sub.data);
        }
        for (const faction of factions) this.combinedSubFactions(faction.data);
        return this.issues;
    }

    /*
     * Two factions with one id, or two sub-factions of one faction with one
     * id: a `parent`, a slot `source` or an expression naming the id can't
     * tell them apart. A warning, because two sources may each provide a
     * faction with the same id (spec §2); within one source it is a mistake.
     */
    private sharedIds() {
        const { factions, subFactions } = this.set;
        const check = (
            files: Array<{ file: string; key: string; what: string }>
        ) => {
            const first = new Map<string, string>();
            for (const { file, key, what } of files) {
                const earlier = first.get(key);
                if (earlier === undefined) first.set(key, file);
                else {
                    this.file = file;
                    this.report(
                        'id',
                        `${what} is also in ${earlier}`,
                        'warning'
                    );
                }
            }
        };
        check(
            factions.map((f) => ({
                file: f.file,
                key: f.data.id,
                what: `the faction id '${f.data.id}'`,
            }))
        );
        check(
            subFactions.map((s) => ({
                file: s.file,
                key: `${s.data.parent.faction}/${s.data.id}`,
                what: `the sub-faction id '${s.data.id}' of '${s.data.parent.faction}'`,
            }))
        );
    }

    private scopeFor(records: Array<Partial<FactionRecords>>): Scope {
        const game = this.set.game.data;
        const merged: Partial<FactionRecords> = {};
        for (const kind of RECORD_KINDS) {
            (merged as Record<string, object>)[kind] = Object.assign(
                {},
                ...records.map((r) => r[kind] ?? {})
            );
        }
        return {
            game,
            records: merged,
            vocabulary: buildVocabulary(
                game,
                records,
                this.set.factions.map((f) => f.data),
                this.set.subFactions.map((s) => s.data)
            ),
            unitStats: new Set(
                Object.values(game.stats.unit).flatMap((t) =>
                    t.stats.map((s) => s.id)
                )
            ),
            numericStats: new Set(
                Object.values(game.stats.unit).flatMap((t) =>
                    t.stats.filter((s) => s.numeric).map((s) => s.id)
                )
            ),
        };
    }

    private gameSystem(game: GameSystem) {
        this.version(game.version);
        for (const kind of [
            'roles',
            'unitTypes',
            'subTypes',
            'traits',
            'groupTypes',
            'slotTags',
            'resources',
            'choices',
            'listRules',
            'groups',
            'specialRules',
            'selectors',
            'slotOptions',
            'subChoices',
        ] as const) {
            this.ids(
                kind,
                game[kind] as Record<string, { id: string }> | undefined
            );
        }
        for (const kind of ['unit', 'weapon'] as const) {
            this.ids(`stats/${kind}`, game.stats[kind]);
            for (const template of Object.values(game.stats[kind])) {
                const ids = template.stats.map((s) => s.id);
                if (new Set(ids).size !== ids.length)
                    this.report(
                        `stats/${kind}/${template.id}`,
                        'stat ids repeat'
                    );
            }
        }
        for (const choice of Object.values(game.choices ?? {})) {
            this.ids(`choices/${choice.id}/values`, choice.values);
            if (choice.default && !(choice.default in choice.values)) {
                this.report(
                    `choices/${choice.id}`,
                    `default '${choice.default}' isn't one of its values`
                );
            }
        }
        // words in terms must not hijack a different built-in scope
        const words = new Map<string, string>();
        for (const [key, term] of Object.entries(game.terms ?? {})) {
            if (!term?.word) continue;
            const builtIn = (BUILT_IN_SCOPES as ReadonlyArray<string>).includes(
                term.word
            );
            if (builtIn && term.word !== key)
                this.report(
                    `terms/${key}`,
                    `'${term.word}' is already a built-in scope`
                );
            if (words.has(term.word) && words.get(term.word) !== key) {
                this.report(
                    `terms/${key}`,
                    `'${term.word}' is also the word for ${words.get(term.word)}`
                );
            }
            words.set(term.word, key);
        }

        const groupTypes = keys(game.groupTypes);
        for (const type of Object.values(game.groupTypes)) {
            if (typeof type.contingent === 'object') {
                for (const t of type.contingent.linksTo)
                    this.known(
                        `groupTypes/${type.id}`,
                        'group type',
                        t,
                        groupTypes
                    );
                if (type.source !== undefined)
                    this.report(
                        `groupTypes/${type.id}/source`,
                        "source is only read for a root group type; a linked one shares its root's",
                        'warning'
                    );
            }
        }
        for (const id of keys(game.groups)) {
            if (groupTypes.includes(id))
                this.report(
                    `groups/${id}`,
                    'a group id may not equal a group type id'
                );
        }

        const unitStats = Object.values(game.stats.unit).flatMap((t) =>
            t.stats.map((s) => s.id)
        );
        for (const resource of Object.values(game.resources)) {
            if (resource.scope === 'unit') {
                if (!resource.capacityStat)
                    this.report(
                        `resources/${resource.id}`,
                        'a unit resource needs a capacityStat'
                    );
                else
                    this.known(
                        `resources/${resource.id}`,
                        'stat',
                        resource.capacityStat,
                        unitStats
                    );
            }
            // fields read for one scope only
            const only = (
                field: 'capacityStat' | 'defaultLimit' | 'message',
                scope: Resource['scope']
            ) => {
                if (resource[field] !== undefined && resource.scope !== scope)
                    this.report(
                        `resources/${resource.id}/${field}`,
                        `${field} is only read for a ${scope} resource, not a ${resource.scope} one`,
                        'warning'
                    );
            };
            only('capacityStat', 'unit');
            only('defaultLimit', 'list');
            only('message', 'contingent');
        }

        const scope = this.scopeFor([]);
        const vocabulary = scope.vocabulary;
        for (const type of Object.values(game.groupTypes)) {
            this.numberOrExpr(
                `groupTypes/${type.id}/min`,
                type.min,
                FIELD_SCOPES.list,
                vocabulary
            );
            this.numberOrExpr(
                `groupTypes/${type.id}/max`,
                type.max,
                FIELD_SCOPES.list,
                vocabulary
            );
            this.minMax(`groupTypes/${type.id}`, type.min, type.max);
        }

        this.listRules(game.listRules, scope);
        this.choiceEffects(game.choices, scope);

        // contingent resources: roles grant them, group types cost them
        for (const role of Object.values(game.roles))
            if (role.grants)
                this.costs(
                    `roles/${role.id}/grants`,
                    role.grants,
                    scope,
                    FIELD_SCOPES.slot,
                    'grant'
                );
        for (const type of Object.values(game.groupTypes))
            if (type.cost)
                this.costs(
                    `groupTypes/${type.id}/cost`,
                    type.cost,
                    scope,
                    FIELD_SCOPES.groupLimit,
                    'group'
                );

        this.groups('groups', game.groups, scope);
        this.specialRules('specialRules', game.specialRules, scope);
        this.subChoices(game.subChoices, scope);
        this.slotOptions('slotOptions', game.slotOptions, scope);
        for (const selector of Object.values(game.selectors ?? {}))
            this.selector(`selectors/${selector.id}`, selector.match, scope);
    }

    /* ---------------------------------------------------------------- */

    private faction(faction: Faction) {
        const game = this.set.game.data;
        this.version(faction.version);
        if (faction.game.id !== game.id)
            this.report(
                'game',
                `this faction is for '${faction.game.id}', not '${game.id}'`
            );
        else
            this.versionRange(
                'game/versions',
                faction.game.versions,
                `the game '${game.id}'`,
                game.version
            );
        for (const kind of RECORD_KINDS)
            this.ids(
                kind,
                faction[kind] as Record<string, { id: string }> | undefined
            );
        if (faction.defaultGroup) {
            const id = faction.defaultGroup;
            const group = faction.groups?.[id] ?? game.groups?.[id];
            const type = group && game.groupTypes[group.type];
            if (!group) this.report('defaultGroup', `unknown group '${id}'`);
            else if (
                type?.contingent !== 'root' ||
                (type.source ?? 'main') !== 'main'
            )
                this.report(
                    'defaultGroup',
                    `'${id}' isn't a group a list starts with (a root group type from the main faction)`
                );
        }

        // a faction's record with the same id as the game's hides it; almost always a mistake
        for (const kind of [
            'specialRules',
            'groups',
            'selectors',
            'slotOptions',
            'subChoices',
            'listRules',
        ] as const) {
            for (const id of keys(faction[kind])) {
                if (id in (game[kind] ?? {}))
                    this.report(
                        `${kind}/${id}`,
                        `hides the game's ${kind} '${id}'`,
                        'warning'
                    );
            }
        }
        for (const id of keys(faction.groups)) {
            if (id in game.groupTypes)
                this.report(
                    `groups/${id}`,
                    'a group id may not equal a group type id'
                );
        }

        const scope = this.scopeFor([faction]);
        this.records(faction, scope);

        this.ids('subFactionGroups', faction.subFactionGroups);
        for (const group of Object.values(faction.subFactionGroups ?? {})) {
            const at = `subFactionGroups/${group.id}`;
            this.numberOrExpr(
                `${at}/min`,
                group.min,
                FIELD_SCOPES.subFaction,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/max`,
                group.max,
                FIELD_SCOPES.subFaction,
                scope.vocabulary
            );
            const min = group.min ?? 0;
            const max = group.max ?? 1;
            if (typeof min === 'number' && typeof max === 'number' && min > max)
                this.report(at, `min ${min} is more than max ${max}`);
        }
    }

    /* The group a sub-faction is in, or undefined when it names an unknown one */
    private groupOf(
        sub: SubFaction,
        parent: Faction
    ): { id: string; group?: SubFactionGroup } | undefined {
        const id = sub.group ?? DEFAULT_SUB_FACTION_GROUP;
        const group = parent.subFactionGroups?.[id];
        if (!group && id !== DEFAULT_SUB_FACTION_GROUP) return undefined;
        return { id, group };
    }

    /*
     * Sub-factions of the same parent that a contingent can take together (in
     * different groups, or in one group whose max may exceed 1) are merged into
     * one set of records, so they must not define the same record or unit
     * modifier differently. Identical copies are fine. Reported in the later
     * file. Each sub-faction was already checked against its parent alone.
     */
    private combinedSubFactions(parent: Faction) {
        const subs = this.set.subFactions.filter(
            (s) => s.data.parent.faction === parent.id
        );
        const multiple = (group?: SubFactionGroup) => {
            const max = group?.max ?? 1;
            return typeof max === 'string' || max > 1;
        };
        subs.forEach((b, j) => {
            const bGroup = this.groupOf(b.data, parent);
            if (!bGroup) return;
            for (const a of subs.slice(0, j)) {
                const aGroup = this.groupOf(a.data, parent);
                if (!aGroup) continue;
                if (aGroup.id === bGroup.id && !multiple(aGroup.group))
                    continue;
                this.file = b.file;
                const other = `sub-faction '${a.data.id}' (${a.file})`;
                const why =
                    aGroup.id === bGroup.id
                        ? `group '${aGroup.id}' allows more than one`
                        : `they're in groups '${aGroup.id}' and '${bGroup.id}'`;
                for (const kind of [
                    ...RECORD_KINDS,
                    'unitModifiers',
                ] as const) {
                    const mine = (b.data[kind] ?? {}) as Record<
                        string,
                        unknown
                    >;
                    const theirs = (a.data[kind] ?? {}) as Record<
                        string,
                        unknown
                    >;
                    for (const id of keys(mine)) {
                        if (!(id in theirs) || sameData(mine[id], theirs[id]))
                            continue;
                        const overridden =
                            kind !== 'unitModifiers' &&
                            id in ((parent[kind] as object) ?? {});
                        this.report(
                            `${kind}/${id}`,
                            overridden
                                ? `${other} also overrides the parent's ${kind} '${id}', differently, and both can be taken together (${why}); make the replacements identical, or keep the two from being taken together`
                                : `${other} also defines ${kind} '${id}', differently, and both can be taken together (${why}); make them identical or rename one`
                        );
                    }
                }
            }
        });
    }

    private subFaction(sub: SubFaction) {
        const parent = this.set.factions.find(
            (f) => f.data.id === sub.parent.faction
        )?.data;
        if (!parent) {
            this.report(
                'parent',
                `parent faction '${sub.parent.faction}' isn't loaded`
            );
            return;
        }
        this.version(sub.version);
        this.versionRange(
            'parent/versions',
            sub.parent.versions,
            `the faction '${parent.id}'`,
            parent.version
        );
        for (const kind of RECORD_KINDS)
            this.ids(
                kind,
                sub[kind] as Record<string, { id: string }> | undefined
            );

        const overrides = sub.overrides ?? [];
        for (const kind of RECORD_KINDS) {
            for (const id of keys(sub[kind])) {
                if (
                    id in (parent[kind] ?? {}) &&
                    !overrides.some((o) => o.kind === kind && o.id === id)
                ) {
                    this.report(
                        `${kind}/${id}`,
                        `collides with the parent's ${kind} '${id}'; list it in overrides if that's intended`
                    );
                }
            }
        }
        for (const o of overrides) {
            if (!(o.id in ((parent[o.kind] as object) ?? {})))
                this.report(
                    `overrides`,
                    `the parent has no ${o.kind} '${o.id}' to override`
                );
        }

        const scope = this.scopeFor([parent, sub]);
        this.records(sub, scope);

        if (!this.groupOf(sub, parent)) {
            const groups = [
                DEFAULT_SUB_FACTION_GROUP,
                ...keys(parent.subFactionGroups),
            ];
            this.report(
                'group',
                `'${parent.id}' has no sub-faction group '${sub.group}'${didYouMean(sub.group!, groups)}`
            );
        }
        this.condition('', sub.when, FIELD_SCOPES.subFaction, scope.vocabulary);

        for (const modifier of Object.values(sub.unitModifiers ?? {})) {
            const path = `unitModifiers/${modifier.id}`;
            this.selector(path, modifier.selector, scope);
            modifier.actions.forEach((action, i) => {
                const at = `${path}/actions/${i}`;
                if (action.kind === 'addUpgrade')
                    this.known(
                        at,
                        'faction upgrade',
                        action.upgradeId,
                        keys(scope.records.upgrades)
                    );
                else if (action.kind === 'unavailable') {
                    if (!action.message?.trim())
                        this.report(at, 'needs a message for players');
                } else this.effect(at, action, scope, FIELD_SCOPES.effect);
            });
        }
        this.ids('unitModifiers', sub.unitModifiers);
    }

    /* ---------------------------------------------------------------- */

    /* checks the records a faction or sub-faction defines, resolving against `scope` */
    private records(r: Partial<FactionRecords>, scope: Scope) {
        for (const weapon of Object.values(r.weapons ?? {}))
            this.weaponProfiles(`weapons/${weapon.id}`, weapon, scope);
        for (const equipment of Object.values(r.equipment ?? {})) {
            if (!equipment.weapon) continue;
            const at = `equipment/${equipment.id}/weapon`;
            this.weaponProfiles(at, equipment.weapon, scope);
            if (!equipment.weapon.profiles.length)
                this.report(at, 'has no profiles', 'warning');
            // usually a weapon record left behind when its profile moved here
            if (scope.records.weapons?.[equipment.id])
                this.report(
                    at,
                    `there is also a weapon '${equipment.id}', held and counted apart from this profile; if it is the same attack, remove the weapon and give units the equipment instead`,
                    'warning'
                );
        }
        for (const upgrade of Object.values(r.upgrades ?? {}))
            this.upgrade(
                `upgrades/${upgrade.id}`,
                upgrade,
                scope,
                FIELD_SCOPES.upgrade
            );
        for (const unit of Object.values(r.units ?? {})) this.unit(unit, scope);
        this.groups('groups', r.groups, scope);
        this.specialRules('specialRules', r.specialRules, scope);
        this.slotOptions('slotOptions', r.slotOptions, scope);
        this.listRules(r.listRules, scope);
        for (const selector of Object.values(r.selectors ?? {}))
            this.selector(`selectors/${selector.id}`, selector.match, scope);
        this.subChoices(r.subChoices, scope);
    }

    /* a weapon's profiles, or the profiles an equipment's `weapon` gives (validator 2.3.0) */
    private weaponProfiles(
        path: string,
        weapon: EquipmentWeapon,
        scope: Scope
    ) {
        const { game } = scope;
        if (!game.stats.weapon[weapon.template])
            this.report(path, `unknown weapon template '${weapon.template}'`);
        weapon.profiles.forEach((p, i) => {
            // a profile's own template (validator 1.11.0) wins over the weapon's
            const at = `${path}/profiles/${i}`;
            const id = p.template ?? weapon.template;
            const template = game.stats.weapon[id];
            if (!template) {
                if (p.template)
                    this.report(at, `unknown weapon template '${id}'`);
                return;
            }
            if (p.template === weapon.template)
                this.report(
                    at,
                    `the profile's template is the weapon's '${weapon.template}' already; leave it out`,
                    'warning'
                );
            this.stats(
                at,
                p.stats,
                template.stats.map((s) => s.id)
            );
        });
        weapon.profiles.forEach((p, i) =>
            p.specialRules?.forEach((s) =>
                this.rule(`${path}/profiles/${i}`, s, scope)
            )
        );
    }

    private stats(
        path: string,
        stats: Record<string, string>,
        wanted: Array<string>
    ) {
        const missing = wanted.filter((k) => !(k in stats));
        const extra = keys(stats).filter((k) => !wanted.includes(k));
        if (missing.length)
            this.report(path, `missing stats: ${missing.join(', ')}`);
        if (extra.length)
            this.report(path, `stats not in the template: ${extra.join(', ')}`);
    }

    /* Amounts given at a target (a unit's cost, a grant, …) in resources used for it */
    private costs(
        path: string,
        costs: Record<string, NumberOrExpr>,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>,
        target: CostTarget
    ) {
        for (const [resource, value] of Object.entries(costs)) {
            const found = scope.game.resources[resource];
            if (!found) this.known(path, 'resource', resource, []);
            else if (!usedFor(found).includes(target))
                this.report(
                    path,
                    `'${resource}' isn't used for ${TARGET_NAMES[target]}`
                );
            else if (target === 'grant' && found.scope !== 'contingent')
                this.report(
                    path,
                    `'${resource}' isn't a contingent resource, so it can't be granted`
                );
            this.numberOrExpr(
                `${path}/${resource}`,
                value,
                scopes,
                scope.vocabulary
            );
        }
    }

    private rule(path: string, selection: SpecialRuleSelection, scope: Scope) {
        const rule =
            scope.records.specialRules?.[selection.id] ??
            scope.game.specialRules?.[selection.id];
        if (!rule) this.report(path, `unknown special rule '${selection.id}'`);
        else if (selection.value !== undefined && !rule.configurable)
            this.report(
                path,
                `'${selection.id}' is given a value but takes none`,
                'warning'
            );
    }

    private gear(path: string, ref: GearRef, scope: Scope) {
        const pool =
            ref.kind === 'weapon'
                ? scope.records.weapons
                : scope.records.equipment;
        if (!(ref.id in (pool ?? {})))
            this.report(path, `unknown ${ref.kind} '${ref.id}'`);
    }

    private unit(unit: Unit, scope: Scope) {
        const path = `units/${unit.id}`;
        const { game } = scope;
        this.known(path, 'role', unit.role, keys(game.roles));
        this.known(path, 'unit type', unit.type, keys(game.unitTypes));
        this.tags(path, unit.tags);
        this.traits(`${path}/traits`, unit.traits);
        this.costs(`${path}/cost`, unit.cost, scope, FIELD_SCOPES.unit, 'unit');
        if (unit.additionalModels)
            this.costs(
                `${path}/additionalModels/cost`,
                unit.additionalModels.cost,
                scope,
                FIELD_SCOPES.unit,
                'additionalModels'
            );

        const profileIds = unit.profiles.map((p) => p.id);
        if (!profileIds.length) this.report(path, 'has no profiles', 'warning');
        if (new Set(profileIds).size !== profileIds.length)
            this.report(path, 'profile ids repeat');
        if (unit.composition) this.composition(unit, profileIds, scope);
        unit.profiles.forEach((profile) => {
            const at = `${path}/profiles/${profile.id}`;
            const template = game.stats.unit[profile.template];
            if (!template)
                this.report(at, `unknown unit template '${profile.template}'`);
            else
                this.stats(
                    at,
                    profile.stats,
                    template.stats.map((s) => s.id)
                );
            if (profile.type)
                this.known(at, 'unit type', profile.type, keys(game.unitTypes));
            this.tags(at, profile.tags);
            this.traits(`${at}/traits`, profile.traits);
            profile.specialRules?.forEach((s) => this.rule(at, s, scope));
        });

        for (const gear of unit.defaultGear ?? []) {
            this.gear(`${path}/defaultGear`, gear, scope);
            if (gear.profileId)
                this.known(
                    `${path}/defaultGear`,
                    'profile',
                    gear.profileId,
                    profileIds
                );
        }
        unit.defaultGear?.forEach((gear, i) =>
            this.gearNote(`${path}/defaultGear/${i}/note`, gear.note)
        );

        const upgradeIds = keys(unit.upgrades);
        for (const upgrade of Object.values(unit.upgrades ?? {})) {
            const at = `${path}/upgrades/${upgrade.id}`;
            if (upgrade.profileId)
                this.known(at, 'profile', upgrade.profileId, profileIds);
            for (const r of upgrade.replaces ?? [])
                this.known(at, 'sibling upgrade', r, upgradeIds);
            const scopes: Array<BuiltInScope> = upgrade.profileId
                ? ['profile', ...FIELD_SCOPES.upgrade]
                : [...FIELD_SCOPES.upgrade];
            this.upgrade(at, upgrade, scope, scopes);
            this.swapFrom(at, upgrade, unit, scope);
            this.mirrorOf(at, upgrade, unit, scope);
        }
        this.ids(`${path}/upgrades`, unit.upgrades);

        this.condition(path, unit.when, FIELD_SCOPES.unit, scope.vocabulary);
        if (unit.limit)
            this.numberOrExpr(
                `${path}/limit/max`,
                unit.limit.max,
                FIELD_SCOPES.unit,
                scope.vocabulary
            );
    }

    /*
     * A unit's composition blocks: profiles in at most one block, whole
     * numbers, a cost wherever the unit can grow, and a `modelCount` that
     * matches the blocks at their minimum. A `max` may be an expression
     * (validator 1.10.0), evaluated live for the unit as it stands; one that
     * depends on nothing but `unit.models()` is worked out at every size the
     * unit can have, so the checks on fixed maxima apply to it too.
     */
    private composition(unit: Unit, profileIds: Array<string>, scope: Scope) {
        const path = `units/${unit.id}/composition`;
        const blocks = unit.composition ?? [];
        const whole = (n: number, least: number) =>
            Number.isInteger(n) && n >= least;
        const size = (block: CompositionBlock) =>
            Object.values(block.profiles).reduce((sum, n) => sum + n, 0);
        if (unit.additionalModels)
            this.report(
                `units/${unit.id}/additionalModels`,
                "a unit with a composition grows through its blocks' max and cost, not additionalModels"
            );

        const blockIds = blocks.map((b) => b.id);
        if (new Set(blockIds).size !== blockIds.length)
            this.report(path, 'block ids repeat');
        const blockOf = new Map<string, string>();
        /** block id → its `max` expression, when it checks */
        const live = new Map<string, CompiledExpression>();
        let baseModels = 0;
        for (const block of blocks) {
            const at = `${path}/${block.id}`;
            const counts = Object.entries(block.profiles);
            if (!counts.length)
                this.report(at, 'a block needs at least one profile');
            for (const [profile, count] of counts) {
                this.known(at, 'profile', profile, profileIds);
                if (!whole(count, 1))
                    this.report(
                        `${at}/profiles/${profile}`,
                        `a block holds a whole number of models of each profile, at least 1 (got ${count})`
                    );
                const other = blockOf.get(profile);
                if (other !== undefined && other !== block.id)
                    this.report(
                        at,
                        `profile '${profile}' is also in block '${other}'; a profile may be in only one block`
                    );
                blockOf.set(profile, block.id);
            }
            const min = block.min ?? 1;
            if (!whole(min, 0))
                this.report(at, `min must be a whole number (got ${min})`);
            if (typeof block.max === 'string') {
                const { compiled } = this.expression(
                    `${at}/max`,
                    block.max,
                    FIELD_SCOPES.unit,
                    'number',
                    scope.vocabulary
                );
                if (!block.cost)
                    this.report(
                        at,
                        'a block whose max is an expression can add copies, so it needs a cost per copy'
                    );
                // its own copies would raise or lower its own cap
                if (compiled && !block.replaces && readsModels(compiled))
                    this.report(
                        `${at}/max`,
                        'this block adds models, so its own copies change unit.models(); only a block that replaces models (`replaces`) may read it in its max'
                    );
                else if (compiled) live.set(block.id, compiled);
            } else {
                const max = block.max ?? min;
                if (!whole(max, 0))
                    this.report(at, `max must be a whole number (got ${max})`);
                if (max < min)
                    this.report(at, `min ${min} is more than max ${max}`);
                if (max > min && !block.cost)
                    this.report(
                        at,
                        'a block the unit can add copies of needs a cost per copy'
                    );
            }
            if (block.cost)
                this.costs(
                    `${at}/cost`,
                    block.cost,
                    scope,
                    FIELD_SCOPES.unit,
                    'additionalModels'
                );
            baseModels += min * size(block);
        }

        // `replaces`: the replacer's models take the place of the target's
        const replacers = new Map<string, Array<CompositionBlock>>();
        for (const block of blocks) {
            if (!block.replaces) continue;
            const at = `${path}/${block.id}/replaces`;
            const { block: targetId, profile } = block.replaces;
            const target = blocks.find((b) => b.id === targetId);
            if (!target) {
                this.report(at, `unknown block '${targetId}'`);
                continue;
            }
            if (target.id === block.id)
                this.report(at, 'a block cannot replace its own models');
            else if (target.replaces)
                this.report(
                    at,
                    `block '${targetId}' itself replaces another block's models; chain the replacement from the block that holds the models`
                );
            if (target.profiles[profile] === undefined) {
                this.report(
                    at,
                    `block '${targetId}' has no profile '${profile}'`
                );
                continue;
            }
            const key = `${targetId}/${profile}`;
            replacers.set(key, [...(replacers.get(key) ?? []), block]);
            baseModels -= (block.min ?? 1) * size(block);
        }

        // the sizes the unit can have: known in full when every block that
        // adds models has a fixed max, else only the size as bought
        const growth = (block: CompositionBlock) => {
            const min = block.min ?? 1;
            return typeof block.max === 'string'
                ? undefined
                : (Math.max(block.max ?? min, min) - min) * size(block);
        };
        const growths = blocks.filter((b) => !b.replaces).map(growth);
        const largest = growths.every((g) => g !== undefined)
            ? baseModels + growths.reduce((sum, g) => sum + g, 0)
            : undefined;
        const sizes: Array<number> = [];
        if (whole(baseModels, 1))
            for (let n = baseModels; n <= (largest ?? baseModels); n++)
                if (sizes.push(n) > 1000) break;
        /** block id → its `max` at each of `sizes`, when it can be worked out */
        const caps = new Map<string, Array<number>>();
        for (const [id, compiled] of live) {
            const values = sizes.length ? capAt(compiled, sizes) : undefined;
            if (values) caps.set(id, values);
        }
        for (const block of blocks) {
            const values = caps.get(block.id);
            if (!values) continue;
            const at = `${path}/${block.id}/max`;
            const min = block.min ?? 1;
            if (values[0] < min)
                this.report(
                    at,
                    `at the unit's size as bought (${baseModels} models) this max is ${values[0]}, below the block's min ${min}`
                );
            else if (largest !== undefined && values.every((v) => v <= min))
                this.report(
                    at,
                    `this max is never above min ${min} at any size the unit can have (${baseModels}–${largest} models), so the block never grows`,
                    'warning'
                );
        }

        for (const [key, blocksReplacing] of replacers) {
            const [targetId, profile] = key.split('/');
            const target = blocks.find((b) => b.id === targetId)!;
            const held = target.profiles[profile];
            const targetMin = target.min ?? 1;
            const supply = targetMin * held;
            const at = `${path}/${targetId}`;
            const takenMin = blocksReplacing.reduce(
                (sum, b) => sum + (b.min ?? 1) * size(b),
                0
            );
            if (takenMin > supply) {
                this.report(
                    at,
                    `blocks replacing '${profile}' take ${takenMin} models at their min, but '${targetId}' holds only ${supply} at its min`
                );
                continue;
            }
            if (blocksReplacing.every((b) => typeof b.max !== 'string')) {
                const takenMax = blocksReplacing.reduce(
                    (sum, b) =>
                        sum + ((b.max as number) ?? b.min ?? 1) * size(b),
                    0
                );
                if (takenMax > supply)
                    this.report(
                        at,
                        `blocks replacing '${profile}' can take ${takenMax} models, but '${targetId}' holds only ${supply} at its min`
                    );
                continue;
            }
            // a live max that can't be worked out is left to the app
            if (
                blocksReplacing.some(
                    (b) => typeof b.max === 'string' && !caps.has(b.id)
                )
            )
                continue;
            // at each size, against the fewest the target may hold then: the
            // other blocks that add models are grown first
            const otherGrowth = blocks
                .filter((b) => !b.replaces && b !== target)
                .reduce((sum, b) => sum + (growth(b) ?? 0), 0);
            const targetGrowth = (growth(target) ?? 0) / size(target);
            for (const [i, n] of sizes.entries()) {
                const takes = blocksReplacing.reduce(
                    (sum, b) =>
                        sum +
                        (typeof b.max === 'string'
                            ? caps.get(b.id)![i]
                            : (b.max ?? b.min ?? 1)) *
                            size(b),
                    0
                );
                const extra = Math.max(n - baseModels - otherGrowth, 0);
                const copies =
                    targetMin +
                    Math.min(Math.ceil(extra / size(target)), targetGrowth);
                if (takes > copies * held) {
                    this.report(
                        at,
                        `blocks replacing '${profile}' can take ${takes} models when the unit has ${n}, but '${targetId}' may then hold only ${copies * held}`
                    );
                    break;
                }
            }
        }

        if (baseModels !== unit.modelCount)
            this.report(
                `units/${unit.id}/modelCount`,
                `modelCount is ${unit.modelCount}, but the composition's blocks at their min hold ${baseModels} models`
            );
        if (baseModels === 0)
            this.report(path, 'the unit has no models at its minimum');
        for (const profile of profileIds)
            if (!blockOf.has(profile))
                this.report(
                    path,
                    `profile '${profile}' is in no block, so no model uses it`,
                    'warning'
                );
    }

    /*
     * The option ids an upgrade offers once references are pulled in (its own
     * options win over shared ones, the first shared upgrade over later ones;
     * see getAllOptions), and clashes between shared upgrades.
     */
    private resolveOptions(upgrade: Upgrade, scope: Scope) {
        const own = Object.values(upgrade.options)
            .filter((o) => !('target' in o))
            .map((o) => o.id);
        const offered = [...own];
        const sharedFrom = new Map<string, string>();
        const sharedClashes: Array<{
            option: string;
            kept: string;
            hidden: string;
        }> = [];

        for (const option of Object.values(upgrade.options)) {
            if (!('target' in option)) continue;
            const shared = scope.records.upgrades?.[option.target];
            if (!shared) continue;
            for (const id of Object.keys(shared.options)) {
                if (own.includes(id)) continue;
                const kept = sharedFrom.get(id);
                if (kept) {
                    sharedClashes.push({
                        option: id,
                        kept,
                        hidden: shared.name,
                    });
                    continue;
                }
                sharedFrom.set(id, shared.name);
                offered.push(id);
            }
        }
        return { offered, sharedClashes };
    }

    /*
     * A gear note (validator 1.11.0) is only shown to players, next to the
     * gear; a blank one shows nothing, so it is probably a mistake.
     */
    private gearNote(path: string, note: string | undefined) {
        if (note !== undefined && !note.trim())
            this.report(
                path,
                'the note is empty, so nothing is shown; write one or leave it out',
                'warning'
            );
    }

    /* whether any option the upgrade offers, references expanded, gives gear */
    private givesGear(upgrade: Upgrade, scope: Scope) {
        const gives = (o: Option) =>
            !!(
                o.weaponRefs?.length ||
                o.equipmentRefs?.length ||
                o.swaps?.length
            );
        return Object.values(upgrade.options).some((o) =>
            'target' in o
                ? Object.values(
                      scope.records.upgrades?.[o.target]?.options ?? {}
                  ).some(gives)
                : gives(o)
        );
    }

    /*
     * `perModel.count` is the number of picks per `everyX` models, so it only
     * means something for `one-in-x` and must be a whole number of at least 1;
     * 1 is the default, so writing it is redundant (a warning).
     */
    private perModelCount(at: string, upgrade: Upgrade) {
        const { type, count } = upgrade.perModel;
        if (count === undefined) return;
        if (type !== 'one-in-x') {
            const hint =
                type === 'multiple' || type === 'single'
                    ? `; did you mean perModel.max?`
                    : '';
            this.report(
                at,
                `count is only read for perModel.type 'one-in-x', not '${type}'${hint}`
            );
            return;
        }
        if (!Number.isInteger(count) || count < 1)
            this.report(
                at,
                `count must be a whole number of at least 1, not ${count}`
            );
        else if (count === 1)
            this.report(
                at,
                'count 1 is the default for one-in-x; leave it out',
                'warning'
            );
    }

    /*
     * `swapFrom` names gear every non-default pick takes off: it must exist,
     * the count must be positive, there must be something to swap to, and the
     * unit should hold it by default (a warning: the holder may come from a
     * sub-faction) unless `restrictions.required` names it.
     */
    private swapFrom(path: string, upgrade: Upgrade, unit: Unit, scope: Scope) {
        const swap = upgrade.swapFrom;
        if (!swap) return;
        const at = `${path}/swapFrom`;
        this.gear(at, swap, scope);
        if (swap.count !== undefined && !(swap.count > 0))
            this.report(at, 'count must be a positive number');

        const { offered } = this.resolveOptions(upgrade, scope);
        if (!offered.some((id) => id !== upgrade.default))
            this.report(
                at,
                'every option is the default, so nothing is ever swapped',
                'warning'
            );

        const held = (ref: GearRef, profileId?: string) =>
            ref.kind === swap.kind &&
            ref.id === swap.id &&
            (!upgrade.profileId ||
                !profileId ||
                profileId === upgrade.profileId);
        const holds =
            (unit.defaultGear ?? []).some((g) => held(g, g.profileId)) ||
            Object.values(unit.upgrades ?? {}).some((u) => {
                if (!u.default) return false;
                const option = u.options[u.default];
                if (!option || 'target' in option) return false;
                const refs =
                    swap.kind === 'weapon'
                        ? option.weaponRefs
                        : option.equipmentRefs;
                return (
                    !!refs?.includes(swap.id) &&
                    (!upgrade.profileId ||
                        !u.profileId ||
                        u.profileId === upgrade.profileId)
                );
            });
        // naming it in `restrictions.required` says an earlier pick gives it
        const required = upgrade.restrictions?.required.some(
            (r) => r.kind === swap.kind && r.id === swap.id
        );
        if (!holds && !required)
            this.report(
                at,
                `the unit doesn't hold ${swap.kind} '${swap.id}' by default${upgrade.profileId ? ` on '${upgrade.profileId}'` : ''}, so there is nothing to take off`,
                'warning'
            );
    }

    /*
     * `mirrorOf` makes an upgrade copy a sibling's pick, so the two must line
     * up: the source is another upgrade of the unit, on another profile, and
     * not a mirror itself (no chains, so no cycles); both offer the same option
     * ids once references are expanded, with the same default; the mirror's
     * amount comes from its own profile, so only `every` and `single` fit.
     * Fields that let a pick be blocked or that disagree with the source are
     * warnings, and two upgrades replacing each other is an error.
     */
    private mirrorOf(path: string, upgrade: Upgrade, unit: Unit, scope: Scope) {
        const sourceId = upgrade.mirrorOf;
        if (sourceId === undefined) return;
        const at = `${path}/mirrorOf`;
        if (sourceId === upgrade.id) {
            this.report(at, "an upgrade can't mirror itself");
            return;
        }
        const source = unit.upgrades?.[sourceId];
        if (!source) {
            this.known(at, 'sibling upgrade', sourceId, keys(unit.upgrades));
            return;
        }
        if (source.mirrorOf !== undefined) {
            this.report(
                at,
                `'${sourceId}' mirrors '${source.mirrorOf}' itself; mirror '${source.mirrorOf}' directly`
            );
            return;
        }
        const bucket = (u: Upgrade) =>
            u.profileId ? `profile '${u.profileId}'` : 'the unit at large';
        if (source.profileId === upgrade.profileId)
            this.report(
                at,
                `'${sourceId}' is on the same profile (${bucket(upgrade)}); a mirror must be on another profile`
            );

        const mine = new Set(this.resolveOptions(upgrade, scope).offered);
        const theirs = new Set(this.resolveOptions(source, scope).offered);
        const missing = [...theirs].filter((id) => !mine.has(id));
        const extra = [...mine].filter((id) => !theirs.has(id));
        const list = (ids: Array<string>) =>
            ids.map((id) => `'${id}'`).join(', ');
        if (missing.length)
            this.report(
                `${path}/options`,
                `doesn't offer ${list(missing)}, which '${sourceId}' offers; a mirror needs every option of its source, under the same id`
            );
        if (extra.length)
            this.report(
                `${path}/options`,
                `offers ${list(extra)}, which '${sourceId}' doesn't; a mirror only ever takes its source's pick`
            );
        if (upgrade.default !== source.default)
            this.report(
                `${path}/default`,
                `default ${upgrade.default ? `'${upgrade.default}'` : 'none'} differs from '${sourceId}''s (${source.default ? `'${source.default}'` : 'none'}); a mirror and its source need the same default`
            );

        const type = upgrade.perModel.type;
        if (type !== 'every' && type !== 'single')
            this.report(
                `${path}/perModel`,
                `a mirror's perModel.type must be 'every' or 'single', not '${type}': its amount follows its own profile, so it can't be a number of picks the player chooses`
            );

        if (!!upgrade.multiSelect !== !!source.multiSelect)
            this.report(
                `${path}/multiSelect`,
                `multiSelect differs from '${sourceId}''s; a mirror takes every option its source picks, so the two should match`,
                'warning'
            );

        if (upgrade.replaces?.includes(sourceId))
            this.report(
                `${path}/replaces`,
                `replaces '${sourceId}', the upgrade it mirrors`
            );
        if (source.replaces?.includes(upgrade.id))
            this.report(
                at,
                `'${sourceId}' replaces this upgrade, so picking it would remove its own mirror`
            );

        const restricted =
            !!upgrade.restrictions &&
            (upgrade.restrictions.exclusions.length > 0 ||
                upgrade.restrictions.required.length > 0);
        const referenceRestricted = Object.values(upgrade.options).some(
            (o) =>
                'target' in o &&
                !!o.restrictions &&
                (o.restrictions.exclusions.length > 0 ||
                    o.restrictions.required.length > 0)
        );
        if (restricted || referenceRestricted)
            this.report(
                restricted ? `${path}/restrictions` : `${path}/options`,
                `restrictions on a mirror can stop it copying '${sourceId}''s pick, leaving its models without the same option`,
                'warning'
            );
        if (upgrade.limitBy?.length)
            this.report(
                `${path}/limitBy`,
                `limitBy on a mirror can stop it copying '${sourceId}''s pick, leaving its models without the same option`,
                'warning'
            );
    }

    /*
     * An option's swap: every `from` and the `to` exist, and a `from` list
     * names at least one gear, each once.
     */
    private swap(path: string, swap: GearSwap, scope: Scope) {
        const from = swapFromRefs(swap);
        for (const ref of from) this.gear(path, ref, scope);
        this.gear(path, swap.to, scope);
        if (!from.length)
            this.report(`${path}/from`, 'a from list needs at least one gear');
        const seen = new Set<string>();
        for (const ref of from) {
            const key = `${ref.kind}:${ref.id}`;
            if (seen.has(key))
                this.report(
                    `${path}/from`,
                    `${ref.kind} '${ref.id}' is listed more than once; a pick takes one of each`
                );
            seen.add(key);
        }
    }

    private upgrade(
        path: string,
        upgrade: Upgrade,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>
    ) {
        this.ids(`${path}/options`, upgrade.options);
        if (!keys(upgrade.options).length)
            this.report(path, 'has no options', 'warning');

        // an upgrade's own options hide same-id options from the shared upgrades it
        // references (intended); between shared upgrades the first referenced wins,
        // which is probably a mistake, so warn
        const { offered, sharedClashes } = this.resolveOptions(upgrade, scope);
        for (const clash of sharedClashes) {
            this.report(
                path,
                `'${clash.option}' comes from both ${clash.kept} and ${clash.hidden}; using ${clash.kept}'s (listed first)`,
                'warning'
            );
        }
        const expanded = offered;
        if (upgrade.default && !expanded.includes(upgrade.default)) {
            this.report(
                path,
                `default '${upgrade.default}' isn't one of its options`
            );
        }
        if (upgrade.perModel.type === 'one-in-x' && !upgrade.perModel.everyX)
            this.report(path, "a 'one-in-x' upgrade needs everyX");
        if (
            upgrade.perModel.type !== 'one-in-x' &&
            upgrade.perModel.everyX !== undefined
        )
            this.report(
                `${path}/perModel/everyX`,
                `everyX is only read for perModel.type 'one-in-x', not '${upgrade.perModel.type}'`,
                'warning'
            );
        this.perModelCount(`${path}/perModel`, upgrade);
        this.gearNote(`${path}/gearNote`, upgrade.gearNote);
        if (upgrade.gearNote?.trim() && !this.givesGear(upgrade, scope))
            this.report(
                `${path}/gearNote`,
                'none of its options give gear, so the note is never shown',
                'warning'
            );

        upgrade.restrictions?.exclusions.forEach((e) =>
            this.gear(`${path}/restrictions`, e, scope)
        );
        upgrade.restrictions?.required.forEach((e) =>
            this.gear(`${path}/restrictions`, e, scope)
        );
        upgrade.limitBy?.forEach((l) => this.gear(`${path}/limitBy`, l, scope));

        this.condition(
            path,
            upgrade.when,
            scopes,
            scope.vocabulary,
            'upgrade-when'
        );
        this.numberOrExpr(`${path}/min`, upgrade.min, scopes, scope.vocabulary);
        this.numberOrExpr(`${path}/max`, upgrade.max, scopes, scope.vocabulary);
        this.minMax(path, upgrade.min, upgrade.max);

        const optionScopes: Array<BuiltInScope> = ['option', ...scopes];
        for (const option of Object.values(upgrade.options) as Array<
            Option | UpgradeReference
        >) {
            const at = `${path}/options/${option.id}`;
            if ('target' in option) {
                this.known(
                    at,
                    'faction upgrade',
                    option.target,
                    keys(scope.records.upgrades)
                );
                option.restrictions?.exclusions.forEach((e) =>
                    this.gear(at, e, scope)
                );
                option.restrictions?.required.forEach((e) =>
                    this.gear(at, e, scope)
                );
                continue;
            }
            this.costs(
                `${at}/cost`,
                option.cost,
                scope,
                optionScopes,
                'option'
            );
            option.weaponRefs?.forEach((w) =>
                this.known(at, 'weapon', w, keys(scope.records.weapons))
            );
            option.equipmentRefs?.forEach((e) =>
                this.known(at, 'equipment', e, keys(scope.records.equipment))
            );
            option.swaps?.forEach((s, i) =>
                this.swap(`${at}/swaps/${i}`, s, scope)
            );
            option.subChoices?.forEach((s) =>
                this.known(
                    at,
                    'sub-choice',
                    s,
                    keys(scope.vocabulary.subChoices)
                )
            );
            option.effects?.forEach((e, i) =>
                this.effect(`${at}/effects/${i}`, e, scope, optionScopes)
            );
            this.condition(
                at,
                option.when,
                optionScopes,
                scope.vocabulary,
                'option-when'
            );
            this.numberOrExpr(
                `${at}/max`,
                option.max,
                optionScopes,
                scope.vocabulary
            );
        }
    }

    private effect(
        path: string,
        effect: StatEffect | SpecialRuleEffect | TraitEffect | SlotTagEffect,
        scope: Scope,
        scopes: ReadonlyArray<BuiltInScope>
    ) {
        if (effect.kind === 'stat') {
            if (!effect.changes.length)
                this.report(path, 'a stat effect with no changes', 'warning');
            for (const change of effect.changes) {
                if (!scope.unitStats.has(change.stat))
                    this.report(path, `unknown stat '${change.stat}'`);
                else if (
                    change.op === 'add' &&
                    !scope.numericStats.has(change.stat)
                )
                    this.report(
                        path,
                        `'${change.stat}' isn't a numeric stat, so 'add' can't shift it`,
                        'warning'
                    );
            }
        } else if (effect.kind === 'specialRule') {
            this.specialRuleEffect(path, effect, scope);
        } else if (effect.kind === 'slotTag') {
            this.slotTagEffect(path, effect, scope);
            // it tags the slot, not a profile
            scopes = scopes.filter((s) => s !== 'profile');
        } else {
            this.traitEffect(path, effect);
            // traits belong to the whole unit: no profile to look at
            scopes = scopes.filter((s) => s !== 'profile');
        }
        this.condition(path, effect.when, scopes, scope.vocabulary);
    }

    /* A slotTag effect (validator 2.2.0): game-declared tags, and categories some option of them has */
    private slotTagEffect(path: string, effect: SlotTagEffect, scope: Scope) {
        const declared = keys(scope.game.slotTags);
        if (!effect.add.length)
            this.report(path, 'a slotTag effect needs at least one tag in add');
        this.duplicates(`${path}/add`, effect.add, 'slot tag');
        for (const tag of effect.add)
            if (!declared.includes(tag))
                this.report(
                    `${path}/add`,
                    `unknown slot tag '${tag}'${didYouMean(tag, declared)}; slot tags are declared in the game's slotTags`
                );
        this.categories(
            `${path}/categories`,
            effect.categories,
            effect.add.filter((t) => declared.includes(t))
        );
    }

    /* Entries listed more than once: harmless, but likely a slip */
    private duplicates(
        path: string,
        values: ReadonlyArray<string>,
        what: string
    ) {
        const seen = new Set<string>();
        for (const value of values) {
            if (seen.has(value))
                this.report(
                    path,
                    `${what} '${value}' is listed more than once`,
                    'warning'
                );
            seen.add(value);
        }
    }

    /* The slot options with each tag, by category, across every loaded file */
    private optionCategories?: Map<string, Set<string>>;

    private categoriesOf(tag: string): Set<string> {
        if (!this.optionCategories) {
            const map = new Map<string, Set<string>>();
            const { game, factions, subFactions } = this.set;
            for (const options of [
                game.data.slotOptions,
                ...factions.map((f) => f.data.slotOptions),
                ...subFactions.map((f) => f.data.slotOptions),
            ])
                for (const option of Object.values(options ?? {})) {
                    if (!option.category) continue;
                    const set = map.get(option.slotTag) ?? new Set<string>();
                    set.add(option.category);
                    map.set(option.slotTag, set);
                }
            this.optionCategories = map;
        }
        return this.optionCategories.get(tag) ?? new Set();
    }

    /*
     * The categories a restriction (a slot's `tagOptions` entry, a slotTag
     * effect) offers for `tags`: a category no slot option of those tags has,
     * in the game or any loaded faction or sub-faction, offers nothing
     */
    private categories(
        path: string,
        categories: ReadonlyArray<string> | undefined,
        tags: ReadonlyArray<string>
    ) {
        if (!categories) return;
        if (!categories.length) {
            this.report(
                path,
                'an empty categories list offers no slot options; leave it out to offer every option of the tag'
            );
            return;
        }
        this.duplicates(path, categories, 'category');
        if (!tags.length) return;
        const known = new Set(tags.flatMap((t) => [...this.categoriesOf(t)]));
        for (const category of new Set(categories))
            if (!known.has(category))
                this.report(
                    path,
                    `no slot option of ${tags.map((t) => `'${t}'`).join(' or ')} has the category '${category}', so it offers nothing${didYouMean(category, [...known])}`,
                    'warning'
                );
    }

    /* A slot's `tagOptions` (validator 2.2.0): keys are tags the slot has */
    private tagOptions(path: string, slot: Slot, scope: Scope) {
        const declared = keys(scope.game.slotTags);
        for (const [tag, options] of Object.entries(slot.tagOptions ?? {})) {
            const at = `${path}/tagOptions/${tag}`;
            if (!declared.includes(tag)) {
                this.report(
                    at,
                    `unknown slot tag '${tag}'${didYouMean(tag, declared)}`
                );
                continue;
            }
            if (!slot.tags?.includes(tag)) {
                this.report(
                    at,
                    `the slot doesn't have the tag '${tag}' (add it to tags); a slotTag effect limits the options of a tag it adds with its own categories`
                );
                continue;
            }
            this.categories(`${at}/categories`, options.categories, [tag]);
        }
    }

    /* A special-rule effect: the rule it adds, and (validator 2.5.0) those it removes or replaces */
    private specialRuleEffect(
        path: string,
        effect: SpecialRuleEffect,
        scope: Scope
    ) {
        const { rule, remove, replace } = effect;
        if (!rule && !remove && !replace)
            this.report(
                path,
                'a special-rule effect needs rule, remove or replace'
            );
        if (remove) {
            if (!remove.length)
                this.report(
                    `${path}/remove`,
                    'remove needs at least one special rule'
                );
            this.duplicates(`${path}/remove`, remove, 'special rule');
            for (const id of remove) this.heldRule(`${path}/remove`, id);
        }
        if (replace) {
            const at = `${path}/replace`;
            if (!replace.from.length)
                this.report(
                    `${at}/from`,
                    'replace needs at least one special rule in from'
                );
            this.duplicates(`${at}/from`, replace.from, 'special rule');
            for (const id of replace.from) this.heldRule(`${at}/from`, id);
            this.rule(`${at}/to`, replace.to, scope);
            const to =
                scope.records.specialRules?.[replace.to.id] ??
                scope.game.specialRules?.[replace.to.id];
            if (
                to?.configurable &&
                replace.to.value === undefined &&
                to.defaultValue === undefined
            )
                this.report(
                    `${at}/to`,
                    `'${replace.to.id}' takes a value, but neither the replacement nor the rule's defaultValue gives one`,
                    'warning'
                );
        }
        if (rule) {
            this.rule(path, rule, scope);
            if ([...(remove ?? []), ...(replace?.from ?? [])].includes(rule.id))
                this.report(
                    path,
                    `'${rule.id}' is both given and taken away`,
                    'warning'
                );
        }
    }

    /*
     * A rule an effect takes away: it only has to be one some unit could hold,
     * so a game-level effect may name a faction's rule
     */
    private heldRule(path: string, id: string) {
        if (!this.anyRuleIds().has(id))
            this.report(
                path,
                `unknown special rule '${id}'${didYouMean(id, [...this.anyRuleIds()])}`
            );
    }

    /* Every special rule id in the game and any loaded faction or sub-faction */
    private loadedRuleIds?: Set<string>;

    private anyRuleIds(): Set<string> {
        if (!this.loadedRuleIds) {
            const { game, factions, subFactions } = this.set;
            this.loadedRuleIds = new Set(
                [
                    game.data.specialRules,
                    ...factions.map((f) => f.data.specialRules),
                    ...subFactions.map((f) => f.data.specialRules),
                ].flatMap((rules) => keys(rules))
            );
        }
        return this.loadedRuleIds;
    }

    private traitEffect(path: string, effect: TraitEffect) {
        const { add = [], remove = [], replace } = effect;
        if (!add.length && !remove.length && !replace)
            this.report(path, 'a trait effect needs add, remove or replace');
        if (replace && !replace.from.length)
            this.report(path, 'replace needs at least one trait in from');
        this.traits(path, [
            ...add,
            ...remove,
            ...(replace ? [...replace.from, replace.to] : []),
        ]);
        const removed = [...remove, ...(replace?.from ?? [])].map(tagId);
        for (const trait of [...add, ...(replace ? [replace.to] : [])]) {
            if (!trait.trim()) this.report(path, 'a trait needs a name');
            else if (removed.includes(tagId(trait)))
                this.report(
                    path,
                    `'${trait}' is both given and taken away`,
                    'warning'
                );
        }
    }

    /*
     * `units` are the ids `unitIds` may name: the scope's own, a slot source's,
     * or `unchecked` when the source is unknown (already reported)
     */
    private selector(
        path: string,
        selector: UnitSelectorOrRef | undefined,
        scope: Scope,
        units: ReadonlyArray<string> | 'unchecked' = keys(scope.records.units)
    ) {
        if (!selector) return;
        if (typeof selector === 'string') {
            this.known(
                path,
                'selector',
                selector.slice(1),
                scope.vocabulary.selectors
            );
            return;
        }
        const traits = (scope.vocabulary.traits ?? []).map(tagId);
        const match = (at: string, m: UnitExclusion) => {
            if (units !== 'unchecked')
                m.unitIds?.forEach((id) => this.known(at, 'unit', id, units));
            m.roles?.forEach((r) =>
                this.known(at, 'role', r, keys(scope.game.roles))
            );
            if (this.definedTraits) this.traits(at, m.traits);
            else
                for (const trait of m.traits ?? []) {
                    if (!traits.includes(tagId(trait)))
                        this.report(
                            at,
                            `no unit has or is given the trait '${trait}'${didYouMean(tagId(trait), traits)}`,
                            'warning'
                        );
                }
            // a game-level selector may name a faction's rule, so any loaded one counts
            for (const id of m.specialRules ?? []) {
                if (!this.anyRuleIds().has(id))
                    this.report(
                        at,
                        `unknown special rule '${id}'${didYouMean(id, [...this.anyRuleIds()])}`,
                        'warning'
                    );
            }
        };
        match(path, selector);
        selector.exclude?.forEach((e, i) => match(`${path}/exclude/${i}`, e));
    }

    /*
     * The units a slot source offers (the faction's, plus the sub-factions'
     * it names), or `unchecked` when the source names something not loaded
     */
    private sourceUnits(
        path: string,
        source: SlotSource
    ): ReadonlyArray<string> | 'unchecked' {
        const factions = this.set.factions.map((f) => f.data);
        const faction = factions.find((f) => f.id === source.faction);
        if (!faction) {
            this.report(
                path,
                `unknown faction '${source.faction}'${didYouMean(
                    source.faction,
                    factions.map((f) => f.id)
                )}`
            );
            return 'unchecked';
        }
        const subs = this.set.subFactions
            .map((s) => s.data)
            .filter((s) => s.parent.faction === faction.id);
        let picked = subs;
        if (source.subFactions !== 'any') {
            picked = [];
            for (const id of source.subFactions ?? []) {
                const sub = subs.find((s) => s.id === id);
                if (sub) picked.push(sub);
                else
                    this.report(
                        path,
                        `'${faction.id}' has no sub-faction '${id}'${didYouMean(
                            id,
                            subs.map((s) => s.id)
                        )}`
                    );
            }
        }
        return [faction, ...picked].flatMap((r) => keys(r.units));
    }

    /* A slot's units (from its source, if any) and the effects on them */
    private slotUnits(
        path: string,
        slot: {
            units?: UnitSelectorOrRef;
            source?: SlotSource;
            effects?: Array<SlotUnitEffect>;
        },
        scope: Scope
    ) {
        if (slot.source)
            this.selector(
                path,
                slot.units,
                scope,
                this.sourceUnits(`${path}/source`, slot.source)
            );
        else this.selector(path, slot.units, scope);
        slot.effects?.forEach((effect, i) =>
            this.effect(
                `${path}/effects/${i}`,
                effect,
                scope,
                FIELD_SCOPES.effect
            )
        );
    }

    /* A slot a mechanic (a slot option, a special rule) adds to a group */
    private addedSlot(path: string, slot: AddedSlot, scope: Scope) {
        if (!slot.roleChoices.length)
            this.report(path, 'a slot needs at least one role');
        slot.roleChoices.forEach((r) =>
            this.known(path, 'role', r, keys(scope.game.roles))
        );
        this.slotUnits(path, slot, scope);
    }

    private groups(
        path: string,
        groups: Record<string, Group> | undefined,
        scope: Scope
    ) {
        const { game } = scope;
        for (const group of Object.values(groups ?? {})) {
            const at = `${path}/${group.id}`;
            this.known(at, 'group type', group.type, keys(game.groupTypes));
            this.selector(at, group.units, scope);
            group.slots.forEach((slot, i) => {
                const s = `${at}/slots/${i}`;
                if (!slot.roles.length)
                    this.report(s, 'a slot needs at least one role');
                slot.roles.forEach((r) =>
                    this.known(s, 'role', r, keys(game.roles))
                );
                slot.tags?.forEach((t) =>
                    this.known(s, 'slot tag', t, keys(game.slotTags))
                );
                this.tagOptions(s, slot, scope);
                this.slotUnits(s, slot, scope);
                this.condition(
                    s,
                    slot.when,
                    FIELD_SCOPES.slot,
                    scope.vocabulary
                );
                if (slot.repeat) {
                    this.numberOrExpr(
                        `${s}/repeat/max`,
                        slot.repeat.max,
                        FIELD_SCOPES.slot,
                        scope.vocabulary
                    );
                    this.minMax(
                        `${s}/repeat`,
                        slot.repeat.min,
                        slot.repeat.max
                    );
                }
            });
            group.requires?.forEach((r, i) =>
                this.selector(`${at}/requires/${i}`, r.units, scope)
            );
            this.condition(
                at,
                group.when,
                FIELD_SCOPES.groupWhen,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/min`,
                group.min,
                FIELD_SCOPES.groupLimit,
                scope.vocabulary
            );
            this.numberOrExpr(
                `${at}/max`,
                group.max,
                FIELD_SCOPES.groupLimit,
                scope.vocabulary
            );
            this.minMax(at, group.min, group.max);
            if (group.cost)
                this.costs(
                    `${at}/cost`,
                    group.cost,
                    scope,
                    FIELD_SCOPES.groupLimit,
                    'group'
                );
            group.effects?.forEach((effect, i) =>
                this.effect(
                    `${at}/effects/${i}`,
                    effect,
                    scope,
                    FIELD_SCOPES.effect
                )
            );
        }
    }

    /* Sub-choices: their values, and what each adds to or multiplies an option's cost by */
    private subChoices(
        subs: Record<string, SubChoice> | undefined,
        scope: Scope
    ) {
        for (const sub of Object.values(subs ?? {})) {
            const at = `subChoices/${sub.id}`;
            this.ids(`${at}/values`, sub.values);
            if (!(sub.default in sub.values))
                this.report(
                    at,
                    `default '${sub.default}' isn't one of its values`
                );
            for (const value of Object.values(sub.values)) {
                const v = `${at}/values/${value.id}`;
                if (value.cost)
                    this.costs(
                        `${v}/cost`,
                        value.cost,
                        scope,
                        FIELD_SCOPES.option,
                        'option'
                    );
                if (value.costMultiplier)
                    this.costs(
                        `${v}/costMultiplier`,
                        value.costMultiplier,
                        scope,
                        [],
                        'option'
                    );
            }
        }
    }

    private specialRules(
        path: string,
        rules: Record<string, SpecialRule> | undefined,
        scope: Scope
    ) {
        for (const rule of Object.values(rules ?? {})) {
            const at = `${path}/${rule.id}`;
            if (rule.grants)
                this.costs(
                    `${at}/grants`,
                    rule.grants,
                    scope,
                    FIELD_SCOPES.ruleGrant,
                    'grant'
                );
            rule.slots?.forEach((slot, i) =>
                this.addedSlot(`${at}/slots/${i}`, slot, scope)
            );
            if (rule.defaultValue !== undefined && !rule.configurable)
                this.report(
                    at,
                    'has a default value but takes no value',
                    'warning'
                );
        }
    }

    /* typed and expression list rules, in the game or a faction or sub-faction */
    /*
     * A list choice value's effects reach every matching unit in the list, from
     * any faction, so they're checked like the game's own groups' effects
     */
    private choiceEffects(
        choices: Record<string, ListChoice> | undefined,
        scope: Scope
    ) {
        for (const choice of Object.values(choices ?? {})) {
            for (const value of Object.values(choice.values)) {
                const at = `choices/${choice.id}/values/${value.id}`;
                this.selector(`${at}/units`, value.units, scope);
                if (value.units && !value.effects?.length)
                    this.report(
                        `${at}/units`,
                        'units has no effect without effects',
                        'warning'
                    );
                value.effects?.forEach((effect, i) =>
                    this.effect(
                        `${at}/effects/${i}`,
                        effect,
                        scope,
                        FIELD_SCOPES.effect
                    )
                );
            }
        }
    }

    private listRules(
        rules: Record<string, ListRule> | undefined,
        scope: Scope
    ) {
        const { game, vocabulary } = scope;
        const groupTypes = keys(game.groupTypes);
        for (const rule of Object.values(rules ?? {})) {
            const path = `listRules/${rule.id}`;
            switch (rule.kind) {
                case 'resourceCap':
                    this.known(
                        path,
                        'resource',
                        rule.resource,
                        keys(game.resources)
                    );
                    this.selector(path, rule.units, scope);
                    for (const t of rule.contingentTypes ?? [])
                        this.known(path, 'group type', t, groupTypes);
                    if ('value' in rule.max)
                        this.numberOrExpr(
                            `${path}/max`,
                            rule.max.value,
                            FIELD_SCOPES.list,
                            vocabulary
                        );
                    break;
                case 'count': {
                    this.selector(path, rule.units, scope);
                    for (const t of rule.groupTypes ?? [])
                        this.known(path, 'group type', t, groupTypes);
                    const scopes: Array<BuiltInScope> =
                        rule.scope === 'list'
                            ? ['main', 'list']
                            : [rule.scope, 'root', 'main', 'list'];
                    this.numberOrExpr(
                        `${path}/min`,
                        rule.min,
                        scopes,
                        vocabulary
                    );
                    this.numberOrExpr(
                        `${path}/max`,
                        rule.max,
                        scopes,
                        vocabulary
                    );
                    this.minMax(path, rule.min, rule.max);
                    break;
                }
                case 'expression':
                    if (rule.scope !== 'group' && rule.groupTypes)
                        this.report(
                            path,
                            'groupTypes only applies to a rule with scope "group"'
                        );
                    for (const t of rule.groupTypes ?? [])
                        this.known(path, 'group type', t, groupTypes);
                    this.condition(
                        path,
                        rule.when,
                        rule.scope === 'group'
                            ? FIELD_SCOPES.groupRule
                            : FIELD_SCOPES.list,
                        vocabulary,
                        rule.scope === 'group' ? undefined : 'list-rule'
                    );
                    break;
            }
        }
    }

    private slotOptions(
        path: string,
        options: Record<string, SlotOption> | undefined,
        scope: Scope
    ) {
        const roles = keys(scope.game.roles);
        for (const option of Object.values(options ?? {})) {
            const at = `${path}/${option.id}`;
            this.known(
                at,
                'slot tag',
                option.slotTag,
                keys(scope.game.slotTags)
            );
            option.slotRoles?.forEach((r) => this.known(at, 'role', r, roles));
            this.selector(`${at}/units`, option.units, scope);
            if (option.cost)
                this.costs(
                    `${at}/cost`,
                    option.cost,
                    scope,
                    FIELD_SCOPES.slot,
                    'slotOption'
                );
            // a slot option adds at most one slot effect: the app reads only the
            // first, so more is a warning (not an error, so data written with
            // repeated effects before `count` keeps loading)
            const slotEffects =
                option.effects?.filter((effect) => effect.kind === 'slot')
                    .length ?? 0;
            if (slotEffects > 1)
                this.report(
                    `${at}/effects`,
                    `has ${slotEffects} slot effects; only the first is used. To add several slots, use one slot effect with \`count\`, e.g. \`{ "kind": "slot", "roleChoices": [...], "count": ${slotEffects} }\``,
                    'warning'
                );
            option.effects?.forEach((effect, i) => {
                const e = `${at}/effects/${i}`;
                if (effect.kind === 'slot') this.addedSlot(e, effect, scope);
                else if (effect.kind === 'allowedRoles')
                    effect.roles.forEach((r) =>
                        this.known(e, 'role', r, roles)
                    );
                else this.effect(e, effect, scope, FIELD_SCOPES.effect);
            });
        }
    }
}

/** Every integrity problem in a game and the factions and sub-factions loaded for it */
export function validateGameData(set: GameDataSet): Array<DataIssue> {
    return new Validator(set).run();
}
