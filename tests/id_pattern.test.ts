import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tokenize } from '../src/expressions/lexer';
import {
    ExpressionWordSchema,
    SelectorRefSchema,
    SlugSchema,
} from '../src/game_data/schema';

/*
 * The schema's id and name patterns must accept exactly what the expression
 * lexer does, or a record could validate and still be impossible to refer to.
 */

/* the lexer reads `kind:<s>` as one reference to the id <s> */
function lexerTakesId(s: string) {
    try {
        const tokens = tokenize(`unit:${s}`);
        return (
            tokens.length === 2 &&
            tokens[0].type === 'reference' &&
            tokens[0].id === s
        );
    } catch {
        return false;
    }
}

/* the lexer reads `@<s>` as one selector */
function lexerTakesSelector(s: string) {
    try {
        const tokens = tokenize(`@${s}`);
        return (
            tokens.length === 2 &&
            tokens[0].type === 'selector' &&
            tokens[0].text === s
        );
    } catch {
        return false;
    }
}

/* the lexer reads <s> as one name (a keyword such as `and` is a name too here) */
function lexerTakesName(s: string) {
    try {
        const tokens = tokenize(s);
        return (
            tokens.length === 2 &&
            (tokens[0].type === 'name' || tokens[0].type === 'keyword') &&
            tokens[0].text === s
        );
    } catch {
        return false;
    }
}

const cases = [
    'squad',
    'infantry-squad',
    'walker-2',
    '2nd-squad',
    '42',
    'a-b-c',
    'x',
    'Squad',
    'infantry squad',
    'infantry_squad',
    'infantry.squad',
    '-squad',
    'squad-',
    'infantry--squad',
    '',
    'é',
    ' squad',
    'squad\n',
];

describe('id pattern', () => {
    it('accepts exactly the ids the expression lexer does', () => {
        for (const s of cases) {
            assert.equal(
                SlugSchema.safeParse(s).success,
                lexerTakesId(s),
                JSON.stringify(s)
            );
        }
    });

    it('accepts exactly the selector references the expression lexer does', () => {
        for (const s of cases) {
            assert.equal(
                SelectorRefSchema.safeParse(`@${s}`).success,
                lexerTakesSelector(s),
                JSON.stringify(s)
            );
        }
    });

    it('accepts exactly the term words the expression lexer reads as names', () => {
        for (const s of cases) {
            assert.equal(
                ExpressionWordSchema.safeParse(s).success,
                lexerTakesName(s),
                JSON.stringify(s)
            );
        }
    });

    it('has cases on both sides', () => {
        assert.ok(cases.some(lexerTakesId) && !cases.every(lexerTakesId));
        assert.ok(cases.some(lexerTakesName) && !cases.every(lexerTakesName));
        assert.ok(cases.some((s) => lexerTakesId(s) && !lexerTakesName(s)));
    });
});
