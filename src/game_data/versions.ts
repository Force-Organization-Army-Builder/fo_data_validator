import type { SourceManifest } from '../types';
import { RELEASE_PATTERN } from './schema';
import type { DataIssue } from './validate';

/*
 * The versions of the data format and of the expression language this build of
 * the app understands. Both are whole numbers that only go up when a change
 * would break data written for the version before: a new function or scope
 * doesn't count, a changed meaning or removed syntax does.
 *
 * A source declares them in its manifest (`schemaVersion`, `expressionVersion`).
 * A source newer than the app is refused; one older than the oldest still
 * supported is refused with a message to update it. Raise the current version
 * here, and keep the previous language's behaviour behind it, when the
 * language changes incompatibly (docs/specs/expression_language_spec_2026-10-17.md §14).
 */

/**
 * This validator's release, as in package.json (a test keeps the two equal).
 * A literal, not a read of package.json, so this module stays browser-safe.
 */
export const VALIDATOR_VERSION = '2.2.0';

export const SCHEMA_VERSION = 1;
export const OLDEST_SCHEMA_VERSION = 1;

export const EXPRESSION_VERSION = 1;
export const OLDEST_EXPRESSION_VERSION = 1;

/** The expression version a manifest without one is read as */
export const DEFAULT_EXPRESSION_VERSION = 1;

/** The expression language version a source's expressions are written for */
export const expressionVersionOf = (
    manifest: Pick<SourceManifest, 'expressionVersion'>
) => manifest.expressionVersion ?? DEFAULT_EXPRESSION_VERSION;

function checkVersion(
    what: string,
    value: unknown,
    field: string,
    current: number,
    oldest: number,
    file: string
): Array<DataIssue> {
    const issue = (message: string): DataIssue => ({
        severity: 'error',
        file,
        path: field,
        message,
    });

    if (!Number.isInteger(value) || (value as number) < 1) {
        return [issue(`${field} must be a whole number, 1 or more`)];
    }
    const version = value as number;
    if (version > current) {
        return [
            issue(
                `this source is written for ${what} version ${version}, but this version of Force Org only understands up to ${current}; update Force Org or the validator to use it`
            ),
        ];
    }
    if (version < oldest) {
        return [
            issue(
                `this source is written for ${what} version ${version}, which Force Org no longer supports (oldest supported: ${oldest}); the source needs updating`
            ),
        ];
    }
    return [];
}

/* The three numbers of a `major.minor.patch` release, or undefined */
function releaseParts(value: unknown): [number, number, number] | undefined {
    if (typeof value !== 'string') return undefined;
    const match = RELEASE_PATTERN.exec(value);
    return match
        ? [Number(match[1]), Number(match[2]), Number(match[3])]
        : undefined;
}

/** Negative when release a is older than b, 0 when equal, positive when newer */
export function compareReleases(a: string, b: string): number {
    const [x, y] = [releaseParts(a), releaseParts(b)];
    if (!x || !y) throw new Error(`not a release number: ${x ? b : a}`);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function checkValidatorVersion(value: unknown, file: string): Array<DataIssue> {
    if (value === undefined) return [];
    const issue = (message: string): DataIssue => ({
        severity: 'error',
        file,
        path: 'minValidatorVersion',
        message,
    });
    if (!releaseParts(value)) {
        return [
            issue(
                'minValidatorVersion must be a release number, `major.minor.patch`, e.g. "1.14.0"'
            ),
        ];
    }
    const required = value as string;
    if (compareReleases(required, VALIDATOR_VERSION) > 0) {
        return [
            issue(
                `this source needs validator ${required} or newer, but this is ${VALIDATOR_VERSION}; update Force Org or the validator to use it`
            ),
        ];
    }
    return [];
}

/**
 * Checks a manifest's declared versions. Errors mean the source (its games
 * included) can't be loaded; a missing `expressionVersion` is only a warning.
 *
 * Takes the raw manifest, before any shape check: a source written for a
 * newer validator is expected to have fields this one doesn't know, and the
 * version errors are what explain them. Any input is safe.
 */
export function checkManifestVersions(
    raw: unknown,
    file = 'forceorg.json'
): Array<DataIssue> {
    const manifest = (
        raw !== null && typeof raw === 'object' ? raw : {}
    ) as Partial<Record<keyof SourceManifest, unknown>>;
    const issues = checkValidatorVersion(manifest.minValidatorVersion, file);
    issues.push(
        ...checkVersion(
            'data format',
            manifest.schemaVersion,
            'schemaVersion',
            SCHEMA_VERSION,
            OLDEST_SCHEMA_VERSION,
            file
        )
    );
    if (manifest.expressionVersion === undefined) {
        issues.push({
            severity: 'warning',
            file,
            path: 'expressionVersion',
            message: `no expressionVersion: read as version ${DEFAULT_EXPRESSION_VERSION}; add "expressionVersion": ${EXPRESSION_VERSION} so the source keeps working if the expression language changes`,
        });
    } else {
        issues.push(
            ...checkVersion(
                'expression language',
                manifest.expressionVersion,
                'expressionVersion',
                EXPRESSION_VERSION,
                OLDEST_EXPRESSION_VERSION,
                file
            )
        );
    }
    return issues;
}

/** Whether the text is a `major.minor.patch` version */
export const isRelease = (value: unknown): value is string =>
    releaseParts(value) !== undefined;

const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/;

/* One comparator (`>=1.2.0`, `^1.2.0`, `1.2.0`) against a version, or undefined when unreadable */
function meets(version: string, comparator: string): boolean | undefined {
    if (comparator === '*') return true;
    const match = COMPARATOR.exec(comparator);
    if (!match) return undefined;
    const [, op = '=', bound] = match;
    const order = compareReleases(version, bound);
    const [major, minor] = releaseParts(bound)!;
    switch (op) {
        case '>=':
            return order >= 0;
        case '<=':
            return order <= 0;
        case '>':
            return order > 0;
        case '<':
            return order < 0;
        case '^': {
            // up to the next change of the leftmost number that isn't 0
            const next =
                major > 0
                    ? `${major + 1}.0.0`
                    : minor > 0
                      ? `0.${minor + 1}.0`
                      : undefined;
            return next === undefined
                ? order === 0
                : order >= 0 && compareReleases(version, next) < 0;
        }
        case '~':
            return (
                order >= 0 &&
                compareReleases(version, `${major}.${minor + 1}.0`) < 0
            );
        default:
            return order === 0;
    }
}

/**
 * Whether a `major.minor.patch` version satisfies a version range, or
 * undefined when either can't be read. A range is comparators separated by
 * spaces, all of which must hold (`>=1.2.0 <2.0.0`); `||` separates
 * alternatives. A comparator is a full version with `>=`, `<=`, `>`, `<`,
 * `=`, `^` or `~` in front (none means `=`), or `*` for any version.
 */
export function satisfiesRange(
    version: string,
    range: string
): boolean | undefined {
    if (!isRelease(version)) return undefined;
    const alternatives = range.split('||').map((part) => part.trim());
    let any = false;
    for (const alternative of alternatives) {
        const comparators = alternative.split(/\s+/).filter(Boolean);
        if (comparators.length === 0) return undefined;
        let all = true;
        for (const comparator of comparators) {
            const met = meets(version, comparator);
            if (met === undefined) return undefined;
            all &&= met;
        }
        any ||= all;
    }
    return any;
}

/** Whether the text can be read as a version range by `satisfiesRange` */
export const isVersionRange = (range: string): boolean =>
    satisfiesRange('0.0.0', range) !== undefined;
