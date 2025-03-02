import { msToHms, timeToMs } from './Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { MarkerType } from '/Shared/MarkerType.js';

/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('/Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */

const Log = ContextualLog.Create('TimestampExpression');

class MarkerReference {
    /**
     * @type {'any'|'intro'|'credits'|'commercial'} */
    type = 'any';
    index = 0;
    start = false;
    implicit = false;

    /**
     * @param {string} [type]
     * @param {number} [index]
     * @param {boolean} [start]
     * @param {boolean} [implicit] */
    constructor(type, index, start, implicit) {
        if (type !== undefined) this.type = type;
        if (index !== undefined) this.index = index;
        if (start !== undefined) this.start = start;
        if (implicit !== undefined) this.implicit = implicit;
    }

    /**
     * Determine whether the given marker reference is equal to this one.
     * @param {MarkerReference} other The other reference to compare.
     * @param {boolean} strict Whether to check for exact equality, not just fields that affect the underlying timestamp. */
    equals(other, strict=false) {
        return this.type === other.type && this.index === other.index && this.start === other.start
            && (!strict || this.implicit === other.implicit);
    }

    clone() {
        return new MarkerReference(this.type, this.index, this.start, this.implicit);
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
    /** @type {MarkerReference} */
    markerRef;

    constructor(plain, valid, invalidReason, hms, ms, markerType, markerRef) {
        if (plain !== undefined) this.plain = plain;
        if (valid !== undefined) this.valid = valid;
        if (invalidReason !== undefined) this.invalidReason = invalidReason;
        if (hms !== undefined) this.hms = hms;
        if (ms !== undefined) this.ms = ms;
        if (markerType !== undefined) this.markerType = markerType;
        if (markerRef !== undefined) this.markerRef = markerRef.clone();
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

        if (!!this.markerRef !== !!other.markerRef) {
            return false;
        }

        if (this.markerRef && !this.markerRef.equals(other.markerRef, strict)) {
            return false;
        }

        return true;
    }

    /** Return a copy of this parse state */
    clone() {
        return new ParseState(this.plain, this.valid, this.invalidReason, this.hms, this.ms, this.markerType, this.markerRef);
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
    /** @type {MarkerData|SerializedMarkerData} */
    #matchedMarker;
    /** @type {string} The last string that was parsed. */
    #lastParse = null;

    /**
     * @param {MarkerData[]|SerializedMarkerData[]} markers
     * @param {boolean} isEnd
     * @param {boolean} plainOnly */
    constructor(markers, isEnd, plainOnly=false) {
        this.#isEnd = isEnd;
        this.#markers = markers;
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
        this.#validateMarkerReference();
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

        const ref = this.#state.markerRef;
        if (!ref) {
            return this.#state.ms;
        }

        if (!this.#matchedMarker) {
            // Cannot calculate timestamp if we don't have a media item reference.
            return null;
        }

        const ms = this.#state.ms + (ref.start ? this.#matchedMarker.start : this.#matchedMarker.end);

        if (!final || this.#state.ms !== 0) {
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
        return !!this.#state.markerRef;
    }

    /**
     * Sets the current time in milliseconds.
     * If no media item is set, only sets the raw milliseconds, otherwise
     * takes the current marker reference (if any) into account.
     * NOTE: While a delta approach would be easier, we would then need
     * custom handling for -0.
     * @param {number} newMs */
    setMs(newMs) {
        if (!this.#markers || !this.#state.markerRef) {
            this.#state.ms = newMs;
            return this;
        }

        const ref = this.#state.markerRef;
        this.#state.ms = newMs - (ref.start ? this.#matchedMarker.start : this.#matchedMarker.end);
        return this;
    }

    /**
     * Converts this expression to a human-readable string. Always uses '=MarkerRef+timestamp'
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

        let markerStr = '';
        const ref = state.markerRef;
        if (ref) {
            markerStr = keyFromMarkerType(ref.type) + ref.index.toString() + (ref.implicit ? '' : ref.start ? 'S' : 'E');
        }

        let timeStr = '';
        if (state.ms !== 0 || !ref) {
            if (state.hms || state.hms === null) {
                timeStr = msToHms(state.ms, true /*minify*/);
            } else {
                timeStr = Object.is(state.ms, -0) ? '-0' : state.ms.toString();
            }
        }

        let opStr = '';
        if (markerStr && timeStr && state.ms >= 0) {
            opStr += '+';
        }

        return this.#setString('=' + typeStr + markerStr + opStr + timeStr);
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

        // Validate markers immediately if cached values are available
        if (this.#markers) {
            this.#validateMarkerReference();
        }

        return state;
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

        if (this.#state.markerRef) {
            this.#setInvalid('Expressions can only reference a single marker.');
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
        this.#state.markerRef = new MarkerReference(
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
     * Matches an expression's marker reference to the actual marker, if it exists. */
    #validateMarkerReference() {
        if (!this.#markers) {
            throw new Error(`#validateMarkerReference - a media item is required to validate marker references.`);
        }

        if (!this.#state.valid || !this.#state.markerRef) {
            return;
        }


        const ref = this.#state.markerRef;
        const targetIndex = Math.abs(ref.index);

        if (targetIndex === 0) {
            this.#setInvalid('Marker index 0 is invalid, use 1-based indexing.');
            return;
        }

        const inc = ref.index < 0 ? -1 : 1;
        const loopEnd = inc < 0 ? -1 : this.#markers.length;
        let matchIndex = 0;
        const isAny = ref.type === 'any';
        for (let i = inc < 0 ? this.#markers.length - 1 : 0; i !== loopEnd; i += inc) {
            const marker = this.#markers[i];
            if (isAny || marker.markerType === ref.type) {
                if (++matchIndex === targetIndex) {
                    this.#matchedMarker = marker;
                    return;
                }
            }
        }

        this.#setInvalid(`Invalid marker index '${ref.index}': not enough ${ref.type === 'any' ? '' : ref.type + ' '}markers`);
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
