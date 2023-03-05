import { $, buildNode, clearEle } from '../Common.js';
import { Log } from '../../../Shared/ConsoleLog.js';

import Animation from './Animate.js';
import Tooltip from './Tooltip.js';

import ButtonCreator from '../ButtonCreator.js';
import ThemeColors from '../ThemeColors.js';

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
 */

/**
 * Class to display overlays on top of a webpage.
 *
 * Taken from PlexWeb/script/overlay.js
 * CSS animations should probably be used instead of my home-grown Animate.js,
 * but I'm too lazy to change things right now.
 */
const Overlay = new function() {
    /**
     * Creates a full-screen overlay with the given message, button text, and button function.
     * @param {string|HTMLElement} message The message to display.
     * @param {string} [buttonText='OK'] The text of the button. Defaults to 'OK'.
     * @param {Function} [buttonFunc=Overlay.dismiss] The function to invoke when the button is pressed.
     * Defaults to dismissing the overlay.
     * @param {boolean} [dismissible=true] Control whether the overlay can be dismissed. Defaults to `true`.
     */
    this.show = function(message, buttonText='OK', buttonFunc=Overlay.dismiss, dismissible=true) {
        this.build({ dismissible : dismissible, centered : false, focusBack : null },
            buildNode('div', { id : 'overlayMessage', class : 'overlayDiv' }, message),
            ButtonCreator.textButton(
                buttonText,
                buttonFunc,
                { id : 'overlayBtn', class : 'overlayInput overlayButton', style : 'width: 100px' })
        );
    };

    /**
     * Sets the overlay's message. Only valid if the current overlay was shown via `Overlay.show`.
     * @param {string|HTMLElement} message The new message to display */
    this.setMessage = function(message) {
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
    };

    /**
     * Dismiss the overlay and remove it from the DOM.
     * Expects the overlay to exist.
     * @param {...any} args Function parameters. Ignored unless a boolean is found, in which case it's used to determine whether
     *                      we should reset our focusBack element. We don't want to in overlay chains.
     */
    this.dismiss = function(...args) {
        Animation.queue({ opacity : 0 }, $('#mainOverlay'), 250, true /*deleteAfterTransition*/);
        Tooltip.dismiss();
        let forReshow = false;
        for (const arg of args) {
            // Gross, obviously. This function is called from many different contexts though,
            // so sometimes the first and second arguments aren't what we expect.
            if (typeof arg == 'boolean') {
                forReshow = arg;
                break;
            }
        }

        if (!forReshow) {
            focusBack?.focus();
            focusBack = null;
        }
    };

    /** Immediately remove the overlay from the screen without animation. */
    const destroyExistingOverlay = function() {
        const overlay = $('#mainOverlay');
        if (overlay) {
            Log.verbose('Destroying existing overlay to display a new one.');
            overlay.parentNode.removeChild(overlay);
            Tooltip.dismiss();
        }
    };

    /**
     * The element to set focus back to when the overlay is dismissed.
     * @type {HTMLElement?} */
    let focusBack = null;

    /**
     * @param {HTMLElement} element */
    this.setFocusBackElement = function(element) {
        focusBack = element;
    };

    /**
     * Generic overlay builder.
     * @param {OverlayOptions} options Options that define how the overlay is shown.
     * @param {...HTMLElement} children A list of elements to append to the overlay.
     */
    this.build = function(options, ...children) {
        // Immediately remove any existing overlays
        destroyExistingOverlay();
        const overlayNode = _overlayNode(options);

        const container = buildNode('div', { id : 'overlayContainer', class : options.centered ? 'centeredOverlay' : 'defaultOverlay' });
        if (!options.noborder) {
            container.classList.add('darkerOverlay');
        }

        children.forEach(function(element) {
            container.appendChild(element);
        });

        overlayNode.appendChild(container);
        document.body.appendChild(overlayNode);
        if ($('#tooltip')) {
            Tooltip.dismiss();
        }

        const delay = options.delay || 250;
        if (delay != 0) {
            Animation.fireNow({ opacity : 1 }, overlayNode, delay);
        }

        if (options.forceFullscreen || container.clientHeight / window.innerHeight > 0.7) {
            addFullscreenOverlayElements(container);
        } else if (options.closeButton) {
            addCloseButton();
        }

        setupTabInputs(overlayNode); // Potentially sets focus, so make sure this is before options.setup
        if (options.setup) {
            // TODO: This is currently just used to set a non-default focus. If there's no other
            // use for this, should it be collapsed into an 'initial focus' field?
            const args = options.setup.args || [];
            options.setup.fn(...args);
        }

        if (options.focusBack !== null) {
            focusBack = options.focusBack;
        }

        window.addEventListener('keydown', overlayKeyListener, false);
    };

    /**
     * Create the main overlay element based on the given options.
     * @param {*} options The options for the overlay. See `build` for details.
     * @returns The main overlay Element.
     */
    const _overlayNode = function(options) {
        return buildNode('div',
            {
                id : 'mainOverlay',
                style : `opacity: ${options.delay == 0 ? '1' : '0'}`,
                dismissible : options.dismissible ? '1' : '0'
            },
            0,
            {
                click : function(e) {
                    const overlayElement = $('#mainOverlay');
                    if (overlayElement
                        && overlayElement.getAttribute('dismissible') == '1'
                        && (e.target.id == 'mainOverlay' || (options.noborder && e.target.id == 'overlayContainer'))
                        && overlayElement.style.opacity == 1) {
                        Overlay.dismiss();
                    }
                }
            }
        );
    };

    /**
     * Ensures that tab navigation doesn't "escape" the overlay by forcing the first/last tabbable element to
     * cycle to the last/first instead of anything outside of #mainOverlay.
     *
     * TODO: This could break if anyone reaches into the overlay manually and adjusts the elements.
     * @param {HTMLElement} overlayNode */
    const setupTabInputs = function(overlayNode) {
        const focusable = $('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', overlayNode);
        if (focusable) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            first.addEventListener('keydown', (/**@type {KeyboardEvent}*/e) => {
                if (e.key == 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    last.focus();
                }
            });

            last.addEventListener('keydown', (/**@type {KeyboardEvent}*/e) => {
                if (e.key == 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
                    e.preventDefault();
                    first.focus();
                }
            });

            first.focus();
        }
    };

    /**
     * Sets different classes and adds a close button for overlays
     * that are set to 'fullscreen'.
     * @param {HTMLElement} container The main overlay container.
     */
    const addFullscreenOverlayElements = function(container) {
        container.classList.remove('defaultOverlay');
        container.classList.remove('centeredOverlay');
        container.classList.add('fullOverlay');
        addCloseButton();
    };

    const addCloseButton = function() {
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
                keyup : (e) => { if (e.key == 'Enter') Overlay.dismiss(); },
            });
        Tooltip.setTooltip(close, 'Close');
        $('#mainOverlay').appendChild(close);
    };

    /**
     * Internal helper that dismisses an overlay when escape is pressed,
     * but only if the overlay is set to be dismissible.
     * @param {KeyboardEvent} e The Event.
     */
    const overlayKeyListener = function(e) {
        if (e.keyCode == 27 /*esc*/) {
            const overlayNode = $('#mainOverlay');
            if (overlayNode && !!overlayNode.getAttribute('dismissible') && overlayNode.style.opacity == '1') {
                window.removeEventListener('keydown', overlayKeyListener, false);
                Overlay.dismiss();
            }
        }
    };
}();

export default Overlay;
