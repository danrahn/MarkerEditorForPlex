import { $, $$, $append, $clear, $div, $i } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';

import { animateOpacity } from './AnimationHelpers.js';
import { Attributes } from './DataAttributes.js';
import ButtonCreator from './ButtonCreator.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import { ThemeColors } from './ThemeColors.js';
import Tooltip from './Tooltip.js';

/**
 * @typedef {Object} OverlayOptions
 * @property {boolean?} dismissible Whether the overlay can be dismissed. Default true
 * @property {boolean?} centered Determines whether the overlay is centered in the screen versus near the. Default false
 * @property {boolean?} noborder Don't surround the overlay's children with a border. Default false
 * @property {number?}  delay The visibility transition time in ms. Default 250
 * @property {boolean?} forceFullscreen Whether to force fullscreen elements
 * @property {boolean?} closeButton Whether to add a close button, even if we're not a full screen overlay.
 * @property {{args?: any[], fn (...any) => void}} setup Setup function to call once the overlay has been attached to the DOM.
 * @property {HTMLElement?} focusBack The element to set focus back to after the overlay is dismissed. If this is undefined
 *                                    no element will be focused. If it's null, set focus to whatever this was last set to.
 * @property {() => void} onDismiss Callback to invoke when this overlay is dismissed.
 */


const Log = ContextualLog.Create('Overlay');

/**
 * Class to display overlays on top of a webpage.
 *
 * Adapted from PlexWeb/script/overlay.js
 */
export default class Overlay {

    /**
     * Callback functions (if any) to invoke when this overlay is dismissed.
     * @type {(() => void)[]} */
    static #dismissCallbacks = [];

    /**
     * The element to set focus back to when the overlay is dismissed.
     * @type {HTMLElement?} */
    static #focusBack = null;

    /** @type {Promise<void>?} */
    static #containerLock = null;
    /** @type {(value: void | PromiseLike<void>) => void} */
    static #containerUnlock = null;
    /** @type {Promise<void>?} */
    static #dismissing;

    /**
     * Creates a full-screen overlay with the given message, button text, and button function.
     * @param {string|HTMLElement} message The message to display.
     * @param {string} [buttonText='OK'] The text of the button. Defaults to 'OK'.
     * @param {Function} [buttonFunc=Overlay.dismiss] The function to invoke when the button is pressed.
     * Defaults to dismissing the overlay.
     * @param {boolean} [dismissible=true] Control whether the overlay can be dismissed. Defaults to `true`.
     * @returns {Promise<void>} */
    static show(message, buttonText='OK', buttonFunc=Overlay.dismiss, dismissible=true) {
        return Overlay.build({ dismissible : dismissible, centered : false, focusBack : null },
            $div({ id : 'overlayMessage', class : 'overlayDiv' }, message),
            ButtonCreator.textButton(
                buttonText,
                buttonFunc,
                { id : 'overlayBtn', class : 'overlayInput overlayButton', style : 'width: 100px' })
        );
    }

    /**
     * Sets the overlay's message. Only valid if the current overlay was shown via `Overlay.show`.
     * @param {string|HTMLElement} message The new message to display */
    static setMessage(message) {
        const div = $('#overlayMessage');
        if (!div) {
            Log.error('No overlay message div found!');
            return;
        }

        if (message instanceof HTMLElement) {
            $clear(div);
            div.appendChild(message);
        } else {
            div.innerHTML = message;
        }
    }

    /**
     * Add a callback to be invoked when this overlay is dismissed.
     * @param {() => void} event */
    static addDismissEvent(event) {
        Overlay.#dismissCallbacks.push(event);
    }

    /**
     * Dismiss the overlay and remove it from the DOM.
     * Expects the overlay to exist. */
    static dismiss() {
        const main = Overlay.get();
        Overlay.#dismissing ??= animateOpacity(main, 1, 0, 250, () => {
            // We don't want the overlay to be ripped out from under us if we're in the middle of replacing it.
            if (!Overlay.#containerLock) {
                main.parentElement.removeChild(main);
            }

            Overlay.#dismissing = null;
            Tooltip.clearStaleTooltips();
        });

        Overlay.#focusBack?.focus();
        Overlay.#focusBack = null;

        // Dismiss after setting focus, as Tooltip's 'show on focus' behavior can be
        // annoying if it's not the user that's setting focus
        Tooltip.dismiss();

        while (Overlay.#dismissCallbacks.length > 0) {
            // Remove the callback before invoking it, in case the callback awaits this initial dismissal.
            Overlay.#dismissCallbacks.pop()();
        }

        window.removeEventListener('keydown', Overlay.overlayKeyListener);
        /** @type {HTMLHtmlElement} */
        const html = $$('html');
        html.style.removeProperty('overscroll-behavior');
        return Overlay.#dismissing;
    }

    /**
     * If the overlay is currently being dismissed, returns a promise that resolves when the dismissal is complete.
     * Otherwise resolves immediately. */
    static waitForDismiss() {
        return Overlay.#dismissing || Promise.resolve();
    }

    /**
     * @param {HTMLElement} element */
    static setFocusBackElement(element) {
        Overlay.#focusBack = element;
    }

    /**
     * Get the overlay node and container. Abstracts away whether we're in an overlay or not.
     * @param {OverlayOptions} options */
    static async #getOverlayContainers(options) {
        let inTransition = false;
        if (Overlay.showing()) {
            // If we're already showing an overlay, fade out the content and clear it before
            // handing back the top-level node and container
            Log.verbose('Replacing existing overlay to display a new one.');
            const overlayNode = Overlay.get();
            overlayNode.setAttribute(Attributes.OverlayDismissible, options.dismissible ? '1' : '0');
            /** @type {HTMLElement} */
            const container = $('#overlayContainer', overlayNode);
            const delay = options.delay === 0 ? 0 : (options.delay || 250);

            const initialOpacity = Math.min(
                parseFloat(getComputedStyle(container).opacity),
                parseFloat(getComputedStyle(overlayNode).opacity));
            inTransition = initialOpacity !== 1;
            if (options.delay === 0) {
                container.classList.remove('fadeOut');
            } else if (inTransition) {
                // If the initial opacity isn't 1, assume we're in the middle of showing the overlay,
                // and don't interrupt that initial animation, attempting to smoothly replace the contents.
                Log.info(`Attempting to show an overlay when another is in the middle of being shown/hidden. ` +
                            `Are you sure this is what you wanted?`);
            } else {
                await animateOpacity(container, 1, 0, delay);
            }

            $clear(container);
            return {
                overlayNode,
                container,
                inTransition
            };
        }

        // We're not already showing an overlay, build one.
        return {
            overlayNode : Overlay.#overlayNode(options),
            container : $div({ id : 'overlayContainer', class : options.centered ? 'centeredOverlay' : 'defaultOverlay' }),
            inTransition : false,
        };
    }

    /**
     * Lock the overlay to help avoid race conditions when attempting to show overlays
     * while a different overlay is already in the process of being displayed. While some
     * overlap is expected/supported, there are some critical sections that shouldn't be
     * fighting each other */
    static #lock() {
        Overlay.#containerLock = new Promise(r => { Overlay.#containerUnlock = r; });
    }

    /**
     * Unlock overlay adjustments after a leaving core setup. */
    static #unlock() {
        Overlay.#containerUnlock?.();
        Overlay.#containerLock = null;
        Overlay.#containerUnlock = null;
    }

    /**
     * Generic overlay builder.
     * @param {OverlayOptions} options Options that define how the overlay is shown.
     * @param {...HTMLElement} children A list of elements to append to the overlay. */
    static async build(options, ...children) {
        // If we have an existing overlay, fade it out, remove it, then fade in the new content.
        // If we're already waiting for it to fade out from a previous request, wait for that to finish first.
        if (Overlay.#containerLock) await Overlay.#containerLock;
        Overlay.#lock();

        const replaceInline = Overlay.showing();
        const delay = options.delay === 0 ? 0 : (options.delay || 250);
        const { overlayNode, container, inTransition } = await Overlay.#getOverlayContainers(options);

        if (!options.noborder) {
            container.classList.add('darkerOverlay');
        }

        children.forEach(function(element) {
            container.appendChild(element);
        });

        if (!replaceInline) {
            overlayNode.appendChild(container);
            document.body.appendChild(overlayNode);
        }

        Tooltip.dismiss();

        if (options.forceFullscreen || container.clientHeight / window.innerHeight > 0.7) {
            Overlay.#addFullscreenOverlayElements(container, options.dismissible);
        } else if (options.closeButton) {
            Overlay.#addCloseButton();
        }

        if (!options.dismissible && options.closeButton) {
            Overlay.#addCloseButton();
        }

        Overlay.#setupTabInputs(overlayNode); // Potentially sets focus, so make sure this is before options.setup
        if (options.setup) {
            // TODO: This is currently just used to set a non-default focus. If there's no other
            // use for this, should it be collapsed into an 'initial focus' field?
            const args = options.setup.args || [];
            options.setup.fn(...args);
        }

        if (options.focusBack !== null) {
            Overlay.#focusBack = options.focusBack;
        }

        if (options.onDismiss) {
            Overlay.#dismissCallbacks.push(options.onDismiss);
        }

        Overlay.#unlock();
        if (replaceInline) {
            if (!inTransition) {
                await animateOpacity(container, 0, 1, delay);
            }
        } else {
            // Note: This could be a static listener that's never removed, but tie it to the lifetime
            // of the overlay to avoid unnecessary processing, even though it's likely a micro optimization.
            window.addEventListener('keydown', Overlay.overlayKeyListener, false);
            if (delay !== 0) {
                await animateOpacity(overlayNode, 0, 1, delay, () => {
                    overlayNode.style.removeProperty('opacity');
                });
            }
        }
    }

    /**
     * Replace all the contents of the current overlay with something else (keeping all main overlay settings the same).
     * Also handles things like setting up tab navigation so the new content can't escape the overlay.
     * @param {HTMLOrSVGElement|string} newContent */
    static replace(newContent) {
        if (!Overlay.showing()) {
            Log.warn('Tried to replace overlay content, but no overlay is currently showing.');
            return;
        }

        const container = $('#overlayContainer', Overlay.get());
        $clear(container);
        if (newContent instanceof HTMLElement || newContent instanceof SVGElement) {
            container.appendChild(newContent);
        } else {
            container.innerHTML = newContent;
        }

        // If we have a close button, remove and re-add it to ensure tab navigation gets reset.
        const closeButton = $$('.overlayCloseButton', Overlay.get());
        if (closeButton) {
            closeButton.remove();
            Overlay.#addCloseButton();
        }

        Overlay.#setupTabInputs(Overlay.get());
    }

    /**
     * Create the main overlay element based on the given options.
     * @param {OverlayOptions} options The options for the overlay. See `build` for details.
     * @returns The main overlay Element. */
    static #overlayNode(options) {
        return $div(
            {
                id : 'mainOverlay',
                style : `opacity: ${options.delay === 0 ? '1' : '0'}`,
                [Attributes.OverlayDismissible] : options.dismissible ? '1' : '0'
            },
            0,
            {
                click : e => {
                    /** @type {HTMLElement} */
                    const overlayElement = $('#mainOverlay');
                    if (overlayElement
                        && overlayElement.getAttribute(Attributes.OverlayDismissible) === '1'
                        && (e.target.id === 'mainOverlay' || (options.noborder && e.target.id === 'overlayContainer'))
                        && getComputedStyle(overlayElement).opacity === '1') {
                        Overlay.dismiss();
                    }
                },
                scroll : Tooltip.onScroll,
            }
        );
    }

    /**
     * Ensures that tab navigation doesn't "escape" the overlay by forcing the first/last tabbable element to
     * cycle to the last/first instead of anything outside of #mainOverlay.
     *
     * TODO: This could break if anyone reaches into the overlay manually and adjusts the elements.
     * @param {HTMLElement} overlayNode */
    static #setupTabInputs(overlayNode) {
        const focusable = $('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', overlayNode);
        if (focusable) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            first.addEventListener('keydown', (/**@type {KeyboardEvent}*/e) => {
                if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    last.focus();
                }
            });

            last.addEventListener('keydown', (/**@type {KeyboardEvent}*/e) => {
                if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    first.focus();
                }
            });

            first.focus();
        }
    }

    /**
     * Sets different classes and adds a close button for overlays
     * that are set to 'fullscreen'.
     * @param {HTMLElement} container The main overlay container. */
    static #addFullscreenOverlayElements = function(container, dismissible) {
        container.classList.remove('defaultOverlay');
        container.classList.remove('centeredOverlay');
        container.classList.add('fullOverlay');
        $$('html').style.overscrollBehavior = 'none';
        if (dismissible) {
            Overlay.#addCloseButton();
        }
    };

    static #addCloseButton() {
        const close = $append(
            $i(
                { tabindex : 0, class : 'overlayCloseButton' },
                0,
                { click : Overlay.dismiss,
                  keyup : (e) => { if (e.key === 'Enter') Overlay.dismiss(); } }
            ),
            getSvgIcon(Icons.Cancel, ThemeColors.Primary));

        Tooltip.setTooltip(close, 'Close');
        Overlay.get().appendChild(close);
    }

    /**
     * Internal helper that dismisses an overlay when escape is pressed,
     * but only if the overlay is set to be dismissible.
     * @param {KeyboardEvent} e The Event. */
    static overlayKeyListener(e) {
        if (e.key === 'Escape') {
            /** @type {HTMLElement} */
            const overlayNode = Overlay.get();
            if (overlayNode && overlayNode.getAttribute(Attributes.OverlayDismissible) === '1') {
                Overlay.dismiss();
            }
        }
    }

    /**
     * Return whether an overlay is currently showing. */
    static showing() {
        return !!Overlay.get();
    }

    /**
     * Returns the current overlay HTML, if any.
     * @returns {HTMLElement} */
    static get() {
        return $$('body>#mainOverlay');
    }

    /**
     * Sets whether the overlay can be dismissed by the user via Escape/clicking outside of the main content.
     * @param {boolean} dismissible */
    static setDismissible(dismissible) {
        Overlay.get().setAttribute(Attributes.OverlayDismissible, dismissible ? 1 : 0);
    }
}
