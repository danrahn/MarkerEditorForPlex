import { $textInput, toggleClass } from './HtmlHelpers.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { msToHms } from './Common.js';
import { TimeExpression } from './TimeExpression.js';

/** @typedef {!import('./ClientDataExtensions').MediaItemWithMarkerTable} MediaItemWithMarkerTable */
/** @typedef {!import('/Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('./TimeExpression').ParseState} ParseState */

const Log = ContextualLog.Create('TimeInput');

/**
 * @typedef {Object} TimeInputOptions
 * @property {bool} [isEnd] Whether this input is for the end of a marker. Defaults to false.
 * @property {bool} [customValidate] Whether the input has a separate validation function. Defaults to false.
 * @property {(newState: ParseState) => void} [onExpressionChanged] Callback to invoke when the expression has been re-parsed.
 * @property {bool} [plainOnly] Whether to only allow plain input, not complex expressions. Defaults to false.
 * @property {MediaItemWithMarkerTable} [mediaItem]
*/


/* eslint-disable quote-props */ // Quotes are cleaner here
/**
 * Map of time input shortcut keys that will increase/decrease the time by specific values.
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
    #customValidate = false;
    #plainOnly = false;

    /** @type {TimeExpression} */
    #expression;

    /** @type {(newState: ParseState) => void} Callback to invoke when the expression has been reparsed. */
    #onExpressionChanged;

    /** @type {ParseState} */
    #lastState;

    static #defaultPlaceholder = 'ms or mm:ss[.000]';

    /**
     * @param {TimeInputOptions} options
     * @param {{ [eventName: string]: Function[] }} events List of additional events to add to the input element.
     * @param {{ [attribute: string]: any }} Additional attributes to attach to the input element. */
    constructor(options, events={}, attributes={}) {
        this.#mediaItem = options.mediaItem;
        this.#isEnd = !!options.isEnd;
        this.#customValidate = !!options.customValidate;
        this.#onExpressionChanged = options.onExpressionChanged;
        this.#plainOnly = 'plainOnly' in options && options.plainOnly;
        this.#expression = new TimeExpression(
            this.#mediaItem?.markerTable().markers(),
            this.#mediaItem?.markerTable().chapters(),
            this.#isEnd,
            this.#plainOnly);
        this.#lastState = this.#expression.state();
        if (this.#mediaItem && !this.#mediaItem.markerTable()) {
            this.#mediaItem = undefined;
            Log.error(`Media item does not have a marker table, can't use expression-based parsing!`);
        }

        const iter = i => i ? i instanceof Array ? i : [i] : [];
        events.paste = [this.#onPaste.bind(this), ...iter(events.paste)];
        events.keydown = [
            this.#handleSeek.bind(this),
            ...iter(events.keydown)
        ];

        events.keyup = [
            this.#onKeyup.bind(this),
            ...iter(events.keyup)
        ];

        // Ensure reparse also happens after losing focus
        events.change = [
            this.#onKeyup.bind(this),
            ...iter(events.change),
        ];

        this.#input = $textInput(
            {   type : 'text',
                maxlength : 24,
                placeholder : TimeInput.#defaultPlaceholder,
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
        // First verify the value has been parsed. Caching should ensure this is cheap when inputs are the same,
        // but should be verified for large bulk operations (e.g. bulk adding for all one One Piece).
        // There's a special case where the input itself is blank, but the placeholder indicates the real value.
        // This is used for implicit markers (e.g. end timestamp based on the start timestamp). In that case, parse
        // the placeholder instead.
        let value = this.#input.value;
        if (value.length === 0 && this.#input.placeholder !== TimeInput.#defaultPlaceholder) {
            value = this.#input.placeholder;
        }

        this.#expression.parse(value);
        return this.#expression.ms(final);
    }

    /**
     * Helper that adjusts the placeholder if an implicit end time is being used.
     * @param {ParseState} startState */
    checkPlaceholder(startState) {
        if (!this.#isEnd) {
            return false;
        }

        const oldPlaceholder = this.#input.placeholder;
        if (!startState.chapterReference()?.start || this.#input.value) {
            this.#input.placeholder = TimeInput.#defaultPlaceholder;
            return oldPlaceholder === TimeInput.#defaultPlaceholder;
        }

        const cloneState = startState.clone();
        cloneState.chapterReference().start = false; // Ensure we're using the end time
        cloneState.markerType = null; // End timestamps can't use M@ syntax
        this.#expression.updateState(cloneState);
        this.#input.placeholder = this.#expression.toString();
        return oldPlaceholder === this.#input.placeholder;
    }

    /** Return the underlying text input element. */
    input() { return this.#input; }

    /** Return whether this expression is "advanced", i.e. contains more than just raw timestamps. */
    isAdvanced() { return this.#expression.isAdvanced(); }

    /**
     * Return the current state of the expression. */
    expressionState() { return this.#expression.state(); }

    /**
     * @param {KeyboardEvent} _e */
    #onKeyup(_e) {
        // TODO: Should this be cached? It's not heavy, but we might be calculating it a lot.
        const newState = this.#expression.parse(this.#input.value);

        // TODO: What's faster, comparing the old and new state, or just re-parsing the returned state?
        if (!this.#lastState.equals(newState)) {
            this.#onExpressionChanged?.(newState);
        }

        this.#lastState = newState;

        if (this.#customValidate) {
            return;
        }

        toggleClass(this.#input, 'invalid', !newState.valid);
        let title = '';
        if (newState.valid) {
            // No title for plain expressions that already use hms.
            if (!newState.plain || !newState.hms) {
                // null is a sentinel indicating that a mediaItem is needed
                // to get the real value. Set no title in that instance.
                const ms = this.#expression.ms();
                if (ms !== null) {
                    title = msToHms(ms, true /*minify*/);
                }
            }
        } else {
            title = newState.invalidReason || 'Invalid input';
        }

        this.#input.title = title;
    }

    /**
     * @param {ClipboardEvent} e */
    #onPaste(e) {
        const text = e.clipboardData.getData('text/plain');

        // With chapter name references, it's more trouble than it's worth to
        // try to fix up complex expressions, so just paste it as-is and let the user figure it out.
        if (!this.#plainOnly && text[0] === '=') {
            return;
        }

        const rgxFind = this.#plainOnly ? /^[\d:.]*$/ : /^=[-+\d:.ACIMSEh@ ]$/;
        const rgxReplace = this.#plainOnly ? /[^:\d.]/g : /[^-+=\d:.ACIMSEh@ ]/g;

        if (!rgxFind.test(text)) {
            e.preventDefault();
            const newText = text.replace(rgxReplace, '');

            // Even if the resulting text is invalid, paste in the valid characters anyway,
            // as someone might have wanted to paste a partial expression.
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

        const isExpression = !this.#plainOnly && this.#input.value[0] === '=';
        if (isExpression) {
            // Allow some additional characters in expression mode
            if (this.inTextReference() || /[MCIASEh@()+ -]/.test(e.key)) {
                return;
            }
        }

        // Regardless of whether we have a valid shortcut, we don't want
        // the character to be typed into the input
        e.preventDefault();

        // Should this be cached? Only if we can guarantee we have the latest state.
        // TODO: Make sure all events are captured - paste, change, keyup, input, etc.
        const parseState = this.#expression.parse(this.#input.value);

        // No need to do anything if the current expression isn't valid
        if (!parseState.valid) {
            return;
        }

        const simpleKeys = isExpression ? expressionAdjustKeys : adjustKeys;
        if (!truncationKeys[e.key] && !simpleKeys[e.key]) {
            return;
        }

        this.#calculateNewTimeInput(e, simpleKeys);
    }

    /**
     * Returns whether the cursor is likely in a text reference (i.e. in the middle of a chapter name expression). */
    inTextReference() {
        return TimeExpression.InTextReference(this.#input.value, this.#input.selectionStart);
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
        return !this.#plainOnly && input.selectionStart === 0 && (input.value[0] !== '=' || input.selectionEnd !== 0);
    }

    /**
     * @param {KeyboardEvent} e
     * @param {{ [key: string]: number }} simpleKeys */
    #calculateNewTimeInput(e, simpleKeys) {
        const simpleKey = e.key in simpleKeys;
        const maxDuration = this.#mediaItem?.duration || NaN;
        const max = isNaN(maxDuration) ? Number.MAX_SAFE_INTEGER : maxDuration;

        let currentValue = this.#expression.ms();
        if (isNaN(currentValue)) {
            return;
        }

        // Expressions with marker references can't use negative offsets (unless the full reference hasn't
        // been computed, since the offset might go positive once the marker/chapter offset has been added).
        const negativeAllowed = !this.#expression.isAdvanced() || currentValue === null;
        const min = negativeAllowed ? (isNaN(maxDuration) ? Number.MIN_SAFE_INTEGER : -maxDuration) : 0;


        if (currentValue === null) {
            // Without a media item reference, ignore any state-based expressions and only use the raw milliseconds.
            Log.assert(!this.#mediaItem, `We should only have a null current time when we don't have a baseline media item.`);
            currentValue = this.#expression.state().ms;
        }

        let timeDiff = 0;
        if (simpleKey) {
            timeDiff = simpleKeys[e.key] * (e.altKey ? 5 : 1);
        } else {
            timeDiff = truncationKeys[e.key](currentValue, max, e.altKey);
        }

        const newTime = this.#getNewTime(e, currentValue, min, max, timeDiff);
        const newValue = this.#expression.setMs(newTime).toString();

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
}
