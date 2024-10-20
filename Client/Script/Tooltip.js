import { $, $clear, $div, $span } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

const Log = ContextualLog.Create('Tooltip');

const windowMargin = 10;

export const TooltipTextSize = {
    /** @readonly Default text size. */
    Standard : 0,
    /** @readonly Smaller tooltip text. */
    Smaller : -1,
    /** @readonly Larger tooltip text */
    Larger : 1,
};

/**
 * A weak reference. Only defined here since VSCode's intellisense doesn't resolve this built-in type.
 * @template T
 * @typedef {Object} WeakRef<T>
 * @property {() => T?} deref Returns the WekRef object's target object, or undefined if the target object has been reclaimed.
 */

/**
 * @typedef {Object} TooltipOptions
 * @property {number}  [delay=250] The delay between hovering over the item and displaying the tooltip. Default=250ms
 * @property {number} [maxWidth=350] Determines the maximum width of the tooltip. Default=350px
 * @property {boolean} [centered=false] Determines whether the tooltip text is left or center aligned. Default=false
 * @property {number}  [textSize=0] Determines whether the text is normal, smaller, or larger. Default=0
 * @property {boolean} [noBreak=false] Determines whether we should avoid breaking tooltip text when possible. Default=false
 */

/**
 * @typedef {Object} TooltipEntryType
 * @property {WeakRef<Element>} targetRef A weak reference to the target for this tooltip
 * @property {string|HTMLElement} tooltip The tooltip to display
 *
 * @typedef {TooltipEntryType & TooltipOptions} TooltipEntry
 */

/**
 * Custom attribute used to identify tooltip targets. */
const TooltipId = 'data-tt-id';

/**
 * @param {TooltipOptions} options
 * @param {TooltipEntry?} existing
 * @returns {TooltipOptions} */
function optionsFromOptions(options={}, existing) {
    /**
     * @template T
     * @param {string} v
     * @param {T} d
     * @returns {T} */
    const valueOrDefault = (v, d) => {
        const setVal = options[v];
        if (setVal === null || setVal === undefined) {
            // If our options don't have the given value set, but our baseline element does,
            // use the baseline's value.
            const existingValue = existing?.[v];
            if (existingValue !== null && existingValue !== undefined) {
                switch (typeof existingValue) {
                    case 'boolean':
                        return +existingValue === 1;
                    case 'number':
                        return +existingValue;
                    default:
                        return existingValue;
                }
            }

            return d;
        }

        return setVal;
    };

    return {
        delay : valueOrDefault('delay', 250),
        maxWidth : valueOrDefault('maxWidth', 0),
        centered : valueOrDefault('centered', false),
        textSize : valueOrDefault('textSize', 0),
        noBreak : valueOrDefault('noBreak', false),
    };
}

/**
 * Implements common functionality for on-hover tooltips, offering expanded functionality over 'title'.
 * Taken from PlexWeb/script/Tooltip, but has strayed quite a bit from the original fork. */
export default class Tooltip {

    static #initialized = false;

    /**
     * The tooltip itself.
     * @type {HTMLElement} */
    static #tooltip;

    /**
     * @type {{ [elementId: string]: TooltipEntry }} */
    static #tooltips = {};

    /** Contains the setTimeout id of a scroll event, which will hide the tooltip when expired
     * @type {number|null} */
    static #hideTooltipTimer = null;

    /** @type {number} `timerId` to keep track of the tooltip delay timeout. */
    static #tooltipTimer = null;

    /** @type {boolean} Keeps track of whether the tooltip is currently visible. */
    static #showingTooltip = false;

    /** @type {HTMLElement} The element whose tooltip is currently visible. */
    static #ttTarget = null;

    /** Used to map elements to their tooltips. */
    static #nextId = 0;

    static Setup() {
        if (Tooltip.#initialized) {
            return;
        }

        Tooltip.#initialized = true;
        const frame = $('#plexFrame');
        Tooltip.#tooltip = $div({ id : 'tooltip' }, 0, { click : Tooltip.dismiss });
        frame.appendChild(Tooltip.#tooltip);
        frame.addEventListener('scroll', Tooltip.onScroll);
        frame.addEventListener('keydown', Tooltip.dismiss); // Any keyboard input dismisses tooltips.
        setInterval(Tooltip.clearStaleTooltips, 60_000);
    }

    /**
     * Scroll handler. When detected, hide the tooltip (mainly for mobile devices).
     * Add a bit of delay, as it is a bit jarring to have it immediately go away.
     */
    static onScroll() {
        if (Tooltip.#hideTooltipTimer) {
            clearTimeout(Tooltip.#hideTooltipTimer);
        }

        if (Tooltip.active()) {
            Tooltip.#hideTooltipTimer = setTimeout(Tooltip.dismiss, 100);
        }
    }

    /**
     * Sets up tooltip handlers for basic use cases.
     * @param {HTMLElement} element The element to add the tooltip to.
     * @param {string|HTMLElement} tooltip The tooltip text.
     * @param {TooltipOptions?} tooltipOptions The duration an element must be hovered before the tooltip is shown, in ms. */
    static setTooltip(element, tooltip, tooltipOptions) {
        const existing = Tooltip.#tooltips[Tooltip.#ttId(element)];
        const hasTT = !!existing;
        const options = optionsFromOptions(tooltipOptions, existing);
        this.setText(element, tooltip, options);

        if (!hasTT) {
            element.addEventListener('mousemove', Tooltip.#onMouseMove);
            element.addEventListener('mouseleave', Tooltip.dismiss);
            element.addEventListener('focusin', Tooltip.#onFocus);
            element.addEventListener('focusout', Tooltip.dismiss);
        }
    }

    /**
     * Handles tooltip positioning when the mouse location moves
     * @param {MouseEvent} e */
    static #onMouseMove(e) {
        const options = Tooltip.#getOptions(this);
        Tooltip.showTooltip(e, options.tooltip, options.delay);
    }

    /**
     * Simulate a MouseMove event when an element gains focus.
     * Note: this can be annoying without the global keydown dismissal, so make sure if anything
     *       changes there, we have a way of dismissing tooltips from focused elements.
     * @param {FocusEvent} e */
    static #onFocus(e) {
        // Don't do anything if we're already showing the tooltip for this item
        if (Tooltip.#showingTooltip && Tooltip.#ttTarget === this) {
            return;
        }

        // Fill out values read by #showTooltipCore, as well as some sentinel values (focusX/Y)
        // that indicates our target is focused, and we should avoid making adjustments that causes
        // the tooltip to overlap the element itself.
        const rect = e.target.getBoundingClientRect();
        const fakeE = {
            target : e.target,
            clientY : rect.bottom,
            clientX : rect.left,
            focusY : rect.bottom - rect.top,
            focusX : rect.right - rect.left,
        };

        // Focus delay is a bit more than the default value of 250ms
        const options = Tooltip.#getOptions(this);
        const delay = Math.max(500, options.delay);
        Tooltip.showTooltip(fakeE, options.tooltip, delay);
    }

    /**
     * Sets the tooltip text for the given element.
     * Assumes `element` has gone through the initial tooltip setup.
     * @param {HTMLElement} element
     * @param {string|HTMLElement} tooltip
     * @param {TooltipOptions} options */
    static setText(element, tooltip, options={}) {
        const existingOptions = this.#getOptions(element);
        if (existingOptions) {
            options.delay ??= existingOptions.delay;
            options.maxWidth ??= existingOptions.maxWidth;
            options.centered ??= existingOptions.centered;
            options.textSize ??= existingOptions.textSize;
            options.noBreak ??= existingOptions.noBreak;
        }

        this.#tooltips[Tooltip.#ttId(element, true /*create*/)] = { targetRef : new WeakRef(element), tooltip : tooltip, ...options };
        if (Tooltip.#showingTooltip && Tooltip.#ttTarget === element) {
            if (tooltip instanceof Element) {
                $clear(Tooltip.#tooltip);
                Tooltip.#tooltip.appendChild(tooltip);
            } else {
                Tooltip.#tooltip.innerText = tooltip;
            }
        }
    }

    /**
     * @param {HTMLElement} element */
    static #ttId(element, create=false) {
        let id = element.getAttribute(TooltipId);
        if (create && !id) {
            id = (++Tooltip.#nextId).toString();
            element.setAttribute(TooltipId, id);
        }

        return id || 0;
    }

    static #getOptions(element) {
        return Tooltip.#tooltips[Tooltip.#ttId(element)];
    }

    /**
     * Removes the tooltip from the given element
     * @param {HTMLElement} element */
    static removeTooltip(element) {
        delete Tooltip.#tooltips[Tooltip.#ttId(element)];
        element.removeEventListener('mousemove', Tooltip.#onMouseMove);
        element.removeEventListener('mouseleave', Tooltip.dismiss);
        element.removeEventListener('focusin', Tooltip.#onFocus);
        element.removeEventListener('focusout', Tooltip.dismiss);
        if (Tooltip.#ttTarget === element) {
            Tooltip.dismiss();
        }
    }

    /**
     * Updates the position of a tooltip with the given text at a position relative to the current clientX/Y.
     * If the tooltip is not currently visible, resets the delay timer.
     * @param {MouseEvent} e The MouseEvent that triggered this function.
     * @param {string} text The text to display.
     * @param {number} [delay=250] The delay before showing the tooltip, in ms. */
    static showTooltip(e, text, delay=250) {
        // If we have a raw string, shove it in a span first
        if (typeof(text) == 'string') {
            text = $span(text);
        }

        if (Tooltip.#showingTooltip) {
            Tooltip.#showTooltipCore(e, text);
            return;
        }

        if (Tooltip.#tooltipTimer) {
            clearTimeout(Tooltip.#tooltipTimer);
        }

        Tooltip.#tooltipTimer = setTimeout(Tooltip.#showTooltipCore, delay, e, text);
    }

    /**
     * Cached border width of the tooltip. Assumes that it does not change over the course of the session
     * @type {number?} */
    static #tooltipBorderAdjustment = undefined;

    /**
     * Retrieve the border width of the tooltip. If we have a cached value, return it,
     * otherwise do the one-time calculation.
     * @param {HTMLElement} tooltip
     * @return {number} */
    static #borderWidth(tooltip) {
        if (Tooltip.#tooltipBorderAdjustment !== undefined) {
            return Tooltip.#tooltipBorderAdjustment;
        }

        const style = getComputedStyle(tooltip);
        Tooltip.#tooltipBorderAdjustment = parseInt(style.borderLeftWidth) + parseInt(style.borderRightWidth);
        return Tooltip.#tooltipBorderAdjustment;
    }

    /**
     * Core routine to show a tooltip and update its position.
     * Should not be called outside of this file.
     * @param {MouseEvent} e The MouseEvent that triggered this function.
     * @param {HTMLElement} text The tooltip Element containing the tooltip text. */
    static #showTooltipCore(e, text) {
        if (!Tooltip.#showingTooltip) {
            Log.tmi(text, `Launching tooltip`);
        }

        Tooltip.#ttTarget = e.target;
        while (Tooltip.#ttTarget && !Tooltip.#ttTarget.hasAttribute(TooltipId)) {
            Tooltip.#ttTarget = Tooltip.#ttTarget.parentElement;
        }

        Tooltip.#showingTooltip = true;
        const tooltip = Tooltip.#tooltip;

        const options = Tooltip.#tooltips[Tooltip.#ttId(Tooltip.#ttTarget)];
        const ttUpdated = options?.tooltip;
        const newText = ttUpdated || text;
        if (newText instanceof Element) {
            $clear(tooltip);
            tooltip.appendChild(newText);
        } else {
            tooltip.innerText = newText;
        }

        tooltip.style.display = 'inline';
        Tooltip.#setAttributes(tooltip);

        const extraMargin = e.focusY ? 5 : 20; // Focus triggers don't need as much of a margin
        const heightAdjust = tooltip.clientHeight + extraMargin + windowMargin;
        const rawHeight = e.clientY + window.scrollY;
        const maxHeight = document.body.clientHeight + window.scrollY - heightAdjust;
        tooltip.style.top = (Math.min(rawHeight, maxHeight) + extraMargin) + 'px';

        const avoidOverlay = rawHeight > maxHeight ? 10 : 0;
        // Border isn't included in clientWidth, which can cause us to slowly shrink a tooltip that's on the right edge.
        const borderAdjust = Tooltip.#borderWidth(tooltip);
        const widthAdjust = tooltip.clientWidth + windowMargin + avoidOverlay + borderAdjust;
        const maxWidth = document.body.clientWidth + window.scrollX - widthAdjust;
        const centered = options.centered;
        if (centered) {
            const centerAdjust = parseInt(tooltip.clientWidth / 2);
            tooltip.style.left = Math.min(e.clientX + window.scrollX, e.clientX + window.scrollX - centerAdjust) + 'px';
        } else {
            tooltip.style.left = (Math.min(e.clientX + window.scrollX, maxWidth) + avoidOverlay) + 'px';
        }

        if (maxWidth < e.clientX + window.scrollX && rawHeight + heightAdjust > document.body.clientHeight + window.scrollY) {
            // Adjusting x & y, move tooltip completely above cursor
            tooltip.style.top = (rawHeight - heightAdjust + extraMargin - (e.focusY ?? 0)) + 'px';
        }

        Tooltip.#tooltipTimer = null;
    }

    /**
     * @param {HTMLElement} tooltip */
    static #setAttributes(tooltip) {
        const ttTarget = Tooltip.#ttTarget;
        const options = Tooltip.#getOptions(ttTarget);
        const ar = a => options[a] ? 'add' : 'remove';
        if (options.maxWidth > 0) {
            tooltip.style.maxWidth = `calc(min(90%, ${options.maxWidth + 'px'}))`;
        } else {
            tooltip.style.removeProperty('max-width');
        }

        tooltip.classList[ar('maxWidth')]('larger');
        tooltip.classList[ar('centered')]('centered');
        tooltip.classList[ar('noBreak')]('noBreak');
        const textSize = options.textSize;
        tooltip.classList[textSize <= 0 ? 'remove' : 'add']('largerText');
        tooltip.classList[textSize >= 0 ? 'remove' : 'add']('smallerText');
    }

    /** Dismisses the tooltip. */
    static dismiss() {
        if (Tooltip.#showingTooltip) {
            Log.tmi(`Dismissing tooltip: ${Tooltip.#tooltip.innerHTML}`);
        }

        Tooltip.#tooltip.style.display = 'none';
        if (Tooltip.#tooltipTimer !== null) {
            clearTimeout(Tooltip.#tooltipTimer);
        }

        Tooltip.#tooltipTimer = null;
        Tooltip.#showingTooltip = false;
        Tooltip.#ttTarget = null;
    }

    /**
     * @returns `true` if we're currently showing a tooltip.
     */
    static active() {
        return Tooltip.#showingTooltip;
    }

    /**
     * Removes tooltip information for any elements that have been deleted. */
    static clearStaleTooltips() {
        const toDelete = new Set();
        for (const [id, entry] of Object.entries(Tooltip.#tooltips)) {
            // There are no guarantees on exactly when an unreferenced element will get garbage collected,
            // but that's fine here. The allocated element probably uses far more memory than the handful of
            // flags we have allocated here, so we're not ballooning memory usage that much by keeping these
            // around for potentially longer than strictly necessary.
            if (!entry.targetRef.deref()) {
                toDelete.add(id);
            }
        }

        if (toDelete.size > 0) {
            Log.verbose(`clearStaleTooltips: Removed ${toDelete.size} disconnected tooltip(s).`);
        }

        toDelete.forEach(id => delete Tooltip.#tooltips[id]);
    }
}
