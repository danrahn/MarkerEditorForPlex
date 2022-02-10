/// <summary>
/// Class to display overlays on top of a webpage. Taken from PlexWeb/script/overlay.js
///
/// CSS animations should probably be used instead of my home-grown Animate.js, but I'm too lazy to change things right now.
/// </summary>
let Overlay = new function()
{
    /// <summary>
    /// Creates a full-screen overlay with the given message, button text, and button function.
    /// </summary>
    this.show = function(message, buttonText, buttonFunc=Overlay.dismiss, dismissible=true)
    {
        this.build({ dismissible : dismissible, centered : false },
            buildNode("div", { id : "overlayMessage", class : "overlayDiv" }, message),
            buildNode(
                "input",
                {
                    type : "button",
                    id : "overlayBtn",
                    class : "overlayInput overlayButton",
                    value : buttonText,
                    style : "width: 100px"
                },
                0,
                {
                    click : buttonFunc
                }
            )
        );
    };

    /// <summary>
    /// Common method to fade out and delete an overlay
    /// </summary>
    this.dismiss = function()
    {
        Animation.queue({ opacity : 0 }, $("#mainOverlay"), 250, true /*deleteAfterTransition*/);
        Tooltip.dismiss();
    };

    /// <summary>
    /// Generic overlay builder
    /// </summary>
    /// <param name="options">
    /// Options that define how the overlay is shown:
    ///   dismissible : Determines whether the overlay can be dismissed
    ///   centered : Determines whether the overlay is centered in the screen (versus closer to the top)
    ///   noborder : Determine whether to surround the overlay's children with a dark border (defaults to false)
    ///   setup : A function to run after attaching the children to the DOM, but before triggering the show animation
    /// </param>
    /// <param name="...children">The list of nodes to append to the overlay.</param>
    this.build = function(options, ...children)
    {
        if ($("#mainOverlay") && $("#mainOverlay").style.opacity != "0")
        {
            return;
        }

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

        Animation.queue({ opacity : 1 }, overlayNode, 250);
        if (container.clientHeight / window.innerHeight > 0.7)
        {
            addFullscreenOverlayElements(container);
        }

        window.addEventListener("keydown", overlayKeyListener, false);
    };

    let _overlayNode = function(options)
    {
        return buildNode("div",
            {
                id : "mainOverlay",
                style : "opacity: 0",
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

    /// <summary>
    /// Sets different classes and adds a close button for overlays
    /// that take up more space
    /// </summary>
    let addFullscreenOverlayElements = function(container)
    {
        container.classList.remove("defaultOverlay");
        container.classList.remove("centeredOverlay");
        container.classList.add("fullOverlay");
        let close = buildNode(
            "img",
            {
                src : Icons.get("exit"),
                style : "position: fixed; top: 10px; right: 20px; width: 25px"
            },
            0,
            {
                click : Overlay.dismiss,
                mouseover : function() { this.src = Icons.getColor("exit", "e1e1e1"); },
                mouseout : function() { this.src = Icons.get("exit"); }
            });
        Tooltip.setTooltip(close, "Close");
        $("#mainOverlay").appendChild(close);
    };

    /// <summary>
    /// Internal helper that dismisses an overlay when escape is pressed,
    /// but only if the overlay is set to be dismissible
    /// </summary>
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
