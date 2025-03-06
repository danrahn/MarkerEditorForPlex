import TestBase from '../TestBase.js';

import { TimeExpression, TimestampInvalidReason } from '../../Client/Script/TimeExpression.js';
import TestHelpers from '../TestHelpers.js';

/** @typedef {!import('../../Client/Script/TimeExpression').ParseState} ParseState */

/** @typedef {{ start: number, end: number, markerType: string }} FakeMarkerData */
/** @typedef {{ start: number, end: number, name: string }} FakeChapterData */

export default class TimeExpressionTest extends TestBase {
    constructor() {
        super();
        this.requiresServer = false;
        this.testMethods = [
            this.testBasicSyntax,
            this.testTimeOperations,
            this.testMarkerReferences,
            this.testChapterIndexes,
            this.testSimpleChapterNames,
            this.testComplexChapterNames,
            this.testToString,
            this.testMarkerType,
            this.testPlainOnly,
            this.testMiscErrors,
            this.testEquality,
            this.testInTextReference,
        ];
    }

    className() { return 'TimeExpressionTest'; }

    /**
     * Test basic syntax parsing, i.e. expressions without a leading '='.
     * Also validates the equivalent '=' syntax to ensure they agree with each other. */
    testBasicSyntax() {
        const badTimestamp = t => TimestampInvalidReason.InvalidTimestamp(t);

        /* eslint-disable quote-props */ // Cleaner to have everything in quotes
        const testCases = {
            '1000'         : 1000,
            '1.'           : 1000,
            '1.0'          : 1000,
            '0.1'          : 100,
            '.1'           : 100,
            '1.0001'       : 1000,
            '1:00'         : 60000,
            '1:01'         : 61000,
            '1:01:01'      : 3661000,
            '01:02.05'     : 62050,
            '01:02.050'    : 62050,
            '2.1'          : 2100,
            ' 2.1'         : 2100,
            '1'            : 1,
            '0'            : 0,
            '-0'           : -0,
            '-0:00:00.000' : -0,
            '-1'           : -1,
            '-.01'         : -10,
            '-1:00'        : -60000,
            '90:00'        : 5400000,

            '2 0 0 0'      : [NaN, badTimestamp('2 0 0 0'), true /*skipEqualsCheck*/], // "No operator" error in '=' mode.
            '2:'           : badTimestamp('2:'),
            '2:0:'         : badTimestamp('2:0:'),
            '2:90'         : badTimestamp('2:90'),
            '1:01:01:01'   : badTimestamp('1:01:01:01'),

            // Whitespace not allowed after negative sign in plain mode,
            // but is in '=' mode, so skip the equals check.
            '- 1:00'       : [NaN, badTimestamp('- 1:00'), true /*skipEqualsCheck*/],
            '- 1000'       : [NaN, badTimestamp('- 1000'), true /*skipEqualsCheck*/],
        };
        /* eslint-enable quote-props */

        const simpleTestRunner = (input, expected) => {
            if (typeof expected === 'number') {
                this.#testPlain(input, expected);
            } else if (typeof expected === 'string') {
                this.#testPlain(input, NaN, expected);
            } else {
                this.#testPlain(input, ...expected);
            }
        };

        this.#runTests(testCases, simpleTestRunner, 'One or more basic syntax tests failed');
    }

    /** Test time only operations, i.e. addition and subtraction of ms and hms subexpressions. */
    testTimeOperations() {
        const doubleOp = op => TimestampInvalidReason.DoubleOperator(op);

        const testCases = {
            '1+1'           : 2,
            '1 + 1'         : 2,
            '1-1'           : 0,
            '1.+1'          : 1001,
            '2.+3:00'       : 182000,
            '1-1.'          : -999,
            '-0-0'          : -0,
            '-0+0'          : 0,
            '0-0'           : -0,
            '-1 -1 - 1'     : -3,
            '-1 -1 +1'      : -1,
            '1+1+'          : 2, // Postfixed operators are fine
            '1+1-'          : 2, // Postfixed operators are fine
            '1+1+1'         : 3,
            '1 + 1-1'       : 1,
            '1:00. - .1'    : 59900,
            '1:30:00-90:00' : 0,

            '1--1'          : doubleOp('--'),
            '1++1'          : doubleOp('++'),
            '1+-1'          : doubleOp('+-'),
            '1-+1'          : doubleOp('-+'),
            '1:90-90:00'    : TimestampInvalidReason.InvalidTimestamp('1:90'),
        };

        const simpleTestRunner = (input, expected) => {
            if (typeof expected === 'number') {
                this.#testSimpleEquals(input, expected);
            } else {
                this.#testSimpleEquals(input, NaN, expected);
            }
        };

        this.#runTests(testCases, simpleTestRunner, 'One or more time operation tests failed');
    }

    /** Test marker references, i.e. expressions that reference markers by index. */
    testMarkerReferences() {
        const markers = [
            { start : 1000, end : 2000, markerType : 'intro' },
            { start : 3000, end : 4000, markerType : 'credits' },
        ];

        const testCases = {
            '=I1S'       : 1000,
            '=I1E'       : 2000,
            '=C1S'       : 3000,
            '=C1E'       : 4000,
            '=I1S+1000'  : 2000,
            '=I1S-500'   : 500,
            '=I1S+1:00'  : 61000,

            // Implicit start/end
            '=I1'        : 2000,
            '=C1'        : 4000,
            '=M1'        : [1000, null, true],
            '=M2'        : [3000, null, true],

            // Not enough markers
            '=I2S'       : TimestampInvalidReason.BadRefIndex('marker', 2, 'intro markers'),
            '=C2S'       : TimestampInvalidReason.BadRefIndex('marker', 2, 'credits markers'),

            // Negative Indexes
            '=M-1S'      : 3000,
            '=M-2S'      : 1000,
            '=I-1S'      : 1000,
            '=I-2S'      : TimestampInvalidReason.BadRefIndex('marker', -2, 'intro markers'),

            // Operations with swapped order
            '=1:00+I1S'  : 61000,
            '=1:00-I1S'  : TimestampInvalidReason.SubtractedReference('Marker'),
            '=1:00+C1S'  : 63000,
            '=1:00-C1S'  : TimestampInvalidReason.SubtractedReference('Marker'),

            // Operators with multiple time subexpressions
            '=1:00+I1+2' : 62002,
            '=-2+M2+50'  : 4048,
            '=M1+1:00+3' : 62003,

            '=M1+C1'     : TimestampInvalidReason.MultipleReferences(),
            '=M1S-2000'  : TimestampInvalidReason.NegativeTimestampWithRef(),
        };

        this.#runTests(testCases, this.#advancedTestRunner.bind(this, markers, []), 'One or more marker reference tests failed');
    }

    /** Test index-based chapter references. */
    testChapterIndexes() {
        const chapters = [
            { start : 1000, end : 2000, name : 'Opening' },
            { start : 3000, end : 4000, name : 'Ending' },
            { start : 5000, end : 6000, name : 'End' },
            { start : 7000, end : 8000, name : 'Chapter Four' },
        ];

        const testCases = {
            '=Ch1S'      : 1000,
            '=Ch1E'      : 2000,
            '=Ch2S'      : 3000,
            '=Ch2E'      : 4000,
            '=Ch1S+1000' : 2000,
            '=Ch1S-500'  : 500,
            '=Ch1S+1:00' : 61000,

            '=Ch0'       : TimestampInvalidReason.ZeroRefIndex(),
            '=Ch1'       : 1000, // Implicit start
            '=Ch2'       : 3000, // Implicit start
            '=Ch3'       : [6000, null, true], // Implicit end
            '=Ch4'       : [8000, null, true], // Implicit end
            '=Ch5'       : TimestampInvalidReason.BadRefIndex('chapter', 5, 'chapters'),

            // Negative indexes
            '=Ch-1S'     : 7000,
            '=Ch-1E'     : 8000,
            '=Ch-2'      : 5000,
            '=Ch-3'      : 3000,
            '=Ch-3E'     : 4000,
            '=Ch-4'      : 1000,
            '=Ch-5'      : TimestampInvalidReason.BadRefIndex('chapter', -5, 'chapters'),

            // Operations with swapped order
            '=1:00+Ch1'  : 61000,
            '=1:00-Ch1S' : TimestampInvalidReason.SubtractedReference('Chapter'),
            '=1:00+Ch2S' : 63000,
            '=1:00-Ch2'  : TimestampInvalidReason.SubtractedReference('Chapter'),

            '=Ch1S-2000' : TimestampInvalidReason.NegativeTimestampWithRef(),
        };

        this.#runTests(testCases, this.#advancedTestRunner.bind(this, [], chapters), 'One or more chapter reference tests failed');
    }

    /** Test basic chapter name references. */
    testSimpleChapterNames() {
        const basicChapters = [
            { start : 1000, end : 2000, name : 'Opening' },
            { start : 3000, end : 4000, name : 'Ending' },
            { start : 5000, end : 6000, name : 'End' },
            { start : 7000, end : 8000, name : 'Chapter Four' },
        ];

        const basicTests = {
            '=Ch(/Open/)'        : 1000,
            '=Ch(/End/)'         : 3000, // Multiple matches, pick first one.
            '=Ch(/NonExistent/)' : TimestampInvalidReason.NoChapterRegex('/NonExistent/'),
            '=Ch(Open*)'         : 1000,
            '=Ch(End?)'          : TimestampInvalidReason.NoChapterRegex('/^End.$/i'),
            '=Ch(End*)'          : 3000, // Matches "Ending"
            '=Ch(End*)E'         : 4000,
            '=Ch(End)E'          : 6000,
            '=Ch(NonExistent*)'  : TimestampInvalidReason.NoChapterRegex('/^NonExistent.*$/i'),
            '=Ch(/End$/i)'       : 5000, // Regex match for "End"
            '=Ch(/^Open/i)'      : 1000, // Regex match for "Opening"
            '=Ch(/^Open/)E'      : 2000,
        };

        this.#runTests(
            basicTests,
            this.#advancedTestRunner.bind(this, [], basicChapters),
            'One or more advanced chapter reference tests failed');
    }

    /** Test chapter name references with more interesting names. */
    testComplexChapterNames() {
        const advancedChapters = [
            { start : 1000,  end : 2000,  name : 'Chapter*One' },
            { start : 3000,  end : 4000,  name : 'Chapter?Two' },
            { start : 5000,  end : 6000,  name : 'Chapter[Three]' },
            { start : 7000,  end : 8000,  name : 'Chapter\\[Four)' },
            { start : 9000,  end : 10000, name : '[[Amazing ** Chapter Five?]]' },
            { start : 10000, end : 11000, name : '^Chapter Six$' },
            { start : 11000, end : 12000, name : 'Chapter Seven' },
            { start : 12000, end : 13000, name : 'Chapter\\/Eight' },
            { start : 13000, end : 14000, name : 'Chapter Nine' },
            { start : 14000, end : 15000, name : 'Chapter T\ten' },
            { start : 15000, end : 16000, name : 'Chapter Eleven' },
        ];

        const badGroup = '/(Chapter.*/';
        const unterminatedGroup = 'Invalid regular expression: /(Chapter.*/: Unterminated group';

        const advancedTests = {
            '=Ch(Chapter\\*One)'       : 1000,
            '=Ch(Chapter\\?Two)'       : 3000,
            '=Ch(Chapter[Three])'      : 5000,
            '=Ch(Chapter\\[Three\\])'  : 5000,  // Escaping brackets isn't required, but it should still work
            '=Ch(Chapter\\\\[Four\\))' : 7000,

            '=Ch(/Chapter\\*One/)'        : 1000,
            '=Ch(/Chapter\\?Two/)'        : 3000,
            '=Ch(/Chapter\\[Three\\]/)'   : 5000,
            '=Ch(^Ch*x$)'                 : 10000,
            '=Ch(/^\\^Ch\\w+\\sSix\\$$/)' : 10000,
            '=Ch(/Chapter\\s+Seven/)'     : 11000, // Whitespace preserved during parse
            '=Ch(/chapter\\s+seven/i)'    : 11000,
            '=Ch(/ter\\\\\\/Eight/)'      : 12000,
            // JS technically allows this, but it shouldn't for us, because the '/' isn't escaped, ending the regex early.
            '=Ch(/ter\\\\/Eight/)'        : TimestampInvalidReason.UnterminatedChapterRef(),

            // Wildcard matches don't allow substrings. Must use * or ?
            '=Ch(Chapter Eleve)'         : TimestampInvalidReason.NoChapterRegex('/^Chapter Eleve$/i'),
            '=Ch(Chapter Eleve?)'        : 15000,
            // '?' means _exactly_ one, not 0 or one
            '=Ch(Chapter Eleven?)'       : TimestampInvalidReason.NoChapterRegex('/^Chapter Eleven.$/i'),

            '=Ch10'   : 14000, // double-digit chapter
            '=Ch10E'  : 15000, // double-digit chapter end
            '=Ch-10'  : 3000,  // negative double-digit chapter
            '=Ch-10E' : 4000,  // negative double-digit chapter end
            '=Ch12'   : TimestampInvalidReason.BadRefIndex('chapter', 12, 'chapters'),
            '=Ch-12'  : TimestampInvalidReason.BadRefIndex('chapter', -12, 'chapters'),

            // Case sensitivity
            '=Ch(/Chapter\\\\\\[Four\\)/)'  : 7000,
            '=Ch(/Chapter\\\\\\[four\\)/)'  : TimestampInvalidReason.NoChapterRegex('/Chapter\\\\\\[four\\)/'),
            '=Ch(/Chapter\\\\\\[four\\)/i)' : 7000, // Wrong case, case insensitive

            // More special characters
            '=Ch(?[*\\*\\**\\?*)'   : 9000,
            '=Ch(/^\\[[^\\]]+\\]/)' : 9000,

            // Tab escape, not other characters
            '=Ch(*t\\ten)'       : 14000,
            '=Ch(/t\\ten/i)'     : 14000,
            '=Ch(Chap\\ter One)' : TimestampInvalidReason.NoChapterRegex('/^Chap\\ter One$/i'),
            '=Ch(Chapt\\er One)' : TimestampInvalidReason.BadWildcardEscape('e'),

            // Unterminated references.
            '=Ch(Chapter One'     : TimestampInvalidReason.UnterminatedChapterRef(),
            '=Ch(/Chapter One)'   : TimestampInvalidReason.UnterminatedChapterRef(),
            '=Ch(Chapter One/'    : TimestampInvalidReason.UnterminatedChapterRef(),
            '=Ch(Chapter One/i'   : TimestampInvalidReason.UnterminatedChapterRef(),
            '=Ch(Chaptter One\\)' : TimestampInvalidReason.UnterminatedChapterRef(),
            '=Ch(/Chapter One/g)' : TimestampInvalidReason.UnterminatedChapterRef(),

            [`=Ch(${badGroup})`]  : TimestampInvalidReason.BadChapterRegex(badGroup, unterminatedGroup),
        };

        this.#runTests(
            advancedTests,
            this.#advancedTestRunner.bind(this, [], advancedChapters),
            'One or more advanced chapter reference tests failed');
    }

    /** Test transforming input into a standardized format. E.g "=1000 + Ch1 + 1:00" becomes "=Ch1+1:01" */
    testToString() {
        const markers = [
            { start : 1000, end : 2000, markerType : 'intro' },
            { start : 3000, end : 4000, markerType : 'credits' },
        ];

        const chapters = [
            { start : 1000, end : 2000, name : 'Opening' },
            { start : 3000, end : 4000, name : 'Ending' },
            { start : 5000, end : 6000, name : 'Chapter Three' },
        ];

        const testCases = {
            // Multiple operators are combined
            '=1 + 1 + 1'          : '=3',
            // Math checks out
            '=1 + 4 - 1'          : '=4',
            // Existence of any non-ms makes it use hms syntax.
            '=1 + 1. + 1'         : '=0:01.002',
            // Marker references go to start, and raw ms are combined.
            '=2000+M1-200'        : '=M1+1800',
            // Chapter references go to start, raw ms are combined, whitespace removed
            '=C@100+Ch(Opening) - 200 ' : '=C@Ch(Opening)-100',
            // Same with hms syntax
            '=1:00+I1S'           : '=I1S+1:00',
            // Raw ms removed when it equals 0 and there's a reference.
            '=1:00+M2-60000'      : '=M2',
            // Raw ms not removed when there isn't a reference (and no hms).
            '=50+100-150'         : '=0',
            // Raw ms not removed when there isn't a reference (and hms).
            '=1:00-60000'         : '=0:00',
            // Chapter references to to start, hms syntax is kept
            '=1:00+Ch(Opening) - 200 ' : '=Ch(Opening)+0:59.8',
            //  Name regex works
            '=1000 + Ch(/Open/)'  : '=Ch(/Open/)+1000',
            // Wildcard text stays the same, despite underlying expression being regex
            '=500+Ch(End*)'       : '=Ch(End*)+500',
            // Whitespace preserved in name references
            '=1000 + Ch(/Chapter Three/)' : '=Ch(/Chapter Three/)+1000',
            // Whitespace is also preserved if the chapter reference is invalid, but order isn't rearranged
            '=1000 + Ch(/Chapter Four/)' : '=1000 + Ch(/Chapter Four/)',
            // Invalid expressions are kept as-is.
            '=fail '              : '=fail',
            '=C@C'                : '=C@C',
            // Whitespace preserved in invalid expressions
            '=fail2 + fail2'      : '=fail2 + fail2',
        };

        const testFn = (input, expected) => this.#testToString(input, markers, chapters, expected);
        this.#runTests(testCases, testFn, 'One or more toString tests failed');
    }

    /** Test prefixed marker type indicators. */
    testMarkerType() {
        const testCases = {
            '=I@0'       : 0,
            '=C@'        : 0,
            '=A@1:00'    : 60000,
            '=  I@60000' : 60000,
            '=M@1:00'    : TimestampInvalidReason.InvalidRef('marker'),
            '=1+I@1:00'  : TimestampInvalidReason.MarkerTypeNotAtStart(),
            '=C@I@0'     : TimestampInvalidReason.MarkerTypeNotAtStart(),
            '=I@1:00'    : [NaN, TimestampInvalidReason.MarkerTypeInEndInput(), true /*isEnd*/],
        };

        this.#runTests(testCases, this.#advancedTestRunner.bind(this, [], []), 'One or more marker type tests failed');
    }

    /** Test expressions when plain expressions are forced (i.e. '=' syntax is forbidden) */
    testPlainOnly() {
        const exp = new TimeExpression([], [], false /*isEnd*/, true /*plainOnly*/);
        const testRunner = (input, output) => {
            const state = exp.parse(input, true /*force*/);
            const expected = typeof output === 'number' ? output : NaN;
            TestHelpers.verify(Object.is(exp.ms(), expected), this.#msError(input, expected, exp.ms()));
            if (isNaN(expected)) {
                TestHelpers.verify(!state.valid, `Expected "${input}" to be invalid`);
                TestHelpers.verify(
                    state.invalidReason === output,
                    `Expected "${input}" to have invalid reason "${output}", found "${state.invalidReason}"`);
            } else {
                TestHelpers.verify(exp.state().valid, `Expected "${input}" to be valid`);
                TestHelpers.verify(!exp.state().invalidReason, `Expected "${input}" to have no invalid reason`);
            }
        };

        /* eslint-disable quote-props */
        const testCases = {
            '1'       : 1,
            '1.'      : 1000,
            '1:00'    : 60000,
            '1:00:00' : 3600000,
            '1.0001'  : 1000,
            '90:00'   : 5400000,

            '1=0'     : TimestampInvalidReason.InvalidTimestamp('1=0'),
            '1:'      : TimestampInvalidReason.InvalidTimestamp('1:'),
            '1:0:'    : TimestampInvalidReason.InvalidTimestamp('1:0:'),
            '1:90'    : TimestampInvalidReason.InvalidTimestamp('1:90'),
            '=1'      : TimestampInvalidReason.PlainOnly(),
            '=1:00'   : TimestampInvalidReason.PlainOnly(),
            '=I@1:00' : TimestampInvalidReason.PlainOnly(),
        };
        /* eslint-enable quote-props */

        this.#runTests(testCases, testRunner, 'One or more plain-only tests failed');
    }

    /** Test various other error conditions. */
    testMiscErrors() {
        const markers = [
            { start : 1000, end : 2000, markerType : 'intro' },
            { start : 3000, end : 4000, markerType : 'credits' },
        ];

        const chapters = [
            { start : 1000, end : 2000, name : 'Opening' },
            { start : 3000, end : 4000, name : 'Ending' },
        ];

        const testCases = {
            '=M1+Ch1'         : TimestampInvalidReason.MultipleReferences(),
            '=Ch(Opening)+I1' : TimestampInvalidReason.MultipleReferences(),
            '=Ch1+Ch2'        : TimestampInvalidReason.MultipleReferences(),
            '=M1-1:00+Ch2'    : TimestampInvalidReason.MultipleReferences(),
            '=-M1'            : TimestampInvalidReason.SubtractedReference('Marker'),
            '=-Ch1'           : TimestampInvalidReason.SubtractedReference('Chapter'),
            '=2 0 0 0'        : TimestampInvalidReason.NoOperator(),
            '=2M1'            : TimestampInvalidReason.NoOperator(),
            '=2 M1'           : TimestampInvalidReason.NoOperator(),
            '=Ch1 1:00'       : TimestampInvalidReason.NoOperator(),
        };

        this.#runTests(testCases, this.#advancedTestRunner.bind(this, markers, chapters), 'One or more miscellaneous error tests failed');
    }

    /**
     * Test equality of two TimeExpressions. */
    testEquality() {
        const eqt = (a='', b='', eq=true, strict=false, end=false) => ({
            expressionA : a,
            expressionB : b,
            areEqual    : eq,
            strict      : strict,
            isEnd       : end,
        });

        const testCases = [
            eqt('1', '1', true),
            eqt('1', '2', false),
            eqt('=1', '1', false), // Plain vs non-plain are not equal
            eqt('=Ch1', '=Ch1', true),
            eqt('=1000', '=1.', true),
            eqt('=1000', '=1.', false, true), // Strict mode not equal, since hms is different.
            eqt('=1:00', '=0:01:00.000', true),
            eqt('=1:00-1000', '=0:00:59.000', true),
            eqt('=1:00+Ch1', '=Ch1+1:00', true), // Order doesn't matter
            eqt('=60000+Ch1', '=Ch1+1:00', true), // More hms vs ms
            eqt('=60000+M1', '=M1+1:01-1000', true), // As long as final ms is the same, they're equal
            eqt('=1000 + C1', '=1000+C1', true), // Whitespace doesn't matter
            eqt('=Ch(Name)', '=Ch(/^Name$/i)', true), // Regex vs wildcard
            eqt('=Ch(Name)', '=Ch(/^Name$/i)', false, true), // Regex vs wildcard, strict
            eqt('=Ch(Name)', '=Ch(/Name/)', false),
            eqt('=M1', '=I1', false), // Different marker types. But could techinically be the same, TODO?
            eqt('=M1', '=M1', false, false, true), // Different isEnd
            eqt('=Ch1', '=Ch1', false, false, true), // Different isEnd
            eqt('=Ch1E', '=Ch1', true, false, true), // Different isEnd, but explicit end in start.
            eqt('=Ch1', '=Ch1S', true, false, true), // Different isEnd, but explicit start in end.
            eqt('=Ch1E', '=Ch1', false, true, true), // Not equal under strict mode, however.
        ];

        const allErrors = [];
        for (const { expressionA, expressionB, areEqual, strict, isEnd } of testCases) {
            const stateA = new TimeExpression(null, null, false).parse(expressionA);
            const stateB = new TimeExpression(null, null, isEnd).parse(expressionB);
            try {
                TestHelpers.verify(stateA.equals(stateB, strict) === areEqual,
                    `Expected "${expressionA}" and "${expressionB}" to be ${areEqual ? 'equal' : 'different'}`);
            } catch (e) {
                allErrors.push(e.message);
            }
        }

        if (allErrors.length > 0) {
            throw new Error(`One or more equality tests failed:\n\t\t${allErrors.join('\n\t\t')}`);
        }
    }

    /** Test the static TimeExpression.InTextReference */
    testInTextReference() {
        /** @typedef {{ input: string, cursor: number|string, expected: boolean }} TextRef */
        /**
         * @type {(input: string, cursor: number|string, expected: boolean) => TextRef} */
        const tr = (input, cursor, expected) => ({
            input,
            cursor,
            expected,
        });

        const testCases = [
            tr('=Ch(Chapter One)', '0-3', false),
            tr('=Ch(Chapter One)', '4-15', true),
            tr('=Ch(Chapter One)', 16, false),
            tr('=Ch()', 4, true),
            tr('=Ch()', 5, false),
            tr('=Ch(\\)1)', '4-7', true),
            tr('=Ch(\\)1)', 8, false),
            tr('=Ch(\\\\)1)', 7, false),
            tr('=Ch(\\\\\\)1)', 8, true),
            tr('=Ch(Not completed', '4-17', true),
            tr('=C@C2-1:00', '0-10', false),
        ];

        const allErrors = [];
        for (const { input, cursor, expected } of testCases) {
            let innerCases = [];
            if (typeof cursor === 'number') {
                innerCases = [cursor];
            } else {
                const match = cursor.match(/^(?<start>\d+)-(?<end>\d+)$/);
                innerCases = Array.from({ length : match.groups.end - match.groups.start + 1 }, (_, i) => i + (+match.groups.start));
            }

            for (const c of innerCases) {
                try {
                    TestHelpers.verify(TimeExpression.InTextReference(input, c) === expected,
                        `Expected "${input}" at index ${c} to ${expected ? '' : 'not '}be in a text reference`);
                } catch (e) {
                    allErrors.push(e.message);
                }
            }
        }

        if (allErrors.length > 0) {
            throw new Error(`One or more equality tests failed:\n\t\t${allErrors.join('\n\t\t')}`);
        }
    }

    /**
     * Test runner that runs multiple tests, building up a list of all errors it encounters.
     * Since TestHelpers.verify throws, this lets us run all the tests and then throw a single error
     * instead of returning as soon as the first error is seen. */
    #runTests(testCases, testFunc, errorHeader) {
        const errorMessages = [];
        for (const [input, expected] of Object.entries(testCases)) {
            try {
                testFunc(input, expected);
            } catch (e) {
                errorMessages.push(e.message);
            }
        }

        if (errorMessages.length > 0) {
            throw new Error(`${errorHeader}:\n\t\t${errorMessages.join('\n\t\t')}`);
        }
    }

    /**
     * Common helper for handing input to #testAdvanced.
     * @param {FakeMarkerData[]} markers The markers to attach to the expression.
     * @param {FakeChapterData[]} chapters See above.
     * @param {string} input Expression input
     * @param {number|string|any[]} expected The expected output. Can be a number for milliseconds, a string for an error
     *        (NaN implied), or an array of [expectedMs, expectedError, isEnd] arguments to pass to #testAdvanced. */
    #advancedTestRunner(markers, chapters, input, expected) {
        if (typeof expected === 'number') {
            this.#testAdvanced(input, markers, chapters, expected);
        } else if (typeof expected === 'string') {
            this.#testAdvanced(input, markers, chapters, NaN, expected);
        } else {
            this.#testAdvanced(input, markers, chapters, ...expected);
        }
    }

    /**
     * @param {string} input
     * @param {FakeMarkerData[]} markers
     * @param {FakeChapterData[]} chapters
     * @param {string} expected */
    #testToString(input, markers, chapters, expected) {
        const exp = new TimeExpression(markers, chapters, false /*isEnd*/, false /*plainOnly*/);
        exp.parse(input);
        const result = exp.toString();
        TestHelpers.verify(result === expected, `Expected "${input}" to transform to "${expected}", found "${result}"`);
    }

    /**
     * @param {string} input The text input
     * @param {FakeMarkerData[]} markers array of marker data
     * @param {FakeChapterData[]} chapters array of chapter data
     * @param {number} expectedMs Expected result in milliseconds
     * @param {string|null} expectedError Expected error, if any
     * @param {boolean} isEnd Whether this should emulate an end timestamp */
    #testAdvanced(input, markers, chapters, expectedMs, expectedError=null, isEnd=false) {
        const exp = new TimeExpression(markers, chapters, isEnd /*isEnd*/, false /*plainOnly*/);
        exp.parse(input);
        TestHelpers.verify(Object.is(expectedMs, exp.ms()), this.#msError(input, expectedMs, exp.ms()));
        if (expectedError) {
            const state = exp.state();
            TestHelpers.verify(!state.valid, `Expected "${input}" to be invalid`);
            TestHelpers.verify(expectedError === exp.state().invalidReason,
                `Expected "${input}" to have invalid reason "${expectedError}", found "${state.invalidReason}"`);
        } else {
            TestHelpers.verify(exp.state().valid, `Expected "${input}" to be valid`);
            TestHelpers.verify(!exp.state().invalidReason, `Expected "${input}" to have no invalid reason`);
        }
    }

    /**
     * @param {string} input The non-'=' input to test
     * @param {number} expectedMs The expected result in milliseconds, or NaN if an error is expected
     * @param {string|null} expectedError The expected error string, or null if no error is expected.
     * @param {boolean} skipEqualsCheck Whether to skip the followup check of the '=' form of the input. */
    #testPlain(input, expectedMs, expectedError=null, skipEqualsCheck=false) {
        // Test all four end/plain combinations, since the result should be the same across all of them.
        for (const args of [[false, false], [false, true], [true, false], [true, true]]) {
            const exp = new TimeExpression([], [], args[0] /*isEnd*/, args[1] /*plainOnly*/);
            exp.parse(input);
            TestHelpers.verify(Object.is(expectedMs, exp.ms()), this.#msError(input, expectedMs, exp.ms()));
            if (expectedError) {
                const state = exp.state();
                TestHelpers.verify(!state.valid, `Expected "${input}" to be invalid`);
                TestHelpers.verify(expectedError === exp.state().invalidReason,
                    `Expected "${input}" to have invalid reason "${expectedError}", found "${state.invalidReason}"`);
            } else {
                TestHelpers.verify(exp.state().valid, `Expected "${input}" to be valid`);
                TestHelpers.verify(!exp.state().invalidReason, `Expected "${input}" to have no invalid reason`);
            }

            // Also test =N syntax.
            if (!args[1] && !skipEqualsCheck) {
                this.#testSimpleEquals(input, expectedMs, expectedError);
            }
        }
    }

    /**
     * @param {string} plainInput The input to test (_without_ leading '=')
     * @param {number} expectedMs The expected result in ms, or NaN if an error is expected.
     * @param {string|null} expectedError The expected error string, or null if no error is expected. */
    #testSimpleEquals(plainInput, expectedMs, expectedError=null) {
        const eqInput = '=' + plainInput;
        for (const isEnd of [true, false]) {
            const exp = new TimeExpression([], [], isEnd, false /*plainOnly*/);
            exp.parse(eqInput);
            TestHelpers.verify(Object.is(expectedMs, exp.ms()), this.#msError(eqInput, expectedMs, exp.ms()));
            if (expectedError) {
                const state = exp.state();
                TestHelpers.verify(!state.valid, `Expected "${eqInput}" to be invalid`);
                TestHelpers.verify(expectedError === exp.state().invalidReason,
                    `Expected "${eqInput}" to have invalid reason "${expectedError}", found "${state.invalidReason}"`);
            } else {
                TestHelpers.verify(exp.state().valid, `Expected "${eqInput}" to be valid`);
                TestHelpers.verify(!exp.state().invalidReason, `Expected "${eqInput}" to have no invalid reason`);
            }
        }
    }

    /**
     * @param {string} input
     * @param {number} expected
     * @param {number} actual */
    #msError(input, expected, actual) {
        const v = n => Object.is(n, -0) ? '-0' : n;
        return `Expected "${input}" to result in ${v(expected)}, found ${v(actual)}`;
    }
}
