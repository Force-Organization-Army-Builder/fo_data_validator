import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { readSource } from '../src/game_data/read_source';
import { checkShapes, ShapeFile } from '../src/game_data/shape';

/* The shape check behind `npm run validate-data` */

const example = path.join(import.meta.dirname, '../examples/full');

async function files(): Promise<Array<ShapeFile>> {
    const [set] = (await readSource(example)).provided;
    return [
        { ...set.game, kind: 'GameSystem' },
        ...set.factions.map((f) => ({ ...f, kind: 'Faction' as const })),
        ...set.subFactions.map((f) => ({ ...f, kind: 'SubFaction' as const })),
    ];
}

describe('checkShapes', () => {
    it('accepts the example source', async () => {
        assert.deepEqual(checkShapes(await files()), []);
    });

    /* breaks one unit of the example faction and returns what the check says */
    async function issuesAfter(
        unit: string,
        change: (record: Record<string, unknown>) => void
    ) {
        const all = await files();
        const faction = all.find((f) => f.kind === 'Faction')!;
        change(
            (faction.data as { units: Record<string, Record<string, unknown>> })
                .units[unit]
        );
        return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
    }

    it('reports a wrong type with its path', async () => {
        const issues = await issuesAfter(
            'carrier',
            (u) => (u.profiles = 'nope')
        );
        assert.ok(issues.some((i) => i.startsWith('units/carrier/profiles: ')));
    });

    it('reports a perModel count that is not a number', async () => {
        const issues = await issuesAfter('squad', (u) => {
            const upgrades = u.upgrades as Record<
                string,
                { perModel: Record<string, unknown> }
            >;
            upgrades['trooper-sidearm'].perModel.count = 'two';
        });
        assert.ok(
            issues.some((i) =>
                i.startsWith(
                    'units/squad/upgrades/trooper-sidearm/perModel/count: '
                )
            ),
            issues.join('\n')
        );
    });

    it('takes a composition max as a number or an expression', async () => {
        const blocks = (u: Record<string, unknown>) =>
            u.composition as Array<Record<string, unknown>>;
        assert.deepEqual(
            await issuesAfter('pioneer-squad', (u) => {
                blocks(u)[1].max = 3;
            }),
            []
        );
        const issues = await issuesAfter('pioneer-squad', (u) => {
            blocks(u)[1].max = true;
        });
        assert.ok(
            issues.some((i) =>
                i.startsWith('units/pioneer-squad/composition/1/max: ')
            ),
            issues.join('\n')
        );
    });

    it('reports an unknown effect kind (a discriminator no branch matches)', async () => {
        const issues = await issuesAfter('squad', (u) => {
            const upgrades = u.upgrades as Record<
                string,
                { options: Record<string, Record<string, unknown>> }
            >;
            upgrades['squad-options'].options['grenades'] = {
                id: 'grenades',
                name: 'Grenades',
                cost: { points: 5 },
                effects: [{ kind: 'stats', changes: [] }],
            };
        });
        assert.deepEqual(issues, [
            "units/squad/upgrades/squad-options/options/grenades/effects/0/kind: Invalid discriminator value. Expected 'stat' | 'specialRule' | 'trait' | 'slotTag'",
        ]);
    });

    it('reports an unknown key', async () => {
        const issues = await issuesAfter(
            'squad',
            (u) => (u.cst = { points: 1 })
        );
        assert.ok(issues.some((i) => i.startsWith('units/squad/cst: ')));
    });

    it('reports a missing field', async () => {
        const issues = await issuesAfter('carrier', (u) => delete u.modelCount);
        assert.deepEqual(issues, [
            "units/carrier: missing required property 'modelCount'",
        ]);
    });

    it('takes effects and units on list choice values', async () => {
        const choiceIssues = async (
            change: (values: Record<string, Record<string, unknown>>) => void
        ) => {
            const all = await files();
            const game = all.find((f) => f.kind === 'GameSystem')!;
            change(
                (
                    game.data as {
                        choices: Record<
                            string,
                            { values: Record<string, Record<string, unknown>> }
                        >;
                    }
                ).choices['stance'].values
            );
            return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
        };
        // the example's offensive and defensive values carry both
        assert.deepEqual(await choiceIssues(() => {}), []);
        assert.deepEqual(
            await choiceIssues((v) => {
                v['offensive'].units = { roles: ['troop'] };
                v['defensive'].effects = [
                    { kind: 'specialRule', rule: { id: 'disciplined' } },
                ];
            }),
            []
        );

        const at = 'choices/stance/values/offensive';
        for (const [change, path] of [
            [(v: Record<string, unknown>) => (v.units = 3), `${at}/units`],
            [
                (v: Record<string, unknown>) =>
                    (v.effects = [{ kind: 'allowedRoles', roles: ['heavy'] }]),
                `${at}/effects/0/kind`,
            ],
            [
                (v: Record<string, unknown>) =>
                    (v.effects = { kind: 'trait', add: ['X'] }),
                `${at}/effects`,
            ],
            [(v: Record<string, unknown>) => (v.efects = []), `${at}/efects`],
        ] as const) {
            const issues = await choiceIssues((v) => change(v['offensive']));
            assert.ok(
                issues.some((i) => i.startsWith(`${path}: `)),
                issues.join('\n')
            );
        }
    });

    const badIds = [
        'Infantry-squad',
        'infantry squad',
        '-squad',
        'squad-',
        'infantry--squad',
        '',
    ];

    it('rejects a record key that is not a lowercase kebab-case id', async () => {
        for (const bad of badIds) {
            const all = await files();
            const faction = all.find((f) => f.kind === 'Faction')!;
            const units = (faction.data as { units: Record<string, unknown> })
                .units;
            units[bad] = structuredClone(units['squad']);
            const issues = checkShapes(all).map(
                (i) => `${i.path}: ${i.message}`
            );
            assert.equal(issues.length, 1, issues.join('\n'));
            assert.ok(
                issues[0].startsWith(
                    `units/${bad}: invalid key '${bad}': ids are lowercase kebab-case`
                ) && issues[0].includes('`infantry-squad`'),
                issues[0]
            );
        }
    });

    it('rejects an id value that is not a lowercase kebab-case id', async () => {
        for (const bad of badIds) {
            const issues = await issuesAfter('squad', (u) => (u.id = bad));
            assert.equal(issues.length, 1, issues.join('\n'));
            assert.match(
                issues[0],
                /^units\/squad\/id: ids are lowercase kebab-case.*`infantry-squad`/
            );
        }
    });

    it('rejects a selector reference to a malformed id', async () => {
        for (const bad of ['@Vehicles', '@', 'vehicles', '@-vehicles']) {
            const all = await files();
            const game = all.find((f) => f.kind === 'GameSystem')!;
            (
                game.data as {
                    listRules: Record<string, Record<string, unknown>>;
                }
            ).listRules['fixed-cap'].units = bad;
            const issues = checkShapes(all).map(
                (i) => `${i.path}: ${i.message}`
            );
            assert.deepEqual(
                issues,
                [
                    "listRules/fixed-cap/units: a selector reference is '@' followed by a selector id; ids are lowercase kebab-case: letters a-z and digits, with single hyphens between words, e.g. `infantry-squad`",
                ],
                bad
            );
        }
    });

    it('checks term words against the names expressions accept', async () => {
        const termIssues = async (word: string) => {
            const all = await files();
            const game = all.find((f) => f.kind === 'GameSystem')!;
            (
                game.data as { terms: Record<string, Record<string, unknown>> }
            ).terms['group'].word = word;
            return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
        };
        assert.deepEqual(await termIssues('battle-group'), []);
        for (const bad of ['2nd-group', 'Group', 'battle--group']) {
            const issues = await termIssues(bad);
            assert.equal(issues.length, 1, bad);
            assert.match(
                issues[0],
                /^terms\/group\/word: .*start with a letter/
            );
        }
    });

    it('checks sub-faction groups', async () => {
        const all = await files();
        const faction = all.find((f) => f.kind === 'Faction')!;
        const groups = (
            faction.data as { subFactionGroups: Record<string, object> }
        ).subFactionGroups;
        groups['doctrine'] = { ...groups['doctrine'], maxx: 2 };
        const sub = all.find(
            (f) => (f.data as { id: string }).id === 'coastal-heritage'
        )!;
        (sub.data as Record<string, unknown>).group = 3;
        const issues = checkShapes(all).map((i) => `${i.path}: ${i.message}`);
        assert.ok(
            issues.some((i) => i.startsWith('subFactionGroups/doctrine/maxx: '))
        );
        assert.ok(issues.some((i) => i.startsWith('group: ')));
    });
});

describe('counts', () => {
    type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    /* changes one unit of the example faction and returns what the check says */
    async function issuesAfter(unit: string, change: (unit: Loose) => void) {
        const all = await files();
        const faction = all.find((f) => f.kind === 'Faction')!;
        change((faction.data as Loose).units[unit]);
        return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
    }

    it('takes whole model counts only, at least 1', async () => {
        for (const modelCount of [0, -5, 2.5]) {
            assert.deepEqual(
                await issuesAfter('squad', (u) => (u.modelCount = modelCount)),
                ['units/squad/modelCount: a whole number, 1 or more']
            );
        }
    });

    it('takes a whole number of additional models, at least 1', async () => {
        assert.deepEqual(
            await issuesAfter('carrier', (u) => {
                u.additionalModels = { max: -1, cost: { points: 10 } };
            }),
            ['units/carrier/additionalModels/max: a whole number, 1 or more']
        );
    });

    it('takes a whole everyX, at least 1', async () => {
        for (const everyX of [0, 2.5]) {
            assert.deepEqual(
                await issuesAfter('squad', (u) => {
                    u.upgrades['trooper-sidearm'].perModel = {
                        type: 'one-in-x',
                        everyX,
                    };
                }),
                [
                    'units/squad/upgrades/trooper-sidearm/perModel/everyX: a whole number, 1 or more',
                ]
            );
        }
    });

    it('takes a min or max as a whole number or an expression', async () => {
        const maxOf = (max: unknown) =>
            issuesAfter('squad', (u) => {
                u.upgrades['trooper-sidearm'].max = max;
            });
        assert.deepEqual(await maxOf(0), []);
        assert.deepEqual(await maxOf('unit.models()'), []);
        for (const max of [-1, 1.5]) {
            assert.deepEqual(await maxOf(max), [
                'units/squad/upgrades/trooper-sidearm/max: a whole number, 0 or more',
            ]);
        }
    });

    it('still takes a fraction where one is meant', async () => {
        // the example's gear limit: one pick for every five of the gear
        assert.deepEqual(await issuesAfter('squad', () => {}), []);
    });
});

describe('slot tag effects and slot option categories', () => {
    type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    async function gameIssues(change: (game: Loose) => void) {
        const all = await files();
        change(all.find((f) => f.kind === 'GameSystem')!.data as Loose);
        return checkShapes(all).map((i) => `${i.path}: ${i.message}`);
    }

    it("rejects a slotTag effect in a slot option's effects, saying why", async () => {
        const issues = await gameIssues((game) => {
            game.slotOptions['extra-support'].effects.push({
                kind: 'slotTag',
                add: ['prime'],
            });
        });
        assert.deepEqual(issues, [
            "slotOptions/extra-support/effects/1/kind: a slot option can't have a slotTag effect: slot options are applied last, so a tag one added could never offer anything; give the slot the tag (`tags`), or put the slotTag effect on the group, the slot, an upgrade option, a sub-faction unit modifier or a list choice value",
        ]);
    });

    it('takes no profile filter on a slotTag effect', async () => {
        const issues = await gameIssues((game) => {
            game.groups['heavy-detachment'].effects = [
                {
                    kind: 'slotTag',
                    add: ['prime'],
                    profiles: { anyOf: ['infantry'] },
                },
            ];
        });
        assert.deepEqual(issues, [
            "groups/heavy-detachment/effects/0/profiles: unknown property 'profiles' (misspelt, or a field from a newer validator release)",
        ]);
    });

    it('takes slug categories and tag ids only', async () => {
        const issues = await gameIssues((game) => {
            game.slotOptions['honoured-crew'].category = 'Honour';
            game.groups['heavy-detachment'].slots[0].tagOptions.prime = {
                categories: ['honour rank'],
            };
            game.groups['heavy-detachment'].effects = [
                { kind: 'slotTag', add: ['Prime'], categories: ['honour'] },
            ];
        });
        assert.equal(issues.length, 3, issues.join('\n'));
        for (const at of [
            'slotOptions/honoured-crew/category: ',
            'groups/heavy-detachment/slots/0/tagOptions/prime/categories/0: ',
            'groups/heavy-detachment/effects/0/add/0: ',
        ])
            assert.ok(
                issues.some(
                    (i) => i.startsWith(at) && i.includes('kebab-case')
                ),
                at
            );
    });

    it('takes a slotTag effect in a sub-faction unit modifier', async () => {
        // the example's veterans carry one
        assert.deepEqual(await gameIssues(() => {}), []);
    });
});
