import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { formatDiagnostic } from '../src/expressions/diagnostics';
import { readSource } from '../src/game_data/read_source';
import {
    DataIssue,
    GameDataSet,
    validateGameData,
} from '../src/game_data/validate';

/*
 * Integrity of the example sources in examples/. Run it after hand-editing
 * them.
 */

const root = path.join(import.meta.dirname, '..');
const examples = path.join(root, 'examples');

const describeIssue = (i: DataIssue) =>
    `${i.severity} ${i.file} ${i.path}: ${i.message}` +
    (i.expression
        ? `\n${formatDiagnostic(i.expression.source, { ...i, ...i.expression })}`
        : '');

/* a source's games, with any extension sources' files added to the game they extend */
async function sets(dir: string, ...extensionDirs: Array<string>) {
    const source = await readSource(dir);
    const extensions = await Promise.all(
        extensionDirs.map((d) => readSource(d))
    );

    return source.provided.map((set): GameDataSet => {
        for (const ext of extensions.flatMap((e) => e.extensions)) {
            if (ext.game !== set.game.data.id) continue;
            set.factions.push(...ext.factions);
            set.subFactions.push(...ext.subFactions);
        }
        return set;
    });
}

async function assertClean(dir: string, ...extensionDirs: Array<string>) {
    const issues = (await sets(dir, ...extensionDirs)).flatMap(
        validateGameData
    );
    assert.deepEqual(issues.map(describeIssue), []);
}

describe('example sources', () => {
    it('full coverage source with the extension source', () =>
        assertClean(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        ));

    for (const name of ['full', 'starter']) {
        it(name, () => assertClean(path.join(examples, name)));
    }
});

describe('validator', () => {
    it('reports broken references, stats and expressions', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const faction = structuredClone(set.factions[0]);
        const squad = faction.data.units['squad'];
        squad.role = 'trop';
        squad.profiles[0].stats = { move: '6' };
        squad.upgrades!['squad-options'].options['grenades'] = {
            id: 'grenades',
            name: 'Grenades',
            cost: { points: 5 },
            when: {
                if: 'choice(stance) == offensiv',
                message: 'Offensive only',
            },
        };
        faction.data.units['carrier'].id = 'not-carrier';

        const issues = validateGameData({ ...set, factions: [faction] });
        const messages = issues.map((i) => `${i.path}: ${i.message}`);

        assert.ok(messages.includes("units/squad: unknown role 'trop'"));
        assert.ok(
            messages.some((m) =>
                m.startsWith('units/squad/profiles/trooper: missing stats')
            )
        );
        assert.ok(
            messages.some((m) =>
                m.includes(
                    "'offensiv' isn't a value of stance (did you mean 'offensive'?)"
                )
            )
        );
        assert.ok(
            messages.includes(
                "units/carrier: id is 'not-carrier', but the key is 'carrier'"
            )
        );
        const expression = issues.find((i) => i.expression);
        assert.equal(
            expression?.expression?.source,
            'choice(stance) == offensiv'
        );
    });

    it('requires declared overrides for sub-faction collisions', async () => {
        const [set] = await sets(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        );
        const sub = set.subFactions.find((s) => s.data.id === 'irregulars')!;
        const withoutOverride = structuredClone(sub);
        delete withoutOverride.data.overrides;

        const issues = validateGameData({
            ...set,
            subFactions: set.subFactions.map((s) =>
                s === sub ? withoutOverride : s
            ),
        });
        assert.ok(
            issues.some((i) =>
                i.message.startsWith(
                    "collides with the parent's specialRules 'disciplined'"
                )
            )
        );
    });
});

/* the full source with the extension, changed by `change`, and what the validator says */
async function issuesAfter(change: (set: GameDataSet) => void) {
    const [set] = structuredClone(
        await sets(
            path.join(examples, 'full'),
            path.join(examples, 'extension')
        )
    );
    change(set);
    return validateGameData(set).map(
        (i) => `${i.severity} ${i.file} ${i.path}: ${i.message}`
    );
}
const sub = (set: GameDataSet, id: string) =>
    set.subFactions.find((s) => s.data.id === id)!.data;

describe('grouped sub-factions', () => {
    it('reports an unknown group, with a hint', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'coastal-heritage').group = 'heritag';
        });
        assert.deepEqual(issues, [
            "error sub-factions/coastal-heritage.json group: 'field-army' has no sub-faction group 'heritag' (did you mean 'heritage'?)",
        ]);
    });

    it('checks group limits and sub-faction conditions', async () => {
        const issues = await issuesAfter((set) => {
            const groups = set.factions[0].data.subFactionGroups!;
            groups['heritage'].max = 'list.has(unit:walkr)';
            groups['doctrine'].min = 2;
            sub(set, 'coastal-heritage').when!.if = 'list.count(unit:walker)';
            sub(set, 'highland-heritage').when = {
                if: 'unit.has(unit:walker)',
                message: 'Never',
            };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json subFactionGroups/doctrine: min 2 is more than max 1',
            "error factions/field-army.json subFactionGroups/heritage/max: unknown unit 'walkr' (did you mean 'walker'?)",
            "error sub-factions/highland-heritage.json when: 'unit' isn't available here (allowed: contingent, list, main, root)",
            'error sub-factions/coastal-heritage.json when: this field needs a boolean but the expression is a number',
        ]);
    });

    it('allows identical records in sub-factions taken together', async () => {
        // both heritages define the same local-knowledge rule (see the example)
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('reports different records in sub-factions taken together', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'coastal-heritage').specialRules!['local-knowledge'].text =
                'Something else.';
            sub(set, 'siege-doctrine').unitModifiers = {
                tough: {
                    id: 'tough',
                    name: 'Tough',
                    selector: {},
                    actions: [],
                },
            };
            sub(set, 'highland-heritage').unitModifiers = {
                tough: {
                    id: 'tough',
                    name: 'Tougher',
                    selector: {},
                    actions: [],
                },
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/highland-heritage.json unitModifiers/tough: sub-faction 'siege-doctrine' (sub-factions/siege-doctrine.json) also defines unitModifiers 'tough', differently, and both can be taken together (they're in groups 'doctrine' and 'heritage'); make them identical or rename one",
            "error sub-factions/coastal-heritage.json specialRules/local-knowledge: sub-faction 'highland-heritage' (sub-factions/highland-heritage.json) also defines specialRules 'local-knowledge', differently, and both can be taken together (group 'heritage' allows more than one); make them identical or rename one",
        ]);
    });

    it('allows the same ids in a group of one', async () => {
        // the doctrines both define `drill`, differently, but only one can be taken
        const issues = await issuesAfter(() => {});
        assert.ok(!issues.some((i) => i.includes('drill')));
    });

    it('reports two overrides of one parent record taken together', async () => {
        // veterans and irregulars (no group) both override `disciplined`
        const issues = await issuesAfter((set) => {
            set.factions[0].data.subFactionGroups!['default'] = {
                id: 'default',
                name: 'Regiment',
                max: 2,
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/irregulars.json specialRules/disciplined: sub-faction 'veterans' (sub-factions/veterans.json) also overrides the parent's specialRules 'disciplined', differently, and both can be taken together (group 'default' allows more than one); make the replacements identical, or keep the two from being taken together",
        ]);
    });

    it('still accepts sub-factions without groups', async () => {
        const issues = await issuesAfter((set) => {
            delete set.factions[0].data.subFactionGroups;
            for (const s of set.subFactions) {
                delete s.data.group;
                delete s.data.when;
            }
        });
        assert.deepEqual(issues, []);
    });
});

describe('unit composition', () => {
    const gunTeam = (set: GameDataSet) =>
        set.factions[0].data.units['gun-team'];

    it('checks blocks against the profiles and the model count', async () => {
        const issues = await issuesAfter((set) => {
            const unit = gunTeam(set);
            unit.composition![0].profiles = { gunner: 1, loadr: 1.5 };
            unit.composition!.push({
                id: 'spotter',
                profiles: { gunner: 1 },
                min: 2,
                max: 1,
            });
            unit.additionalModels = { max: 1, cost: { points: 5 } };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/gun-team/additionalModels: a unit with a composition grows through its blocks' max and cost, not additionalModels",
            "error factions/field-army.json units/gun-team/composition/gun-crew: unknown profile 'loadr'",
            'error factions/field-army.json units/gun-team/composition/gun-crew/profiles/loadr: a block holds a whole number of models of each profile, at least 1 (got 1.5)',
            "error factions/field-army.json units/gun-team/composition/spotter: profile 'gunner' is also in block 'gun-crew'; a profile may be in only one block",
            'error factions/field-army.json units/gun-team/composition/spotter: min 2 is more than max 1',
            "error factions/field-army.json units/gun-team/modelCount: modelCount is 2, but the composition's blocks at their min hold 4.5 models",
            "warning factions/field-army.json units/gun-team/composition: profile 'loader' is in no block, so no model uses it",
        ]);
    });

    it('needs a cost where the unit can grow', async () => {
        const issues = await issuesAfter((set) => {
            delete gunTeam(set).composition![0].cost;
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json units/gun-team/composition/gun-crew: a block the unit can add copies of needs a cost per copy',
        ]);
    });

    it('accepts fixed blocks and optional blocks', async () => {
        const issues = await issuesAfter((set) => {
            const unit = gunTeam(set);
            unit.composition = [
                { id: 'gunner', profiles: { gunner: 1 } },
                {
                    id: 'loaders',
                    profiles: { loader: 1 },
                    min: 0,
                    max: 2,
                    cost: { points: 10 },
                },
            ];
            unit.modelCount = 1;
        });
        assert.deepEqual(issues, []);
    });
});

describe('weapon profile templates', () => {
    const spear = (set: GameDataSet) =>
        set.factions[0].data.weapons['spear'].profiles;

    it("checks a profile's stats against its own template", async () => {
        const issues = await issuesAfter((set) => {
            spear(set)[1].stats = { range: '1"', attacks: '2', damage: '1' };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json weapons/spear/profiles/1: stats not in the template: range',
        ]);
    });

    it('reports an unknown profile template and warns on a redundant one', async () => {
        const issues = await issuesAfter((set) => {
            spear(set)[0].template = 'ranged';
            spear(set)[1].template = 'mele';
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json weapons/spear/profiles/0: the profile's template is the weapon's 'ranged' already; leave it out",
            "error factions/field-army.json weapons/spear/profiles/1: unknown weapon template 'mele'",
        ]);
    });
});

describe('traits', () => {
    it('checks trait effects, with no profile scope in their conditions', async () => {
        const issues = await issuesAfter((set) => {
            const gunLine = set.factions[0].data.groups['gun-line'];
            gunLine.effects = [
                { kind: 'trait' },
                {
                    kind: 'trait',
                    add: ['Gun Line'],
                    remove: ['gun line'],
                    when: {
                        if: 'profile.is(tag:sergeant)',
                        message: 'Sergeants only',
                    },
                },
                { kind: 'trait', replace: { from: [], to: 'Gun Line' } },
            ];
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json groups/gun-line/effects/0: a trait effect needs add, remove or replace',
            "warning factions/field-army.json groups/gun-line/effects/1: 'Gun Line' is both given and taken away",
            "error factions/field-army.json groups/gun-line/effects/1/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
            'error factions/field-army.json groups/gun-line/effects/2: replace needs at least one trait in from',
        ]);
    });

    it('checks the rest of a group effect like any effect', async () => {
        const issues = await issuesAfter((set) => {
            const gunLine = set.factions[0].data.groups['gun-line'];
            gunLine.effects!.push({
                kind: 'specialRule',
                rule: { id: 'stubborn' },
            });
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/2: unknown special rule 'stubborn'",
        ]);
    });

    it('warns on selector traits no unit has or is given', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').unitModifiers!['veteran-corps'].selector = {
                traits: ['Disiplined'],
            };
        });
        assert.deepEqual(issues, [
            "warning sub-factions/veterans.json unitModifiers/veteran-corps: no unit has or is given the trait 'Disiplined' (did you mean 'disciplined'?)",
        ]);
    });

    it('knows traits only a profile has', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').unitModifiers!['veteran-corps'].selector = {
                traits: ['Shield'],
            };
        });
        assert.deepEqual(issues, []);
    });

    it('knows traits given by effects in other factions', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'irregulars').when = {
                if: 'main.has(trait:veteran-corps) or main.has(trait:gun-line)',
                message: 'Only alongside veterans or a gun line',
            };
        });
        assert.deepEqual(issues, []);
    });
});

describe('slots filled from another faction', () => {
    const fieldArmy = (set: GameDataSet) => set.factions[0].data;
    const handlerSlot = (set: GameDataSet) =>
        fieldArmy(set).specialRules['construct-handler'].slots![0];
    const borrowedSlot = (set: GameDataSet) => {
        const effect = sub(set, 'veterans').slotOptions!['borrowed-specialists']
            .effects![0];
        assert.equal(effect.kind, 'slot');
        return effect;
    };

    it("resolves unitIds against the source's units, sub-factions included", async () => {
        const issues = await issuesAfter((set) => {
            // the faction's own `squad` isn't a Clockwork Guild unit
            handlerSlot(set).units = { unitIds: ['battle-construct', 'squad'] };
            // `any` brings in every sub-faction's units, wherever it's loaded from
            borrowedSlot(set).units = {
                unitIds: ['squad', 'veteran-squad', 'militia', 'constructs'],
            };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json specialRules/construct-handler/slots/0: unknown unit 'squad'",
            "error sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0: unknown unit 'constructs'",
        ]);
    });

    it('reports unknown factions and sub-factions, with hints', async () => {
        const issues = await issuesAfter((set) => {
            handlerSlot(set).source = { faction: 'clockwork-guil' };
            borrowedSlot(set).source = {
                faction: 'field-army',
                subFactions: ['veterans', 'irregular'],
            };
            fieldArmy(set).groups['armoured-spearhead'].slots[1].source = {
                faction: 'field-army',
                subFactions: ['veterans'],
            };
        });
        assert.deepEqual(issues, [
            // the spearhead's slot still names a Clockwork Guild unit
            "error factions/field-army.json groups/armoured-spearhead/slots/1: unknown unit 'battle-construct'",
            "error factions/field-army.json specialRules/construct-handler/slots/0/source: unknown faction 'clockwork-guil' (did you mean 'clockwork-guild'?)",
            "error sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0/source: 'field-army' has no sub-faction 'irregular' (did you mean 'irregulars'?)",
        ]);
    });

    it("checks a slot's roles, exclusions and effects", async () => {
        const issues = await issuesAfter((set) => {
            const slot = handlerSlot(set);
            slot.roleChoices = [];
            slot.effects!.push({
                kind: 'specialRule',
                rule: { id: 'stubborn' },
            });
            borrowedSlot(set).units = {
                exclude: [{ unitIds: ['general'], traits: ['Veteranz'] }],
            };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json specialRules/construct-handler/slots/0: a slot needs at least one role',
            "error factions/field-army.json specialRules/construct-handler/slots/0/effects/1: unknown special rule 'stubborn'",
            "warning sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0/exclude/0: no unit has or is given the trait 'Veteranz' (did you mean 'veterans'?)",
        ]);
    });

    it('knows traits given to units in sourced slots', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'irregulars').when = {
                if: 'main.has(trait:bonded-constructs) or main.has(trait:spearhead)',
                message: 'Only alongside bonded constructs',
            };
        });
        assert.deepEqual(issues, []);
    });
});

describe('composition blocks that replace models', () => {
    const sapperTeam = (set: GameDataSet) =>
        set.factions[0].data.units['sapper-team'];

    it('accepts a replacement that keeps the unit its size', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('checks the target block and profile', async () => {
        const issues = await issuesAfter((set) => {
            const [sapper, foreman] = sapperTeam(set).composition!;
            foreman.replaces = { block: 'sappers', profile: 'sapper' };
            sapper.id = 'sapper';
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/sapper-team/composition/foreman/replaces: unknown block 'sappers'",
        ]);

        const profile = await issuesAfter((set) => {
            sapperTeam(set).composition![1].replaces!.profile = 'foreman';
        });
        assert.deepEqual(profile, [
            "error factions/field-army.json units/sapper-team/composition/foreman/replaces: block 'sapper' has no profile 'foreman'",
        ]);
    });

    it('does not let blocks replace more models than the target holds', async () => {
        const issues = await issuesAfter((set) => {
            sapperTeam(set).composition![1].max = 5;
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/sapper-team/composition/sapper: blocks replacing 'sapper' can take 5 models, but 'sapper' holds only 4 at its min",
        ]);
    });

    it('counts a compulsory replacement in the model count', async () => {
        const issues = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition![1].min = 1;
        });
        assert.deepEqual(issues, []);

        const wrong = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition![1].min = 1;
            unit.modelCount = 5;
        });
        assert.deepEqual(wrong, [
            "error factions/field-army.json units/sapper-team/modelCount: modelCount is 5, but the composition's blocks at their min hold 4 models",
        ]);
    });

    it('does not chain replacements', async () => {
        const issues = await issuesAfter((set) => {
            const unit = sapperTeam(set);
            unit.composition!.push({
                id: 'champion',
                profiles: { sapper: 1 },
                min: 0,
                max: 1,
                cost: { points: 5 },
                replaces: { block: 'foreman', profile: 'foreman' },
            });
        });
        assert.ok(
            issues.some((i) =>
                i.includes(
                    "block 'foreman' itself replaces another block's models"
                )
            )
        );
    });
});

describe('composition blocks with an expression max', () => {
    const pioneers = (set: GameDataSet) =>
        set.factions[0].data.units['pioneer-squad'];
    const at = 'factions/field-army.json units/pioneer-squad/composition';

    it('accepts a live max on a block that replaces models', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('checks the expression in the unit scopes', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![1].max = 'option.picks()';
        });
        assert.equal(issues.length, 1);
        assert.match(
            issues[0],
            /^error .*pioneer-chief\/max: 'option' isn't available here/
        );
    });

    it('needs a cost', async () => {
        const issues = await issuesAfter((set) => {
            delete pioneers(set).composition![1].cost;
        });
        assert.deepEqual(issues, [
            `error ${at}/pioneer-chief: a block whose max is an expression can add copies, so it needs a cost per copy`,
        ]);
    });

    it('lets only a replacing block read unit.models()', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![0].max = '5 + floor(unit.models() / 2)';
        });
        assert.deepEqual(issues, [
            `error ${at}/pioneer/max: this block adds models, so its own copies change unit.models(); only a block that replaces models (\`replaces\`) may read it in its max`,
        ]);
    });

    it('allows a live max on a block that adds models when it reads something else', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![0].max =
                '5 + 5 * min(root.count(role:support), 2)';
        });
        assert.deepEqual(issues, []);
    });

    it('checks the max at the size as bought against min', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![1].min = 2;
        });
        assert.deepEqual(issues, [
            `error ${at}/pioneer-chief/max: at the unit's size as bought (5 models) this max is 1, below the block's min 2`,
        ]);
    });

    it('warns about a max that never lets the block grow, counting a negative result as 0', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![1].max = 'floor(unit.models() / 5) - 3';
        });
        assert.deepEqual(issues, [
            `warning ${at}/pioneer-chief/max: this max is never above min 0 at any size the unit can have (5–15 models), so the block never grows`,
        ]);
    });

    it('does not let blocks replace more models than the target holds at any size', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![1].max = 'unit.models() + 1';
        });
        assert.deepEqual(issues, [
            `error ${at}/pioneer: blocks replacing 'pioneer' can take 6 models when the unit has 5, but 'pioneer' may then hold only 5`,
        ]);

        // every model replaced is fine: the target grows with the unit
        const all = await issuesAfter((set) => {
            pioneers(set).composition![1].max = 'unit.models()';
        });
        assert.deepEqual(all, []);
    });

    it('counts the other blocks that add models as grown first', async () => {
        const issues = await issuesAfter((set) => {
            const unit = pioneers(set);
            unit.profiles.push({ ...unit.profiles[0], id: 'hauler' });
            unit.composition!.push({
                id: 'hauler',
                profiles: { hauler: 1 },
                min: 0,
                max: 10,
                cost: { points: 5 },
            });
            unit.composition![1].max = 'floor(unit.models() / 2)';
        });
        // at 25 models the Pioneers may still be only 5 (10 Haulers), and 12 > 5
        assert.deepEqual(issues, [
            `error ${at}/pioneer: blocks replacing 'pioneer' can take 6 models when the unit has 12, but 'pioneer' may then hold only 5`,
        ]);
    });

    it('leaves a max that reads the list to the app', async () => {
        const issues = await issuesAfter((set) => {
            pioneers(set).composition![1].max = '20 * list.count(role:support)';
        });
        assert.deepEqual(issues, []);
    });
});

describe('slot option units', () => {
    it('checks the selector', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.slotOptions!['veteran-officer'].units = {
                roles: ['offcer'],
            };
        });
        assert.deepEqual(issues, [
            "error game.json slotOptions/veteran-officer/units: unknown role 'offcer'",
        ]);
    });
});

describe('faction and sub-faction list rules', () => {
    const rules = (set: GameDataSet) => set.factions[0].data.listRules!;

    it('checks a group-scope condition with the group scope available', async () => {
        const issues = await issuesAfter((set) => {
            const rule = rules(set)['vehicles-in-reserve'];
            if (rule.kind === 'expression') rule.groupTypes = ['reserv'];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json listRules/vehicles-in-reserve: unknown group type 'reserv'",
        ]);
    });

    it('does not allow the group scope in a list-scope rule', async () => {
        const issues = await issuesAfter((set) => {
            const rule = rules(set)['vehicles-in-reserve'];
            if (rule.kind === 'expression') delete rule.scope;
        });
        assert.deepEqual(
            [
                ...new Set(
                    issues.map((i) => i.split(': ').slice(1).join(': '))
                ),
            ].sort(),
            [
                "'group' isn't available here (allowed: list, main)",
                'groupTypes only applies to a rule with scope "group"',
            ]
        );
    });

    it('warns when a faction rule hides the game rule of the same id', async () => {
        const issues = await issuesAfter((set) => {
            rules(set)['heavy-cap'] = set.game.data.listRules!['heavy-cap'];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json listRules/heavy-cap: hides the game's listRules 'heavy-cap'",
        ]);
    });

    it('needs a declared override to replace a faction rule', async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').listRules = {
                'vehicles-in-reserve': rules(set)['vehicles-in-reserve'],
            };
        });
        assert.deepEqual(issues, [
            "error sub-factions/veterans.json listRules/vehicles-in-reserve: collides with the parent's listRules 'vehicles-in-reserve'; list it in overrides if that's intended",
        ]);

        const allowed = await issuesAfter((set) => {
            const veterans = sub(set, 'veterans');
            veterans.listRules = {
                'vehicles-in-reserve': rules(set)['vehicles-in-reserve'],
            };
            veterans.overrides!.push({
                kind: 'listRules',
                id: 'vehicles-in-reserve',
            });
        });
        assert.deepEqual(allowed, []);
    });
});

describe('perModel count', () => {
    const sidearm = (set: GameDataSet) =>
        set.factions[0].data.units['squad'].upgrades!['trooper-sidearm'];
    const squads = (set: GameDataSet) =>
        set.factions[0].data.units['squad'].upgrades!['squad-options'];
    const at =
        'factions/field-army.json units/squad/upgrades/trooper-sidearm/perModel';

    it('accepts the example, two picks per five models', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('accepts one-in-x without count', async () => {
        const issues = await issuesAfter((set) => {
            delete sidearm(set).perModel.count;
        });
        assert.deepEqual(issues, []);
    });

    for (const count of [0, -2, 1.5]) {
        it(`rejects count ${count}`, async () => {
            const issues = await issuesAfter((set) => {
                sidearm(set).perModel.count = count;
            });
            assert.deepEqual(issues, [
                `error ${at}: count must be a whole number of at least 1, not ${count}`,
            ]);
        });
    }

    it('warns that count 1 is the default', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).perModel.count = 1;
        });
        assert.deepEqual(issues, [
            `warning ${at}: count 1 is the default for one-in-x; leave it out`,
        ]);
    });

    it('rejects count on other types, pointing multiple and single at max', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).perModel = { type: 'multiple', count: 2 };
            squads(set).perModel = { type: 'some', count: 2 };
        });
        assert.deepEqual(issues, [
            `error ${at}: count is only read for perModel.type 'one-in-x', not 'multiple'; did you mean perModel.max?`,
            "error factions/field-army.json units/squad/upgrades/squad-options/perModel: count is only read for perModel.type 'one-in-x', not 'some'",
        ]);
    });

    it('rejects count on every', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).perModel = { type: 'every', count: 3 };
        });
        assert.deepEqual(issues, [
            `error ${at}: count is only read for perModel.type 'one-in-x', not 'every'`,
        ]);
    });
});

describe('upgrade swapFrom', () => {
    const sidearm = (set: GameDataSet) =>
        set.factions[0].data.units['squad'].upgrades!['trooper-sidearm'];

    it('accepts the example, which swaps the trooper rifle for a shared list', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('reports unknown gear and a non-positive count', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).swapFrom = { kind: 'weapon', id: 'rifel', count: 0 };
        });
        assert.ok(
            issues.some((i) => i.endsWith("swapFrom: unknown weapon 'rifel'"))
        );
        assert.ok(
            issues.some((i) =>
                i.endsWith('swapFrom: count must be a positive number')
            )
        );
    });

    it('warns when the unit does not hold the gear', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).swapFrom = { kind: 'weapon', id: 'cannon' };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/upgrades/trooper-sidearm/swapFrom: the unit doesn't hold weapon 'cannon' by default on 'trooper', so there is nothing to take off",
        ]);
    });

    it('warns when the only option is the default', async () => {
        const issues = await issuesAfter((set) => {
            sidearm(set).options = { none: sidearm(set).options['none'] };
            delete sidearm(set).gearNote;
        });
        assert.deepEqual(issues, [
            'warning factions/field-army.json units/squad/upgrades/trooper-sidearm/swapFrom: every option is the default, so nothing is ever swapped',
        ]);
    });

    const captainAxe = (set: GameDataSet) =>
        set.factions[0].data.units['captain'].upgrades!['captain-axe'];

    it('does not warn about gear an earlier pick gives when restrictions.required names it', async () => {
        // the example's captain-axe swaps twin blades, which only captain-blades gives
        assert.deepEqual(
            await issuesAfter((set) => {
                captainAxe(set).restrictions!.requiredAnd = false;
            }),
            []
        );
    });

    it('still warns when nothing names the gear', async () => {
        const issues = await issuesAfter((set) => {
            captainAxe(set).restrictions!.required = [
                { kind: 'weapon', id: 'rifle' },
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/captain/upgrades/captain-axe/swapFrom: the unit doesn't hold weapon 'twin-blades' by default, so there is nothing to take off",
        ]);
        assert.deepEqual(
            await issuesAfter((set) => {
                delete captainAxe(set).restrictions;
            }),
            [
                "warning factions/field-army.json units/captain/upgrades/captain-axe/swapFrom: the unit doesn't hold weapon 'twin-blades' by default, so there is nothing to take off",
            ]
        );
    });
});

describe('gear notes', () => {
    const walker = (set: GameDataSet) => set.factions[0].data.units['walker'];
    const at = 'factions/field-army.json units/walker';

    it('accepts the example: a default gear note and an upgrade note covering a shared list', async () => {
        // trooper-sidearm's only gear comes from the shared sidearms list
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('warns about an empty note', async () => {
        const issues = await issuesAfter((set) => {
            walker(set).defaultGear![0].note = ' ';
            walker(set).upgrades!['fittings'].gearNote = '';
        });
        assert.deepEqual(issues, [
            `warning ${at}/defaultGear/0/note: the note is empty, so nothing is shown; write one or leave it out`,
            `warning ${at}/upgrades/fittings/gearNote: the note is empty, so nothing is shown; write one or leave it out`,
        ]);
    });

    it('warns about an upgrade note when no option gives gear', async () => {
        const issues = await issuesAfter((set) => {
            const fittings = walker(set).upgrades!['fittings'];
            fittings.gearNote = 'Turret mounted';
            delete fittings.options['mounted-cannon'];
        });
        assert.deepEqual(issues, [
            `warning ${at}/upgrades/fittings/gearNote: none of its options give gear, so the note is never shown`,
        ]);
    });

    it('counts swaps as giving gear', async () => {
        const issues = await issuesAfter((set) => {
            set.factions[0].data.units['captain'].upgrades![
                'captain-blades'
            ].gearNote = 'Off hand';
        });
        assert.deepEqual(issues, []);
    });
});

describe('option swaps', () => {
    const blades = (set: GameDataSet) => {
        const option =
            set.factions[0].data.units['captain'].upgrades!['captain-blades']
                .options['twin-blades'];
        assert.ok(!('target' in option));
        return option.swaps![0];
    };
    const at =
        'factions/field-army.json units/captain/upgrades/captain-blades/options/twin-blades/swaps/0';

    it('accepts a single from and a from list (the example has both)', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
        assert.deepEqual(
            await issuesAfter((set) => {
                blades(set).from = { kind: 'weapon', id: 'rifle' };
            }),
            []
        );
    });

    it('checks every gear in a from list', async () => {
        const issues = await issuesAfter((set) => {
            blades(set).from = [
                { kind: 'weapon', id: 'rifle' },
                { kind: 'weapon', id: 'knif' },
                { kind: 'equipment', id: 'rifle' },
            ];
        });
        assert.deepEqual(issues, [
            `error ${at}: unknown weapon 'knif'`,
            `error ${at}: unknown equipment 'rifle'`,
        ]);
    });

    it('reports an empty from list', async () => {
        const issues = await issuesAfter((set) => {
            blades(set).from = [];
        });
        assert.deepEqual(issues, [
            `error ${at}/from: a from list needs at least one gear`,
        ]);
    });

    it('reports gear listed twice in a from list', async () => {
        const issues = await issuesAfter((set) => {
            blades(set).from = [
                { kind: 'weapon', id: 'rifle' },
                { kind: 'weapon', id: 'knife' },
                { kind: 'weapon', id: 'rifle' },
            ];
        });
        assert.deepEqual(issues, [
            `error ${at}/from: weapon 'rifle' is listed more than once; a pick takes one of each`,
        ]);
    });
});

describe('upgrade mirrorOf', () => {
    const team = (set: GameDataSet) =>
        set.factions[0].data.units['sapper-team'];
    const foreman = (set: GameDataSet) => team(set).upgrades!['foreman-tools'];
    const sapper = (set: GameDataSet) => team(set).upgrades!['sapper-tools'];
    const at =
        'factions/field-army.json units/sapper-team/upgrades/foreman-tools';

    it("accepts the example, whose Foreman copies the Sappers' sidearm", async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('accepts own options matching options a reference pulls in', async () => {
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).perModel = { type: 'single' };
                foreman(set).options = {
                    knife: {
                        id: 'knife',
                        name: 'Knife',
                        cost: { points: 3 },
                        weaponRefs: ['knife'],
                    },
                    axe: {
                        id: 'axe',
                        name: 'Axe',
                        cost: { points: 6 },
                        weaponRefs: ['axe'],
                    },
                };
            }),
            []
        );
    });

    it('reports an unknown source, with a hint, and a mirror of itself', async () => {
        const unknown = await issuesAfter((set) => {
            foreman(set).mirrorOf = 'sapper-tool';
        });
        assert.equal(unknown.length, 1);
        assert.ok(
            unknown[0].startsWith(
                `error ${at}/mirrorOf: unknown sibling upgrade 'sapper-tool'`
            )
        );
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).mirrorOf = 'foreman-tools';
            }),
            [`error ${at}/mirrorOf: an upgrade can't mirror itself`]
        );
    });

    it('does not chain mirrors', async () => {
        const issues = await issuesAfter((set) => {
            sapper(set).mirrorOf = 'foreman-tools';
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/sapper-team/upgrades/sapper-tools/mirrorOf: 'foreman-tools' mirrors 'sapper-tools' itself; mirror 'sapper-tools' directly",
            `error ${at}/mirrorOf: 'sapper-tools' mirrors 'foreman-tools' itself; mirror 'foreman-tools' directly`,
        ]);
    });

    it('needs another profile', async () => {
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).profileId = 'sapper';
            }),
            [
                `error ${at}/mirrorOf: 'sapper-tools' is on the same profile (profile 'sapper'); a mirror must be on another profile`,
            ]
        );
        assert.deepEqual(
            await issuesAfter((set) => {
                delete foreman(set).profileId;
                delete sapper(set).profileId;
            }),
            [
                `error ${at}/mirrorOf: 'sapper-tools' is on the same profile (the unit at large); a mirror must be on another profile`,
            ]
        );
    });

    it("needs the source's options under the same ids, and no others", async () => {
        const issues = await issuesAfter((set) => {
            foreman(set).options = {
                knife: {
                    id: 'knife',
                    name: 'Knife',
                    cost: { points: 2 },
                    weaponRefs: ['knife'],
                },
                blades: {
                    id: 'blades',
                    name: 'Twin blades',
                    cost: { points: 8 },
                    weaponRefs: ['twin-blades'],
                },
            };
        });
        assert.deepEqual(issues, [
            `error ${at}/options: doesn't offer 'axe', which 'sapper-tools' offers; a mirror needs every option of its source, under the same id`,
            `error ${at}/options: offers 'blades', which 'sapper-tools' doesn't; a mirror only ever takes its source's pick`,
        ]);
    });

    it('needs the same default', async () => {
        assert.deepEqual(
            await issuesAfter((set) => {
                sapper(set).default = 'knife';
            }),
            [
                `error ${at}/default: default none differs from 'sapper-tools''s ('knife'); a mirror and its source need the same default`,
            ]
        );
        assert.deepEqual(
            await issuesAfter((set) => {
                sapper(set).default = 'knife';
                foreman(set).default = 'axe';
            }),
            [
                `error ${at}/default: default 'axe' differs from 'sapper-tools''s ('knife'); a mirror and its source need the same default`,
            ]
        );
        assert.deepEqual(
            await issuesAfter((set) => {
                sapper(set).default = 'knife';
                foreman(set).default = 'knife';
            }),
            []
        );
    });

    it("allows only 'every' and 'single'", async () => {
        for (const type of ['some', 'multiple', 'one-in-x'] as const) {
            const issues = await issuesAfter((set) => {
                foreman(set).perModel = { type, everyX: 5 };
            });
            assert.deepEqual(issues, [
                `error ${at}/perModel: a mirror's perModel.type must be 'every' or 'single', not '${type}': its amount follows its own profile, so it can't be a number of picks the player chooses`,
            ]);
        }
    });

    it('warns when multiSelect differs from the source', async () => {
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).multiSelect = true;
            }),
            [
                `warning ${at}/multiSelect: multiSelect differs from 'sapper-tools''s; a mirror takes every option its source picks, so the two should match`,
            ]
        );
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).multiSelect = true;
                sapper(set).multiSelect = true;
            }),
            []
        );
    });

    it('reports a mirror and its source replacing each other', async () => {
        const issues = await issuesAfter((set) => {
            foreman(set).replaces = ['sapper-tools'];
            sapper(set).replaces = ['foreman-tools'];
        });
        assert.deepEqual(issues, [
            `error ${at}/replaces: replaces 'sapper-tools', the upgrade it mirrors`,
            `error ${at}/mirrorOf: 'sapper-tools' replaces this upgrade, so picking it would remove its own mirror`,
        ]);
    });

    it('warns about restrictions and limitBy that can block the copy', async () => {
        const issues = await issuesAfter((set) => {
            foreman(set).restrictions = {
                exclusions: [{ kind: 'weapon', id: 'twin-blades' }],
                required: [],
                requiredAnd: false,
            };
            foreman(set).limitBy = [{ kind: 'weapon', id: 'rifle', count: 1 }];
        });
        assert.deepEqual(issues, [
            `warning ${at}/restrictions: restrictions on a mirror can stop it copying 'sapper-tools''s pick, leaving its models without the same option`,
            `warning ${at}/limitBy: limitBy on a mirror can stop it copying 'sapper-tools''s pick, leaving its models without the same option`,
        ]);
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).options['sidearms'] = {
                    id: 'sidearms',
                    target: 'sidearms',
                    restrictions: {
                        exclusions: [],
                        required: [{ kind: 'weapon', id: 'rifle' }],
                        requiredAnd: false,
                    },
                };
            }),
            [
                `warning ${at}/options: restrictions on a mirror can stop it copying 'sapper-tools''s pick, leaving its models without the same option`,
            ]
        );
        // empty restrictions are fine
        assert.deepEqual(
            await issuesAfter((set) => {
                foreman(set).restrictions = {
                    exclusions: [],
                    required: [],
                    requiredAnd: false,
                };
            }),
            []
        );
    });
});

describe('sub-types', () => {
    const fieldArmy = (set: GameDataSet) => set.factions[0].data;
    const squad = (set: GameDataSet) => fieldArmy(set).units['squad'];
    const grenadesWhen = (set: GameDataSet, source: string) => {
        squad(set).upgrades!['squad-options'].options['grenades'] = {
            id: 'grenades',
            name: 'Grenades',
            cost: { points: 5 },
            when: { if: source, message: 'Not allowed' },
        };
    };

    it('warns on unit and profile tags that match no sub-type, with a hint', async () => {
        const issues = await issuesAfter((set) => {
            squad(set).tags = ['Lin'];
            squad(set).profiles[1].tags = ['Sergeant', 'Drummer'];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/tags: the tag 'Lin' matches no sub-type (did you mean 'line'?)",
            "warning factions/field-army.json units/squad/profiles/sergeant/tags: the tag 'Drummer' matches no sub-type",
        ]);
    });

    it('matches tags case-insensitively, by name or by id', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.subTypes!['gun-crew'] = {
                id: 'gun-crew',
                name: 'Gun-crew',
            };
            set.game.data.subTypes!['escort'] = {
                id: 'escort',
                name: 'Escort Party',
            };
            squad(set).tags = ['LINE', 'gun crew', 'escort party'];
            squad(set).profiles[1].tags = ['sergeant', 'Escort'];
        });
        assert.deepEqual(issues, []);
    });

    it('checks the sub-type records themselves', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.subTypes!['line'].id = 'rank';
        });
        assert.deepEqual(issues, [
            "error game.json subTypes/line: id is 'rank', but the key is 'line'",
        ]);
    });

    it('warns on profile filter values that are neither a unit type nor a sub-type', async () => {
        const issues = await issuesAfter((set) => {
            const options = squad(set).upgrades!['heavy-weapons'];
            options.limitBy![0].profiles = {
                anyOf: ['Infantry', 'line'],
                noneOf: ['Sargeant', 'trooper'],
            };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/upgrades/heavy-weapons/limitBy/0/profiles: 'Sargeant' matches no unit type or sub-type (did you mean 'sergeant'?)",
            "warning factions/field-army.json units/squad/upgrades/heavy-weapons/limitBy/0/profiles: 'trooper' matches no unit type or sub-type",
        ]);
    });

    it('warns on tag: references to no sub-type, and knows sub-types no unit here has', async () => {
        assert.deepEqual(
            await issuesAfter((set) =>
                grenadesWhen(set, 'unit.is(tag:elite) or unit.is(tag:sergant)')
            ),
            [
                "warning factions/field-army.json units/squad/upgrades/squad-options/options/grenades/when: the game defines no sub-type 'sergant' (did you mean 'sergeant'?)",
            ]
        );
    });

    it('changes nothing when the game defines no sub-types', async () => {
        const issues = await issuesAfter((set) => {
            delete set.game.data.subTypes;
            squad(set).tags = ['Anything'];
            squad(set).upgrades!['heavy-weapons'].limitBy![0].profiles = {
                anyOf: ['trooper'],
            };
            grenadesWhen(set, 'unit.is(tag:anything) or unit.is(tag:elite)');
        });
        // only the existing check: no unit in this faction has `elite`
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/upgrades/squad-options/options/grenades/when: no unit or profile has the tag 'elite'",
        ]);
    });
});

describe('list choice value effects', () => {
    const values = (set: GameDataSet) =>
        set.game.data.choices!['stance'].values;
    const at = 'game.json choices/stance/values';

    it('accepts the example: a trait for line troops, a stat change and a conditional trait', async () => {
        assert.deepEqual(await issuesAfter(() => {}), []);
    });

    it('checks the effects like group effects', async () => {
        const issues = await issuesAfter((set) => {
            values(set)['offensive'].effects = [
                {
                    kind: 'stat',
                    changes: [{ stat: 'moral', op: 'add', value: 1 }],
                },
                { kind: 'specialRule', rule: { id: 'disciplind' } },
                { kind: 'trait' },
                {
                    kind: 'trait',
                    add: ['Zealous'],
                    when: {
                        if: 'profile.is(tag:sergeant)',
                        message: 'Sergeants only',
                    },
                },
                {
                    kind: 'stat',
                    changes: [{ stat: 'morale', op: 'add', value: 1 }],
                    when: { if: 'choice(stance) == offensiv', message: '' },
                },
            ];
        });
        assert.deepEqual(issues, [
            `error ${at}/offensive/effects/0: unknown stat 'moral'`,
            `error ${at}/offensive/effects/1: unknown special rule 'disciplind'`,
            `error ${at}/offensive/effects/2: a trait effect needs add, remove or replace`,
            `error ${at}/offensive/effects/3/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)`,
            `error ${at}/offensive/effects/4/when: a condition needs a message for players`,
            `error ${at}/offensive/effects/4/when: 'offensiv' isn't a value of stance (did you mean 'offensive'?)`,
        ]);
    });

    it('checks the units selector', async () => {
        const issues = await issuesAfter((set) => {
            values(set)['offensive'].units = '@line-trops';
            values(set)['defensive'].units = {
                roles: ['trop'],
                traits: ['Nobody Has This'],
            };
        });
        assert.deepEqual(issues, [
            `error ${at}/offensive/units: unknown selector 'line-trops'`,
            `error ${at}/defensive/units: unknown role 'trop'`,
            `warning ${at}/defensive/units: no unit has or is given the trait 'Nobody Has This'`,
        ]);
    });

    it('warns about units without effects', async () => {
        const issues = await issuesAfter((set) => {
            delete values(set)['offensive'].effects;
        });
        assert.deepEqual(issues, [
            `warning ${at}/offensive/units: units has no effect without effects`,
        ]);
    });

    it('makes the traits it gives known to selectors and trait: references', async () => {
        const issues = await issuesAfter((set) => {
            set.factions[0].data.selectors!['assault'] = {
                id: 'assault',
                name: 'Assault troops',
                match: { traits: ['assault troops', 'Dug In'] },
            };
        });
        assert.deepEqual(issues, []);
    });
});

describe('empty records and mismatched values', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!;
    const about = (issues: Array<string>, text: string) =>
        issues.filter((i) => i.includes(text));

    it('warns about a unit with no profiles', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).data.units['medic'].profiles = [];
        });
        assert.deepEqual(about(issues, 'no profiles'), [
            'warning factions/field-army.json units/medic: has no profiles',
        ]);
    });

    it('warns about an upgrade with no options', async () => {
        const issues = await issuesAfter((set) => {
            const upgrade =
                fieldArmy(set).data.units['squad'].upgrades!['squad-options'];
            upgrade.options = {};
            delete upgrade.default;
        });
        assert.deepEqual(about(issues, 'no options'), [
            'warning factions/field-army.json units/squad/upgrades/squad-options: has no options',
        ]);
    });

    it('warns about a stat effect with no changes', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.choices!['stance'].values['offensive'].effects = [
                { kind: 'stat', changes: [] },
            ];
        });
        assert.deepEqual(issues, [
            'warning game.json choices/stance/values/offensive/effects/0: a stat effect with no changes',
        ]);
    });

    it("warns about an 'add' on a stat no template marks numeric", async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.choices!['stance'].values['offensive'].effects = [
                {
                    kind: 'stat',
                    changes: [
                        { stat: 'save', op: 'add', value: -1 },
                        { stat: 'save', op: 'set', value: '3+' },
                        { stat: 'move', op: 'add', value: 1 },
                    ],
                },
            ];
        });
        assert.deepEqual(issues, [
            "warning game.json choices/stance/values/offensive/effects/0: 'save' isn't a numeric stat, so 'add' can't shift it",
        ]);
    });

    it('warns about a value given to a rule that takes none', async () => {
        const issues = await issuesAfter((set) => {
            const [profile] = fieldArmy(set).data.units['squad'].profiles;
            profile.specialRules = [
                { id: 'fearless', value: '2' },
                { id: 'armoured', value: '2' },
                { id: 'fearless' },
            ];
        });
        assert.deepEqual(about(issues, 'value'), [
            "warning factions/field-army.json units/squad/profiles/trooper: 'fearless' is given a value but takes none",
        ]);
    });

    it('warns about two factions with one id', async () => {
        const issues = await issuesAfter((set) => {
            const copy = structuredClone(fieldArmy(set));
            copy.file = 'factions/field-army-copy.json';
            set.factions.push(copy);
        });
        assert.deepEqual(about(issues, 'is also in'), [
            "warning factions/field-army-copy.json id: the faction id 'field-army' is also in factions/field-army.json",
        ]);
    });

    it('warns about two sub-factions of one faction with one id', async () => {
        const issues = await issuesAfter((set) => {
            const copy = structuredClone(
                set.subFactions.find((s) => s.data.id === 'veterans')!
            );
            copy.file = 'sub-factions/veterans-copy.json';
            set.subFactions.push(copy);
        });
        assert.deepEqual(about(issues, 'is also in'), [
            "warning sub-factions/veterans-copy.json id: the sub-faction id 'veterans' of 'field-army' is also in sub-factions/veterans.json",
        ]);
    });

    it('lets sub-factions of different factions share an id', async () => {
        const issues = await issuesAfter((set) => {
            const copy = structuredClone(
                set.subFactions.find((s) => s.data.id === 'veterans')!
            );
            copy.file = 'sub-factions/guild-veterans.json';
            copy.data.parent.faction = 'clockwork-guild';
            set.subFactions.push(copy);
        });
        assert.deepEqual(about(issues, 'is also in'), []);
    });
});
