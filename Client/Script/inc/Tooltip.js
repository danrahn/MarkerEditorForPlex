import { $, buildNode } from './../Common.js';
import { Log } from '../../../Shared/ConsoleLog.js';

/**
 * Implements common functionality for on-hover tooltips, offering expanded functionality over 'title'.
 * Taken from PlexWeb/script/Tooltip.
 * @class
 */
let Tooltip = new function()
{
    /** Contains the setTimeout id of a scroll event, which will hide the tooltip when expired */
    let hideTooltipTimer = null;

    window.addEventListener("load", function()
    {
        let frame = $("#plexFrame");
        frame.appendChild(buildNode("div", { id : "tooltip" }));
        frame.addEventListener("scroll", function()
        {
            // On scroll, hide the tooltip (mainly for mobile devices)
            // Add a bit of delay, as it is a bit jarring to have it immediately go away
            if (hideTooltipTimer)
            {
                clearTimeout(hideTooltipTimer);
            }

            hideTooltipTimer = setTimeout(() => { $("#tooltip").style.display = "none"; }, 100);
        });
    });

    /**
     * Sets up tooltip handlers for basic use cases.
     * @param {HTMLElement} element The element to add the tooltip to.
     * @param {string} tooltip The tooltip text.
     * @param {number} [delay=250] The duration an element must be hovered before the tooltip is shown, in ms.
     */
    this.setTooltip = function(element, tooltip, delay=250)
    {
        this.setText(element, tooltip);
        element.setAttribute("ttDelay", delay);
        element.addEventListener("mousemove", function(e)
        {
            Tooltip.showTooltip(e, this.getAttribute("tt"), this.getAttribute("ttDelay"));
        });

        element.addEventListener("mouseleave", function()
        {
            Tooltip.dismiss();
        });
    };

    /**
     * Sets the tooltip text for the given element.
     * Assumes `element` has gone through the initial tooltip setup.
     * @param {HTMLElement} element
     * @param {string} tooltip
     */
    this.setText = function(element, tooltip)
    {
        element.setAttribute("tt", tooltip);
        if (showingTooltip && ttElement == element)
        {
            $("#tooltip").innerHTML = tooltip;
        }
    };

    /**
     * Retrieve the current tooltip text for the given element,
     * or an empty string if it does not exist.
     * @param {HTMLElement} element
     */
    this.getText = function(element)
    {
        return element.getAttribute("tt") || "";
    }

    /** @type {number} `timerId` to keep track of the tooltip delay timeout. */
    let tooltipTimer = null;

    /** @type {boolean} Keeps track of whether the tooltip is currently visible. */
    let showingTooltip = false;

    /** @type {HTMLElement} The element whose tooltip is currently visible. */
    let ttElement = null;

    /**
     * Updates the position of Show a tooltip with the given text at a position relative to the current clientX/Y.
     * If the tooltip is not currently visible, resets the delay timer.
     * @param {MouseEvent} e The MouseEvent that triggered this function.
     * @param {string} text The text to display.
     * @param {number} [delay=250] The delay before showing the tooltip, in ms.
     */
    this.showTooltip = function(e, text, delay=250)
    {
        // If we have a raw string, shove it in a span first
        if (typeof(text) == "string")
        {
            text = buildNode("span", {}, text);
        }

        if (showingTooltip)
        {
            showTooltipCore(e, text);
            return;
        }

        if (tooltipTimer)
        {
            clearTimeout(tooltipTimer);
        }

        tooltipTimer = setTimeout(showTooltipCore, delay, e, text);
    };

    const windowMargin = 10;

    /**
     * Updates the position of the current tooltip, if active.
     * @param {number} clientX The new X-axis offset.
     * @param {number} clientY The new Y-axis offset.
     */
    this.updatePosition = function(clientX, clientY)
    {
        if (!showingTooltip)
        {
            Log.verbose("Not updating tooltip position as it's not currently active");
            return;
        }

        let tooltip = $("#tooltip");
        let maxHeight = $("#plexFrame").clientHeight - tooltip.clientHeight - 20 - windowMargin;
        tooltip.style.top = (Math.min(clientY, maxHeight) + 20) + "px";
        let avoidOverlay = clientY > maxHeight ? 10 : 0;
        let maxWidth = $("#plexFrame").clientWidth - tooltip.clientWidth - windowMargin - avoidOverlay;
        tooltip.style.left = (Math.min(clientX, maxWidth) + avoidOverlay) + "px";
    };

    /**
     * Core routine to show a tooltip and update its position.
     * Should not be called outside of this file.
     * @param {MouseEvent} e The MouseEvent that triggered this function.
     * @param {HTMLElement} text The tooltip Element containing the tooltip text.
     */
    let showTooltipCore = function(e, text)
    {
        if (!showingTooltip)
        {
            Log.tmi(text, `Launching tooltip`);
        }

        ttElement = e.target;
        showingTooltip = true;
        let tooltip = $("#tooltip");

        let ttUpdated = ttElement && ttElement.getAttribute("tt");
        if (ttUpdated)
        {
            tooltip.innerHTML = ttUpdated;
        }
        else
        {
            tooltip.innerHTML = "";
            tooltip.appendChild(text);
        }

        tooltip.style.display = "inline";

        const heightAdjust = tooltip.clientHeight + 20 + windowMargin;
        const rawHeight = e.clientY + window.scrollY;
        const maxHeight = window.innerHeight + window.scrollY - heightAdjust;
        tooltip.style.top = (Math.min(rawHeight, maxHeight) + 20) + "px";

        const avoidOverlay = rawHeight > maxHeight ? 10 : 0;
        const widthAdjust = tooltip.clientWidth + windowMargin + avoidOverlay;
        const maxWidth = window.innerWidth + window.scrollX - widthAdjust;
        tooltip.style.left = (Math.min(e.clientX + window.scrollX, maxWidth) + avoidOverlay) + "px";
    };

    /** Dismisses the tooltip. */
    this.dismiss = function()
    {
        if (showingTooltip)
        {
            Log.tmi(`Dismissing tooltip: ${$("#tooltip").innerHTML}`);
        }
        $("#tooltip").style.display = "none";
        clearTimeout(tooltipTimer);
        tooltipTimer = null;
        showingTooltip = false;
    };

    /**
     * @returns `true` if we're currently showing a tooltip.
     */
    this.active = function()
    {
        return showingTooltip;
    };
}();

export default Tooltip;
