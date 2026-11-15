import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
    checkManifestVersions,
    compareReleases,
    EXPRESSION_VERSION,
    expressionVersionOf,
    SCHEMA_VERSION,
    VALIDATOR_VERSION,
} from '../src/game_data/versions';

const current = {
    schemaVersion: SCHEMA_VERSION,
    expressionVersion: EXPRESSION_VERSION,
};

describe('manifest versions', () => {
    it('accepts the current versions', () => {
        assert.deepEqual(checkManifestVersions(current), []);
    });

    it('reads a missing expressionVersion as 1, with a warning', () => {
        const issues = checkManifestVersions({ schemaVersion: SCHEMA_VERSION });
        assert.equal(issues.length, 1);
        assert.equal(issues[0].severity, 'warning');
        assert.equal(issues[0].path, 'expressionVersion');
        assert.equal(expressionVersionOf({}), 1);
    });

    it('refuses an expression language newer than the app', () => {
        const [issue] = checkManifestVersions({
            ...current,
            expressionVersion: EXPRESSION_VERSION + 1,
        });
        assert.equal(issue.severity, 'error');
        assert.match(issue.message, /update Force Org/);
    });

    it('refuses a data format newer than the app', () => {
        const [issue] = checkManifestVersions({
            ...current,
            schemaVersion: SCHEMA_VERSION + 1,
        });
        assert.equal(issue.severity, 'error');
        assert.equal(issue.path, 'schemaVersion');
    });

    it('refuses versions that are not whole numbers of 1 or more', () => {
        for (const bad of [0, -1, 1.5, '1' as unknown as number]) {
            const issues = checkManifestVersions({
                ...current,
                expressionVersion: bad,
            });
            assert.equal(issues[0]?.severity, 'error', String(bad));
        }
    });
});

describe('minValidatorVersion', () => {
    const errors = (minValidatorVersion: unknown) =>
        checkManifestVersions({ ...current, minValidatorVersion }).filter(
            (issue) => issue.severity === 'error'
        );
    const [major, minor, patch] = VALIDATOR_VERSION.split('.').map(Number);

    it('matches the package version', async () => {
        const pkg = JSON.parse(
            await fs.readFile(
                path.join(import.meta.dirname, '../package.json'),
                'utf8'
            )
        );
        assert.equal(VALIDATOR_VERSION, pkg.version);
    });

    it('says nothing when left out', () => {
        assert.deepEqual(checkManifestVersions(current), []);
    });

    it('accepts this release and older ones', () => {
        for (const v of [
            VALIDATOR_VERSION,
            '1.0.0',
            '0.9.99',
            `${major}.${minor}.0`,
        ])
            assert.deepEqual(errors(v), [], v);
    });

    it('refuses a source for a newer release, by patch, minor or major', () => {
        for (const v of [
            `${major}.${minor}.${patch + 1}`,
            `${major}.${minor + 1}.0`,
            `${major + 1}.0.0`,
            // compared as numbers, not text: 10 is newer than 9
            `${major}.${minor + 10}.0`,
        ]) {
            const issues = errors(v);
            assert.equal(issues.length, 1, v);
            assert.equal(issues[0].path, 'minValidatorVersion');
            assert.equal(
                issues[0].message,
                `this source needs validator ${v} or newer, but this is ${VALIDATOR_VERSION}; update Force Org to use it`
            );
        }
    });

    it('refuses a value that is not major.minor.patch', () => {
        for (const v of [
            '1.14',
            '1.14.0.1',
            'v1.14.0',
            '1.14.0-beta',
            '01.14.0',
            ' 1.14.0',
            '',
            'latest',
        ]) {
            const issues = errors(v);
            assert.equal(issues.length, 1, v);
            assert.match(issues[0].message, /major\.minor\.patch/);
        }
    });

    it('refuses a value that is not a string', () => {
        for (const v of [1.14, 1, null, true, ['1.14.0'], { major: 1 }]) {
            const issues = errors(v);
            assert.equal(issues.length, 1, JSON.stringify(v));
            assert.match(issues[0].message, /major\.minor\.patch/);
        }
    });

    it('takes any manifest without throwing', () => {
        for (const raw of [undefined, null, 'text', 3, [], {}]) {
            const issues = checkManifestVersions(raw);
            assert.ok(
                issues.some((issue) => issue.path === 'schemaVersion'),
                JSON.stringify(raw)
            );
        }
    });

    it('compares releases as numbers', () => {
        assert.ok(compareReleases('1.9.0', '1.10.0') < 0);
        assert.ok(compareReleases('2.0.0', '1.99.99') > 0);
        assert.equal(compareReleases('1.14.0', '1.14.0'), 0);
    });
});

describe('fo-validate', () => {
    const bin = path.join(import.meta.dirname, '../bin/fo-validate.mjs');

    /* runs the CLI on a copy of the starter source with its manifest changed */
    async function issuesFor(
        change: (manifest: Record<string, unknown>) => void
    ) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fo-validate-'));
        try {
            await fs.cp(
                path.join(import.meta.dirname, '../examples/starter'),
                dir,
                { recursive: true }
            );
            const file = path.join(dir, 'forceorg.json');
            const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
            change(manifest);
            await fs.writeFile(file, JSON.stringify(manifest));
            let code = 0;
            let out: string;
            try {
                out = execFileSync(process.execPath, [bin, dir, '--json'], {
                    encoding: 'utf8',
                });
            } catch (error) {
                const e = error as { status: number; stdout: string };
                code = e.status;
                out = e.stdout;
            }
            const issues = JSON.parse(out) as Array<{ path: string }>;
            return { code, paths: issues.map((issue) => issue.path) };
        } finally {
            await fs.rm(dir, { recursive: true });
        }
    }

    it('reports a too-old validator instead of the unknown fields', async () => {
        assert.deepEqual(
            await issuesFor((m) => {
                m.minValidatorVersion = `${Number(VALIDATOR_VERSION.split('.')[0]) + 1}.0.0`;
                m.someNewerField = true;
            }),
            { code: 1, paths: ['minValidatorVersion'] }
        );
    });

    it('reports a too-new data format instead of the unknown fields', async () => {
        assert.deepEqual(
            await issuesFor((m) => {
                m.schemaVersion = SCHEMA_VERSION + 1;
                m.someNewerField = true;
            }),
            { code: 1, paths: ['schemaVersion'] }
        );
    });

    it('keeps version warnings alongside the later results', async () => {
        assert.deepEqual(
            await issuesFor((m) => {
                delete m.expressionVersion;
                m.someNewerField = true;
            }),
            { code: 1, paths: ['expressionVersion', 'someNewerField'] }
        );
    });
});
