import { ConsoleLog, ContextualLog } from '/Shared/ConsoleLog.js';
import { $$ } from './HtmlHelpers.js';
import { Attributes } from './DataAttributes.js';

const Log = ContextualLog.Create('Animate');

/**
 * @typedef {Object} CustomAnimationOptions
 * @property {boolean} [noReset] Don't reset an element's animated property to its original value on completion.
 *
 * @typedef {CustomAnimationOptions & KeyframeAnimationOptions} AnimationOptions
 */

/**
 * Helper that parses animation method calls and logs to TMI output
 * @param {string} method
 * @param {HTMLElement} element
 * @param {object} params */
const logAnimate = (method, element, params={}) => {
    // Avoid unnecessary parsing if we're not going to show it
    if (Log.getLevel() > ConsoleLog.Level.TMI) { return; }

    let msg = `method=${method}`;
    for (const [key, value] of Object.entries(params)) {
        let displayValue = value;
        if (typeof value === 'object') {
            // Assume JSON
            displayValue = JSON.stringify(value);
        } else if (typeof value === 'function') {
            displayValue = value.name || '(anonymous)';
        }

        msg += `; ${key}=${displayValue}`;
    }

    Log.tmi(element, msg + '; element=');
};

/**
 * Flashes the background of the given element
 * @param {string|HTMLElement} ele The id of the element to animate, or the element itself.
 * @param {string} color The color to flash.
 * @param {number} [duration=500] The animation duration.
 * @param {() => any} [callback]
 * @returns {Promise<void>} */
export function flashBackground(ele, color, duration=1000, callback) {
    logAnimate('flashBackground', ele, { color, duration, callback });
    const button = typeof ele === 'string' ? $$(`#${ele}`) : ele;
    if (!button) { Log.warn(`flashBackground - Didn't find button`); return Promise.resolve(); }

    const initialColor = button.style.backgroundColor ?? 'transparent';
    return new Promise(resolve => {
        button.animate([
            { backgroundColor : initialColor },
            { backgroundColor : color, offset : 0.25 },
            { backgroundColor : color, offset : 0.75 },
            { backgroundColor : initialColor },
        ], {
            duration
        }).addEventListener('finish', async () => {
            await callback?.();
            resolve();
        });
    });
}

/**
 * Returns a promise that resolve when the given element has finished animating its opacity.
 * NOTE: Could probably be a Common.js method that generalizes "awaitable animate" if/when I get
 * around to removing more usage of Animate.js
 * @param {HTMLElement} ele The element to animate
 * @param {number} start The starting opacity for the element
 * @param {number} end The end opacity for the element
 * @param {number|AnimationOptions} options The length of the animation
 * @param {boolean|() => any} [callback] Either a boolean value indicating whether to remove the element
 *                            after the transition is complete, or a custom callback function.
 * @returns {Promise<void>} */
export function animateOpacity(ele, start, end, options, callback) {
    logAnimate('animateOpacity', ele, { start, end, options, callback });
    return new Promise(resolve => {
        ele.animate({ opacity : [start, end] }, options)
            .addEventListener('finish', async () => {
                if (options.noReset) {
                    ele.style.opacity = end;
                }

                if (callback) {
                    if (typeof callback === 'boolean') {
                        ele.parentElement.removeChild(ele);
                    } else if (typeof callback === 'function') {
                        await callback();
                    } else {
                        Log.warn(`animateOpacity options must be a boolean or a function.`);
                    }
                }

                resolve();
            });
    });
}

/**
 * Checks the given property on the element to be used as a restoration
 * value. If the element is already animating that property, return the
 * cached property, otherwise grab it from the style directly.
 * @param {HTMLElement} ele
 * @param {string} prop */
function checkProp(ele, prop) {
    let sav = ele.style[prop];
    if ((ele instanceof HTMLImageElement) && prop in ['width', 'height']) {
        // For images, use the width/height property directly if
        // the style isn't set, but make sure it ends with 'px'.
        sav ||= ele[prop];
        if (sav === 'number') {
            sav += 'px';
        }
    }

    prop = Attributes.PropReset(prop);
    const isAnimating = ele.getAttribute(prop);
    if (isAnimating !== null) {
        return isAnimating;
    }

    ele.setAttribute(prop, sav);
    return sav;
}

/**
 * Remove the given data-prop-reset property from the element
 * @param {HTMLElement} ele
 * @param {string} prop */
function removeProp(ele, prop) {
    ele.removeAttribute(Attributes.PropReset(prop));
}

/**
 * Shrink the height of ele to 0 while also fading out the content.
 * @param {HTMLElement} ele
 * @param {number|AnimationOptions} options
 * @param {(...any) => any} [callback]
 * @returns {Promise<void>} */
export function slideUp(ele, options, callback) {
    logAnimate('slideUp', ele, { options, callback });
    // Initial setup:
    // * Get the current height of the container so we have a known starting point
    // * Set overflow to hidden so content doesn't "escape" when the element shrinks away
    // * Explicitly set the height of the element BEFORE setting overflow:hidden, because
    //   overflow:hidden disables margin collapsing, so might increase the height of the element
    //   right before animating.
    const heightSav = checkProp(ele, 'height');
    let startingHeight = heightSav;
    if (!startingHeight) {
        const bounds = ele.getBoundingClientRect();
        startingHeight = (bounds.height) + 'px';
        ele.style.height = startingHeight;
    }

    return slide(
        ele,
        [{ opacity : 1, height : startingHeight }, { opacity : 0, height : '0px' }],
        options,
        async () => {
            if (ele instanceof HTMLImageElement) {
                ele.height = options.noReset ? 0 : heightSav;
                ele.style.removeProperty('height');
            } else {
                ele.style.height = options.noReset ? '0px' : heightSav;
            }

            removeProp(ele, 'height');

            await callback?.();
        });
}

/**
 * Expand the height of ele from 0 to the given finalHeight.
 * @param {HTMLElement} ele
 * @param {string} finalHeight
 * @param {number|AnimationOptions} options
 * @param {(...any) => any} [callback] */
export function slideDown(ele, finalHeight, options, callback) {
    logAnimate('slideDown', ele, { options, callback });
    const hasHeight = !!checkProp(ele, 'height');

    return slide(
        ele,
        [{ opacity : 0, height : '0px' }, { opacity : 1, height : finalHeight }],
        options,
        async () => {
            if (!hasHeight && !options.noReset) {
                ele.style.removeProperty('height');
            } else if (options.noReset) {
                // For images, remove the style height and
                // set the height attribute directly.
                if (ele instanceof HTMLImageElement) {
                    ele.height = parseInt(finalHeight);
                    ele.style.removeProperty('height');
                } else {
                    ele.style.height = finalHeight;
                }
            }

            removeProp(ele, 'height');

            await callback?.();
        });
}

/**
 * @param {HTMLElement} ele
 * @param {number[]} stops
 * @param {number|AnimationOptions} options
 * @param {(...any) => any} [callback]
 * @returns {Promise<void>} */
function slide(ele, stops, options, callback) {
    const ofSav = checkProp(ele, 'overflow');
    ele.style.overflow = 'hidden';

    return new Promise(resolve => {
        const ani = ele.animate(
            [
                { ...stops[0], easing : 'ease-out' },
                { ...stops[1] }
            ],
            options
        );

        ani.addEventListener('finish', async () => {
            ele.style.overflow = ofSav;
            removeProp(ele, 'overflow');
            await callback?.();
            resolve();
        });
    });
}

/**
 * Thin wrapper around Element.animate that returns a promise that resolves when
 * the animation is complete.
 * @param {HTMLElement} ele
 * @param {Keyframe[] | PropertyIndexedKeyframes} keyframes
 * @param {number} duration
 * @param {(...any) => any} callback
 * @returns {Promise<void>} */
export function animate(ele, keyframes, duration, callback) {
    logAnimate('animate', { keyframes, duration, callback });
    return new Promise(resolve => {
        ele.animate(keyframes, duration).addEventListener('finish', async () => {
            await callback?.(); // Not necessarily async, but if it is, wait for it to complete.
            resolve();
        });
    });
}
