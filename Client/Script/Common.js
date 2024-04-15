
/**
 * Removes all children from the given element.
 * @param {HTMLElement} ele The element to clear.
 */
function clearEle(ele) {
    while (ele.firstChild) {
        ele.removeChild(ele.firstChild);
    }
}


/**
 * Custom jQuery-like selector method.
 * If the selector starts with '#' and contains no spaces, return the result of `querySelector`,
 * otherwise return the result of `querySelectorAll`.
 * @param {DOMString} selector The selector to match.
 * @param {HTMLElement} ele The scope of the query. Defaults to `document`. */
function $(selector, ele=document) {
    if (selector.indexOf('#') === 0 && selector.indexOf(' ') === -1) {
        return $$(selector, ele);
    }

    return ele?.querySelectorAll(selector);
}

/**
 * Like $, but forces a single element to be returned. i.e. querySelector.
 * @param {string} selector The query selector.
 * @param {HTMLElement} [ele=document] The scope of the query. Defaults to `document`. */
function $$(selector, ele=document) {
    return ele?.querySelector(selector);
}

/**
 * Helper method to create DOM elements.
 * @param {string} type The TAG to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options={}] Additional options */
function buildNode(type, attrs, content, events, options={}) {
    const ele = document.createElement(type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * Helper method to create DOM elements with the given namespace (e.g. SVGs).
 * @param {string} ns The namespace to create the element under.
 * @param {string} type The type of element to create.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element. */
function buildNodeNS(ns, type, attrs, content, events, options={}) {
    const ele = document.createElementNS(ns, type);
    return _buildNode(ele, attrs, content, events, options);
}

/**
 * "Private" core method for buildNode and buildNodeNS, that handles both namespaced and non-namespaced elements.
 * @param {HTMLElement} ele The HTMLElement to attach the given properties to.
 * @param {{[attribute: string]: string}} [attrs] Attributes to apply to the element (e.g. class, id, or custom attributes).
 * @param {string|HTMLElement|SVGElement} [content] The inner content of the element, either a string or an element.
 * @param {{[event: string]: EventListener|EventListener[]}} [events] Map of events (click/keyup/etc) to attach to the element.
 * @param {object} [options] */
function _buildNode(ele, attrs, content, events, options) {
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            ele.setAttribute(key, value);
        }
    }

    if (events) {
        for (const [event, func] of Object.entries(events)) {
            /** @type {EventListener[]} */
            let handlers = func;
            if (!(func instanceof Array)) {
                handlers = [func];
            }

            for (const handler of handlers) {
                if (options.thisArg) {
                    ele.addEventListener(event, handler.bind(options.thisArg, ele));
                } else {
                    ele.addEventListener(event, handler);
                }
            }
        }
    }

    if (content) {
        if (content instanceof Element) {
            ele.appendChild(content);
        } else {
            ele.innerHTML = content;
        }
    }

    return ele;
}

/**
 * Helper to append multiple children to a single element at once.
 * @param {HTMLElement} parent Parent element to append children to.
 * @param {...HTMLElement} elements Elements to append this this `HTMLElement`
 * @returns {HTMLElement} `parent` */
function appendChildren(parent, ...elements) {
    for (const element of elements) {
        if (element) {
            parent.appendChild(element);
        }
    }

    return parent;
}


/**
 * Return 'n text' if n is 1, otherwise 'n texts'.
 * @param {number} n The number of items.
 * @param {string} text The type of item. */
function plural(n, text) {
    return `${n} ${text}${n === 1 ? '' : 's'}`;
}

/**
 * Pads 0s to the front of `val` until it reaches the length `pad`.
 * @param {number} val The value to pad.
 * @param {number} pad The minimum length of the string to return. */
function pad0(val, pad) {
    val = val.toString();
    return '0'.repeat(Math.max(0, pad - val.length)) + val;
}

/**
 * Convert milliseconds to a user-friendly [h:]mm:ss.000 string.
 * @param {number} ms */
function msToHms(ms) {
    const msAbs = Math.abs(ms);
    let seconds = msAbs / 1000;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    seconds = Math.floor(seconds) % 60;
    const thousandths = msAbs % 1000;
    let time = pad0(minutes, 2) + ':' + pad0(seconds, 2) + '.' + pad0(thousandths, 3);
    if (hours > 0) {
        time = hours + ':' + time;
    }

    return ms < 0 ? '-' + time : time;
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
function timeToMs(value, allowNegative=false) {
    let ms = 0;
    if (value.indexOf(':') === -1) {
        if (value.indexOf('.') === -1) {
            // Raw milliseconds
            return parseInt(value);
        }

        // Assume sections.milliseconds
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
 * by 5m, 1m, 50s, 10s, 5s, 1s, 0.5s, or .1s without manually typing specific numbers. */
const adjustKeys = {
    '_'  : -60000, // Shift+-
    '+'  :  60000, // Shift+=
    '-'  : -10000, // -
    '='  :  10000, // +
    '['  :  -1000, // [
    ']'  :   1000,
    '{'  :   -100,
    '}'  :    100,
};
/* eslint-enable */

/**
 * Round `c` to the nearest `f`, with a maximum value of `m`
 * @param {number} c Current ms value
 * @param {number} m Maximum value
 * @param {number} f Truncation factor
 * @returns {number} */
const roundDelta = (c, m, f, r=c % f) => r === 0 ? 0 : -r + ((m - c < f - r) || (r < (f / 2)) ? 0 : f);

/**
 * Map of "special" time input shortcuts that requires additional parameters
 * @type {{[key: string]: (currentMs: number, maxValue: number, altKey: boolean) => number}} */
const truncationKeys = {
    '\\' : (c, m, a) => roundDelta(c, m, a ? 5000 : 1000),
    '|'  : (c, m, a) => roundDelta(c, m, a ? 500 : 100)
};

/**
 * If we have a negative, it's valid if we're at the start of the input and
 * a negative isn't already present (or the negative is selected).
 * @param {KeyboardEvent} e */
const validNegative = e =>
    e.key === '-'
    && e.target.selectionStart === 0
    && (e.target.value[0] !== '-' || e.target.selectionEnd !== e.target.selectionStart);

/**
 * A common input handler that allows incremental
 * time changes with keyboard shortcuts.
 * @param {KeyboardEvent} e */
function timeInputShortcutHandler(e, maxDuration=NaN) {
    if (e.key.length !== 1 || e.ctrlKey || /[\d:.]/.test(e.key)) {
        return;
    }

    // Allow a negative sign, but only if we're at the start of the input and don't already have one.
    if (validNegative(e)) {
        return;
    }

    e.preventDefault();
    if (!adjustKeys[e.key] && !truncationKeys[e.key]) {
        return;
    }

    const simpleKey = e.key in adjustKeys;
    const max = isNaN(maxDuration) ? Number.MAX_SAFE_INTEGER : maxDuration;
    const min = (isNaN(maxDuration) ? Number.MIN_SAFE_INTEGER : -maxDuration);
    const currentValue = e.target.value === '-' ? '-0.0' : e.target.value;

    // Default to HMS, but keep ms if that's what's currently being used
    const needsHms = currentValue.length === 0 || /[.:]/.test(currentValue);

    // Alt multiplies by 5, so 100ms becomes 500, 1 minutes becomes 5, etc.
    const currentValueMs = timeToMs(currentValue || '0', true /*allowNegative*/);
    if (isNaN(currentValueMs)) {
        return; // Don't try to do anything with invalid input
    }

    let timeDiff = 0;
    if (simpleKey) {
        timeDiff = adjustKeys[e.key] * (e.altKey ? 5 : 1);
    } else {
        timeDiff = truncationKeys[e.key](currentValueMs, max, e.altKey);
    }

    const newTime = Math.min(max, Math.max(min, currentValueMs + timeDiff));
    const newValue = needsHms ? msToHms(newTime) : newTime;

    // execCommand will make this undo-able, but is deprecated.
    // Fall back to direct substitution if necessary.
    try {
        e.target.select();
        document.execCommand('insertText', false, newValue);
    } catch (ex) {
        e.target.value = needsHms ? msToHms(newTime) : newTime;
    }
}

/**
 * Small helper that converts a given negative or positive offset into a "real" timestamp.
 * Negative offsets indicate an offset from the end of the item.
 * @param {number} offset
 * @param {number} duration
 * @returns {number} */
function realMs(offset, duration) {
    // '===' treats -0 as +0, but Object.is can tell the difference.
    if (offset < 0 || Object.is(offset, -0)) {
        return duration + offset;
    }

    return offset;
}

/**
 * General callback to treat 'Enter' on a given element as a click.
 * @param {KeyboardEvent} e */
function clickOnEnterCallback(e) {
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
function waitFor(condition, timeout) {
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
function scrollAndFocus(e, scrollTarget, focusTarget) {
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

export {
    $,
    $$,
    appendChildren,
    buildNode,
    buildNodeNS,
    clearEle,
    clickOnEnterCallback,
    msToHms,
    pad0,
    plural,
    realMs,
    roundDelta,
    scrollAndFocus,
    timeInputShortcutHandler,
    timeToMs,
    waitFor,
};
