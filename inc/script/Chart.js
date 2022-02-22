/// <summary>
/// A basic charting library
///
/// Currently only supports simple pie and bar charts
///
/// Taken from PlexWeb/script/chart.js
/// </summary>
let Chart = new function()
{
    /// <summary>
    /// Returns a pie chart in SVG form
    /// </summary>
    /// <param name="data">
    /// Required fields:
    ///  radius : the radius of the circle
    ///  points : the values to chart
    ///    Each point requires a 'value' and a 'label'
    ///
    /// Optional fields:
    ///  colors:
    ///    An array of colors to override the default choices
    ///  colorMap:
    ///    A dictionary mapping labels to colors. Takes precedence over colors.
    ///  noSort:
    ///    If true, points will not be sorted before creating the chart
    ///  labelOptions:
    ///    A dictionary of flags that determine the label:
    ///      percentage - show the percentage of the total (default = true)
    ///      count - show the raw value (default = false)
    ///      name - show the name of the data point (default = true)
    ///  title:
    ///    The title for the graph
    ///  noTitle:
    ///    Flag indicating that we shouldn't add a title, even if it is set
    /// </returns>
    this.pie = function(data)
    {
        sortData(data);

        let total = data.points.reduce((acc, cur) => acc + cur.value, 0);

        let r = data.radius;
        let hasTitle = data.title && !data.noTitle;
        let titleOffset = hasTitle ? 40 : 0;
        let svg = makeSvg(r * 2, r * 2 + titleOffset);
        --r; // Need space for border
        let cumulative = 0;
        let colors = data.colors ? data.colors : ["#FFC000", "#5B9BD5", "#A5A5A5", "#70AD47", "#4472C4", "#ED7D31"];
        let colorIndex = 0;
        for (let point of data.points)
        {
            let startPoint = getPoint(r, cumulative, total);
            let d = `M ${r} ${r + titleOffset} L ${startPoint.x} ${startPoint.y + titleOffset} `;

            cumulative += point.value;

            let endPoint = getPoint(r, cumulative, total);
            let sweep = (point.value > total / 2) ? "1" : "0";
            d += `A ${r} ${r} ${sweep} ${sweep} 0 ${endPoint.x} ${endPoint.y + titleOffset} `;
            d += `L ${endPoint.x} ${endPoint.y + titleOffset} ${r} ${r + titleOffset}`;
            let sliceColor = "";
            if (data.colorMap && data.colorMap[point.label])
            {
                sliceColor = data.colorMap[point.label];
            }
            else
            {
                sliceColor = colors[colorIndex++ % colors.length];
            }
            let slice = buildPieSlice(d, sliceColor);

            let label = buildPieTooltip(point, total, data.labelOptions);
            if (label.length != 0)
            {
                addTooltip(slice, label);
            }

            svg.appendChild(slice);
        }

        if (hasTitle)
        {
            svg.appendChild(buildCenteredText(titleOffset - 20, data.title, 18));
        }

        return svg;
    };

    /// <summary>
    /// Extremely basic bar graph support
    ///
    /// Required Fields:
    ///   width : the width of the chart
    ///   height : the height of the chart
    ///   points : an array of { value, label } pairs
    /// </summary>
    this.bar = function(data)
    {
        // For now, don't bother with negative values and assume all charts start at 0
        let max = data.points.reduce((acc, cur) => acc < cur.value ? cur.value : acc, 0);
        sortData(data);

        let hasTitle = data.title && !data.noTitle;
        let titleOffset = hasTitle ? 40 : 0;
        let svg = makeSvg(data.width, data.height + titleOffset);

        // Give 5% for the left/bottom labels (even though they aren't implemented yet, and 5% probably isn't enough)
        let fp = { x : data.width * 0.05, y : data.height * 0.05 };
        let axisWidth = Math.max(1, Math.round(data.height / 100));
        let axis = buildNodeNS(
            "http://www.w3.org/2000/svg",
            "polyline",
            {
                points : `${fp.x},${titleOffset} ${fp.x},${data.height - fp.y + titleOffset} ${data.width},${data.height - fp.y + titleOffset} `,
                stroke : "#616161",
                "stroke-width" : axisWidth,
                fill : "none"
            }
        );

        svg.appendChild(axis);

        let gridWidth = data.width - axisWidth - fp.x;
        let gridHeight = data.height - axisWidth - fp.y;
        let per = gridWidth / data.points.length;
        let barWidth = per >= 4 ? parseInt(per / 4 * 3) : per;

        let offsetX = axisWidth + fp.x;

        for (let point of data.points)
        {
            let height = gridHeight * (point.value / max);
            let bar = buildRect(offsetX, gridHeight - height + titleOffset, barWidth, height, "#4472C4");
            addTooltip(bar, `${point.label}: ${point.value}`);
            svg.appendChild(bar);

            // Also build a ghost bar for better tooltips, especially with small bars
            if (gridHeight - height > 1)
            {
                let ghostBar = buildRect(offsetX, titleOffset, barWidth, gridHeight, "none", { "pointer-events" : "all" });
                addTooltip(ghostBar, `${point.label}: ${point.value}`);
                ghostBar.addEventListener("mouseenter", function() { this.setAttribute("stroke", "#616161"); });
                ghostBar.addEventListener("mouseleave", function() { this.setAttribute("stroke", "none"); });
                svg.appendChild(ghostBar);
            }

            offsetX += per;
        }

        if (hasTitle)
        {
            svg.appendChild(buildCenteredText(titleOffset - 20, data.title, 18));
        }

        return svg;
    };

    /// <summary>
    /// Sorts a chart's data points, unless we explicitly don't want to.
    /// If data.sortFn is set, sort on that function. Otherwise, do a default smallest-to-largest sort
    /// </summary>
    let sortData = function(data)
    {
        if (data.noSort)
        {
            return;
        }

        if (data.sortFn)
        {
            data.points.sort(data.sortFn);
        }
        else
        {
            data.points.sort((a, b) => a.value - b.value);
        }
    };

    /// <summary>
    /// Adds a horizontally centered text node at the given y offset
    /// </summary>
    let buildCenteredText = function(y, text, size)
    {
        return buildNodeNS(
            "http://www.w3.org/2000/svg",
            "text",
            {
                x : "50%",
                y : y,
                fill : "#c1c1c1",
                "text-anchor" : "middle",
                "font-weight" : "bold",
                "font-size" : size + "pt"
            },
            text
        );
    };

    /// <summary>
    /// Returns a rectangle with the given start coordinates, width, height, and fill color
    /// </summary>
    /// <param name="extra">Any extra attributes that that should be added outside of the named parameters</pram>
    let buildRect = function(x, y, width, height, fill, extra)
    {
        let rect = buildNodeNS(
            "http://www.w3.org/2000/svg",
            "rect",
            {
                x : x,
                y : y,
                width : width,
                height : height,
                fill : fill
            }
        );

        if (extra)
        {
            for (let [key, value] of Object.entries(extra))
            {
                rect.setAttribute(key, value);
            }
        }

        return rect;
    };

    /// <summary>
    /// Builds a slice of a pie chart
    /// </summary>
    let buildPieSlice = function(definition, fill)
    {
        return buildNodeNS("http://www.w3.org/2000/svg",
            "path",
            {
                d : definition,
                fill : fill,
                stroke : "#616161",
                "pointer-events" : "all",
                xmlns : "http://www.w3.org/2000/svg"
            },
            0,
            {
                mouseenter : highlightPieSlice,
                mouseleave : function() { this.setAttribute("stroke", "#616161"); }
            });
    };

    /// <summary>
    /// Builds and returns the tooltip label for the given point, based on the given options
    /// </summary>
    let buildPieTooltip = function(point, total, labelOptions)
    {
        let label = "";
        let percentage = (point.value / total * 100).toFixed(2);
        if (!labelOptions)
        {
            return `${point.label} (${percentage}%)`;
        }

        if (labelOptions.name === undefined || labelOptions.name)
        {
            label += point.label;
        }

        if (labelOptions.count)
        {
            label += ` - ${point.value}`;
        }

        if (labelOptions.percentage === undefined || labelOptions.percentage)
        {
            label += ` (${percentage}%)`;
        }

        return label;
    };

    /// <summary>
    /// Highlights the edges of the hovered pie slice
    /// </summary>
    let highlightPieSlice = function()
    {
        // Setting this element to be the last will ensure that
        // the full outline is drawn (i.e. not covered by another slice)
        let parent = this.parentNode;
        parent.removeChild(this);
        parent.appendChild(this);
        this.setAttribute("stroke", "#c1c1c1");
    };

    /// <summary>
    /// Adds hover tooltips to the given data point
    /// </summary>
    let addTooltip = function(element, label)
    {
        Tooltip.setTooltip(element, label, 50);
    };

    /// <summary>
    /// Given a value and total, returns a point on a circle of
    /// the given radius that is (value / total * 100) percent of the circle
    /// <summary>
    let getPoint = function(radius, value, total)
    {
        // Need to translate coordinate systems
        let angle = (value / total) * Math.PI * 2;
        let x = radius * Math.cos(angle) + radius + 1; // + 1 to account for stroke border
        let y = radius - radius * Math.sin(angle) + 1;
        return { x : x, y : y };
    };

    /// <summary>
    /// Returns a top-level SVG container with the given width and height
    /// </summary>
    let makeSvg = function(width, height)
    {
        return buildNodeNS(
            "http://www.w3.org/2000/svg",
            "svg",
            {
                width : width,
                height : height,
                viewBox : `0 0 ${width} ${height}`,
                xmlns : "http://www.w3.org/2000/svg",
                x : 0,
                y : 0
            });
    };
}();
