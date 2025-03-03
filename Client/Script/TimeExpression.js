import { msToHms, timeToMs } from './Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { MarkerType } from '/Shared/MarkerType.js';

/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('/Shared/PlexTypes').ChapterData} ChapterData */

const Log = ContextualLog.Create('TimestampExpression');

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

// TODO: (in other classes) - if end input is blank and there's a non-specific start/end chapter reference,
// apply the same reference to the end input.

// TODO: name-based chapter references (Ch='Opening', Ch="Ending", Ch='Chapter\'s Name').
//       also need to account for paste/allowed characters. Basically means we either allow
//       any character input, or add a specific handler that only allows arbitrary when we think we're
//       in a chapter reference (invalid=true + extra flag indicating that state?).

/**
 * A reference to a chapter. Currently only supports index-based references, so no extra fields on top of the BaseReference.
 */
class ChapterReference extends BaseReference {
    /**
     * @param {number} [index]
     * @param {boolean} [start]
     * @param {boolean} [implicit] */
    constructor(index, start, implicit) {
        super(index, start, implicit);
    }

    /**
     * @param {BaseReference} other
     * @param {boolean} strict */
    equals(other, strict=false) {
        return (other instanceof ChapterReference) && super.equals(other, strict);
    }

    clone() {
        return new ChapterReference(this.index, this.start, this.implicit);
    }

    toString() {
        return 'Ch' + this.index.toString() + (this.implicit ? '' : this.start ? 'S' : 'E');
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
        if (this.plain !== other.plain || this.hms !== other.hms || this.ms !== other.ms || this.markerType !== other.markerType) {
            return false;
        }

        if (strict && (this.valid !== other.valid || this.invalidReason !== other.invalidReason)) {
            return false;
        }

        if (!!this.advRef !== !!other.advRef) {
            return false;
        }

        return !this.advRef || this.advRef.equals(other.advRef, strict);
    }

    /** Return a copy of this parse state */
    clone() {
        return new ParseState(
            this.plain, this.valid, this.invalidReason, this.hms, this.ms, this.markerType, this.advRef);
    }
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
    /** @type {MarkerData[]|SerializedMarkerData[]} */
    #markers;
    /** @type {ChapterData[]} */
    #chapters;
    /** @type {MarkerData|SerializedMarkerData|ChapterData} */
    #matchedReference;
    /** @type {string} The last string that was parsed. */
    #lastParse = null;

    /**
     * @param {MarkerData[]|SerializedMarkerData[]} markers
     * @param {ChapterData[]} chapters
     * @param {boolean} isEnd
     * @param {boolean} plainOnly */
    constructor(markers, chapters, isEnd, plainOnly=false) {
        this.#isEnd = isEnd;
        this.#markers = markers;
        this.#chapters = chapters;
        this.#plainOnly = plainOnly;
    }

    /**
     * @readonly Retrieve the underlying parsed expression state. */
    state() {
        // Should .clone() so internal state can't be modified, but that's expensive.
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
     * If the expression is invalid, returns NaN, and if there's a marker reference without
     * a matched marker, return null. */
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
        text = text.replace(/ /g, '');
        if (!force && text === this.#lastParse) {
            // This is expected when multiple callers want to ensure
            // the latest state.
            Log.tmi(`Same string "${text}", not parsing`);
            return this.#state;
        }

        this.#reset(!text.length);
        const state = this.#state;
        if (!text || text.length === 0) {
            state.hms = true;
            return state;
        }

        if (text[0] !== '=') {
            state.ms = timeToMs(text, true /*allowNegative*/);
            state.valid = !isNaN(state.ms);
            if (!state.valid) {
                state.invalidReason = 'Timestamp could not be parsed';
            }

            state.hms = !onlyDigits.test(text);
            return state;
        }

        if (this.#plainOnly) {
            return this.#setInvalid(`Only plain expressions are allowed, cannot use '=' syntax`);
        }

        state.plain = false;

        let i = 1;
        let negative = false;
        while (i < text.length) {
            const c = text[i];
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
                i = this.#parseTimeReference(text, i, negative);
                if (!i) return state;
                negative = false;
                continue;
            }

            if (plusMinus.has(c)) {
                Log.assert(!negative, 'Negative flag should always be false when starting expression parsing.');

                negative = c === '-';
                if (plusMinus.has(text[++i])) {
                    // No double negatives or "1+-2"/"1-+2"/etc.
                    return this.#setInvalid(`Invalid operator sequence '${c+text[i]}'. Only a single operator is supported`);
                }

                continue;
            }

            // If we're here, we didn't hit a valid start to a subexpression.
            return this.#setInvalid(`Unexpected character '${c}' at position ${i}.`);
        }

        if (state.hms === null) {
            state.hms = true; // No standalone times means default to hms.
        }

        // Validate references immediately if cached values are available
        this.#validateReferences();

        return state;
    }

    #parseChapterReference(text, i, negative) {
        if (this.#state.advRef) {
            this.#setInvalid('Expressions cannot have multiple marker/chapter references.');
            return 0;
        }

        if (negative) {
            this.#setInvalid('Chapter references cannot be subtracted.');
            return 0;
        }

        const chapterData = chapterRefFormat.exec(text.substring(i));
        if (!chapterData) {
            this.#setInvalid('Could not parse potential chapter reference.');
            return 0;
        }

        const se = chapterData.groups.se;
        this.#state.advRef = new ChapterReference(
            parseInt(chapterData.groups.index),
            se ? se === 'S' : !this.#isEnd, // Opposite of marker reference, start timestamps use chapter start implicitly.
            !se /*implicit*/
        );

        return i + chapterData.groups.index.length + (se ? 1 : 0) + 2;
    }

    /**
     * Parses a potential marker reference in the given text, starting at character i.
     * Also checks for explicit marker type references (e.g. 'I@XXX' to add an intro marker).
     * @param {string} text
     * @param {number} i
     * @returns {number} The new value of i */
    #parseMarkerReference(text, i, negative) {
        const c = text[i];

        // First check for a marker type reference. Relies on this only being called when
        // a valid marker type character is at the current position.
        if (c !== 'M' && text[i + 1] === '@') {
            if (this.#isEnd) {
                // Marker type references are only allowed for start times.
                this.#setInvalid('Marker type references are only allowed for start times.');
                return 0;
            }

            // Must be the first part of the expression. Relies on the caller removing whitespace.
            if (i !== 1) {
                this.#setInvalid('Marker type references must be the first part of the expression.');
                return 0;
            }

            if (this.#state.markerType) {
                this.#setInvalid('Expressions can only reference a single marker type.');
                return 0;
            }

            this.#state.markerType = keyToTypeMap[c];
            return i + 2;
        }

        if (this.#state.advRef) {
            this.#setInvalid('Expressions cannot have multiple marker/chapter references.');
            return 0;
        }

        if (negative) {
            this.#setInvalid('Marker references cannot be subtracted.');
            return 0;
        }

        const markerData = markerRefFormat.exec(text.substring(i));
        if (!markerData) {
            this.#setInvalid('Could not parse potential marker reference.');
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
        while (validTimeChars.has(text[i++]));
        const timeString = text.substring(iStart, i);
        const ms = timeToMs(timeString);
        if (isNaN(ms)) {
            this.#setInvalid(`Could not parse "${timeString}" as a timestamp.`);
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
            this.#setInvalid('Negative timestamps are not allowed with marker/chapter references.');
        }
    }

    /**
     * Matches an expression's marker reference to the actual marker, if it exists. */
    #validateMarkerReference() {
        if (!this.#markers) {
            throw new Error(`#validateMarkerReference - a media item is required to validate marker references.`);
        }

        if (!this.#state.valid || !this.#state.advRef || !(this.#state.advRef instanceof MarkerReference)) {
            return;
        }

        const ref = this.#state.advRef;
        this.#matchedReference = this.#matchIndexReference(ref, this.#markers);
        if (!this.#matchedReference) {
            this.#setInvalid(`Invalid marker index '${ref.index}': not enough ${ref.type === 'any' ? '' : ref.type + ' '}markers`);
        }
    }

    /**
     * Matches an expression's chapter reference to the actual chapter, if it exists. */
    #validateChapterReference() {
        if (!this.#chapters) {
            throw new Error(`#validateChapterReference - chapters are required to validate chapter references.`);
        }

        if (!this.#state.valid || !this.#state.advRef || !(this.#state.advRef instanceof ChapterReference)) {
            return;
        }

        this.#matchedReference = this.#matchIndexReference(this.#state.advRef, this.#chapters);
        if (!this.#matchedReference) {
            this.#setInvalid(`Invalid chapter index '${this.#state.advRef.index}': not enough chapters`);
        }
    }

    /**
     * @param {BaseReference} ref
     * @param {MarkerData[]|SerializedMarkerData[]|ChapterData[]} items */
    #matchIndexReference(ref, items) {
        const targetIndex = Math.abs(ref.index);

        if (targetIndex === 0) {
            this.#setInvalid('Reference index 0 is invalid, use 1-based indexing.');
            return;
        }

        const inc = ref.index < 0 ? -1 : 1;
        const loopEnd = inc < 0 ? -1 : items.length;
        let matchIndex = 0;
        for (let i = inc < 0 ? items.length - 1 : 0; i !== loopEnd; i += inc) {
            const item = items[i];
            if (++matchIndex === targetIndex) {
                return item;
            }
        }
    }

    /**
     * Set this expression invalid with the given reason.
     * Return the parsed expression to make our lives easier in some places.
     * @param {string} reason */
    #setInvalid(reason) {
        this.#state.valid = false;
        this.#state.invalidReason = reason;
        return this.#state;
    }
}
