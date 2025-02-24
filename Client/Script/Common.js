/**
 * Return 'n text' if n is 1, otherwise 'n texts'.
 * @param {number} n The number of items.
 * @param {string} text The type of item. */
export function plural(n, text) {
    return `${n} ${text}${n === 1 ? '' : 's'}`;
}

/**
 * Pads 0s to the front of `val` until it reaches the length `pad`.
 * @param {number} val The value to pad.
 * @param {number} pad The minimum length of the string to return. */
export function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/**
 * Returns the minimal text for the given number of thousandths.
 * @param {number} ms */
function minifiedThousandths(ms) {
    if (ms === 0) {
        return '';
    }

    const asStr = ms.toString();
    if (ms % 100 === 0) {
        return `.${asStr[0]}`;
    } else if (ms % 10 === 0) {
        return `.${asStr.substring(2)}`;
    }

    return `.${asStr}`;
}

/**
 * Convert milliseconds to a user-friendly [h:]mm:ss.000 string.
 * @param {number} ms
 * @param {boolean} minify Whether to minify the output if possible, with single-digit minutes, and truncated thousandths. */
export function msToHms(ms, minify=false) {
    const msAbs = Math.abs(ms);
    let seconds = msAbs / 1000;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    seconds = Math.floor(seconds) % 60;
    const thousandths = msAbs % 1000;
    let time = '';
    if (minify) {
        time = pad0(minutes, hours > 0 ? 2 : 1) + ':' + pad0(seconds, 2) + minifiedThousandths(thousandths);
    } else {
        time = pad0(minutes, 2) + ':' + pad0(seconds, 2) + '.' + pad0(thousandths, 3);
    }

    if (hours > 0) {
        time = hours + ':' + time;
    }

    return (ms > 0 || Object.is(ms, 0)) ? time : '-' + time;
}

/**
 * Regex capturing a valid [hh:]mm:ss.000 input. */
const hmsRegex = new RegExp('' +
    /^(?<negative>-)?/.source +
    /(?:(?<hours>\d{1,3}):)?/.source +
    /(?:(?<minutes>0\d|[1-5]\d):)?/.source +
    /(?<seconds>0\d|[1-5]\d)/.source +
    /\.?(?<milliseconds>\d+)?$/.source);

/**
 * @typedef {Object} HmsGroups
 * @property {string?} negative Whether the value is negative (valid for e.g. bulk shift)
 * @property {string?} hours The number of hours. Note that this group will actually hold minutes if hours are not present.
 * @property {string?} minutes The number of minutes. Note that this group is only populated if hours are not present.
 * @property {string}  seconds The number of seconds.
 * @property {string?} milliseconds The decimal value, if any.
*/

/**
 * Parses [hh]:mm:ss.000 input into milliseconds (or the integer conversion of string milliseconds).
 * @param {string} value The time to parse
 * @returns The number of milliseconds indicated by `value`. */
export function timeToMs(value, allowNegative=false) {
    let ms = 0;
    if (value.indexOf(':') === -1) {
        if (value.indexOf('.') === -1) {
            // Raw milliseconds
            return parseInt(value);
        }

        // Assume seconds.milliseconds
        return parseInt(parseFloat(value) * 1000);
    }

    const result = hmsRegex.exec(value);
    if (!result || (!allowNegative && result.groups.negative)) {
        return NaN;
    }

    /** @type {HmsGroups} */
    const groups = result.groups;

    if (groups.milliseconds) {
        ms = parseInt(groups.milliseconds.substring(0, 3)); // Allow extra digits, but ignore them
        switch (groups.milliseconds.length) {
            case 1:
                ms *= 100;
                break;
            case 2:
                ms *= 10;
                break;
            default:
                break;
        }
    }

    if (groups.seconds) {
        ms += parseInt(groups.seconds) * 1000;
    }

    if (groups.minutes) {
        // Be stricter than the regex itself and force two digits
        // if we have an hours value.
        if (groups.hours && groups.minutes.length !== 2) {
            return NaN;
        }

        ms += parseInt(groups.minutes) * 60 * 1000;
    }

    if (groups.hours) {
        // Because the above regex isn't great, if we have mm:ss.000, hours
        // will be populated but minutes won't. This catches that and adds
        // hours as minutes instead.
        if (groups.minutes) {
            // Normal hh:mm
            ms += parseInt(groups.hours) * 60 * 60 * 1000;
        } else {
            ms += parseInt(groups.hours) * 60 * 1000;
        }
    }

    return ms * (groups.negative ? -1 : 1);
}

/**
 * Small helper that converts a given negative or positive offset into a "real" timestamp.
 * Negative offsets indicate an offset from the end of the item.
 * @param {number} offset
 * @param {number} duration
 * @returns {number} */
export function realMs(offset, duration) {
    // '===' treats -0 as +0, but Object.is can tell the difference.
    if (offset < 0 || Object.is(offset, -0)) {
        return duration + offset;
    }

    return offset;
}

/**
 * General callback to treat 'Enter' on a given element as a click.
 * @param {KeyboardEvent} e */
export function clickOnEnterCallback(e) {
    if (e.ctrlKey || e.shiftKey || e.altKey || e.key !== 'Enter') {
        return;
    }

    e.target.click();
}

/**
 * Waits for the given condition to be true, timing out after a specified number of milliseconds.
 * @param {() => boolean} condition The condition to test until it returns true.
 * @param {number} timeout Number of milliseconds before giving up.
 * @returns {Promise<void>} */
export function waitFor(condition, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { clearInterval(interval); reject(new Error('hit waitFor timeout')); }, timeout);
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                clearTimeout(timer);
                resolve();
            }
        }, 50);
    });
}

/**
 * Stop the current event from propagating and smoothly scroll a specific element into view, setting focus to it or sub-node.
 * @param {Event} e The initiating event.
 * @param {HTMLElement} scrollTarget The block to scroll into view
 * @param {HTMLElement?} focusTarget The element within scrollTarget to focus on, or scrollTarget if not provided */
export function scrollAndFocus(e, scrollTarget, focusTarget) {
    // Stop propagation in addition to preventDefault, since we don't want any
    // subsequent events firing and causing potentially unexpected side-effects,
    // like a keyboard event preventing tooltips from displaying after arrow navigation.
    e?.stopPropagation();
    e?.preventDefault();
    const focusTo = focusTarget || scrollTarget;
    if (focusTo) {
        focusTo.focus({ preventScroll : true });
        scrollTarget.scrollIntoView({ behavior : 'smooth', block : 'nearest' });
    }
}

/**
 * Return whether the control or meta key is pressed.
 * Used by mouse events, as macOS treats Ctrl+Click as a right click, so
 * any Ctrl action can also be used on macOS with cmd+click.
 * @param {MouseEvent} e */
export function ctrlOrMeta(e) {
    return e?.ctrlKey || e?.metaKey;
}

/**
 * Show or hide the given element.
 * @param {HTMLElement} ele
 * @param {boolean} visible */
export function toggleVisibility(ele, visible) {
    if (visible) {
        ele.classList.remove('hidden');
    } else {
        ele.classList.add('hidden');
    }
}
