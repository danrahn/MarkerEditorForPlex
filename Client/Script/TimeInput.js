import { $textInput, toggleClass } from './HtmlHelpers.js';
import { msToHms, timeToMs } from './Common.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { MarkerType } from '/Shared/MarkerType.js';

/** @typedef {!import('./ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */

const Log = ContextualLog.Create('TimeInput');

/**
 * @typedef {Object} MarkerReference
 * @property {string} type
 * @property {number} index
 * @property {boolean} start
 * @property {boolean} implicit Whether 'start' was implied based on isEnd, not an explicit reference.
 * @property {MarkerData} marker The actual marker indicated by the above fields.
*/

// TODO: This should probably be a class
/**
 * @typedef {Object} TimestampExpression
 * @property {boolean} plain Whether this is a "plain" input, versus an advanced expression that starts with '='
 * @property {boolean} valid
 * @property {string} [invalidReason] The reason this expression isn't valid
 * @property {boolean} hms Whether the time component is using HMS or millisecond based timestamps.
 * @property {MarkerReference} [markerRef] If a marker-based expression, the marker reference
 * @property {number} ms The number of ms represented, not including any potential markerRef
 * */


const typeToKeyMap = {
    any : 'M',
    [MarkerType.Intro] : 'I',
    [MarkerType.Credits] : 'C',
    [MarkerType.Ad] : 'A'
};

/**
 * @param {'M'|'I'|'C'|'A'} key */
function markerTypeFromKey(key) {
    return Object.keys(typeToKeyMap).find(type => typeToKeyMap[type] === key);
}

/**
 * @param {string} markerType */
function keyFromMarkerType(markerType) {
    return typeToKeyMap[markerType];
}

const validTimeChars = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ':']);

/* eslint-disable quote-props */ // Quotes are cleaner here
/**
 * Map of time input shortcut keys that will increase/decrease the time by specific values.
 *
 * Values are functions, as there are also two 'special' keys, '\' and '|' (Shift+\), which
 * rounds the current value to the nearest second/tenth of a second.
 *
 * The logic behind the values is that '-' and '=' are the "big" changes, and shift ('_', '+')
 * makes it even bigger, while '[' and ']' are the "small" changes, so shift ('{',  '}')
 * makes it even smaller. Combined with Alt, this gives us the ability to change the timings
 * by 5m, 1m, 50s, 10s, 5s, 1s, 0.5s, or .1s without manually typing specific numbers.
 *
 * In "expression mode", swap -/= with O and P to avoid overlap. */

const smallAdjustKeys = {
    '[' : -1000,
    ']' :  1000,
    '{' :  -100,
    '}' :   100,
};

const expressionAdjustKeys = {
    'O' : -60000,
    'P' :  60000,
    'o' : -10000,
    'p' :  10000,
    ...smallAdjustKeys
};

const adjustKeys = {
    '_'  : -60000, // Shift+-
    '+'  :  60000, // Shift+=
    '-'  : -10000, // -
    '='  :  10000, // +,
    ...smallAdjustKeys
};

/* eslint-enable */

/**
 * Round `c` to the nearest `f`, with a maximum value of `m`
 *
 * Exported for tests.
 * @param {number} c Current ms value
 * @param {number} m Maximum value
 * @param {number} f Truncation factor
 * @returns {number} */
export const roundDelta = (c, m, f, r=c % f) => r === 0 ? 0 : -r + ((m - c < f - r) || (r < (f / 2)) ? 0 : f);

/**
 * Map of "special" time input shortcuts that requires additional parameters
 * @type {{[key: string]: (currentMs: number, maxValue: number, altKey: boolean) => number}} */
const truncationKeys = {
    '\\' : (c, m, a) => roundDelta(c, m, a ? 5000 : 1000),
    '|'  : (c, m, a) => roundDelta(c, m, a ? 500 : 100)
};


/**
 * @param {ClipboardEvent} e */
function pasteListener(e) {
    const text = e.clipboardData.getData('text/plain');

    // TODO: Fine-tune this. Or I could just let paste do its thing even if the input is invalid.
    if (!/^[-+\d:.ACIMSE]*$/.test(text)) {
        const newText = text.replace(/[^-+\d:.ACIMSE]/g, '');
        e.preventDefault();

        // Only attempt to insert if our transformed data can be interpreted
        // as a valid timestamp.
        if (isNaN(timeToMs(newText, true /*allowNegative*/)) && isNaN(parseInt(newText))) {
            return;
        }

        try {
            document.execCommand('insertText', false, newText);
        } catch (ex) {
            /** @type {HTMLInputElement} */
            const target = e.target;
            Log.warn(ex, `Failed to execute insertText command`);
            // Most browsers still support execCommand even though it's deprecated, but if we did fail, try a direct replacement
            target.value = target.value.substring(0, target.selectionStart) + newText + target.value.substring(target.selectionEnd);
        }
    }
}

/**
 * Encapsulates the logic behind timestamp inputs. Two main input forms are allowed:
 *
 * * Standard HMS (1:23.456) and ms (83456) input
 * * Complex Expressions - these start with an '=' and can consist of:
 *   * Up to 1 marker expression, of the form MIL, where
 *     * M: marker type. M for any type, I for intro, C for credits, A for ad
 *     * I: marker index. Positive or negative. M3 is the third marker, C-1 is the last credits marker
 *     * L: location. S to use the marker's start location, E for the end. Nothing to infer automatically
 *   * 0 or more standard time expressions, joined with '+' or '-'. There's not really a reason to have
 *     multiple, but M3+2:00-60000 will parse without issues.
 *   * The marker expression cannot be subtracted. 1000-M1 is not valid, it must be 1000+M1.
 *   * If a marker expression is present, the timestamp cannot go negative. If the first marker starts at
 *     30 seconds, M1S-40.0 is not allowed.
 *
 * TODO: Better adapt this for bulk operations. There are currently two issues:
 *  * A mediaItem is required for complex expressions, which won't be the case for bulk operations.
 *  * The expression itself is tightly coupled to the UI. Expression parsing should be its own class, with
 *    a wrapper that adds the UI to it and handles shortcuts.
 */
export class TimeInput {
    /** @type {HTMLInputElement} */
    #input;

    /** @type {MediaItemWithMarkerTable} */
    #mediaItem;
    #isEnd = false;

    /**
     * @param {MediaItemWithMarkerTable} mediaItem
     * @param {{ [eventName: string]: Function[] }} events List of additional events to add to the input element.
     * @param {{ [attribute: string]: any }} Additional attributes to attach to the input element. */
    constructor(mediaItem, isEnd=false, events={}, attributes={}) {
        this.#mediaItem = mediaItem;
        this.#isEnd = isEnd;
        if (this.#mediaItem && !this.#mediaItem.markerTable()) {
            this.#mediaItem = undefined;
            Log.error(`Media item does not have a marker table, can't use expression-based parsing!`);
        }

        events.paste = [pasteListener, ...(events.paste || [])];
        events.keydown = [
            this.#handleSeek.bind(this),
            ...(events.keydown || [])
        ];

        if (attributes.customValidate) {
            delete attributes.customValidate;
        } else {
            events.keyup = [
                this.#validateInput.bind(this),
                ...(events.keyup || [])
            ];
        }

        this.#input = $textInput(
            {   type : 'text',
                maxlength : 24,
                placeholder : 'ms or mm:ss[.000]',
                autocomplete : 'off',
                ...attributes, },
            {
                ...events
            }
        );
    }

    /** Retrieve the underlying timestamp represented by the current value, in milliseconds.
     * @param {boolean} final */
    ms(final=false) {
        const exp = this.#parseExpression();
        return this.#ms(exp, final);
    }

    /**
     * Internal version that calculates the time from a cached expression.
     * @param {TimestampExpression} expression */
    #ms(expression, final=false) {
        if (!expression.valid) {
            return NaN;
        }

        const marker = expression.markerRef?.marker;
        if (marker) {
            let offset = 0;
            if (final && expression.ms === 0) {
                // With plain marker notation, +/- 0.001 to avoid overlap
                offset = expression.markerRef.start ? -1 : 1;
            }

            return expression.ms + (expression.markerRef.start ? marker.start : marker.end) + offset;
        }

        return expression.ms;
    }

    input() { return this.#input; }

    /**
     * @param {KeyboardEvent} _e */
    #validateInput(_e) {
        // TODO: Should this be cached? It's not _too_ heavy, but we might be calculating it a lot.
        const exp = this.#parseExpression();
        toggleClass(this.#input, 'invalid', !exp.valid);
        let title = '';
        if (exp.valid) {
            // No title for plain expressions that already use hms.
            if (!exp.plain || !exp.hms) {
                title = msToHms(this.#ms(exp), true /*minify*/);
            }
        } else {
            title = exp.invalidReason || 'Invalid input';
        }

        this.#input.title = title;
    }

    /**
     * Handles seek keyboard shortcuts. Also ensures invalid
     * characters aren't entered.
     * @param {KeyboardEvent} e */
    #handleSeek(e) {
        if (e.key.length !== 1 || e.ctrlKey) {
            return;
        }

        if (/[\d:.]/.test(e.key)) {
            // Always allow inputs that look like a timestamp
            return;
        }

        if (this.#shouldTypeNegative(e)) {
            return;
        }

        if (this.#shouldTypeEquals(e)) {
            return;
        }

        const isExpression = this.#mediaItem && this.#input.value[0] === '=';
        if (isExpression) {
            // Allow some additional characters in expression mode
            if (/[MCIASE+ -]/.test(e.key)) {
                return;
            }
        }

        // Regardless of whether we have a valid shortcut, we don't want
        // the character to be typed into the input
        e.preventDefault();

        const currentExpression = this.#parseExpression();

        // No need to do anything if the current expression isn't valid
        if (!currentExpression.valid) {
            return;
        }

        const simpleKeys = isExpression ? expressionAdjustKeys : adjustKeys;
        if (!truncationKeys[e.key] && !simpleKeys[e.key]) {
            return;
        }

        this.#calculateNewTimeInput(e, currentExpression, simpleKeys);
    }

    /**
     * Determine whether a '-' should be added to the input.
     * @param {KeyboardEvent} e */
    #shouldTypeNegative(e) {
        if (e.key !== '-') {
            return false;
        }

        // '-'/'='/'_'/'+' shortcuts disabled in expression mode, so always allow it (unless
        // it's replacing the leading '='). TODO: fine-tune this a bit?
        const input = this.#input;
        if (input.value[0] === '=') {
            return input.selectionStart !== 0;
        }

        return input.selectionStart === 0 && (input.value[0] !== '-' || input.selectionEnd !== 0);
    }

    /**
     * Determine whether a '=' should be added to the input.
     * @param {KeyboardEvent} e */
    #shouldTypeEquals(e) {
        if (e.key !== '=') {
            return false;
        }

        const input = this.#input;
        return this.#mediaItem && input.selectionStart === 0 && (input.value[0] !== '=' || input.selectionEnd !== 0);
    }

    /**
     * Parses the current input */
    /* eslint-disable-next-line complexity */ // The switch of multiple characters overinflates the complexity
    #parseExpression() {
        /** @type {TimestampExpression} */
        const expression = { plain : true, valid : true, ms : 0 };

        const value = this.#input.value;
        if (value.length === 0) {
            expression.hms = true;
            return expression;
        }

        if (value[0] !== '=') {
            expression.ms = timeToMs(value, true /*allowNegative*/);
            expression.valid = !isNaN(expression.ms);
            if (!expression.valid) {
                expression.invalidReason = 'Timestamp could not be parsed';
            }

            expression.hms = !/^\d+$/.test(value);
            return expression;
        }

        if (!this.#mediaItem) {
            expression.valid = false;
            expression.invalidReason = `Only plain expressions are allowed, cannot use '=' syntax`;
            return expression;
        }

        expression.plain = false;

        let i = 1;
        let negative = false;
        while (i < value.length) {
            const c = value[i];
            switch (c) {
                case 'M':
                case 'I':
                case 'C':
                case 'A': {
                    if (expression.markerRef) {
                        expression.valid = false;
                        expression.invalidReason = 'Expressions can only reference a single marker.';
                        return expression;
                    }

                    if (negative) {
                        expression.valid = false;
                        expression.invalidReason = 'Marker references cannot be subtracted.';
                        return expression;
                    }

                    const markerData = /^(?<type>\w)(?<index>-?\d+)(?<se>[SE])?\b/.exec(value.substring(i));
                    if (!markerData) {
                        expression.valid = false;
                        expression.invalidReason = `Could not parse potential marker reference.`;
                        return expression;
                    }

                    const se = markerData.groups.se;
                    expression.markerRef = {
                        type : markerTypeFromKey(c),
                        index : parseInt(markerData.groups.index),
                        start : se ? se === 'S' : this.#isEnd,
                        implicit : !se
                    };

                    i += markerData.groups.index.length + (markerData.groups.se ? 1 : 0) + 1;
                    break;
                }
                case '-':
                case '+':
                    negative = c === '-';
                    i += 1;
                    break;
                case '0': case '1': case '2': case '3': case '4': case '5':
                case '6': case '7': case '8': case '9': case '.': {
                    const iStart = i;
                    while (validTimeChars.has(value[i])) {
                        ++i;
                    }

                    const timeString = value.substring(iStart, i);
                    const ms = timeToMs(timeString);
                    if (isNaN(ms)) {
                        expression.valid = false;
                        expression.invalidReason = `Could not parse "${timeString}" as a timestamp`;
                        return expression;
                    }

                    // Need special handling for '=-0'
                    const add = negative ? -ms : ms;
                    expression.ms = expression.ms === 0 ? add : expression.ms + add;

                    // HMS overrides any single ms instance
                    expression.hms ||= !/^\d+$/.test(timeString);
                    negative = false;
                    break;
                }
                case ' ':
                default:
                    i += 1;
                    break;
            }
        }

        this.#validateMarkerReference(expression);
        return expression;
    }

    /**
     * Ensures the given expression's marker reference is valid.
     * @param {TimestampExpression} expression */
    #validateMarkerReference(expression) {
        if (!expression.valid || !expression.markerRef) {
            return;
        }

        const ref = expression.markerRef;
        const absolute = Math.abs(ref.index);

        if (absolute === 0) {
            expression.valid = false;
            expression.invalidReason = 'Marker index 0 is invalid, use 1-based indexing.';
            return;
        }

        let markers = this.#mediaItem.markerTable().markers();
        if (ref.index < 0) {
            // We don't want an in-place reversal, since we'd be reversing the marker table's underlying references.
            markers = markers.toReversed();
        }

        let idx = 0;
        const isAny = ref.type === 'any';
        for (const marker of markers) {
            if (isAny || marker.markerType === ref.type) {
                if (++idx === absolute) { // Prefixed ++ since user input is 1-based
                    ref.marker = marker;
                    return;
                }
            }
        }

        expression.valid = false;
        expression.invalidReason = `Invalid marker index '${ref.index}': not enough ${ref.type === 'any' ? '' : ref.type + ' '}markers`;

        // TODO: "Plain" inputs handle excessive timestamps gracefully. Make sure expressions do too.
    }

    /**
     * @param {KeyboardEvent} e
     * @param {TimestampExpression} expression
     * @param {{ [key: string]: number }} simpleKeys */
    #calculateNewTimeInput(e, expression, simpleKeys) {
        const simpleKey = e.key in simpleKeys;
        const maxDuration = this.#mediaItem.duration;
        const max = isNaN(maxDuration) ? Number.MAX_SAFE_INTEGER : maxDuration;

        // Expressions with marker references can't use negative offsets.
        const min = expression.markerRef ? 0 : (isNaN(maxDuration) ? Number.MIN_SAFE_INTEGER : -maxDuration);

        // TODO: verify -0
        const currentValue = this.#ms(expression);
        if (isNaN(currentValue)) {
            return;
        }

        let timeDiff = 0;
        if (simpleKey) {
            timeDiff = simpleKeys[e.key] * (e.altKey ? 5 : 1);
        } else {
            timeDiff = truncationKeys[e.key](currentValue, max, e.altKey);
        }

        const newTime = this.#getNewTime(e, currentValue, min, max, timeDiff);
        const newValue = this.#addTimeToExpression(expression, newTime);

        // execCommand will make this undo-able, but is deprecated.
        // Fall back to direct substitution if necessary.
        try {
            this.#input.select();
            document.execCommand('insertText', false, newValue);
        } catch (ex) {
            e.target.value = newValue;
        }
    }

    /**
     * Return the new time in milliseconds for the time input based on the given values.
     * Takes into account jumping between positive and negative offsets.
     * @param {KeyboardEvent} e The event that triggered this calculation
     * @param {number} previous The old time in milliseconds
     * @param {number} min The minimum value
     * @param {number} max The maximum value
     * @param {number} delta The baseline number of milliseconds to adjust previous */
    #getNewTime(e, previous, min, max, delta) {
        const newTime = Math.min(max, Math.max(min, previous + delta));
        if (min === 0) {
            // Return early if negative values aren't allowed.
            return newTime;
        }

        // If we're at zero and crossing the boundary, switch to the inverse (0 => -0, -0 => 0)
        if (previous === 0) {
            // Stay at whatever zero we're at if it's a repeat event (holding down the key)
            if (e.repeat) {
                return previous;
            }

            if (Object.is(previous, 0)) {
                if (delta < 0) {
                    return -0;
                }
            } else if (delta > 0) {
                return 0;
            }
        }

        // If the default adjustment switches between negative and positive, first stop at the
        // appropriate zero value (jumping positive stops at -0, jumping negative stops at 0).
        if (Object.is(Math.abs(previous), previous) !== Object.is(Math.abs(newTime), newTime)) {
            return (previous < 0 || Object.is(previous, -0)) ? -0 : 0;
        }

        return newTime;
    }

    /**
     * Modifies the existing expression such that it's underling value
     * equals the given newTime.
     * @param {TimestampExpression} expression
     * @param {number} newTime */
    #addTimeToExpression(expression, newTime) {
        if (expression.plain) {
            expression.ms = newTime;
            return (expression.hms ? msToHms(newTime) : newTime).toString();
        }

        const ref = expression.markerRef;
        const newMs = newTime - (ref ? ref.start ? ref.marker.start : ref.marker.end : 0);
        if (ref && expression.ms === 0) {
            expression.hms = true; // When coming from no time part, default to hms
        }

        expression.ms = newMs;
        return this.#expressionToString(expression);
    }

    /**
     * Converts a given expression to a human-readable string.
     * Always uses '=MarkerRef+timestamp' notation, regardless of
     * underlying input entry.
     * @param {TimestampExpression} expression */
    #expressionToString(expression) {
        Log.assert(!expression.plain, '#expressionToString expects a complex expression');
        let markerStr = '';
        const ref = expression.markerRef;
        if (ref) {
            markerStr = keyFromMarkerType(ref.type) + ref.index.toString() + (ref.implicit ? '' : ref.start ? 'S' : 'E');
        }

        let timeStr = '';
        if (expression.ms !== 0 || !ref) {
            if (expression.hms) {
                timeStr = msToHms(expression.ms, true /*minify*/);
            } else {
                timeStr = Object.is(expression.ms, -0) ? '-0' : expression.ms.toString();
            }
        }

        let opStr = '';
        if (markerStr && timeStr && expression.ms >= 0) {
            opStr += '+';
        }

        return '=' + markerStr + opStr + timeStr;
    }
}
