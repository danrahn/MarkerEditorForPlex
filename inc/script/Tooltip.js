/// <summary>
/// Implements common functionality for on-hover tooltips, and works a bit better than 'title'.
/// Taken from PlexWeb/script/Tooltip.js
/// </summary>

let Tooltip = new function()
{
    /// <summary>
    /// Contains the setTimeout id of a scroll event, which will hide the tooltip when expired
    /// </summary>
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

    /// <summary>
    /// Sets up tooltip handlers for basic use cases
    /// </summary>
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

    /// <summary>
    /// Sets the tooltip text for the given element
    /// If the tooltip for this element is currently showing, adjust that as well
    /// </summary>
    this.setText = function(element, tooltip)
    {
        element.setAttribute("tt", tooltip);
        if (showingTooltip && ttElement == element)
        {
            $("#tooltip").innerHTML = tooltip;
        }
    };

    let tooltipTimer = null;
    let showingTooltip = false;
    let ttElement = null;

    /// <summary>
    /// Show a tooltip with the given text at a position relative to clientX/Y in event e
    /// </summary>
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

    /// <summary>
    /// Updates the position of the current tooltip, if active
    /// </summary>
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

    /// <summary>
    /// Core routine to show a tooltip and update its position
    /// Should not be called outside of this file
    /// </summary>
    let showTooltipCore = function(e, text)
    {
        if (!showingTooltip)
        {
            Log.tmi(`Launching tooltip: ${text}`);
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

        let maxHeight = $("#plexFrame").clientHeight - tooltip.clientHeight - 20 - windowMargin;
        tooltip.style.top = (Math.min(e.clientY, maxHeight) + 20) + "px";

        let avoidOverlay = e.clientY > maxHeight ? 10 : 0;
        let maxWidth = $("#plexFrame").clientWidth - tooltip.clientWidth - windowMargin - avoidOverlay;
        tooltip.style.left = (Math.min(e.clientX, maxWidth) + avoidOverlay) + "px";
    };

    /// <summary>
    /// Dismisses the tooltip
    /// </summary>
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

    /// <summary>
    /// Returns whether we're currently showing a tooltip
    /// </summary>
    this.active = function()
    {
        return showingTooltip;
    };
}();
