import { $, $$, buildNode, clearEle } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { animateOpacity } from './AnimationHelpers.js';
import ButtonCreator from './ButtonCreator.js';
import ThemeColors from './ThemeColors.js';
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


const Log = new ContextualLog('Overlay');

/* eslint-disable no-invalid-this */ // Remove if Overlay becomes a proper class

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
            buildNode('div', { id : 'overlayMessage', class : 'overlayDiv' }, message),
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
            clearEle(div);
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
        const ret = animateOpacity(main, 1, 0, 250, true /*deleteAfterTransition*/);

        Overlay.#focusBack?.focus();
        Overlay.#focusBack = null;

        // Dismiss after setting focus, as Tooltip's 'show on focus' behavior can be
        // annoying if it's not the user that's setting focus
        Tooltip.dismiss();
        for (const dismiss of Overlay.#dismissCallbacks) {
            dismiss();
        }

        Overlay.#dismissCallbacks = [];

        window.removeEventListener('keydown', Overlay.overlayKeyListener);
        return ret;
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

            clearEle(container);
            return {
                overlayNode,
                container,
                inTransition
            };
        }

        // We're not already showing an overlay, build one.
        return {
            overlayNode : Overlay.#overlayNode(options),
            container : buildNode('div', { id : 'overlayContainer', class : options.centered ? 'centeredOverlay' : 'defaultOverlay' }),
            inTransition : false,
        };
    }

    /**
     * Generic overlay builder.
     * @param {OverlayOptions} options Options that define how the overlay is shown.
     * @param {...HTMLElement} children A list of elements to append to the overlay. */
    static async build(options, ...children) {
        // If we have an existing overlay, fade it out, remove it, then fade in the new content.
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

        if ($('#tooltip')) {
            Tooltip.dismiss();
        }

        if (options.forceFullscreen || container.clientHeight / window.innerHeight > 0.7) {
            Overlay.#addFullscreenOverlayElements(container);
        } else if (options.closeButton) {
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
     * Create the main overlay element based on the given options.
     * @param {OverlayOptions} options The options for the overlay. See `build` for details.
     * @returns The main overlay Element. */
    static #overlayNode(options) {
        return buildNode('div',
            {
                id : 'mainOverlay',
                style : `opacity: ${options.delay === 0 ? '1' : '0'}`,
                dismissible : options.dismissible ? '1' : '0'
            },
            0,
            {
                click(e) {
                    /** @type {HTMLElement} */
                    const overlayElement = $('#mainOverlay');
                    if (overlayElement
                        && overlayElement.getAttribute('dismissible') === '1'
                        && (e.target.id === 'mainOverlay' || (options.noborder && e.target.id === 'overlayContainer'))
                        && getComputedStyle(overlayElement).opacity === '1') {
                        Overlay.dismiss();
                    }
                }
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
    static #addFullscreenOverlayElements = function(container) {
        container.classList.remove('defaultOverlay');
        container.classList.remove('centeredOverlay');
        container.classList.add('fullOverlay');
        Overlay.#addCloseButton();
    };

    static #addCloseButton() {
        const close = buildNode(
            'img',
            {
                src : ThemeColors.getIcon('cancel', 'standard'),
                class : 'overlayCloseButton',
                tabindex : 0,
            },
            0,
            {
                click : Overlay.dismiss,
                keyup : (e) => { if (e.key === 'Enter') Overlay.dismiss(); },
            });
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
            if (overlayNode && !!overlayNode.getAttribute('dismissible')) {
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
}
