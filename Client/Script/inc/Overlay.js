import { $, buildNode, clearEle } from '../Common.js';
import { Log } from '../../../Shared/ConsoleLog.js';

import Animation from './Animate.js';
import Tooltip from './Tooltip.js';
import ThemeColors from '../ThemeColors.js';
import ButtonCreator from '../ButtonCreator.js';

/**
 * @typedef {{ dismissible?: boolean, centered?: boolean, noborder?: boolean, delay?: number,
 *              closeButton?: boolean, setup?: {args: any[], fn: (...any) => void}}} OverlayOptions
 * */

/**
 * Class to display overlays on top of a webpage.
 *
 * Taken from PlexWeb/script/overlay.js
 * CSS animations should probably be used instead of my home-grown Animate.js,
 * but I'm too lazy to change things right now.
 */
let Overlay = new function()
{
    /**
     * Creates a full-screen overlay with the given message, button text, and button function.
     * @param {string|HTMLElement} message The message to display.
     * @param {string} [buttonText='OK'] The text of the button. Defaults to 'OK'.
     * @param {Function} [buttonFunc=Overlay.dismiss] The function to invoke when the button is pressed.
     * Defaults to dismissing the overlay.
     * @param {boolean} [dismissible=true] Control whether the overlay can be dismissed. Defaults to `true`.
     */
    this.show = function(message, buttonText='OK', buttonFunc=Overlay.dismiss, dismissible=true)
    {
        // Set focus to the button on start
        const focusOnLaunch = { fn : () => $('#overlayBtn').focus(), args : [] };
        this.build({ dismissible : dismissible, centered : false, setup : focusOnLaunch },
            buildNode("div", { id : "overlayMessage", class : "overlayDiv" }, message),
            ButtonCreator.textButton(
                buttonText,
                buttonFunc,
                { id : 'overlayBtn', class : 'overlayInput overlayButton', style : 'width: 100px'})
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
    }

    /**
     * Dismiss the overlay and remove it from the DOM.
     * Expects the overlay to exist.
     */
    this.dismiss = function()
    {
        Animation.queue({ opacity : 0 }, $("#mainOverlay"), 250, true /*deleteAfterTransition*/);
        Tooltip.dismiss();
    };

    /** Immediately remove the overlay from the screen without animation. */
    let destroyExistingOverlay = function()
    {
        const overlay = $('#mainOverlay');
        if (overlay) {
            Log.verbose('Destroying existing overlay to display a new one.');
            overlay.parentNode.removeChild(overlay);
            Tooltip.dismiss();
        }
    }

    /**
     * Generic overlay builder.
     * @param {OverlayOptions} options Options that define how the overlay is shown:
     *  * `dismissible` : Determines whether the overlay can be dismissed.
     *  * `centered` : Determines whether the overlay is centered in the screen (versus closer to the top).
     *  * `noborder` : Determine whether to surround the overlay's children with a dark border (defaults to false).
     *  * `delay` : Fade-in duration (defaults to 250ms).
     *  * `closeButton` : Whether to add a close button in the top-right (defaults to false).
     *  * `setup` : A function to run after attaching the children to the DOM, but before triggering the show animation.
     * @param {...HTMLElement} children A list of elements to append to the overlay.
     */
    this.build = function(options, ...children)
    {
        // Immediately remove any existing overlays
        destroyExistingOverlay();
        let overlayNode = _overlayNode(options);

        let container = buildNode("div", { id : "overlayContainer", class : options.centered ? "centeredOverlay" : "defaultOverlay" });
        if (!options.noborder)
        {
            container.classList.add("darkerOverlay");
        }

        children.forEach(function(element)
        {
            container.appendChild(element);
        });

        overlayNode.appendChild(container);
        document.body.appendChild(overlayNode);
        if ($("#tooltip"))
        {
            Tooltip.dismiss();
        }

        if (options.setup)
        {
            options.setup.fn(...options.setup.args);
        }

        let delay = options.delay || 250;
        if (delay != 0)
        {
            Animation.fireNow({ opacity : 1 }, overlayNode, delay);
        }

        if (container.clientHeight / window.innerHeight > 0.7)
        {
            addFullscreenOverlayElements(container);
        }
        else if (options.closeButton)
        {
            addCloseButton();
        }

        window.addEventListener("keydown", overlayKeyListener, false);
    };

    /**
     * Create the main overlay element based on the given options.
     * @param {*} options The options for the overlay. See `build` for details.
     * @returns The main overlay Element.
     */
    let _overlayNode = function(options)
    {
        return buildNode("div",
            {
                id : "mainOverlay",
                style : `opacity: ${options.delay == 0 ? '1' : '0'}`,
                dismissible : options.dismissible ? "1" : "0"
            },
            0,
            {
                click : function(e)
                {
                    let overlayElement = $("#mainOverlay");
                    if (overlayElement &&
                        overlayElement.getAttribute("dismissible") == "1" &&
                        (e.target.id == "mainOverlay" || (options.noborder && e.target.id == "overlayContainer")) &&
                        overlayElement.style.opacity == 1)
                    {
                        Overlay.dismiss();
                    }
                }
            }
        );
    };

    /**
     * Sets different classes and adds a close button for overlays
     * that are set to 'fullscreen'.
     * @param {HTMLElement} container The main overlay container.
     */
    let addFullscreenOverlayElements = function(container)
    {
        container.classList.remove("defaultOverlay");
        container.classList.remove("centeredOverlay");
        container.classList.add("fullOverlay");
        addCloseButton();
    };

    let addCloseButton = function() {
        let close = buildNode(
            "img",
            {
                src : ThemeColors.getIcon('cancel', 'standard'),
                class : 'overlayCloseButton'
            },
            0,
            {
                click : Overlay.dismiss
            });
        Tooltip.setTooltip(close, "Close");
        $("#mainOverlay").appendChild(close);
    }

    /**
     * Internal helper that dismisses an overlay when escape is pressed,
     * but only if the overlay is set to be dismissible.
     * @param {KeyboardEvent} e The Event.
     */
    let overlayKeyListener = function(e)
    {
        if (e.keyCode == 27 /*esc*/)
        {
            let overlayNode = $("#mainOverlay");
            if (overlayNode && !!overlayNode.getAttribute("dismissible") && overlayNode.style.opacity == "1")
            {
                window.removeEventListener("keydown", overlayKeyListener, false);
                Overlay.dismiss();
            }
        }
    };
}();

export default Overlay;
