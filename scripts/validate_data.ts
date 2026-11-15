import fs from 'node:fs/promises';
import path from 'node:path';

import { formatDiagnostic } from '../src/expressions/diagnostics';
import { MANIFEST_FILE, readSource } from '../src/game_data/read_source';
import { checkManifestVersions } from '../src/game_data/versions';
import { DataIssue, validateGameData } from '../src/game_data/validate';
import { checkShapes, ShapeFile } from '../src/game_data/shape';

/*
 * Checks data sources from the command line, with the same checker the app
 * and the integrity test use:
 *
 *   fo-validate <source dir> [<extension source dir> ...] [--json]
 *
 * The manifests' declared versions are checked first, and a source this
 * validator is too old for stops there. Then each file's shape is checked
 * against the zod schemas; the data checker (ids, references, stats,
 * expressions) runs once the shapes are right.
 * The first directory (any, in fact) provides the game; the others may extend
 * it. Exits 1 when there are errors. `--json` prints the issues as JSON.
 */

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((arg) => !arg.startsWith('--'));

const describe = (issue: DataIssue) =>
    `${issue.severity.toUpperCase()} ${issue.file} ${issue.path || '(file)'}: ${issue.message}` +
    (issue.expression
        ? `\n${formatDiagnostic(issue.expression.source, { ...issue, ...issue.expression })}`
        : '');

async function main() {
    if (dirs.length === 0) {
        console.error(
            'usage: npm run validate-data -- <source dir> [<extension source dir> ...] [--json]'
        );
        return 2;
    }

    const manifestLabel = (index: number) =>
        `${path.basename(dirs[index])}/${MANIFEST_FILE}`;

    // the declared versions go first, on the raw manifests: a source for a
    // newer validator may have fields and files this one doesn't understand,
    // and the version error is what explains them
    const versionIssues = (
        await Promise.all(
            dirs.map(async (dir, index) =>
                checkManifestVersions(
                    await readManifest(dir),
                    manifestLabel(index)
                )
            )
        )
    ).flat();
    const versionErrors = versionIssues.filter(
        (issue) => issue.severity === 'error'
    );
    if (versionErrors.length > 0) {
        report(
            versionErrors,
            `${dirs.length} source${dirs.length === 1 ? '' : 's'} not checked`
        );
        return 1;
    }

    const sources = await Promise.all(dirs.map((dir) => readSource(dir)));
    const sets = sources.flatMap((source) => source.provided);
    if (sets.length === 0) {
        console.error(
            'None of the sources provide a game: add a "provides" entry to a forceorg.json.'
        );
        return 2;
    }

    // extension sources add their files to the game they extend
    for (const extension of sources.flatMap((source) => source.extensions)) {
        const set = sets.find(({ game }) => game.data.id === extension.game);
        if (!set) {
            console.error(
                `A source extends the game '${extension.game}', but no source provides it.`
            );
            return 2;
        }
        set.factions.push(...extension.factions);
        set.subFactions.push(...extension.subFactions);
    }

    // files with the wrong shape would crash the data checker, so they go first
    const shapes: Array<ShapeFile> = [
        ...sources.map(({ manifest }, index) => ({
            file: manifestLabel(index),
            kind: 'SourceManifest' as const,
            data: manifest,
        })),
        ...sets.flatMap((set) => [
            { ...set.game, kind: 'GameSystem' as const },
            ...set.factions.map((f) => ({ ...f, kind: 'Faction' as const })),
            ...set.subFactions.map((f) => ({
                ...f,
                kind: 'SubFaction' as const,
            })),
        ]),
    ];
    const shapeIssues = checkShapes(shapes).map((issue): DataIssue => ({
        severity: 'error',
        ...issue,
    }));

    // version warnings are reported with whatever comes next
    const issues = [
        ...versionIssues,
        ...(shapeIssues.length > 0
            ? shapeIssues
            : sets.flatMap(validateGameData)),
    ];
    const errors = report(
        issues,
        `${sets.length} game${sets.length === 1 ? '' : 's'} checked`
    );
    return errors > 0 ? 1 : 0;
}

/* The manifest as written, before any check */
async function readManifest(dir: string): Promise<unknown> {
    const file = path.join(dir, MANIFEST_FILE);
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        throw new Error(
            `${file} could not be read as JSON: ${error instanceof Error ? error.message : error}`
        );
    }
}

/* Prints the issues and a summary line; returns the number of errors */
function report(issues: Array<DataIssue>, what: string): number {
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (json) {
        console.log(JSON.stringify(issues, null, 2));
    } else {
        issues.forEach((issue) => console.log(describe(issue) + '\n'));
        const counts = [
            `${errors.length} error${errors.length === 1 ? '' : 's'}`,
            `${issues.length - errors.length} warning${issues.length - errors.length === 1 ? '' : 's'}`,
        ];
        console.log(
            `${what} (${dirs.map((dir) => path.basename(dir)).join(', ')}): ${counts.join(', ')}`
        );
    }
    return errors.length;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        // a file with the wrong shape (a missing "options", a string where an
        // object goes) can crash the checker, which assumes the right shape
        console.error(
            `Could not check the data: ${error instanceof Error ? error.message : error}\n` +
                'If this is not a JSON or file-path problem, a file probably has the wrong shape: compare it with the schema (schema/*.schema.json).'
        );
        process.exit(2);
    }
);
