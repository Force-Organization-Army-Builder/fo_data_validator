import { z } from 'zod';

/*
 * The data schema (docs/specs/data_schema_spec_2026-10-17.md) as zod schemas:
 * the single source of truth. `src/types.ts` infers the TypeScript types
 * from them (exported from the package), `checkShapes`
 * (./shape.ts) validates untrusted files against them in the browser and the
 * CLI, and `npm run generate-schema` writes the JSON Schema authors point
 * their editors at (`schema/*.schema.json`). The `.describe()` text is the
 * field documentation in both.
 *
 * Objects are strict: an unknown key is an error, which catches misspelt keys.
 */

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/*
 * A record id: lowercase kebab-case (`infantry-squad`), created from the name on
 * first save and permanent after that. Unique per kind within its faction (or
 * game); every record's `id` equals its key.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_RULE =
    'ids are lowercase kebab-case: letters a-z and digits, with single hyphens between words, e.g. `infantry-squad`';

export const SlugSchema = z
    .string()
    .regex(SLUG_PATTERN, SLUG_RULE)
    .describe(
        'A record id: lowercase kebab-case, e.g. `infantry-squad` (letters a-z and digits, with single hyphens between words)'
    );

/*
 * A word written as a scope or kind name in expressions: like an id, but it
 * starts with a letter, as names do in the expression lexer.
 */
export const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const ExpressionWordSchema = z
    .string()
    .regex(
        NAME_PATTERN,
        'words written in expressions are lowercase kebab-case and start with a letter, e.g. `formation`'
    );

export const ExprSchema = z
    .string()
    .describe(
        'An expression in the Force Org expression language (docs/specs/expression_language_spec_2026-10-17.md)'
    );

export const NumberOrExprSchema = z
    .union([z.number(), ExprSchema])
    .describe('A plain number, or an expression that evaluates to one');

/*
 * Counts: whole numbers. A message on each so a shape error says what the
 * field takes, not only what it got.
 */
const WHOLE = 'a whole number, 0 or more';
const POSITIVE_WHOLE = 'a whole number, 1 or more';

/** How many of something, where none is allowed: 0, 1, 2, … */
export const WholeNumberSchema = z.number().int(WHOLE).min(0, WHOLE);

/** How many of something there must be at least one of: 1, 2, 3, … */
export const PositiveWholeNumberSchema = z
    .number()
    .int(POSITIVE_WHOLE)
    .min(1, POSITIVE_WHOLE);

export const CountOrExprSchema = z
    .union([WholeNumberSchema, ExprSchema])
    .describe(
        'A whole number (0 or more), or an expression that evaluates to a number'
    );

export const VersionRangeSchema = z
    .string()
    .describe('A semver range a version must satisfy, e.g. `>=1.2.0 <2.0.0`');

export const CostsSchema = z
    .record(SlugSchema, NumberOrExprSchema)
    .describe(
        'resource id → amount, e.g. `{ "points": 100 }` or `{ "credits": 4, "slots": 1 }`'
    );

/** The fields of anything shown to players by name */
const named = {
    name: z.string(),
    description: z.string().optional(),
};

export const NamedSchema = z.strictObject(named);

export const ConditionSchema = z
    .strictObject({
        if: ExprSchema,
        message: z.string(),
    })
    .describe(
        "A rule's condition plus the player-facing reason shown when it isn't met"
    );

/** The `$schema` an editor reads on the four file kinds; ignored by the app */
const schemaUrl = z
    .string()
    .optional()
    .describe('JSON Schema URL for editor support; ignored by Force Org');

/* ------------------------------------------------------------------ */
/* Selectors and effects                                               */
/* ------------------------------------------------------------------ */

export const ProfileFilterSchema = z
    .strictObject({
        anyOf: z.array(z.string()).optional(),
        noneOf: z.array(z.string()).optional(),
    })
    .describe(
        "Picks profiles by their type and tags (the unit's included), matched as case-insensitive text. Left out, every profile is picked."
    );

const unitMatch = {
    unitIds: z.array(SlugSchema).optional(),
    roles: z.array(SlugSchema).optional(),
    traits: z
        .array(z.string())
        .optional()
        .describe(
            'a unit matches when it has any of these traits, matched as case-insensitive text'
        ),
    profiles: ProfileFilterSchema.optional().describe(
        'a unit matches when one of its profiles does (or the unit itself, if it has no profiles)'
    ),
    specialRules: z
        .array(SlugSchema)
        .optional()
        .describe(
            '(validator 2.5.0) special rule ids: a unit matches when it or one of its profiles holds any of them, with any value'
        ),
};

export const UnitExclusionSchema = z
    .strictObject(unitMatch)
    .describe(
        'Units to leave out, matched like a selector (its fields all apply); e.g. `{ "profiles": { "anyOf": ["Unique"] } }` leaves out every unit with a Unique profile'
    );

export const UnitSelectorSchema = z
    .strictObject({
        ...unitMatch,
        exclude: z
            .array(UnitExclusionSchema)
            .optional()
            .describe(
                'a unit that matches any of these does not match the selector'
            ),
    })
    .describe(
        'Picks units by id, role, trait and profile type/tags; left out, a field matches every unit'
    );

export const SelectorRefSchema = z
    .templateLiteral(['@', SlugSchema], {
        error: `a selector reference is '@' followed by a selector id; ${SLUG_RULE}`,
    })
    .describe(
        'A named selector by id, accepted wherever a `UnitSelector` is, e.g. `"@line-infantry"`'
    );

export const UnitSelectorOrRefSchema = z.union([
    UnitSelectorSchema,
    SelectorRefSchema,
]);

export const NamedSelectorSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        match: UnitSelectorSchema,
    })
    .describe(
        'A selector with a name, referenced as `@id` from expressions and selector fields'
    );

export const StatChangeSchema = z
    .discriminatedUnion('op', [
        z.strictObject({
            stat: SlugSchema,
            op: z.literal('add'),
            value: z.number(),
            min: z.number().optional(),
            max: z.number().optional(),
        }),
        z.strictObject({
            stat: SlugSchema,
            op: z.literal('set'),
            value: z.string(),
        }),
    ])
    .describe(
        "`add` shifts the number and keeps its suffix: '3+' -1 → '2+', '6\"' +1 → '7\"'"
    );

export const StatEffectSchema = z
    .strictObject({
        kind: z.literal('stat'),
        profiles: ProfileFilterSchema.optional(),
        changes: z.array(StatChangeSchema),
        when: ConditionSchema.optional(),
    })
    .describe('several stat changes sharing one profile filter');

export const SpecialRuleSelectionSchema = z.strictObject({
    id: SlugSchema,
    value: z.string().optional(),
});

export const SpecialRuleEffectSchema = z
    .strictObject({
        kind: z.literal('specialRule'),
        profiles: ProfileFilterSchema.optional(),
        rule: SpecialRuleSelectionSchema.optional().describe(
            'the rule each picked profile gains'
        ),
        remove: z
            .array(SlugSchema)
            .optional()
            .describe(
                '(validator 2.5.0) rule ids each picked profile loses, whatever their value'
            ),
        replace: z
            .strictObject({
                from: z.array(SlugSchema),
                to: SpecialRuleSelectionSchema,
            })
            .optional()
            .describe(
                '(validator 2.5.0) each picked profile loses any of `from` (whatever their value) and, only if it held one, gains `to`, e.g. `{ "from": ["skirmisher"], "to": { "id": "armoured", "value": "1" } }`'
            ),
        when: ConditionSchema.optional(),
    })
    .describe(
        "changes the special rules of the profiles `profiles` picks (all of them when left out) and the unit's own: `remove`, then `replace`, then `rule` (added). Needs at least one of the three"
    );

export const TraitEffectSchema = z
    .strictObject({
        kind: z.literal('trait'),
        add: z.array(z.string()).optional().describe('traits the unit gains'),
        remove: z
            .array(z.string())
            .optional()
            .describe('traits the unit loses, if it has them'),
        replace: z
            .strictObject({
                from: z.array(z.string()),
                to: z.string(),
            })
            .optional()
            .describe(
                'the unit loses any of `from` and, only if it had one, gains `to`'
            ),
        when: ConditionSchema.optional(),
    })
    .describe(
        "changes the unit's traits (traits belong to the whole unit, so there is no profile filter); traits match as case-insensitive text"
    );

export const SlotTagEffectSchema = z
    .strictObject({
        kind: z.literal('slotTag'),
        add: z
            .array(SlugSchema)
            .describe(
                'game-declared slot tags the slot holding the unit counts as having, e.g. `["prime"]`'
            ),
        categories: z
            .array(SlugSchema)
            .optional()
            .describe(
                'for the tags it adds, only slot options of these `category`s are offered, e.g. `["honour"]`; left out, every option of the tag. Combined with the slot\'s own `tagOptions` and other slotTag effects on the same tag, only options every restriction allows are offered'
            ),
        when: ConditionSchema.optional(),
    })
    .describe(
        "(validator 2.2.0) the slot that holds the unit counts as having these slot tags, so it offers their slot options and `slot.is(tag:…)` reads true. It tags the slot, not the unit, so there is no profile filter; in place before slot options are offered. Not allowed in a slot option's `effects`"
    );

/* Slots filled from another faction (or other sub-factions of one) */

export const SlotSourceSchema = z
    .strictObject({
        faction: SlugSchema.describe(
            "a faction of the same game, possibly from another source; may be the contingent's own"
        ),
        subFactions: z
            .union([z.literal('any'), z.array(SlugSchema)])
            .optional()
            .describe(
                "units of these sub-factions of `faction` may fill the slot too (`any` = every one loaded), whether or not the contingent took them; left out, only the faction's own units"
            ),
    })
    .describe(
        "Where a slot's units come from instead of the contingent. Units keep their own records (gear, rules, upgrades) but not their home sub-faction's unit modifiers. The slot's `units` selector picks among them, seeing only each unit's own traits; the group's `units` doesn't apply"
    );

/*
 * The effects on a unit, shared by everything that can change one. Each use
 * gets its own union so each keeps its own description in the JSON Schema.
 */
const unitEffects = [
    StatEffectSchema,
    SpecialRuleEffectSchema,
    TraitEffectSchema,
] as const;
const unitEffect = () => z.discriminatedUnion('kind', unitEffects);

export const UnitEffectSchema = unitEffect();

/*
 * The effects on a unit plus `slotTag` (validator 2.2.0), which tags the slot
 * holding the unit: allowed everywhere a unit effect is except slot options,
 * which are applied last, so a tag they added could never offer anything
 */
const heldEffects = [...unitEffects, SlotTagEffectSchema] as const;
const heldEffect = () => z.discriminatedUnion('kind', heldEffects);

export const HeldUnitEffectSchema = heldEffect();

export const SlotUnitEffectSchema = heldEffect().describe(
    "applied to the unit filling the slot, after the group's effects, e.g. replacing a borrowed unit's faction trait"
);

const addedSlot = {
    roleChoices: z
        .array(SlugSchema)
        .describe("the slot's role; with several the player picks one"),
    units: UnitSelectorOrRefSchema.optional().describe(
        "only matching units may fill the slot; with a `source`, `unitIds` are the source's units"
    ),
    source: SlotSourceSchema.optional(),
    effects: z.array(SlotUnitEffectSchema).optional(),
};

export const AddedSlotSchema = z
    .strictObject(addedSlot)
    .describe('A slot a mechanic adds to a group');

/* ------------------------------------------------------------------ */
/* Game definition                                                     */
/* ------------------------------------------------------------------ */

/** The built-in scopes a game may give its own word in `terms` */
export const TERM_SCOPES = [
    'option',
    'profile',
    'unit',
    'slot',
    'group',
    'contingent',
    'root',
    /** the list's main contingent (its root group's type has `source: main`) */
    'main',
    'list',
] as const;

/** Every scope an expression can name: the term scopes and `rule` */
export const BUILT_IN_SCOPES = [
    /** a special rule on the unit, for its `grants` */
    'rule',
    ...TERM_SCOPES,
] as const;

export const BuiltInScopeSchema = z.enum(TERM_SCOPES);

export const TERM_KEYS = [
    ...TERM_SCOPES,
    'faction',
    'subFaction',
    'upgrade',
    'gear',
    'weapon',
    'equipment',
    'specialRule',
    'selector',
] as const;

export const TermKeySchema = z.enum(TERM_KEYS);

export const TermSchema = z.strictObject({
    word: ExpressionWordSchema.optional().describe(
        'For built-in scopes (and `group` as a reference kind): the word data authors may write in expressions instead of the built-in name, e.g. `formation` for `group`'
    ),
    singular: z.string(),
    plural: z.string(),
});

export const RoleSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    grants: CostsSchema.optional().describe(
        'contingent resources a filled slot of this role grants its contingent, e.g. `{ "reserve": 1, "elite": 1 }`; a slot with several roles grants as the first that grants anything'
    ),
});

export const UnitTypeSchema = z
    .strictObject({ ...named, id: SlugSchema })
    .describe(
        'A unit type; `description` holds the rules every unit of the type follows'
    );

export const SubTypeSchema = z
    .strictObject({ ...named, id: SlugSchema })
    .describe(
        'A unit sub-type, given to units and profiles as a `tags` entry matching its name (case-insensitively) or id; `description` holds the rules every model with the sub-type follows'
    );

export const TraitSchema = z
    .strictObject({ ...named, id: SlugSchema })
    .describe(
        'A unit trait, given to units and profiles as a `traits` entry matching its name (case-insensitively) or id; `description` holds what the trait means'
    );

export const GroupTypeSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    contingent: z
        .union([
            z.literal('root'),
            z.strictObject({ linksTo: z.array(SlugSchema) }),
        ])
        .describe(
            '`root` groups start a contingent; linked groups attach to a root group of one of the listed types and share its faction source'
        ),
    source: z
        .enum(['main', 'ally', 'any'])
        .optional()
        .describe(
            "root groups only: `main` uses the list's main faction and sub-faction, `ally` a different one the player picks, `any` (validator 2.1.0) any faction of the game the player picks, the main one included. Only a `main` root starts the main contingent. Left out = `main`"
        ),
    min: CountOrExprSchema.optional().describe(
        'how many of this type a list may hold (at least)'
    ),
    max: CountOrExprSchema.optional().describe(
        'how many of this type a list may hold (at most)'
    ),
    cost: CostsSchema.optional().describe(
        'what a group of this type costs, counted in its contingent for contingent resources and in the list for list resources, e.g. `{ "reserve": 1, "elite": 1 }`; a group\'s own `cost` replaces it'
    ),
});

export const SlotTagSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    optionLabel: z
        .string()
        .optional()
        .describe(
            'what the slot options offered on slots with this tag are called, e.g. "Special Option"; left out, "Option"'
        ),
    color: SlugSchema.optional().describe(
        "the tag's colour in the app's palette (`amber`, `red`, `orange`, `green`, `teal`, `blue`, `violet`, `pink`, `slate`); left out or unknown, the app picks one from the tag's id"
    ),
    icon: SlugSchema.optional().describe(
        "the tag's mark in the app's icon set (`star`, `spark`, `diamond`, `hex`, `cross`, `flag`, `swords`, `crown`, `fleur`, `circle`, `triangle`, `square`, `target`, `bolt`); left out or unknown, the app picks one from the tag's id"
    ),
});

export const COST_TARGETS = [
    'unit',
    'additionalModels',
    'option',
    'slotOption',
    'group',
    'grant',
] as const;

export const CostTargetSchema = z
    .enum(COST_TARGETS)
    .describe(
        "Where an amount in a resource can be given: a unit's cost, the cost of each additional model, an option's cost (with its sub-choice values), a slot option's cost, a group's cost, or what a role or special rule grants"
    );

export const ResourceSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    scope: z
        .enum(['list', 'unit', 'contingent'])
        .describe(
            '`list`: spent across the list against a limit the player sets (points, credits). `unit`: spent within one unit against a capacity from its profile (equipment slots). `contingent`: granted and spent within each contingent, never set by the player (reserve points); going below zero is a list issue'
        ),
    message: z
        .string()
        .optional()
        .describe(
            'contingent resources: the issue shown when a contingent has spent too much'
        ),
    usedFor: z
        .array(CostTargetSchema)
        .optional()
        .describe(
            'what amounts in this resource may be given for; left out, by scope: `list` → unit, additional model, option, slot option and group costs; `unit` → option and slot option costs; `contingent` → group costs and grants'
        ),
    defaultLimit: z
        .number()
        .optional()
        .describe('list resources: the limit offered for new lists'),
    capacityStat: SlugSchema.optional().describe(
        "unit resources: the profile stat holding the unit's capacity"
    ),
    suffix: z.string().optional().describe('e.g. "pts"'),
});

export const StatDefinitionSchema = z.strictObject({
    id: SlugSchema,
    label: z.string().describe('column header, e.g. "WS"'),
    numeric: z
        .boolean()
        .optional()
        .describe(
            "numeric stats can be shifted by stat effects ('3+' -1 → '2+')"
        ),
});

export const StatTemplateSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    stats: z.array(StatDefinitionSchema),
});

export const ListChoiceValueEffectSchema = heldEffect().describe(
    "applied to every matching unit in the list while the value is picked, right after the unit's own traits and sub-faction modifiers; the pick is already the condition, so a `when` needs no `choice()`"
);

export const ListChoiceValueSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        units: UnitSelectorOrRefSchema.optional().describe(
            'the units `effects` apply to, seen with their own traits and sub-faction modifiers (validator 1.13.0); left out = every unit in the list, allies included'
        ),
        effects: z
            .array(ListChoiceValueEffectSchema)
            .optional()
            .describe(
                'stat, special-rule, trait and slot-tag effects on every matching unit in the list while this value is picked (validator 1.13.0), e.g. a stance value giving every unit a trait'
            ),
    })
    .describe("One of a list choice's values");

export const ListChoiceSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        values: z.record(SlugSchema, ListChoiceValueSchema),
        default: SlugSchema.optional(),
    })
    .describe('A list-level choice, e.g. stance or battle size');

/* Typed list-wide rules */

export const ResourceCapRuleSchema = z
    .strictObject({
        kind: z.literal('resourceCap'),
        id: SlugSchema,
        resource: SlugSchema,
        units: UnitSelectorOrRefSchema.optional().describe(
            'count only these units; left out = every unit'
        ),
        contingentTypes: z
            .array(SlugSchema)
            .optional()
            .describe(
                'count only units in contingents whose root group is one of these types'
            ),
        max: z.union([
            z.strictObject({
                percentOfLimit: z.number(),
                round: z.enum(['up', 'down']).optional(),
            }),
            z.strictObject({ value: NumberOrExprSchema }),
        ]),
        message: z.string(),
    })
    .describe(
        'Caps what may be spent on matching units, e.g. heavy units 25%, allies 50%'
    );

export const CountRuleSchema = z
    .strictObject({
        kind: z.literal('count'),
        id: SlugSchema,
        units: UnitSelectorOrRefSchema.optional(),
        groupTypes: z.array(SlugSchema).optional(),
        scope: z.enum(['group', 'contingent', 'list']),
        min: CountOrExprSchema.optional(),
        max: CountOrExprSchema.optional(),
        message: z.string(),
    })
    .describe('Limits how many matching units (or groups) a scope may hold');

export const ExpressionListRuleSchema = z
    .strictObject({
        kind: z.literal('expression'),
        id: SlugSchema,
        scope: z
            .enum(['list', 'group'])
            .optional()
            .describe(
                '`list` (default): the condition is checked once for the whole list. `group`: checked once for each group (of the listed `groupTypes`, or any) with `group`, `contingent`, `root`, `main` and `list` available; the message is reported for each group that fails'
            ),
        groupTypes: z
            .array(SlugSchema)
            .optional()
            .describe('with `scope: "group"`: only groups of these types'),
        when: ConditionSchema,
    })
    .describe(
        'Escape hatch for list rules no typed form covers. A rule only flags the list; it never prevents anything'
    );

export const ListRuleSchema = z.discriminatedUnion('kind', [
    ResourceCapRuleSchema,
    CountRuleSchema,
    ExpressionListRuleSchema,
]);

/* Special rules, gear */

export const SpecialRuleSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    text: z.string(),
    configurable: z
        .boolean()
        .optional()
        .describe('the rule takes a value, e.g. Ambush (X)'),
    defaultValue: z
        .string()
        .optional()
        .describe(
            'the value a configurable rule has when a selection gives none'
        ),
    grants: CostsSchema.optional().describe(
        'contingent resources a unit with the rule grants its contingent (negative takes some away). Expressions may use the `rule` scope, e.g. Quartermaster (X) `{ "reserve": "rule.value() - 1" }`'
    ),
    slots: z
        .array(AddedSlotSchema)
        .optional()
        .describe(
            'slots each unit with the rule adds to its group, e.g. one filled from another faction'
        ),
});

export const GearKindSchema = z.enum(['weapon', 'equipment']);

export const GearRefSchema = z
    .strictObject({ kind: GearKindSchema, id: SlugSchema })
    .describe('Points at a faction weapon or piece of equipment');

export const GearConditionSchema = z
    .strictObject({
        ...GearRefSchema.shape,
        profiles: ProfileFilterSchema.optional(),
    })
    .describe(
        'Gear the unit must hold, optionally only counting profiles that match the filter'
    );

export const GearLimitSchema = z
    .strictObject({
        ...GearConditionSchema.shape,
        count: z.number().positive('a number above 0'),
    })
    .describe(
        'An upgrade may be picked `count` times for each of this gear the unit has'
    );

export const GearSwapSchema = z
    .strictObject({
        from: z
            .union([GearRefSchema, z.array(GearRefSchema)])
            .describe(
                'the gear taken off; a list takes one of each, and a pick needs all of them held'
            ),
        to: GearRefSchema,
    })
    .describe(
        "Takes one `from` (one of each, for a list) off the upgrade's profile and gives it `to` in its place, per pick"
    );

/* a swap's `from` as a list, whether it names one gear or several */
export const swapFromRefs = (
    swap: z.infer<typeof GearSwapSchema>
): Array<z.infer<typeof GearRefSchema>> =>
    Array.isArray(swap.from) ? swap.from : [swap.from];

export const RestrictionsSchema = z.strictObject({
    exclusions: z.array(GearRefSchema),
    required: z.array(GearConditionSchema),
    requiredAnd: z.boolean(),
});

export const SubChoiceValueSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    costMultiplier: z
        .record(SlugSchema, z.number())
        .optional()
        .describe(
            'resource id → multiplier for the option\'s cost, e.g. a turret mount `{ "points": 3 }`'
        ),
    cost: CostsSchema.optional().describe("added to the option's cost"),
});

export const SubChoiceSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        values: z.record(SlugSchema, SubChoiceValueSchema),
        default: SlugSchema,
    })
    .describe(
        'A choice made alongside an option, defined once and shared by every option that offers it'
    );

export const OptionSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    cost: CostsSchema,
    weaponRefs: z.array(SlugSchema).optional(),
    equipmentRefs: z.array(SlugSchema).optional(),
    swaps: z
        .array(GearSwapSchema)
        .optional()
        .describe(
            'gear this option replaces, wherever the profile got it from'
        ),
    subChoices: z
        .array(SlugSchema)
        .optional()
        .describe(
            "ids of shared sub-choices made with the option, e.g. a weapon's `mount`"
        ),
    effects: z
        .array(heldEffect())
        .optional()
        .describe(
            'applied to the unit while the option is picked, e.g. armour plating raising armour'
        ),
    when: ConditionSchema.optional(),
    max: CountOrExprSchema.optional(),
});

export const UpgradeReferenceSchema = z.strictObject({
    id: SlugSchema.describe('id of the option entry in the unit upgrade'),
    target: SlugSchema.describe('id of the faction upgrade it pulls in'),
    restrictions: RestrictionsSchema.optional(),
});

export const PerModelConfigSchema = z.strictObject({
    type: z
        .enum(['single', 'multiple', 'every', 'some', 'one-in-x'])
        .describe(
            'single: once for the unit or one model; multiple: any number of times; every: every model gets it; some: any number of models; one-in-x: `count` (default 1) per `everyX` models'
        ),
    everyX: PositiveWholeNumberSchema.optional(),
    count: PositiveWholeNumberSchema.optional().describe(
        'one-in-x only: picks allowed per `everyX` models (default 1), a positive whole number; the cap is count × floor(models / everyX), e.g. `{ "type": "one-in-x", "everyX": 5, "count": 2 }` for \'for every five Models, up to two Models may each…\''
    ),
    max: WholeNumberSchema.optional(),
    excludeProfiles: ProfileFilterSchema.optional().describe(
        'profiles not counted as models for this upgrade'
    ),
});

const upgradeShape = {
    ...named,
    id: SlugSchema,
    profileId: SlugSchema.optional().describe(
        "the profile that takes this upgrade's gear; left out, the unit at large does"
    ),
    multiSelect: z.boolean().optional(),
    default: SlugSchema.optional().describe(
        'id of the option picked by default'
    ),
    perModel: PerModelConfigSchema,
    min: CountOrExprSchema.optional(),
    max: CountOrExprSchema.optional(),
    restrictions: RestrictionsSchema.optional(),
    replaces: z
        .array(SlugSchema)
        .optional()
        .describe(
            'sibling unit upgrades this upgrade takes the place of when picked'
        ),
    limitBy: z
        .array(GearLimitSchema)
        .optional()
        .describe(
            'caps total non-default picks at Σ count × amount of that gear held'
        ),
    when: ConditionSchema.optional(),
    grantedBy: SlugSchema.optional().describe(
        'id of the sub-faction unit modifier that added this upgrade'
    ),
    gearNote: z
        .string()
        .optional()
        .describe(
            "a short note shown next to every gear this upgrade's picks give (validator 1.11.0), e.g. a mount: `Hull mounted`. It covers the options' `weaponRefs` / `equipmentRefs` and swap `to`s, the `default` option's and those of options reached through a reference included (the referencing upgrade's note wins over the shared upgrade's). Display only: gear is still matched, counted and swapped by kind and id"
        ),
};

export const UpgradeSchema = z.strictObject({
    ...upgradeShape,
    swapFrom: z
        .strictObject({
            ...GearRefSchema.shape,
            count: PositiveWholeNumberSchema.optional(),
        })
        .optional()
        .describe(
            "each pick of any option takes `count` (default 1) of this gear off the upgrade's profile (or the unit at large), up to what is held, besides giving the option's own gear; covers options reached through a reference too, except options with their own `swaps`; not applied to the `default` option"
        ),
    mirrorOf: SlugSchema.optional().describe(
        "id of a sibling unit upgrade on another profile whose pick this upgrade always copies: the same option, never chosen by the player, with the amount set by this upgrade's own `perModel` and profile. Both must offer the same option ids (references expanded) and the same `default`; `perModel.type` must be `every` or `single`; the source can't itself have `mirrorOf`"
    ),
    options: z
        .record(SlugSchema, z.union([OptionSchema, UpgradeReferenceSchema]))
        .describe(
            "own options and references to shared faction upgrades; when ids clash, the upgrade's own option wins, then the shared upgrade referenced first"
        ),
});

export const FactionUpgradeSchema = z
    .strictObject({
        ...upgradeShape,
        options: z.record(SlugSchema, OptionSchema),
    })
    .describe('A faction-level upgrade units point at instead of repeating it');

export const DefaultGearSchema = z
    .strictObject({
        ...GearRefSchema.shape,
        perModel: z
            .boolean()
            .optional()
            .describe(
                "carried by every model, so the amount follows the unit's model count"
            ),
        excludeProfiles: ProfileFilterSchema.optional().describe(
            "with `perModel`: profiles that don't carry it"
        ),
        profileId: SlugSchema.optional().describe(
            'the profile that carries it; left out, the unit at large does. With `perModel`: one for each model of that profile'
        ),
        note: z
            .string()
            .optional()
            .describe(
                "a short note shown next to this gear wherever the unit's gear is listed (validator 1.11.0), e.g. a mount: `Turret mounted`. Display only: gear is still matched, counted and swapped by kind and id"
            ),
    })
    .describe('Gear a unit carries without taking any upgrade');

/* Units */

export const UnitProfileSchema = z.strictObject({
    id: SlugSchema.describe(
        'needed for upgrades, default gear and sub-faction rules to point at the profile'
    ),
    name: z.string(),
    template: SlugSchema.describe('a unit stat template id from the game'),
    stats: z
        .record(SlugSchema, z.string())
        .describe('stat id → value, checked against the template'),
    specialRules: z.array(SpecialRuleSelectionSchema).optional(),
    type: SlugSchema.optional().describe(
        "replaces the unit's type for this profile"
    ),
    tags: z
        .array(z.string())
        .optional()
        .describe("added to the unit's tags for this profile (e.g. Sergeant)"),
    traits: z
        .array(z.string())
        .optional()
        .describe(
            "added to the unit's traits for this profile (validator 1.11.0), e.g. a Shield trait only the shield-bearers have: `profile.is(trait:…)` and profile-level matching see the unit's traits plus these, and the unit counts as holding them (selector `traits`, `unit.is(trait:…)`, container `count(trait:…)`) when any of its profiles does, as with profile `tags`"
        ),
});

export const CompositionBlockSchema = z
    .strictObject({
        name: z
            .string()
            .optional()
            .describe(
                'shown to players, e.g. "Gun Crew"; left out, built from the profile names'
            ),
        description: z.string().optional(),
        id: SlugSchema.describe(
            'unique within the unit; the key a saved list stores the number of copies under'
        ),
        profiles: z
            .record(SlugSchema, PositiveWholeNumberSchema)
            .describe(
                'profile id → how many models of it one copy of the block holds, e.g. `{ "gunner": 1, "loader": 1 }`'
            ),
        min: WholeNumberSchema.optional().describe(
            'copies in the unit as bought for its `cost`; left out = 1'
        ),
        max: CountOrExprSchema.optional().describe(
            "most copies the unit may hold; left out = `min`. An expression (validator 1.10.0) is evaluated live for the unit as it stands, in the unit's scopes, e.g. `floor(unit.models() / 5)` on a block that `replaces` models; only a block with `replaces` may read `unit.models()`"
        ),
        cost: CostsSchema.optional().describe(
            'what each copy above `min` costs; needed when `max` is more than `min` or an expression'
        ),
        replaces: z
            .strictObject({
                block: SlugSchema.describe(
                    'the block whose models it replaces'
                ),
                profile: SlugSchema.describe(
                    'the profile in that block each copy takes the place of; one model of it per model in the copy'
                ),
            })
            .optional()
            .describe(
                "each copy takes the place of models of `profile` in `block` instead of adding models, e.g. one Sapper upgraded to a Foreman: the unit's size stays the same and the profile's count moves to this block's profiles"
            ),
    })
    .describe(
        'A set of models bought together: the unit holds between `min` and `max` copies of it, e.g. a Gun Crew of one Gunner and one Loader'
    );

export const UnitSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    role: SlugSchema,
    type: SlugSchema,
    tags: z
        .array(z.string())
        .optional()
        .describe(
            'keywords and sub-types, matched by `tag:` references and profile filters; free text, though when the game defines `subTypes` a tag that matches none is a warning'
        ),
    cost: CostsSchema,
    modelCount: PositiveWholeNumberSchema.describe(
        'models in the unit as bought for its `cost`; with `composition`, the sum over its blocks of `min` × models per copy'
    ),
    additionalModels: z
        .strictObject({ max: PositiveWholeNumberSchema, cost: CostsSchema })
        .optional()
        .describe(
            'up to `max` more models at `cost` each, of no particular profile; not used with `composition`'
        ),
    composition: z
        .array(CompositionBlockSchema)
        .optional()
        .describe(
            'how many models of each profile the unit holds and how it grows, as blocks of models bought together; replaces `additionalModels`'
        ),
    profiles: z.array(UnitProfileSchema),
    upgrades: z.record(SlugSchema, UpgradeSchema).optional(),
    defaultGear: z.array(DefaultGearSchema).optional(),
    traits: z
        .array(z.string())
        .optional()
        .describe(
            "the unit's traits (e.g. a faction trait), matched by `trait:` references and selector `traits` as case-insensitive text; effects may add or remove some"
        ),
    when: ConditionSchema.optional().describe('when the unit may be taken'),
    limit: z
        .strictObject({
            max: CountOrExprSchema,
            scope: z.enum(['group', 'contingent', 'list']),
            message: z.string().optional(),
        })
        .optional()
        .describe(
            'how many of this unit a scope may hold, e.g. unique characters'
        ),
});

export const WeaponProfileSchema = z.strictObject({
    name: z.string(),
    template: SlugSchema.optional().describe(
        "a weapon stat template id from the game for this profile, in place of the weapon's `template` (validator 1.11.0), e.g. `melee` on the close-combat profile of a spear whose weapon `template` is `ranged`"
    ),
    stats: z
        .record(SlugSchema, z.string())
        .describe("stat id → value, checked against the profile's template"),
    traits: z.array(z.string()).optional(),
    specialRules: z.array(SpecialRuleSelectionSchema).optional(),
});

const weaponProfiles = {
    template: SlugSchema.describe(
        'a weapon stat template id from the game, e.g. `ranged` / `melee`: the template of every profile without its own `template`'
    ),
    profiles: z.array(WeaponProfileSchema),
};

export const WeaponSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    ...weaponProfiles,
});

export const EquipmentWeaponSchema = z
    .strictObject(weaponProfiles)
    .describe(
        "weapon profiles the equipment lets its holder use, e.g. a grenade's thrown attack (validator 2.3.0). Shown as part of the equipment, checked like a weapon's profiles; not a weapon the unit holds, so `weapon:` references, restrictions, `limitBy` and swaps never see it (they see the equipment)"
    );

export const EquipmentSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    text: z.string(),
    weapon: EquipmentWeaponSchema.optional(),
});

/* Groups (formations, retinues, teams) */

export const TagOptionsSchema = z
    .strictObject({
        categories: z
            .array(SlugSchema)
            .describe(
                'only slot options with one of these `category`s are offered for the tag'
            ),
    })
    .describe(
        "Limits the slot options a slot offers for one of its tags (validator 2.2.0). Where several restrictions apply to one tag on one slot (this and slotTag effects' `categories`), only options every one of them allows are offered"
    );

export const SlotSchema = z.strictObject({
    roles: z
        .array(SlugSchema)
        .describe('units of any of these roles may fill the slot'),
    tags: z
        .array(SlugSchema)
        .optional()
        .describe('game-declared slot tags, e.g. `prime`'),
    required: z
        .boolean()
        .optional()
        .describe('must be filled for the list to be valid (compulsory slots)'),
    repeat: z
        .strictObject({
            min: WholeNumberSchema.optional(),
            max: CountOrExprSchema.optional(),
        })
        .optional()
        .describe(
            "the slot may be added more than once, each copy holding one unit (a team's vehicles, optional slots); `max` left out = no limit"
        ),
    units: UnitSelectorOrRefSchema.optional().describe(
        "only matching units may fill this slot; with a `source`, `unitIds` are the source's units"
    ),
    tagOptions: z
        .record(SlugSchema, TagOptionsSchema)
        .optional()
        .describe(
            '(validator 2.2.0) tag id → which of that tag\'s slot options this slot offers, e.g. `{ "prime": { "categories": ["honour"] } }`; each key must be one of the slot\'s `tags`. A tag left out offers every option'
        ),
    source: SlotSourceSchema.optional(),
    effects: z.array(SlotUnitEffectSchema).optional(),
    when: ConditionSchema.optional(),
});

export const GroupRequirementSchema = z
    .strictObject({
        units: UnitSelectorOrRefSchema,
        count: PositiveWholeNumberSchema.optional().describe(
            'matching units needed; left out = 1'
        ),
        scope: z
            .enum(['contingent', 'root'])
            .optional()
            .describe(
                "where they're counted: the group's contingent outside it (default) or its root group"
            ),
    })
    .describe('units the list must already hold before the group can be taken');

export const GroupEffectSchema = heldEffect().describe(
    'applied to every unit in the group, including units in slots added later'
);

export const GroupSchema = z.strictObject({
    ...named,
    id: SlugSchema,
    type: SlugSchema.describe('a group type id from the game'),
    slots: z.array(SlotSchema),
    units: UnitSelectorOrRefSchema.optional().describe(
        'only matching units may fill any slot, including slots a mechanic adds, except slots with a `source`'
    ),
    requires: z
        .array(GroupRequirementSchema)
        .optional()
        .describe('all must be met'),
    requirementText: z
        .string()
        .optional()
        .describe("shown when a requirement isn't met"),
    when: ConditionSchema.optional(),
    min: CountOrExprSchema.optional().describe(
        'how many of this group a list must hold, e.g. a mandatory veteran formation'
    ),
    max: CountOrExprSchema.optional().describe(
        'how many of this group a list may hold'
    ),
    cost: CostsSchema.optional().describe("replaces its group type's `cost`"),
    effects: z
        .array(GroupEffectSchema)
        .optional()
        .describe(
            'applied to every unit in the group, e.g. "Every unit in this group gains the Gun Line trait"'
        ),
});

/* Slot options (choices a tagged slot offers) */

export const SlotEffectSchema = z
    .strictObject({
        kind: z.literal('slot'),
        ...addedSlot,
        count: PositiveWholeNumberSchema.optional().describe(
            'how many such slots the option adds to the group (default 1), each holding its own unit (validator 2.4.0); with several `roleChoices` the player picks one role, which all of them take, e.g. `{ "kind": "slot", "roleChoices": ["support"], "count": 3 }`'
        ),
    })
    .describe(
        'adds a slot (or `count` slots) to the group; with several roles the player picks one'
    );

export const AllowedRolesEffectSchema = z
    .strictObject({
        kind: z.literal('allowedRoles'),
        roles: z.array(SlugSchema),
    })
    .describe('units of these roles may also fill the slot');

export const SlotOptionEffectSchema = z.discriminatedUnion(
    'kind',
    [...unitEffects, SlotEffectSchema, AllowedRolesEffectSchema],
    {
        error: (issue) =>
            (issue.input as { kind?: unknown } | undefined)?.kind === 'slotTag'
                ? "a slot option can't have a slotTag effect: slot options are applied last, so a tag one added could never offer anything; give the slot the tag (`tags`), or put the slotTag effect on the group, the slot, an upgrade option, a sub-faction unit modifier or a list choice value"
                : undefined,
    }
);

export const SlotOptionSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        text: z.string(),
        slotTag: SlugSchema.describe('offered on slots with this tag'),
        category: SlugSchema.optional().describe(
            "(validator 2.2.0) what kind of option this is among its tag's, e.g. `honour`; a slot's `tagOptions` and a slotTag effect's `categories` offer only options of the categories they name"
        ),
        slotRoles: z
            .array(SlugSchema)
            .optional()
            .describe(
                'only offered on slots of these roles; left out = any role'
            ),
        units: UnitSelectorOrRefSchema.optional().describe(
            'only offered on slots whose unit matches, seen as it stands before slot-option effects (its traits from option and group effects included), e.g. `{ "traits": ["Field Army"] }` for an option only Field Army units may take; left out = any unit'
        ),
        cost: CostsSchema.optional().describe(
            'added to the cost of the unit in the slot'
        ),
        effects: z.array(SlotOptionEffectSchema).optional(),
    })
    .describe(
        "A choice made for a slot with the option's tag, applying its effects to the unit in the slot (and the group), e.g. special benefits or enhancements. One option per tag per slot."
    );

/* ------------------------------------------------------------------ */
/* Game system                                                         */
/* ------------------------------------------------------------------ */

export const GameSystemSchema = z.strictObject({
    $schema: schemaUrl,
    ...named,
    id: SlugSchema,
    version: z.string(),
    terms: z
        .partialRecord(TermKeySchema, TermSchema)
        .optional()
        .describe(
            "the game's own words for built-in concepts, in expressions and the UI"
        ),
    roles: z.record(SlugSchema, RoleSchema),
    unitTypes: z.record(SlugSchema, UnitTypeSchema),
    subTypes: z
        .record(SlugSchema, SubTypeSchema)
        .optional()
        .describe(
            'unit sub-types (validator 1.12.0); when set, unit and profile `tags`, `tag:` references and profile filter values that match no sub-type (or unit type) are warnings'
        ),
    traits: z
        .record(SlugSchema, TraitSchema)
        .optional()
        .describe(
            'unit traits (validator 2.0.0); when set, unit and profile `traits`, the traits effects give or take, selector `traits` and `trait:` references that match no trait here are warnings'
        ),
    groupTypes: z
        .record(SlugSchema, GroupTypeSchema)
        .describe('group / formation / retinue / team types'),
    slotTags: z.record(SlugSchema, SlotTagSchema).optional(),
    resources: z.record(SlugSchema, ResourceSchema),
    stats: z.strictObject({
        unit: z.record(SlugSchema, StatTemplateSchema),
        weapon: z.record(SlugSchema, StatTemplateSchema),
    }),
    choices: z
        .record(SlugSchema, ListChoiceSchema)
        .optional()
        .describe('list-level choices, e.g. stance or battle size'),
    listRules: z
        .record(SlugSchema, ListRuleSchema)
        .optional()
        .describe('typed list-wide rules, e.g. percentage caps'),
    groups: z
        .record(SlugSchema, GroupSchema)
        .optional()
        .describe(
            'groups every faction may take (core formations shared by every faction)'
        ),
    specialRules: z
        .record(SlugSchema, SpecialRuleSchema)
        .optional()
        .describe('special rules that belong to no single faction'),
    selectors: z
        .record(SlugSchema, NamedSelectorSchema)
        .optional()
        .describe('selectors every faction may use'),
    slotOptions: z
        .record(SlugSchema, SlotOptionSchema)
        .optional()
        .describe(
            'choices slots with a tag offer (e.g. benefits for tagged slots)'
        ),
    subChoices: z
        .record(SlugSchema, SubChoiceSchema)
        .optional()
        .describe('sub-choices options in every faction may offer'),
});

/* ------------------------------------------------------------------ */
/* Factions and sub-factions                                           */
/* ------------------------------------------------------------------ */

export const FACTION_RECORD_KINDS = [
    'units',
    'weapons',
    'equipment',
    'upgrades',
    'specialRules',
    'groups',
    'selectors',
    'slotOptions',
    'subChoices',
    'listRules',
] as const;

const factionRecords = {
    units: z.record(SlugSchema, UnitSchema),
    weapons: z.record(SlugSchema, WeaponSchema),
    equipment: z.record(SlugSchema, EquipmentSchema),
    upgrades: z.record(SlugSchema, FactionUpgradeSchema),
    specialRules: z.record(SlugSchema, SpecialRuleSchema),
    groups: z.record(SlugSchema, GroupSchema),
    selectors: z.record(SlugSchema, NamedSelectorSchema).optional(),
    slotOptions: z.record(SlugSchema, SlotOptionSchema).optional(),
    subChoices: z.record(SlugSchema, SubChoiceSchema).optional(),
    listRules: z
        .record(SlugSchema, ListRuleSchema)
        .optional()
        .describe(
            "list rules that apply to contingents using this faction (or sub-faction), e.g. a rule about this faction's own traits"
        ),
};

export const FactionRecordsSchema = z.strictObject(factionRecords);

/** The group a sub-faction without a `group` is in; a faction may declare it to name it or change its limits */
export const DEFAULT_SUB_FACTION_GROUP = 'default';

export const SubFactionGroupSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        min: CountOrExprSchema.optional().describe(
            'how many sub-factions of this group a contingent must take; left out = 0. Expressions may use `contingent`, `root`, `main` and `list`'
        ),
        max: CountOrExprSchema.optional().describe(
            'how many sub-factions of this group a contingent may take; left out = 1. Expressions may use `contingent`, `root`, `main` and `list`, e.g. `1 + (list.has(unit:x) ? 1 : 0)`'
        ),
    })
    .describe(
        'An independent sub-faction pick, e.g. a doctrine and a heritage: a contingent takes between `min` and `max` of the sub-factions in each group'
    );

export const FactionSchema = z.strictObject({
    $schema: schemaUrl,
    ...factionRecords,
    ...named,
    id: SlugSchema,
    version: z.string(),
    game: z.strictObject({ id: SlugSchema, versions: VersionRangeSchema }),
    defaultGroup: SlugSchema.optional().describe(
        "the group a new list's main root group starts as when the faction is picked (its usual core formation); the faction's or the game's, of a root group type taken from the main faction"
    ),
    subFactionGroups: z
        .record(SlugSchema, SubFactionGroupSchema)
        .optional()
        .describe(
            'the independent sub-faction picks a contingent of this faction makes; sub-factions name theirs in `group`. Sub-factions without a `group` are in the `default` group (max 1), which may be declared here to name it or change its limits'
        ),
});

export const UnitModifierActionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('addUpgrade'), upgradeId: SlugSchema }),
    z
        .strictObject({ kind: z.literal('unavailable'), message: z.string() })
        .describe(
            "the matched units can't be taken (e.g. a sub-faction's banned vehicles)"
        ),
    ...heldEffects,
]);

export const UnitModifierSchema = z
    .strictObject({
        ...named,
        id: SlugSchema,
        selector: UnitSelectorOrRefSchema,
        actions: z.array(UnitModifierActionSchema),
    })
    .describe(
        'A sub-faction rule applied to every unit of the parent (and sub-faction) it selects'
    );

export const SubFactionSchema = z
    .strictObject({
        $schema: schemaUrl,
        ...z.object(factionRecords).partial().shape,
        ...named,
        id: SlugSchema,
        version: z.string(),
        parent: z.strictObject({
            faction: SlugSchema,
            versions: VersionRangeSchema.optional(),
        }),
        group: SlugSchema.optional().describe(
            "one of the parent's `subFactionGroups`; left out, the `default` group. Sub-factions that can be taken together (different groups, or one group whose `max` may exceed 1) must not define the same record differently"
        ),
        when: ConditionSchema.optional().describe(
            'when the sub-faction may be taken, checked for the contingent it is taken for. Expressions may use `contingent`, `root`, `main` and `list`, e.g. `choice(stance) == defensive` or `main.is(subfaction:x)`'
        ),
        overrides: z
            .array(
                z.strictObject({
                    kind: z.enum(FACTION_RECORD_KINDS),
                    id: SlugSchema,
                })
            )
            .optional()
            .describe(
                "records that intentionally replace the parent's (same kind and id); any other collision is an error"
            ),
        unitModifiers: z.record(SlugSchema, UnitModifierSchema).optional(),
    })
    .describe(
        'Additions to a parent faction, which may come from another source in the same game'
    );

/* ------------------------------------------------------------------ */
/* Source manifest (`forceorg.json` at the root of a data source)      */
/* ------------------------------------------------------------------ */

export const ProvidedGameSchema = z
    .strictObject({
        game: z.string().describe('a `GameSystem` file'),
        factions: z.array(z.string()).describe('`Faction` files'),
        subFactions: z
            .array(z.string())
            .optional()
            .describe('`SubFaction` files'),
    })
    .describe('File paths are relative to the manifest');

export const GameExtensionSchema = z.strictObject({
    game: SlugSchema.describe(
        'id of the extended game; bound to a loaded source that provides it (the user picks if several do)'
    ),
    versions: VersionRangeSchema,
    factions: z.array(z.string()).optional(),
    subFactions: z
        .array(z.string())
        .optional()
        .describe(
            'may name a parent faction from another source in the same game'
        ),
});

/** A release number, exactly `major.minor.patch` with no leading zeros */
export const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const SourceManifestSchema = z.strictObject({
    $schema: schemaUrl,
    minValidatorVersion: z
        .string()
        .regex(RELEASE_PATTERN, 'a release number, `major.minor.patch`')
        .optional()
        .describe(
            'the oldest validator release that understands this source, as `major.minor.patch`, e.g. `1.14.0`; an older validator refuses the source with a message to update instead of reporting its newer fields as unknown. Set it to the release that added the newest feature the source uses. Validators before 1.14.0 do not know this field, so a value below 1.14.0 is never useful'
        ),
    schemaVersion: z
        .number()
        .describe(
            'data format version; the app refuses sources newer than it understands'
        ),
    expressionVersion: z
        .number()
        .optional()
        .describe(
            "the version of the expression language the source's expressions are written for; the app refuses sources newer than it understands. Left out, version 1 (with a warning)"
        ),
    name: z.string(),
    description: z.string().optional(),
    disclaimer: z
        .string()
        .optional()
        .describe('shown next to everything loaded from this source'),
    provides: z
        .array(ProvidedGameSchema)
        .optional()
        .describe('complete games this source defines'),
    extends: z
        .array(GameExtensionSchema)
        .optional()
        .describe('games defined by another source that this source adds to'),
    examples: z
        .array(z.string())
        .optional()
        .describe(
            'example lists the checker runs when the source loads (and in CI where adopted)'
        ),
});

/** The four kinds of file a data source holds, by the name the checker reports them under */
export const FILE_SCHEMAS = {
    SourceManifest: SourceManifestSchema,
    GameSystem: GameSystemSchema,
    Faction: FactionSchema,
    SubFaction: SubFactionSchema,
} as const;

export type ShapeKindName = keyof typeof FILE_SCHEMAS;
