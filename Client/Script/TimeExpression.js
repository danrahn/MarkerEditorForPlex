import { msToHms, timeToMs } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { MarkerType } from '../../Shared/MarkerType.js';

/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').ChapterData} ChapterData */

const Log = ContextualLog.Create('TimestampExpression');

/**
 * All possible parsing errors. This is really only here for test validation, so that any
 * minor string updates won't result in test errors. */
export const TimestampInvalidReason = { // Could make some strings directly, but making everything a function simplifies things.
    PlainOnly : () => `Only plain expressions are allowed, cannot use '=' syntax.`,
    DoubleOperator : (op) => `Double operators not supported, found '${op}'.`,
    NoOperator : () => `No operator found between two expression parts.`,
    InvalidCharacter : (c, i) => `Unexpected character '${c}' at position ${i}.`,
    InvalidTimestamp : (t) => `Could not parse "${t}" as a timestamp.`,
    MarkerTypeInEndInput : () => `Marker type references are only allowed for start times.`,
    MarkerTypeNotAtStart : () => `Marker type references must be the first part of the expression`,
    MultipleTypeReferences : () => `Expressions can only reference a single marker type,`,
    MultipleReferences : () => `Expressions cannot have multiple marker/chapter references.`,
    SubtractedReference : (t) => `${t} references cannot be subtracted.`,
    InvalidRef : (t) => `Could not parse potential ${t} reference.`,
    BadWildcardEscape : (c) => `Unexpected escape character in chapter reference: '${c}'`,
    UnterminatedChapterRef : () => `Unterminated chapter name reference`,
    BadWildcardConversion : (exm) => `Could not convert name reference to a regular expression: ${exm}`,
    BadChapterRegex : (rgx, exm) => `Could not parse regular expression ${rgx}: ${exm}`,
    NoChapterRegex : (rgx) => `No chapter match for regex ${rgx}.`,
    NegativeTimestampWithRef : () => `Negative timestamps are not allowed with marker/chapter references.`,
    BadRefIndex : (t, i, c) => `Invalid ${t} index '${i}': not enough ${c}.`,
    ZeroRefIndex : () => `Reference index 0 is invalid, use 1-based indexing.`,
};

/**
 * Shared class with common attributes for all reference types.
 */
class BaseReference {
    index = 0;
    start = false;
    implicit = false;

    /**
     * @param {number} [index]
     * @param {boolean} [start]
     * @param {boolean} [implicit] */
    constructor(index, start, implicit) {
        if (index !== undefined) this.index = index;
        if (start !== undefined) this.start = start;
        if (implicit !== undefined) this.implicit = implicit;
    }

    /**
     * @param {BaseReference} other
     * @param {boolean} strict */
    equals(other, strict=false) {
        return this.index === other.index && this.start === other.start
            && (!strict || this.implicit === other.implicit);
    }

    toString() { Log.error('BaseReference::toString should be overridden.'); return ''; }
}

/**
 * A reference to a marker, which includes a marker type and an index.
 */
class MarkerReference extends BaseReference {
    /**
     * @type {'any'|'intro'|'credits'|'commercial'} */
    type = 'any';

    /**
     * @param {string} [type]
     * @param {number} [index]
     * @param {boolean} [start]
     * @param {boolean} [implicit] */
    constructor(type, index, start, implicit) {
        super(index, start, implicit);
        if (type !== undefined) this.type = type;
    }

    /**
     * Determine whether the given marker reference is equal to this one.
     * @param {BaseReference} other The other reference to compare.
     * @param {boolean} strict Whether to check for exact equality, not just fields that affect the underlying timestamp. */
    equals(other, strict=false) {
        return (other instanceof MarkerReference) && super.equals(other, strict) && this.type === other.type;
    }

    clone() {
        return new MarkerReference(this.type, this.index, this.start, this.implicit);
    }

    toString() {
        return keyFromMarkerType(this.type) + this.index.toString() + (this.implicit ? '' : this.start ? 'S' : 'E');
    }
}

/**
 * Encapsulates a named chapter reference, either via wildcard matching or a regular expression.
 */
class ChapterNameReference {
    /**
     * The underlying regex for this chapter name reference.
     * @type {RegExp} */
    nameRegex;
    /**
     * The underlying text for this chapter name reference, used for display
     * purposes (e.g. so we don't convert wildcard references to regex strings).
     * @type {string} */
    realText;
    /**
     * Whether this reference is a regular expression, or a wildcard-based reference.
     * @type {boolean} */
    isRegex;

    constructor(nameRegex, realText, isRegex) {
        this.nameRegex = nameRegex;
        this.realText = realText;
        this.isRegex = isRegex;
    }

    /**
     * @param {any} other
     * @param {boolean} strict */
    equals(other, strict=false) {
        return other instanceof ChapterNameReference
            && this.nameRegex.source === other.nameRegex.source
            && this.nameRegex.flags === other.nameRegex.flags
            && (!strict || (this.isRegex === other.isRegex && this.realText === other.realText));
    }

    clone() {
        return new ChapterNameReference(
            new RegExp(this.nameRegex.source, this.nameRegex.flags),
            this.realText,
            this.isRegex
        );
    }

    toString() {
        return this.isRegex ? `(/${this.nameRegex.source}/${this.nameRegex.flags})` : `(${this.realText})`;
    }
}

/**
 * A reference to a chapter, either via a chapter index or a name.
 */
class ChapterReference extends BaseReference {
    /** @type {ChapterNameReference} */
    nameRef;

    /**
     * @param {number} [index]
     * @param {ChapterNameReference} [nameRef]
     * @param {boolean} [start]
     * @param {boolean} [implicit] */
    constructor(index, nameRef, start, implicit) {
        super(index, start, implicit);
        this.nameRef = nameRef;
    }

    /**
     * Create an index-based ChapterReference.
     * @param {number} index
     * @param {boolean} start
     * @param {boolean} implicit
     * @returns {ChapterReference} */
    static fromIndex(index, start, implicit) {
        return new ChapterReference(index, undefined, start, implicit);
    }

    /**
     * Create a name-based ChapterReference.
     * @param {ChapterNameReference} nameRef
     * @param {boolean} start
     * @param {boolean} implicit
     * @returns {ChapterReference} */
    static fromRegex(nameRef, start, implicit) {
        return new ChapterReference(undefined, nameRef, start, implicit);
    }

    /**
     * Check if this ChapterReference equals another.
     * @param {BaseReference} other
     * @param {boolean} strict
     * @returns {boolean} */
    equals(other, strict = false) {
        if (!(other instanceof ChapterReference) || !super.equals(other, strict)) {
            return false;
        }

        return !this.nameRef && !other.nameRef || this.nameRef?.equals(other.nameRef, strict);
    }

    /**
     * Clone this ChapterReference.
     * @returns {ChapterReference} */
    clone() {
        return new ChapterReference(
            this.index,
            this.nameRef?.clone(),
            this.start,
            this.implicit
        );
    }

    /**
     * Convert this ChapterReference to a string.
     * @returns {string} */
    toString() {
        const innerRef = this.nameRef ? this.nameRef.toString() : this.index.toString();
        return 'Ch' + innerRef + (this.implicit ? '' : this.start ? 'S' : 'E');
    }
}

/** Map marker types to their expression identifier keys. */
const typeToKeyMap = {
    any : 'M',
    [MarkerType.Intro] : 'I',
    [MarkerType.Credits] : 'C',
    [MarkerType.Ad] : 'A'
};

/** Map expression identifiers to the underlying marker type. */
const keyToTypeMap = Object.keys(typeToKeyMap).reduce(
    (obj, k) => { obj[typeToKeyMap[k]] = k; return obj; }, {});

/**
 * @param {string} markerType */
function keyFromMarkerType(markerType) {
    return typeToKeyMap[markerType];
}

// Sets of valid characters/regexes for different subexpressions.

const validTimeChars = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ':']);
const validMarkerTypeChars = new Set(['M', 'I', 'C', 'A']);
const plusMinus = new Set(['+', '-']);
const startEnd = new Set (['S', 'E']);
const markerRefFormat = /^(?<type>\w)(?<index>-?\d+)(?<se>[SE])?\b/;
const chapterRefFormat = /^Ch(?<index>-?\d+)(?<se>[SE])?\b/;
const onlyDigits = /^\d+$/;

/**
 * Holds the parsed state of a timestamp expression.
 */
export class ParseState {
    /** Whether this is a "plain" text input, versus an advanced expression that starts with '=' */
    plain = true;
    valid = true;
    /** The reason why this expression isn't valid. */
    invalidReason = '';
    /**
     * @type {boolean} Whether the time component is using HMS- or millisecond-based timestamps. */
    hms = null;
    /* The number of milliseconds, not including any marker references. */
    ms = 0;
    /**
     * The type of marker to add, if any.
     * @type {'intro'|'credits'|'commercial'} */
    markerType;

    /**
     * The "advanced" reference (marker/chapter), if any.
     * @type {BaseReference} */
    advRef;

    constructor(plain, valid, invalidReason, hms, ms, markerType, reference) {
        if (plain !== undefined) this.plain = plain;
        if (valid !== undefined) this.valid = valid;
        if (invalidReason !== undefined) this.invalidReason = invalidReason;
        if (hms !== undefined) this.hms = hms;
        if (ms !== undefined) this.ms = ms;
        if (markerType !== undefined) this.markerType = markerType;
        if (reference !== undefined) this.advRef = reference.clone();
    }

    /**
     * Determine whether the given state is equal to this one.
     * @param {ParseState} other The other state to parse.
     * @param {boolean} strict Whether to check for exact equality, not just fields that affect the underlying timestamp. */
    equals(other, strict) {
        if (this.plain !== other.plain || this.ms !== other.ms || this.markerType !== other.markerType) {
            return false;
        }

        if (strict && (this.hms !== other.hms || this.valid !== other.valid || this.invalidReason !== other.invalidReason)) {
            return false;
        }

        return (!this.advRef && !other.advRef) || this.advRef?.equals(other.advRef, strict);
    }

    /** Return a copy of this parse state */
    clone() {
        return new ParseState(
            this.plain, this.valid, this.invalidReason, this.hms, this.ms, this.markerType, this.advRef);
    }

    /** @returns The ChapterReference associated with this state, or null if there is no chapter reference. */
    chapterReference() {
        return this.advRef instanceof ChapterReference ? this.advRef : null;
    }

    /** @returns The MarkerReference associated with this state, or null if there is no marker reference. */
    markerReference() {
        return this.advRef instanceof MarkerReference ? this.advRef : null;
    }
}

/**
 * Small helper to determine if the character at the given index is escaped.
 * Accounts for multiple escapes, so e.g. '\\)' isn't escaped, because the first \ escapes the second.
 * @param {string} text
 * @param {number} i */
function isEscaped(text, i) {
    let bs = 0;
    while (i - bs > 0 && text[i - ++bs] === '\\');
    return bs % 2 === 0; // Extra ++ means bs is off by one, so an even number means we are escaped.
}

/**
 * Encapsulates the logic necessary to parse an arbitrary timestamp expression.
 */
export class TimeExpression {
    #state = new ParseState();

    /** Whether to only allow plain expressions (e.g. bulk shift) */
    #plainOnly = false;
    /** Whether this is expression is associated with a start or end timestamp. */
    #isEnd = false;
    /**
     * The markers associated with this expression. Both MarkerData and SerializedMarkerData are allowed, since
     * we only need the index and start/end time, which are accessed identically between the two types.
     * @type {MarkerData[]|SerializedMarkerData[]} */
    #markers;
    /** @type {ChapterData[]} */
    #chapters;
    /**
     * The marker/chapter associated with the current expression, if any.
     * @type {MarkerData|SerializedMarkerData|ChapterData} */
    #matchedReference;
    /** @type {string} The last string that was parsed. */
    #lastParse = null;

    /**
     * @param {MarkerData[]|SerializedMarkerData[]|null} markers The markers associated with this item, or null if
     *                                                           this expression isn't tied to a specific media item.
     * @param {ChapterData[]|null} chapters The chapters associated with this item, or null if this expression isn't
     *                                      tied to a specific media item.
     * @param {boolean} isEnd Whether this expression is associated with an end timestamp.
     * @param {boolean} plainOnly Whether this expression is only allowed to use plain (non-'=') expressions. */
    constructor(markers, chapters, isEnd, plainOnly=false) {
        this.#isEnd = isEnd;
        this.#markers = markers;
        this.#chapters = chapters;
        this.#plainOnly = plainOnly;
    }

    /**
     * Returns whether the cursor is likely in a text reference (i.e. in the middle of a chapter name expression).
     * Not necessarily exact, but given the allowed syntax, should be good enough.
     * @param {string} text
     * @param {number} selectionStart The start cursor position */
    static InTextReference(text, selectionStart) {
        const openParen = text.indexOf('(');
        if (openParen === -1) {
            return false;
        }

        let closeParen = text.indexOf(')', openParen);
        if (closeParen === -1) {
            return true;
        }

        while (isEscaped(text, closeParen)) {
            closeParen = text.indexOf(')', closeParen + 1);
            if (closeParen === -1) {
                return true;
            }
        }

        return selectionStart > openParen && selectionStart <= closeParen;
    }

    /**
     * @readonly Retrieve the underlying parsed expression state. */
    state() {
        // Should .clone() so internal state can't be modified, but that's more expensive for theoretical safety.
        // If I ever convert this project to TS, then I could probably use readonly for this.
        return this.#state;
    }

    /**
     * Sets the expression state. Useful for bulk operations
     * where a single time input is applied to many items (i.e. bulk add).
     * @param {ParseState} state */
    updateState(state) {
        // Note that it could be more efficient to not clone this and have a direct
        // reference, but then we'd need to account for marker reference updates.
        // Perf tests show that even with hundreds of bulk operation targets, UI updates
        // still take up the vast majority of the time, so the cost of cloning really doesn't matter.
        this.#state = state.clone();
        if (!this.#state.advRef) {
            // No advanced ref means we should reset the matched reference.
            this.#matchedReference = null;
        }

        this.#validateReferences();
        return this;
    }

    /**
     * Retrieve the underlying millisecond timestamp for this expression.
     * @returns {number} The calculated timestamp, NaN if the expression is invalid, or null if there's
     *                   a marker/chapter reference with no marker/chapter data available. */
    ms(final=false) {
        if (!this.#state.valid) {
            return NaN;
        }

        const ref = this.#state.advRef;
        if (!ref) {
            return this.#state.ms;
        }

        if (!this.#matchedReference) {
            // Cannot calculate timestamp if we don't have a media item reference.
            return null;
        }

        const ms = this.#state.ms + (ref.start ? this.#matchedReference.start : this.#matchedReference.end);

        if (!final || this.#state.ms !== 0 || !(this.#state.advRef instanceof MarkerReference)) {
            return ms;
        }

        // With plain marker notation, +/- 0.001 to avoid overlap,
        // unless that would make us go negative.
        return ms + (ref.start ? (ms === 0 ? 0 : -1) : 1);
    }

    /**
     * Return whether the expression contains any references that require additional
     * data to be calculated (e.g. marker references). */
    isAdvanced() {
        return !!this.#state.advRef;
    }

    /**
     * Sets the current time in milliseconds.
     * If no media item is set, only sets the raw milliseconds, otherwise
     * takes the current marker reference (if any) into account.
     * NOTE: While a delta approach would be easier, we would then need
     * custom handling for -0.
     * @param {number} newMs */
    setMs(newMs) {
        if (!this.#state.advRef || !this.#matchedReference) {
            this.#state.ms = newMs;
            return this;
        }

        const ref = this.#state.advRef;
        this.#state.ms = newMs - (ref.start ? this.#matchedReference.start : this.#matchedReference.end);
        return this;
    }

    /**
     * Converts this expression to a human-readable string. Always uses '=MarkerOrChapterRef+timestamp'
     * notation, regardless of underlying input entry. */
    toString() {
        const state = this.#state;

        // If the state is invalid, just return the lastParse string
        if (!state.valid) {
            return this.#lastParse;
        }

        if (state.plain) {
            return this.#setString((state.hms ? msToHms(state.ms) : state.ms).toString());
        }

        let typeStr = '';
        if (state.markerType) {
            typeStr = keyFromMarkerType(state.markerType) + '@';
        }

        const refStr = state.advRef?.toString() || '';

        let timeStr = '';
        if (state.ms !== 0 || !refStr) {
            if (state.hms || state.hms === null) {
                timeStr = msToHms(state.ms, true /*minify*/);
            } else {
                timeStr = Object.is(state.ms, -0) ? '-0' : state.ms.toString();
            }
        }

        let opStr = '';
        if (refStr && timeStr && state.ms >= 0) {
            opStr += '+';
        }

        return this.#setString('=' + typeStr + refStr + opStr + timeStr);
    }

    /**
     * Updates the last parsed text. Useful when a TimeInput explicitly adjusts the time.
     *
     * Note that this is somewhat dangerous, as it could result in timestamps being
     * displayed that don't match the underlying expression. It's best to force a
     * re-parse before committing any changes.
     * @param {string} text */
    #setString(text) {
        this.#lastParse = text;
        return text;
    }

    #reset(full=false) {
        // We want hms/ms state to be "sticky" unless it's a full reset (i.e. empty text)
        const wasHms = this.#state.hms;
        this.#state = new ParseState();
        this.#lastParse = null;
        this.#matchedReference = null;
        if (!full) {
            this.#state.hms = wasHms;
        }
    }

    /**
     * Parse the given text as an expression, returning the parsed state.
     * @param {string} text
     * @returns A copy of the parsed expression. */
    parse(text, force=false) {
        // Clone so the internal state can't be influenced by external callers.
        return this.#parse(text, force).clone();
    }

    /**
     * @param {string} text */
    #parse(text, force=false) {
        text = text.trim();
        if (!force && text === this.#lastParse) {
            // This is expected when multiple callers want to ensure
            // the latest state.
            Log.tmi(`Same string "${text}", not parsing`);
            return this.#state;
        }

        this.#reset(!text.length);
        this.#lastParse = text;
        if (this.#checkPlain(text)) {
            return this.#state;
        }

        const state = this.#state;
        state.plain = false;
        let foundNumber = false;
        let foundOp = false;

        let i = 1;
        let negative = false;
        while (i < text.length) {
            const c = text[i];

            if (plusMinus.has(c)) {
                Log.assert(!negative, 'Negative flag should always be false when starting expression parsing.');

                negative = c === '-';
                foundOp = true;
                if (plusMinus.has(text[++i])) {
                    // No double negatives or "1+-2"/"1-+2"/etc.
                    return this.#setInvalid('DoubleOperator', c+text[i]);
                }

                continue;
            }

            if (/\s/.test(c)) {
                // Skip whitespace
                ++i;
                continue;
            }

            if ((foundNumber || state.advRef) && !foundOp) {
                // If we've already found a number, but no operator, then we're missing an operator.
                this.#setInvalid('NoOperator');
            }

            if (c === 'C' && text[i + 1] === 'h') {
                i = this.#parseChapterReference(text, i, negative);
                if (!i) return state;
                continue;
            }

            if (validMarkerTypeChars.has(c)) {
                i = this.#parseMarkerReference(text, i, negative);
                if (!i) return state;
                continue;
            }

            if (validTimeChars.has(c)) {
                i = this.#parseTimeReference(text, i, negative, foundNumber, foundOp);
                if (!i) return state;
                negative = false;
                foundNumber = true;
                continue;
            }

            // If we're here, we didn't hit a valid start to a subexpression.
            return this.#setInvalid('InvalidCharacter', c, i);
        }

        if (state.hms === null) {
            state.hms = true; // No standalone times means default to hms.
        }

        // Validate references immediately if cached values are available
        this.#validateReferences();

        return state;
    }

    /**
     * Check for plain text input, returning true if plain text was handled.
     * @param {string} text */
    #checkPlain(text) {
        if (!text || text.length === 0) {
            this.#state.hms = true;
            return true;
        }

        if (text[0] !== '=') {
            this.#parsePlain(text);
            return true;
        }

        if (this.#plainOnly) {
            this.#setInvalid('PlainOnly');
            return true;
        }

        return false;
    }

    /** Parse plain (no leading '=') input, which can only be a single timestamp. */
    #parsePlain(text) {
        const state = this.#state;
        state.ms = timeToMs(text, true /*allowNegative*/);
        state.valid = !isNaN(state.ms);
        if (!state.valid) {
            this.#setInvalid('InvalidTimestamp', text);
            return state;
        }

        state.hms = !onlyDigits.test(text);
        return state;
    }

    /**
     * Parse a potential chapter reference starting at text[i]
     * @param {string} text
     * @param {number} i
     * @param {boolean} negative
     * @returns The new value of i, or 0 if parsing failed. */
    #parseChapterReference(text, i, negative) {
        if (this.#state.advRef) {
            this.#setInvalid('MultipleReferences');
            return 0;
        }

        if (negative) {
            this.#setInvalid('SubtractedReference', 'Chapter');
            return 0;
        }

        const chapterData = chapterRefFormat.exec(text.substring(i));
        if (!chapterData) {
            if (text[i + 2] === '(') {
                return this.#parseChapterTextReference(text, i);
            }

            this.#setInvalid('InvalidRef', 'chapter');
            return 0;
        }

        const se = chapterData.groups.se;
        this.#state.advRef = ChapterReference.fromIndex(
            parseInt(chapterData.groups.index),
            se ? se === 'S' : !this.#isEnd, // Opposite of marker reference, start timestamps use chapter start implicitly.
            !se /*implicit*/
        );

        return i + chapterData.groups.index.length + (se ? 1 : 0) + 2;
    }

    /**
     * Parse a potential chapter name reference, starting at text[i].
     * @param {string} text
     * @param {number} i
     * @returns The new value of i, or 0 if parsing failed. */
    #parseChapterTextReference(text, i) {
        // Two potential forms, Ch(Wildcard*Syntax?) or Ch(/Regex/).
        if (text[i + 3] === '/') {
            return this.#parseChapterRegex(text, i);
        }

        // Wildcard syntax. Replace '*' with '.*' and '?' with '.', and escape any other special characters.
        const regexChars = new Set(['.', '*', '+', '?', '^', '=', '!', ':', '$', '{', '}', '(', ')', '|', '[', ']', '/', '\\']);
        let wildcardToRegex = '';
        i += 3; // Skip past the '(' in 'Ch('
        const startI = i;

        // This needs much more thorough testing, but it's a start.
        while (i < text.length && text[i] !== ')') {
            const c = text[i++];
            if (c === '\\') {
                // Only '*', '?', '\' and ')' need to be escaped, but also allow escaping regex characters to be friendlier.
                if (regexChars.has(text[i])) {
                    wildcardToRegex += '\\' + text[i++];
                } else if (text[i] === 't') {
                    // Don't allow most escape sequences, but allow '\t' for tabs.
                    wildcardToRegex += '\\t';
                    ++i;
                } else {
                    this.#setInvalid('BadWildcardEscape', text[i]);
                    return 0;
                }
            } else if (c === '*') {
                wildcardToRegex += '.*';
            } else if (c === '?') {
                wildcardToRegex += '.';
            } else if (regexChars.has(c)) {
                wildcardToRegex += '\\' + c;
            } else {
                wildcardToRegex += c;
            }
        }

        if (i >= text.length) {
            this.#setInvalid('UnterminatedChapterRef');
            return 0;
        }

        const baseText = text.substring(startI, i);

        const implicitSE = !startEnd.has(text[i + 1]);
        const isStart = implicitSE ? !this.#isEnd : text[++i] === 'S';

        let chapterRegex;
        try {
            chapterRegex = new RegExp('^' + wildcardToRegex + '$', 'i');
        } catch (ex) {
            this.#setInvalid('BadWildcardConversion', ex.message);
            return 0;
        }

        const nameRef = new ChapterNameReference(chapterRegex, baseText, false /*isRegex*/);
        this.#state.advRef = ChapterReference.fromRegex(nameRef, isStart, implicitSE);
        return i + 1;
    }

    /**
     * Attempt to parse a regex-based chapter name reference, starting at text[i].
     * @param {string} text
     * @param {number} i
     * @returns The new value of i, or 0 if parsing failed. */
    #parseChapterRegex(text, i) {
        const startI = i + 4;
        let endI = startI;
        while (endI < text.length) {
            if (text[endI] === '/' && !isEscaped(text, endI)) {
                break;
            }

            ++endI;
        }

        if (endI >= text.length) {
            this.#setInvalid('UnterminatedChapterRef');
            return 0;
        }

        const flags = text[endI + 1] === 'i' ? 'i' : '';
        if (text[endI + (flags ? 2 : 1)] !== ')') {
            this.#setInvalid('UnterminatedChapterRef');
            return 0;
        }

        const rgxStr = text.substring(startI, endI);
        endI += flags ? 2 : 1;
        let chapterRegex;
        try {
            chapterRegex = new RegExp(rgxStr, flags);
        } catch (ex) {
            this.#setInvalid('BadChapterRegex', `/${rgxStr}/${flags}`, ex.message);
            return 0;
        }

        const implicitSE = !startEnd.has(text[endI + 1]);
        const isStart = implicitSE ? !this.#isEnd : text[++endI] === 'S';
        const nameRef = new ChapterNameReference(chapterRegex, rgxStr, true /*isRegex*/);
        this.#state.advRef = ChapterReference.fromRegex(nameRef, isStart, implicitSE);
        return endI + 1;
    }

    /**
     * Parses a potential marker reference in the given text, starting at character i.
     * Also checks for explicit marker type references (e.g. 'I@XXX' to add an intro marker).
     * @param {string} text
     * @param {number} i
     * @returns {number} The new value of i, or 0 if parsing failed. */
    #parseMarkerReference(text, i, negative) {
        const c = text[i];

        // First check for a marker type reference. Relies on this only being called when
        // a valid marker type character is at the current position.
        if (c !== 'M' && text[i + 1] === '@') {
            if (this.#isEnd) {
                // Marker type references are only allowed for start times.
                this.#setInvalid('MarkerTypeInEndInput');
                return 0;
            }

            // Must be the first part of the expression (sans whitespace).
            if (i !== 1) {
                let j = i;
                while (j > 1 && /\s/.test(text[--j]));
                if (j > 1) {
                    this.#setInvalid('MarkerTypeNotAtStart');
                    return 0;
                }
            }

            if (this.#state.markerType) {
                // TODO: is this possible?
                this.#setInvalid('MultipleReferences');
                return 0;
            }

            this.#state.markerType = keyToTypeMap[c];
            return i + 2;
        }

        if (this.#state.advRef) {
            this.#setInvalid('MultipleReferences');
            return 0;
        }

        if (negative) {
            this.#setInvalid('SubtractedReference', 'Marker');
            return 0;
        }

        const markerData = markerRefFormat.exec(text.substring(i));
        if (!markerData) {
            this.#setInvalid('InvalidRef', 'marker');
            return 0;
        }

        const se = markerData.groups.se;
        this.#state.advRef = new MarkerReference(
            keyToTypeMap[markerData.groups.type],
            parseInt(markerData.groups.index),
            se ? se === 'S' : this.#isEnd,
            !se /*implicit*/
        );

        return i + markerData.groups.index.length + (se ? 1 : 0) + 1;
    }

    /**
     * @param {string} text
     * @param {number} i
     * @param {boolean} negative
     * @returns The new value of i, or 0 if parsing failed. */
    #parseTimeReference(text, i, negative) {
        const iStart = i;
        while (validTimeChars.has(text[++i]));
        const timeString = text.substring(iStart, i);
        const ms = timeToMs(timeString);
        if (isNaN(ms)) {
            this.#setInvalid('InvalidTimestamp', timeString);
            return 0;
        }

        // Need special handling for '=-0'
        const add = negative ? -ms : ms;
        this.#state.ms = this.#state.ms === 0 ? add : this.#state.ms + add;

        // HMS overrides any single ms instance
        this.#state.hms ||= !onlyDigits.test(timeString);
        return i;
    }

    /**
     * If marker/chapter data is available, verify the reference points to a valid marker/chapter.
     * If the reference is invalid, set the expression as invalid. */
    #validateReferences() {
        if (this.#markers) {
            this.#validateMarkerReference();
        }

        if (this.#chapters) {
            this.#validateChapterReference();
        }

        // With a marker/chapter reference, don't allow negative timestamps,
        // as I don't see a use case for it.
        if (this.#matchedReference && this.ms() < 0) {
            this.#setInvalid('NegativeTimestampWithRef');
        }
    }

    /**
     * Matches an expression's marker reference to the actual marker, if it exists. */
    #validateMarkerReference() {
        if (!this.#markers) {
            throw new Error(`#validateMarkerReference - a media item is required to validate marker references.`);
        }

        if (!this.#state.valid || !this.#state.markerReference()) {
            return;
        }

        const ref = this.#state.advRef;
        this.#matchedReference = this.#matchIndexReference(ref, this.#markers);
        if (!this.#matchedReference && this.#state.valid) {
            this.#setInvalid('BadRefIndex', 'marker', ref.index, (ref.type === 'any' ? '' : ref.type + ' ') + 'markers');
        }
    }

    /**
     * Matches an expression's chapter reference to the actual chapter, if it exists. */
    #validateChapterReference() {
        if (!this.#chapters) {
            throw new Error(`#validateChapterReference - chapters are required to validate chapter references.`);
        }

        const state = this.#state;
        if (!state.valid || !state.chapterReference()) {
            return;
        }

        const chapterRef = state.chapterReference();
        if (chapterRef.nameRef) {
            this.#matchedReference = this.#matchRegexReference(chapterRef, this.#chapters);
        } else {
            this.#matchedReference = this.#matchIndexReference(chapterRef, this.#chapters);
            if (!this.#matchedReference && state.valid) {
                this.#setInvalid('BadRefIndex', 'chapter', chapterRef.index, 'chapters');
            }
        }
    }

    /**
     * @param {BaseReference} ref
     * @param {MarkerData[]|SerializedMarkerData[]|ChapterData[]} items */
    #matchIndexReference(ref, items) {
        const targetIndex = Math.abs(ref.index);
        const isMarker = ref instanceof MarkerReference;

        if (targetIndex === 0) {
            this.#setInvalid('ZeroRefIndex');
            return;
        }

        const inc = ref.index < 0 ? -1 : 1;
        const loopEnd = inc < 0 ? -1 : items.length;
        let matchIndex = 0;
        const isAny = !isMarker || ref.type === 'any';
        for (let i = inc < 0 ? items.length - 1 : 0; i !== loopEnd; i += inc) {
            const item = items[i];
            if (isAny || item.markerType === ref.type) {
                if (++matchIndex === targetIndex) {
                    return item;
                }
            }
        }
    }

    /**
     * Matches an expression's chapter reference to the actual chapter using a regex, if it exists.
     * @param {ChapterReference} ref The chapter reference containing the regex.
     * @param {ChapterData[]} items The list of chapters to search through.
     * @returns {ChapterData|null} The matched chapter if found, otherwise null. */
    #matchRegexReference(ref, items) {
        const rgx = ref.nameRef.nameRegex;
        for (const item of items) {
            if (rgx.test(item.name)) {
                // TODO: handle multiple references.
                return item;
            }
        }

        this.#setInvalid('NoChapterRegex', `/${rgx.source}/${rgx.flags}`);
    }

    /**
     * Set this expression invalid with the given reason.
     * Return the parsed expression to make our lives easier in some places.
     * @param {keyof TimestampInvalidReason} reason
     * @param {...any} args Additional args to pass into the invalid reason function. */
    #setInvalid(reason, ...args) {
        this.#state.valid = false;
        this.#state.invalidReason = TimestampInvalidReason[reason](...args);
        return this.#state;
    }
}
