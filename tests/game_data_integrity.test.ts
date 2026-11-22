import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { formatDiagnostic } from '../src/expressions/diagnostics';
import { readSource } from '../src/game_data/read_source';
import { GroupTypeSchema } from '../src/game_data/schema';
import { slotSources } from '../src/game_data/slot_sources';
import type { ModelEffect } from '../src/types';
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

describe('equipment with a weapon profile', () => {
    const grenades = (set: GameDataSet) =>
        set.factions[0].data.equipment['grenades'];

    it("checks the profiles as a weapon's", async () => {
        const issues = await issuesAfter((set) => {
            const weapon = grenades(set).weapon!;
            weapon.profiles[0].stats = { range: '6"', attacks: '1' };
            weapon.profiles[0].specialRules = [{ id: 'armourd' }];
            weapon.profiles.push(
                {
                    name: 'Redundant',
                    template: 'ranged',
                    stats: weapon.profiles[0].stats,
                },
                { name: 'Unknown', template: 'mele', stats: {} }
            );
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json equipment/grenades/weapon/profiles/0: missing stats: damage',
            "warning factions/field-army.json equipment/grenades/weapon/profiles/1: the profile's template is the weapon's 'ranged' already; leave it out",
            'error factions/field-army.json equipment/grenades/weapon/profiles/1: missing stats: damage',
            "error factions/field-army.json equipment/grenades/weapon/profiles/2: unknown weapon template 'mele'",
            "error factions/field-army.json equipment/grenades/weapon/profiles/0: unknown special rule 'armourd'",
        ]);
    });

    it('reports an unknown template and warns on no profiles', async () => {
        const issues = await issuesAfter((set) => {
            grenades(set).weapon = { template: 'thrown', profiles: [] };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json equipment/grenades/weapon: unknown weapon template 'thrown'",
            'warning factions/field-army.json equipment/grenades/weapon: has no profiles',
        ]);
    });

    it('is not a weapon the unit holds', async () => {
        const issues = await issuesAfter((set) => {
            set.factions[0].data.units['squad'].defaultGear!.push({
                kind: 'weapon',
                id: 'grenades',
            });
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json units/squad/defaultGear: unknown weapon 'grenades'",
        ]);
    });

    it('warns about a weapon with the same id', async () => {
        const issues = await issuesAfter((set) => {
            const data = set.factions[0].data;
            data.weapons['grenades'] = {
                id: 'grenades',
                name: 'Grenades',
                template: 'ranged',
                profiles: grenades(set).weapon!.profiles,
            };
            sub(set, 'veterans').equipment!['rifle'] = {
                id: 'rifle',
                name: 'Rifle drill',
                text: 'Fires a rifle.',
                weapon: data.weapons['rifle'],
            };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json equipment/grenades/weapon: there is also a weapon 'grenades', held and counted apart from this profile; if it is the same attack, remove the weapon and give units the equipment instead",
            "warning sub-factions/veterans.json equipment/rifle/weapon: there is also a weapon 'rifle', held and counted apart from this profile; if it is the same attack, remove the weapon and give units the equipment instead",
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

    it('lets a trait effect with profiles read the profile in its condition', async () => {
        const issues = await issuesAfter((set) => {
            const gunLine = set.factions[0].data.groups['gun-line'];
            gunLine.effects = [
                {
                    kind: 'trait',
                    profiles: { anyOf: ['sergeant'] },
                    add: ['Promoted'],
                    when: {
                        if: 'profile.is(trait:shield)',
                        message: 'Shield-bearing sergeants only',
                    },
                },
                {
                    kind: 'trait',
                    profiles: { anyOf: ['sergent'] },
                    replace: { from: ['Disciplined'], to: 'Veterans' },
                },
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line/effects/1/profiles: 'sergent' matches no unit type or sub-type (did you mean 'sergeant'?)",
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
            "warning sub-factions/veterans.json unitModifiers/veteran-corps: the game defines no trait 'Disiplined' (did you mean 'disciplined'?)",
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
            "warning sub-factions/veterans.json slotOptions/borrowed-specialists/effects/0/exclude/0: the game defines no trait 'Veteranz' (did you mean 'veterans'?)",
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

describe('profile filters', () => {
    it('warns about an empty anyOf or noneOf, with or without game sub-types', async () => {
        const issues = await issuesAfter((set) => {
            delete set.game.data.subTypes;
            const gunLine = set.factions[0].data.groups['gun-line'];
            gunLine.effects = [
                {
                    kind: 'trait',
                    profiles: { anyOf: [] },
                    add: ['Promoted'],
                },
                {
                    kind: 'stat',
                    profiles: { noneOf: [] },
                    changes: [{ stat: 'move', op: 'add', value: 1 }],
                },
            ];
            gunLine.slots[0].units = { profiles: { anyOf: [], noneOf: [] } };
        });
        assert.deepEqual(issues, [
            'warning factions/field-army.json groups/gun-line/slots/0/units/profiles: an empty anyOf matches no profile; leave it out to pick every profile',
            'warning factions/field-army.json groups/gun-line/slots/0/units/profiles: an empty noneOf leaves no profile out; leave it out',
            'warning factions/field-army.json groups/gun-line/effects/0/profiles: an empty anyOf matches no profile; leave it out to pick every profile',
            'warning factions/field-army.json groups/gun-line/effects/1/profiles: an empty noneOf leaves no profile out; leave it out',
        ]);
    });
});

describe('slots filled from several factions', () => {
    const levy = (set: GameDataSet) =>
        set.factions[0].data.groups['mixed-levy'];
    const entries = (set: GameDataSet, slot: number) => {
        const source = levy(set).slots[slot].source;
        assert.ok(Array.isArray(source));
        return source;
    };

    it('reads one source or a list of them as a list', () => {
        assert.deepEqual(slotSources(undefined), []);
        assert.deepEqual(slotSources({ faction: 'field-army' }), [
            { faction: 'field-army' },
        ]);
        assert.deepEqual(
            slotSources([
                { faction: 'field-army' },
                { faction: 'clockwork-guild' },
            ]),
            [{ faction: 'field-army' }, { faction: 'clockwork-guild' }]
        );
    });

    it("resolves the slot's unitIds against every entry, and an entry's against its own", async () => {
        const issues = await issuesAfter((set) => {
            // a Field Army unit, a Clockwork Guild one and a sub-faction's are all offered
            levy(set).slots[0].units = {
                unitIds: [
                    'walker',
                    'battle-construct',
                    'veteran-squad',
                    'constructs',
                ],
            };
            // `walker` isn't a Clockwork Guild unit
            entries(set, 1)[1].units = {
                unitIds: ['siege-construct', 'walker'],
            };
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/mixed-levy/slots/0: unknown unit 'constructs'",
            "error factions/field-army.json groups/mixed-levy/slots/1/source/1: unknown unit 'walker'",
        ]);
    });

    it('warns when a slot unitIds entry names units of two entries', async () => {
        const issues = await issuesAfter((set) => {
            const guild = set.factions[1].data;
            guild.units['walker'] = {
                ...structuredClone(guild.units['battle-construct']),
                id: 'walker',
            };
            levy(set).slots[0].units = { unitIds: ['walker'] };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/mixed-levy/slots/0: 'walker' is a unit of 'field-army' and 'clockwork-guild'; any of them may fill the slot. To pick one, name it in that entry's `units` instead",
        ]);
    });

    it('reports a faction listed twice and unknown entries by their place', async () => {
        const issues = await issuesAfter((set) => {
            levy(set).slots[0].source = [
                { faction: 'field-army' },
                { faction: 'clockwork-guil' },
                { faction: 'field-army', subFactions: ['veterans'] },
            ];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/mixed-levy/slots/0/source/1: unknown faction 'clockwork-guil' (did you mean 'clockwork-guild'?)",
            "error factions/field-army.json groups/mixed-levy/slots/0/source/2: 'field-army' is listed twice; list each faction once, with every sub-faction it brings in",
        ]);
    });

    it("checks an entry's units given as a named selector", async () => {
        const issues = await issuesAfter((set) => {
            entries(set, 1)[0].units = '@squadz';
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/mixed-levy/slots/1/source/0: unknown selector 'squadz'",
        ]);
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

describe("a slot option's slot effects", () => {
    const extraSupport = (set: GameDataSet) =>
        set.game.data.slotOptions!['extra-support'];

    it('warns about more than one, suggesting count', async () => {
        const issues = await issuesAfter((set) => {
            const effects = extraSupport(set).effects!;
            effects.push({ kind: 'slot', roleChoices: ['support'] });
        });
        assert.deepEqual(issues, [
            'warning game.json slotOptions/extra-support/effects: has 2 slot effects; only the first is used. To add several slots, use one slot effect with `count`, e.g. `{ "kind": "slot", "roleChoices": [...], "count": 2 }`',
        ]);
    });

    it('takes one with a count', async () => {
        const issues = await issuesAfter((set) => {
            extraSupport(set).effects = [
                { kind: 'slot', roleChoices: ['support'], count: 3 },
            ];
        });
        assert.deepEqual(issues, []);
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
                foreman(set).perModel =
                    type === 'one-in-x' ? { type, everyX: 5 } : { type };
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
                    add: ['Dug In'],
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
            `warning ${at}/defensive/units: the game defines no trait 'Nobody Has This'`,
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

describe('a fixed min above a fixed max', () => {
    it('is reported on group types, groups, slot repeats and upgrades', async () => {
        const issues = await issuesAfter((set) => {
            const [typeId] = Object.keys(set.game.data.groupTypes);
            Object.assign(set.game.data.groupTypes[typeId], { min: 3, max: 1 });
            const faction = set.factions.find(
                (f) => f.data.id === 'field-army'
            )!.data;
            const [group] = Object.values(faction.groups!);
            Object.assign(group, { min: 2, max: 1 });
            group.slots[0].repeat = { min: 4, max: 2 };
            Object.assign(faction.units['squad'].upgrades!['trooper-sidearm'], {
                min: 2,
                max: 1,
            });
        });
        assert.deepEqual(
            issues
                .filter((i) => i.includes('is more than max'))
                .map((i) => i.replace(/^.*: /, '')),
            [
                'min 3 is more than max 1',
                'min 2 is more than max 1',
                'min 4 is more than max 2',
                'min 2 is more than max 1',
            ]
        );
    });

    it('is left alone when either is an expression', async () => {
        const issues = await issuesAfter((set) => {
            const [typeId] = Object.keys(set.game.data.groupTypes);
            Object.assign(set.game.data.groupTypes[typeId], {
                min: 3,
                max: 'list.count(*)',
            });
        });
        assert.deepEqual(
            issues.filter((i) => i.includes('is more than max')),
            []
        );
    });
});

describe('fields read under one setting only', () => {
    it('warns about resource fields of another scope', async () => {
        const issues = await issuesAfter((set) => {
            const resources = set.game.data.resources;
            const list = Object.values(resources).find(
                (r) => r.scope === 'list'
            )!;
            list.capacityStat = 'capacity';
            list.message = 'Too much';
            const contingent = Object.values(resources).find(
                (r) => r.scope === 'contingent'
            )!;
            contingent.defaultLimit = 3;
        });
        assert.deepEqual(
            issues.map((i) => i.replace(/^.*resources\/[a-z-]+\//, '')),
            [
                'capacityStat: capacityStat is only read for a unit resource, not a list one',
                'message: message is only read for a contingent resource, not a list one',
                'defaultLimit: defaultLimit is only read for a list resource, not a contingent one',
            ]
        );
    });

    for (const source of ['ally', 'any'] as const) {
        it(`warns about source '${source}' on a linked group type`, async () => {
            const issues = await issuesAfter((set) => {
                const linked = Object.values(set.game.data.groupTypes).find(
                    (t) => typeof t.contingent === 'object'
                )!;
                linked.source = source;
            });
            assert.equal(issues.length, 1);
            assert.match(
                issues[0],
                /^warning game\.json groupTypes\/[a-z-]+\/source: source is only read for a root group type/
            );
        });
    }

    it('warns about everyX on an upgrade that is not one-in-x', async () => {
        const issues = await issuesAfter((set) => {
            const squad = set.factions.find((f) => f.data.id === 'field-army')!
                .data.units['squad'];
            const upgrade = Object.values(squad.upgrades!).find(
                (u) => u.perModel.type !== 'one-in-x'
            )!;
            upgrade.perModel.everyX = 5;
        });
        assert.equal(issues.length, 1);
        assert.match(
            issues[0],
            /perModel\/everyX: everyX is only read for perModel\.type 'one-in-x', not '/
        );
    });
});

describe('root group type sources', () => {
    const rootType = {
        id: 'detachment',
        name: 'Detachment',
        contingent: 'root',
        max: 1,
    };

    it("accepts 'main', 'ally' and 'any', and nothing else", () => {
        for (const source of ['main', 'ally', 'any'])
            assert.ok(
                GroupTypeSchema.safeParse({ ...rootType, source }).success,
                source
            );
        assert.ok(GroupTypeSchema.safeParse(rootType).success);
        assert.ok(
            !GroupTypeSchema.safeParse({ ...rootType, source: 'own' }).success
        );
    });

    it("has an 'any' root type in the full example", async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const types = Object.values(set.game.data.groupTypes);
        assert.ok(
            types.some((t) => t.contingent === 'root' && t.source === 'any')
        );
    });

    it("doesn't start a list with a group of an 'any' root type", async () => {
        const issues = await issuesAfter((set) => {
            set.factions.find(
                (f) => f.data.id === 'field-army'
            )!.data.defaultGroup = 'heavy-detachment';
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json defaultGroup: 'heavy-detachment' isn't a group a list starts with (a root group type from the main faction)",
        ]);
    });
});

describe('the trait registry', () => {
    const squad = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data.units[
            'squad'
        ];

    it('accepts traits by name or id, in any case', async () => {
        const issues = await issuesAfter((set) => {
            squad(set).traits = ['field army', 'FIELD-ARMY', 'Dug In'];
        });
        assert.deepEqual(issues, []);
    });

    it('warns about a unit, profile or effect trait the game does not define', async () => {
        const issues = await issuesAfter((set) => {
            squad(set).traits = ['Field Army', 'Feild Army'];
            squad(set).profiles[0].traits = ['Sheild'];
            set.game.data.choices!['stance'].values['offensive'].effects = [
                {
                    kind: 'trait',
                    add: ['Dug Inn'],
                    remove: ['Spoter'],
                    replace: { from: ['Promotd'], to: 'Gun Lime' },
                },
            ];
        });
        assert.deepEqual(issues, [
            "warning game.json choices/stance/values/offensive/effects/0: the game defines no trait 'Dug Inn' (did you mean 'dug-in'?)",
            "warning game.json choices/stance/values/offensive/effects/0: the game defines no trait 'Spoter' (did you mean 'spotter'?)",
            "warning game.json choices/stance/values/offensive/effects/0: the game defines no trait 'Promotd' (did you mean 'promoted'?)",
            "warning game.json choices/stance/values/offensive/effects/0: the game defines no trait 'Gun Lime' (did you mean 'gun-line'?)",
            "warning factions/field-army.json units/squad/traits: the game defines no trait 'Feild Army' (did you mean 'field-army'?)",
            "warning factions/field-army.json units/squad/profiles/trooper/traits: the game defines no trait 'Sheild' (did you mean 'shield'?)",
        ]);
    });

    it('warns about a trait: reference the game does not define', async () => {
        const issues = await issuesAfter((set) => {
            squad(set).when = {
                if: 'unit.is(trait:feild-army)',
                message: 'Field Army only',
            };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json units/squad/when: the game defines no trait 'feild-army' (did you mean 'field-army'?)",
        ]);
    });

    it('checks trait ids against their keys', async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.traits!['spotter'].id = 'spoter';
        });
        assert.deepEqual(issues, [
            "error game.json traits/spotter: id is 'spoter', but the key is 'spotter'",
        ]);
    });

    it('without a registry, checks traits against the ones in use', async () => {
        const issues = await issuesAfter((set) => {
            delete set.game.data.traits;
            squad(set).traits = [...(squad(set).traits ?? []), 'Brand New'];
            set.factions[0].data.selectors!['fresh'] = {
                id: 'fresh',
                name: 'Fresh',
                match: { traits: ['Brand New', 'Nobody Has This'] },
            };
        });
        assert.deepEqual(
            issues.map((i) => i.replace(/^.*: /, '')),
            ["no unit has or is given the trait 'Nobody Has This'"]
        );
    });
});

describe('versions and version ranges', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;

    it("warns when a faction's range leaves out the game's version", async () => {
        const issues = await issuesAfter((set) => {
            set.game.data.version = '2.1.0';
        });
        // every faction of the game, the extension source's too
        assert.ok(issues.length >= 2);
        for (const issue of issues)
            assert.match(
                issue,
                /^warning factions\/[a-z-]+\.json game\/versions: the game 'sample-skirmish' is version 2\.1\.0, which '>=1\.0\.0 <2\.0\.0' leaves out$/
            );
    });

    it("warns when a sub-faction's range leaves out its parent's version", async () => {
        const issues = await issuesAfter((set) => {
            sub(set, 'veterans').parent.versions = '<1.0.0';
        });
        assert.deepEqual(issues, [
            "warning sub-factions/veterans.json parent/versions: the faction 'field-army' is version 1.0.0, which '<1.0.0' leaves out",
        ]);
    });

    it("warns about a range it can't read and a version that isn't one", async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).game.versions = 'any';
            sub(set, 'veterans').version = 'draft';
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json game/versions: 'any' can't be read as a version range like '>=1.2.0 <2.0.0'",
            "warning sub-factions/veterans.json version: 'draft' isn't a version number like 1.2.0, so version ranges can't be checked against it",
        ]);
    });
});

describe('slot tag effects and slot option categories', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;
    const tagEffect = {
        kind: 'slotTag' as const,
        add: ['prime'],
        categories: ['honour'],
    };

    it('has both in the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const veterans = sub(set, 'veterans');
        assert.ok(
            Object.values(veterans.unitModifiers ?? {}).some((m) =>
                m.actions.some((a) => a.kind === 'slotTag')
            )
        );
        assert.ok(
            Object.values(set.game.data.groups ?? {}).some((g) =>
                g.slots.some((s) => s.tagOptions)
            )
        );
        assert.ok(
            Object.values(set.game.data.slotOptions ?? {}).some(
                (o) => o.category
            )
        );
    });

    it('takes a slotTag effect on an upgrade option, a group, a slot and a list choice value', async () => {
        const issues = await issuesAfter((set) => {
            const faction = fieldArmy(set);
            const option = faction.units['squad'].upgrades!['squad-options']
                .options['banner'] as { effects?: Array<unknown> };
            option.effects = [...(option.effects ?? []), tagEffect];
            const group = faction.groups['gun-line'];
            group.effects = [...(group.effects ?? []), tagEffect];
            const slot = group.slots[0];
            slot.effects = [
                ...(slot.effects ?? []),
                {
                    ...tagEffect,
                    when: {
                        if: 'group.is(type:core) and unit.is(role:troop)',
                        message: 'Troops in a core formation',
                    },
                },
            ];
            const value = set.game.data.choices!['stance'].values['offensive'];
            value.effects = [...(value.effects ?? []), tagEffect];
        });
        assert.deepEqual(issues, []);
    });

    it('reports a tag the game does not declare and an empty add', async () => {
        const issues = await issuesAfter((set) => {
            const group = fieldArmy(set).groups['gun-line'];
            group.effects = [
                { kind: 'slotTag', add: ['prim'] },
                { kind: 'slotTag', add: [] },
            ];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/0/add: unknown slot tag 'prim' (did you mean 'prime'?); slot tags are declared in the game's slotTags",
            'error factions/field-army.json groups/gun-line/effects/1: a slotTag effect needs at least one tag in add',
        ]);
    });

    it('warns about a tag or category listed twice', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                {
                    kind: 'slotTag',
                    add: ['prime', 'prime'],
                    categories: ['honour', 'honour'],
                },
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line/effects/0/add: slot tag 'prime' is listed more than once",
            "warning factions/field-army.json groups/gun-line/effects/0/categories: category 'honour' is listed more than once",
        ]);
    });

    it('warns about a category no slot option of the tag has, and rejects an empty one', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                { kind: 'slotTag', add: ['prime'], categories: ['honor'] },
                { kind: 'slotTag', add: ['prime'], categories: [] },
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line/effects/0/categories: no slot option of 'prime' has the category 'honor', so it offers nothing (did you mean 'honour'?)",
            'error factions/field-army.json groups/gun-line/effects/1/categories: an empty categories list offers no slot options; leave it out to offer every option of the tag',
        ]);
    });

    it("counts categories from any loaded file, a sub-faction's included", async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                { kind: 'slotTag', add: ['prime'], categories: ['drill'] },
            ];
            sub(set, 'siege-doctrine').slotOptions = {
                'siege-drill': {
                    id: 'siege-drill',
                    name: 'Siege Drill',
                    text: 'Practised at the walls.',
                    slotTag: 'prime',
                    category: 'drill',
                },
            };
        });
        assert.deepEqual(issues, []);
    });

    it("doesn't let a slotTag effect's when read the profile", async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                {
                    kind: 'slotTag',
                    add: ['prime'],
                    when: { if: 'profile.is(tag:sergeant)', message: 'x' },
                },
            ];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/0/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
        ]);
    });

    it('checks tagOptions against the slot and its tags', async () => {
        const issues = await issuesAfter((set) => {
            const slot = set.game.data.groups!['heavy-detachment'].slots[0];
            slot.tagOptions = {
                prime: { categories: ['honour', 'rank'] },
                elite: { categories: ['honour'] },
            };
            set.game.data.groups!['allied-formation'].slots[0].tagOptions = {
                prime: { categories: ['honour'] },
            };
        });
        assert.deepEqual(issues, [
            "error game.json groups/allied-formation/slots/0/tagOptions/prime: the slot doesn't have the tag 'prime' (add it to tags); a slotTag effect limits the options of a tag it adds with its own categories",
            "warning game.json groups/heavy-detachment/slots/0/tagOptions/prime/categories: no slot option of 'prime' has the category 'rank', so it offers nothing",
            "error game.json groups/heavy-detachment/slots/0/tagOptions/elite: unknown slot tag 'elite'",
        ]);
    });
});

describe('special-rule remove and replace, and selector specialRules', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;
    const exchange = {
        kind: 'specialRule' as const,
        replace: {
            from: ['skirmisher'],
            to: { id: 'armoured', value: '1' },
        },
    };

    it('has an exchange offered by a group in the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const faction = fieldArmy(set);
        const option = faction.slotOptions!['dig-in'];
        assert.deepEqual(option.units, { specialRules: ['skirmisher'] });
        assert.ok(
            option.effects?.some((e) => e.kind === 'specialRule' && e.replace)
        );
        assert.ok(
            faction.groups['garrison'].effects?.some(
                (e) => e.kind === 'slotTag' && e.add.includes('garrison')
            )
        );
    });

    it('takes remove and replace wherever a special-rule effect goes', async () => {
        const issues = await issuesAfter((set) => {
            const faction = fieldArmy(set);
            const option = faction.units['squad'].upgrades!['squad-options']
                .options['banner'] as { effects?: Array<unknown> };
            option.effects = [...(option.effects ?? []), exchange];
            const group = faction.groups['gun-line'];
            group.effects = [
                ...(group.effects ?? []),
                {
                    kind: 'specialRule',
                    profiles: { anyOf: ['infantry'] },
                    remove: ['skirmisher'],
                    rule: { id: 'fearless' },
                },
            ];
            // a game-level effect may take away a faction's rule
            const value = set.game.data.choices!['stance'].values['offensive'];
            value.effects = [
                ...(value.effects ?? []),
                {
                    kind: 'specialRule',
                    replace: { from: ['skirmisher'], to: { id: 'fearless' } },
                },
            ];
            // re-valuing a rule: the same id in from and to
            group.slots[0].effects = [
                {
                    kind: 'specialRule',
                    replace: {
                        from: ['armoured'],
                        to: { id: 'armoured', value: '3' },
                    },
                },
            ];
        });
        assert.deepEqual(issues, []);
    });

    it('reports unknown rules, empty lists and an effect that does nothing', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                {
                    kind: 'specialRule',
                    remove: ['skirmish'],
                    replace: { from: ['raider'], to: { id: 'holder' } },
                },
                { kind: 'specialRule', remove: [] },
                {
                    kind: 'specialRule',
                    replace: { from: [], to: { id: 'fearless' } },
                },
                { kind: 'specialRule' },
            ];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/0/remove: unknown special rule 'skirmish' (did you mean 'skirmisher'?)",
            "error factions/field-army.json groups/gun-line/effects/0/replace/from: unknown special rule 'raider'",
            "error factions/field-army.json groups/gun-line/effects/0/replace/to: unknown special rule 'holder'",
            'error factions/field-army.json groups/gun-line/effects/1/remove: remove needs at least one special rule',
            'error factions/field-army.json groups/gun-line/effects/2/replace/from: replace needs at least one special rule in from',
            'error factions/field-army.json groups/gun-line/effects/3: a special-rule effect needs rule, remove or replace',
        ]);
    });

    it('warns about repeats, values and a rule both given and taken away', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].effects = [
                {
                    kind: 'specialRule',
                    remove: ['fearless', 'fearless'],
                    rule: { id: 'fearless' },
                },
                {
                    kind: 'specialRule',
                    replace: {
                        from: ['armoured', 'armoured'],
                        to: { id: 'disciplined', value: '2' },
                    },
                },
                {
                    kind: 'specialRule',
                    replace: {
                        from: ['armoured'],
                        to: { id: 'skirmisher' },
                    },
                },
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line/effects/0/remove: special rule 'fearless' is listed more than once",
            "warning factions/field-army.json groups/gun-line/effects/0: 'fearless' is both given and taken away",
            "warning factions/field-army.json groups/gun-line/effects/1/replace/from: special rule 'armoured' is listed more than once",
            "warning factions/field-army.json groups/gun-line/effects/1/replace/to: 'disciplined' is given a value but takes none",
            "warning factions/field-army.json groups/gun-line/effects/2/replace/to: 'skirmisher' takes a value, but neither the replacement nor the rule's defaultValue gives one",
        ]);
    });

    it("warns about a selector's unknown rule, but takes any loaded faction's", async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].units = {
                specialRules: ['skirmishr'],
                exclude: [{ specialRules: ['fearless'] }],
            };
            // a game-level selector may name a faction's rule
            set.game.data.selectors!['vehicles'].match.specialRules = [
                'skirmisher',
            ];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line: unknown special rule 'skirmishr' (did you mean 'skirmisher'?)",
        ]);
    });
});

describe('slot unitWhen, group addedSlotRoles and slot option when', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;
    const garrisonSlot = (set: GameDataSet) =>
        fieldArmy(set).groups['garrison'].slots[1];

    it('has all three in the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        assert.ok(garrisonSlot(set).unitWhen);
        assert.deepEqual(set.game.data.groups!['standard-core'].addedSlotRoles, [
            'support',
        ]);
        assert.ok(set.game.data.slotOptions!['flexible-troop'].when);
    });

    it("checks a unitWhen's expression, scopes and message", async () => {
        const issues = await issuesAfter((set) => {
            const slots = fieldArmy(set).groups['garrison'].slots;
            slots[1].unitWhen = { if: 'profile.is(tag:sergeant)', message: 'x' };
            slots[0].unitWhen = { if: 'unit.has(weapon:canon)', message: ' ' };
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json groups/garrison/slots/0/unitWhen: a condition needs a message for players',
            "error factions/field-army.json groups/garrison/slots/0/unitWhen: unknown weapon 'canon' (did you mean 'cannon'?)",
            "error factions/field-army.json groups/garrison/slots/1/unitWhen: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
        ]);
    });

    it("warns about a unitWhen that doesn't read the unit", async () => {
        const issues = await issuesAfter((set) => {
            garrisonSlot(set).unitWhen = {
                if: 'list.limit(points) >= 1000',
                message: 'Large lists only',
            };
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/garrison/slots/1/unitWhen: doesn't read the unit, so it judges every unit the same; use the slot's `when` for whether the slot is available",
        ]);
    });

    it('checks addedSlotRoles against the game and the slot options', async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).groups['gun-line'].addedSlotRoles = [
                'suport',
                'transport',
                'transport',
                'commander',
            ];
            fieldArmy(set).groups['garrison'].addedSlotRoles = [];
        });
        assert.deepEqual(issues, [
            "warning factions/field-army.json groups/gun-line/addedSlotRoles: role 'transport' is listed more than once",
            "error factions/field-army.json groups/gun-line/addedSlotRoles: unknown role 'suport'",
            "warning factions/field-army.json groups/gun-line/addedSlotRoles: no slot option adds a 'commander' slot, so allowing it changes nothing",
        ]);
    });

    it("checks a slot option's when, which sees the unit but no profile", async () => {
        const issues = await issuesAfter((set) => {
            fieldArmy(set).slotOptions!['field-promotion'].when = {
                if: 'unit.is(role:troop) and group.is(group:gun-line)',
                message: 'Troops in a Gun Line',
            };
            set.game.data.slotOptions!['extra-support'].when = {
                if: 'profile.is(tag:sergeant)',
                message: '',
            };
        });
        assert.deepEqual(issues, [
            'error game.json slotOptions/extra-support/when: a condition needs a message for players',
            "error game.json slotOptions/extra-support/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
        ]);
    });
});

describe('group listEffects', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;
    const spearhead = (set: GameDataSet) =>
        fieldArmy(set).groups['armoured-spearhead'];

    it('has one in the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        assert.deepEqual(spearhead(set).listEffects?.[0].units, '@vehicles');
    });

    it("takes the contingent scope, another faction's units and effects with a when", async () => {
        const issues = await issuesAfter((set) => {
            spearhead(set).listEffects = [
                {
                    scope: 'contingent',
                    units: { unitIds: ['walker', 'battle-construct'] },
                    effects: [
                        {
                            kind: 'stat',
                            changes: [{ stat: 'morale', op: 'add', value: 1 }],
                            when: {
                                if: 'unit.is(role:heavy) and group.is(type:core)',
                                message: 'Heavy units in a core formation',
                            },
                        },
                        { kind: 'slotTag', add: ['prime'] },
                    ],
                },
            ];
        });
        assert.deepEqual(issues, []);
    });

    it('reports unknown units and rules, and warns about an entry that does nothing', async () => {
        const issues = await issuesAfter((set) => {
            spearhead(set).listEffects = [
                {
                    units: { unitIds: ['walkr'] },
                    effects: [
                        { kind: 'specialRule', rule: { id: 'fearles' } },
                    ],
                },
                { units: '@vehicles', effects: [] },
            ];
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/armoured-spearhead/listEffects/0/units: unknown unit 'walkr'",
            "error factions/field-army.json groups/armoured-spearhead/listEffects/0/effects/0: unknown special rule 'fearles'",
            'warning factions/field-army.json groups/armoured-spearhead/listEffects/1/effects: a listEffects entry with no effects does nothing',
        ]);
    });

    it('counts the traits it gives as traits in use', async () => {
        const withTrait = (give: boolean) =>
            issuesAfter((set) => {
                delete set.game.data.traits;
                spearhead(set).listEffects = give
                    ? [{ effects: [{ kind: 'trait', add: ['Column Drill'] }] }]
                    : undefined;
                fieldArmy(set).groups['gun-line'].units = {
                    traits: ['Column Drill'],
                };
            });
        assert.deepEqual(await withTrait(true), []);
        assert.deepEqual(await withTrait(false), [
            "warning factions/field-army.json groups/gun-line: no unit has or is given the trait 'Column Drill'",
        ]);
    });
});

describe('model effects and sub-type effects', () => {
    const fieldArmy = (set: GameDataSet) =>
        set.factions.find((f) => f.data.id === 'field-army')!.data;
    const lead = (set: GameDataSet) =>
        set.game.data.slotOptions!['lead-construct'];
    const split = (set: GameDataSet) => lead(set).effects![0] as ModelEffect;
    const groupEffects = (set: GameDataSet, effects: Array<unknown>) => {
        fieldArmy(set).groups['gun-line'].effects = effects as Array<never>;
    };
    const morale = {
        kind: 'stat' as const,
        changes: [{ stat: 'morale', op: 'add' as const, value: 1 }],
    };

    it('has both in the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        const effect = split(set);
        assert.equal(effect.kind, 'model');
        assert.ok(effect.effects.some((e) => e.kind === 'subType'));
        assert.ok(lead(set).units && typeof lead(set).units !== 'string');
        assert.ok(
            Object.values(sub(set, 'veterans').unitModifiers ?? {}).some((m) =>
                m.actions.some((a) => a.kind === 'subType' && a.profiles)
            )
        );
    });

    it('offers lead-construct on some slot of the full example', async () => {
        const [set] = await sets(path.join(examples, 'full'));
        // a Prime slot open to heavy units, with no category limit on Prime
        const slots = Object.values(set.game.data.groups ?? {}).flatMap(
            (g) => g.slots
        );
        assert.ok(
            slots.some(
                (s) =>
                    s.roles?.includes('heavy') &&
                    s.tags?.includes('prime') &&
                    !s.tagOptions?.prime
            )
        );
        assert.equal(lead(set).category, undefined);
    });

    it('takes a model effect on a group and a slot, with a profile filter, a count and a name', async () => {
        const issues = await issuesAfter((set) => {
            const effect = {
                kind: 'model',
                profiles: { anyOf: ['sergeant'] },
                count: 1,
                name: 'Standard Bearer',
                effects: [morale, { kind: 'subType', add: ['character'] }],
            };
            groupEffects(set, [effect]);
            fieldArmy(set).groups['gun-line'].slots[0].effects = [
                effect as never,
            ];
        });
        assert.deepEqual(issues, []);
    });

    it("lets an effect inside a model effect read the profile, but not the model effect's own when", async () => {
        const issues = await issuesAfter((set) => {
            const effect = split(set);
            effect.when = { if: 'profile.is(tag:sergeant)', message: 'x' };
            effect.effects.push(
                {
                    kind: 'trait',
                    add: ['Promoted'],
                    when: { if: 'profile.is(type:vehicle)', message: 'A vehicle' },
                },
                {
                    kind: 'subType',
                    add: ['elite'],
                    when: { if: 'profile.is(tag:line)', message: 'A line model' },
                }
            );
        });
        assert.deepEqual(issues, [
            "error game.json slotOptions/lead-construct/effects/0/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
        ]);
    });

    it('reports an empty model effect, a blank name and what its effects get wrong', async () => {
        const issues = await issuesAfter((set) => {
            groupEffects(set, [
                { kind: 'model', name: '  ', effects: [] },
                {
                    kind: 'model',
                    profiles: { anyOf: ['sargeant'] },
                    effects: [
                        {
                            kind: 'stat',
                            changes: [{ stat: 'armor', op: 'add', value: 1 }],
                        },
                        { kind: 'specialRule', rule: { id: 'fearles' } },
                    ],
                },
            ]);
        });
        assert.deepEqual(issues, [
            'error factions/field-army.json groups/gun-line/effects/0/effects: a model effect needs at least one effect for the split-off model',
            "error factions/field-army.json groups/gun-line/effects/0/name: a blank name; leave it out to show the source profile's name with the name of what gives the effect",
            "error factions/field-army.json groups/gun-line/effects/1/effects/0: unknown stat 'armor'",
            "error factions/field-army.json groups/gun-line/effects/1/effects/1: unknown special rule 'fearles'",
            "warning factions/field-army.json groups/gun-line/effects/1/profiles: 'sargeant' matches no unit type or sub-type (did you mean 'sergeant'?)",
        ]);
    });

    it('counts the traits an effect inside a model effect gives as traits in use', async () => {
        const withTrait = (give: boolean) =>
            issuesAfter((set) => {
                delete set.game.data.traits;
                if (give)
                    split(set).effects.push({
                        kind: 'trait',
                        add: ['Column Drill'],
                    });
                fieldArmy(set).groups['gun-line'].units = {
                    traits: ['Column Drill'],
                };
            });
        assert.deepEqual(await withTrait(true), []);
        assert.deepEqual(await withTrait(false), [
            "warning factions/field-army.json groups/gun-line: no unit has or is given the trait 'Column Drill'",
        ]);
    });

    it("checks a subType effect's ids against the game's subTypes", async () => {
        const issues = await issuesAfter((set) => {
            groupEffects(set, [
                { kind: 'subType', add: ['elit'] },
                { kind: 'subType' },
                { kind: 'subType', add: ['elite', 'elite'] },
                { kind: 'subType', add: ['line'], remove: ['line'] },
            ]);
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/0/add: unknown sub-type 'elit' (did you mean 'elite'?); sub-types are declared in the game's subTypes",
            'error factions/field-army.json groups/gun-line/effects/1: a subType effect needs add or remove',
            "warning factions/field-army.json groups/gun-line/effects/2/add: sub-type 'elite' is listed more than once",
            "warning factions/field-army.json groups/gun-line/effects/3: 'line' is both given and taken away",
        ]);
    });

    it("doesn't let a subType effect without profiles read the profile", async () => {
        const when = { if: 'profile.is(tag:sergeant)', message: 'x' };
        const issues = await issuesAfter((set) => {
            groupEffects(set, [
                { kind: 'subType', add: ['elite'], when },
                {
                    kind: 'subType',
                    profiles: { anyOf: ['sergeant'] },
                    add: ['elite'],
                    when,
                },
            ]);
        });
        assert.deepEqual(issues, [
            "error factions/field-army.json groups/gun-line/effects/0/when: 'profile' isn't available here (allowed: contingent, group, list, main, root, slot, unit)",
        ]);
    });

    it('takes a subType effect on an upgrade option, a list choice value and listEffects', async () => {
        const issues = await issuesAfter((set) => {
            const effect = { kind: 'subType' as const, add: ['elite'] };
            const option = fieldArmy(set).units['squad'].upgrades![
                'squad-options'
            ].options['grenades'] as { effects?: Array<unknown> };
            option.effects = [...(option.effects ?? []), effect];
            const value = set.game.data.choices!['stance'].values['offensive'];
            value.effects = [...(value.effects ?? []), effect];
            fieldArmy(set).groups['gun-line'].listEffects = [
                { effects: [effect] },
            ];
        });
        assert.deepEqual(issues, []);
    });

    it('checks sub-types against unit tags, and makes them known to tag: references, when the game declares no subTypes', async () => {
        const issues = await issuesAfter((set) => {
            delete set.game.data.subTypes;
            groupEffects(set, [
                { kind: 'subType', add: ['vanguard'] },
                {
                    ...morale,
                    when: { if: 'unit.is(tag:vanguard)', message: 'x' },
                },
            ]);
        });
        assert.ok(
            issues.includes(
                "warning factions/field-army.json groups/gun-line/effects/0/add: no unit or profile has the tag 'vanguard'"
            ),
            issues.join('\n')
        );
        assert.ok(
            !issues.some((i) => i.includes('effects/1/when')),
            issues.join('\n')
        );
        assert.ok(
            !issues.some((i) => i.includes('lead-construct')),
            issues.join('\n')
        );
    });
});
