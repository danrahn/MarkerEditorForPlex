import { $, buildNode } from './Common.js';
import { Attributes } from './DataAttributes.js';
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
 * @typedef {Object} TooltipOptions
 * @property {number}  [delay=250] The delay between hovering over the item and displaying the tooltip. Default=250ms
 * @property {number} [maxWidth=350] Determines the maximum width of the tooltip. Default=350px
 * @property {boolean} [centered=false] Determines whether the tooltip text is left or center aligned. Default=false
 * @property {number}  [textSize=0] Determines whether the text is normal, smaller, or larger. Default=0
 * @property {boolean} [noBreak=false] Determines whether we should avoid breaking tooltip text when possible. Default=false
 */

/**
 * Maps TooltipOptions fields to the actual attribute we add to the tooltip target. */
const OptionToAttribute = {
    /** @readonly */ delay : Attributes.TooltipDelay,
    /** @readonly */ maxWidth : Attributes.TooltipWidth,
    /** @readonly */ centered : Attributes.TooltipCentered,
    /** @readonly */ textSize : Attributes.TooltipTextSize,
    /** @readonly */ noBreak : Attributes.TooltipNoBreak,
};

/**
 * @param {TooltipOptions} options
 * @param {HTMLElement?} target
 * @returns {TooltipOptions} */
function optionsFromOptions(options={}, target) {
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
            if (target?.hasAttribute(OptionToAttribute[v])) {
                const targetValue = target.getAttribute(OptionToAttribute[v]);
                switch (typeof targetValue) {
                    case 'boolean':
                        return +targetValue === 1;
                    case 'number':
                        return +targetValue;
                    default:
                        return targetValue;
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

    /** Contains the setTimeout id of a scroll event, which will hide the tooltip when expired
     * @type {number|null} */
    static #hideTooltipTimer = null;

    /** @type {number} `timerId` to keep track of the tooltip delay timeout. */
    static #tooltipTimer = null;

    /** @type {boolean} Keeps track of whether the tooltip is currently visible. */
    static #showingTooltip = false;

    /** @type {HTMLElement} The element whose tooltip is currently visible. */
    static #ttTarget = null;

    static Setup() {
        if (Tooltip.#initialized) {
            return;
        }

        Tooltip.#initialized = true;
        const frame = $('#plexFrame');
        Tooltip.#tooltip = buildNode('div', { id : 'tooltip' }, 0, { click : Tooltip.dismiss });
        frame.appendChild(Tooltip.#tooltip);
        frame.addEventListener('scroll', Tooltip.onScroll);
        frame.addEventListener('keydown', Tooltip.dismiss); // Any keyboard input dismisses tooltips.
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
        const hasTT = element.hasAttribute(Attributes.TooltipText);
        const options = optionsFromOptions(tooltipOptions, element);
        this.setText(element, tooltip);
        element.setAttribute(Attributes.TooltipDelay, options.delay);
        if (options.maxWidth) element.setAttribute(Attributes.TooltipWidth, options.maxWidth);
        if (options.centered) element.setAttribute(Attributes.TooltipCentered, 1);
        if (options.textSize) element.setAttribute(Attributes.TooltipTextSize, options.textSize);
        if (options.noBreak) element.setAttribute(Attributes.TooltipNoBreak, 1);

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
        Tooltip.showTooltip(e, this.getAttribute(Attributes.TooltipText), this.getAttribute(Attributes.TooltipDelay));
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
        const delay = Math.max(500, parseInt(this.getAttribute(Attributes.TooltipDelay)));
        Tooltip.showTooltip(fakeE, this.getAttribute(Attributes.TooltipText), delay);
    }

    /**
     * Sets the tooltip text for the given element.
     * Assumes `element` has gone through the initial tooltip setup.
     * @param {HTMLElement} element
     * @param {string|HTMLElement} tooltip */
    static setText(element, tooltip) {
        const asString = (typeof tooltip === 'string' ? tooltip : tooltip.outerHTML);
        element.setAttribute(Attributes.TooltipText, asString);
        if (Tooltip.#showingTooltip && Tooltip.#ttTarget === element) {
            Tooltip.#tooltip.innerHTML = tooltip;
        }
    }

    /**
     * Removes the tooltip from the given element
     * @param {HTMLElement} element */
    static removeTooltip(element) {
        element.removeAttribute(Attributes.TooltipText);
        element.removeAttribute(Attributes.TooltipDelay);
        element.removeAttribute(Attributes.TooltipCentered);
        element.removeAttribute(Attributes.TooltipNoBreak);
        element.removeAttribute(Attributes.TooltipTextSize);
        element.removeEventListener('mousemove', Tooltip.#onMouseMove);
        element.removeEventListener('mouseleave', Tooltip.dismiss);
        element.removeEventListener('focusin', Tooltip.#onFocus);
        element.removeEventListener('focusout', Tooltip.dismiss);
        if (Tooltip.#ttTarget === element) {
            Tooltip.dismiss();
        }
    }

    /**
     * Retrieve the current tooltip text for the given element,
     * or an empty string if it does not exist.
     * @param {HTMLElement} element
     */
    static getText(element) {
        return element.getAttribute(Attributes.TooltipText) || '';
    }

    /**
     * Updates the position of Show a tooltip with the given text at a position relative to the current clientX/Y.
     * If the tooltip is not currently visible, resets the delay timer.
     * @param {MouseEvent} e The MouseEvent that triggered this function.
     * @param {string} text The text to display.
     * @param {number} [delay=250] The delay before showing the tooltip, in ms. */
    static showTooltip(e, text, delay=250) {
        // If we have a raw string, shove it in a span first
        if (typeof(text) == 'string') {
            text = buildNode('span', {}, text);
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
        while (Tooltip.#ttTarget && !Tooltip.#ttTarget.hasAttribute(Attributes.TooltipText)) {
            Tooltip.#ttTarget = Tooltip.#ttTarget.parentElement;
        }

        Tooltip.#showingTooltip = true;
        const tooltip = Tooltip.#tooltip;

        const ttUpdated = Tooltip.#ttTarget && Tooltip.#ttTarget.getAttribute(Attributes.TooltipText);
        if (ttUpdated) {
            tooltip.innerHTML = ttUpdated;
        } else {
            tooltip.innerHTML = '';
            tooltip.appendChild(text);
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
        const centered = Tooltip.#ttTarget.hasAttribute(Attributes.TooltipCentered);
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
        const ar = a => ttTarget.hasAttribute(a) ? 'add' : 'remove';
        if (ttTarget.hasAttribute(Attributes.TooltipWidth)) {
            tooltip.style.maxWidth = `calc(min(90%, ${ttTarget.getAttribute(Attributes.TooltipWidth) + 'px'}))`;
        } else {
            tooltip.style.removeProperty('max-width');
        }

        tooltip.classList[ar(Attributes.TooltipWidth)]('larger');
        tooltip.classList[ar(Attributes.TooltipCentered)]('centered');
        tooltip.classList[ar(Attributes.TooltipNoBreak)]('noBreak');
        const textSize = +ttTarget.getAttribute(Attributes.TooltipTextSize);
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
}
