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
            "units/squad/upgrades/squad-options/options/grenades/effects/0/kind: Invalid discriminator value. Expected 'stat' | 'specialRule' | 'trait'",
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
