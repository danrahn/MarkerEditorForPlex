/**
 * A basic charting library.
 *
 * Currently only supports simple pie and bar charts
 *
 * Taken from PlexWeb/script/chart.js
 * @class
 */
let Chart = new function()
{
    /**
     * Create an SVG pie chart.
     * @param {Object} data The pie chart definition
     * @param {number} data.radius The radius of the circle.
     * @param {{ value : number, label : string }[]} data.points The values of the to chart.
     * @param {string[]} [data.colors] An array of colors to override the default choices.
     * @param {{[label : string] : {color : string}}} [data.colorMap] A dictionary mapping labels to colors.
     * Takes precedence over `data.colors`.
     * @param {boolean} [data.noSort] If `true`, points will not be sorted before creating the chart.
     * @param {Object} [data.labelOptions] A dictionary of flags that determine how the label is displayed.
     * @param {boolean} [data.labelOptions.percentage=true] Show the percentage of the total (default = true).
     * @param {boolean} [data.labelOptions.count=false] Show the raw value (default = false).
     * @param {boolean} [data.labelOptions.name=true] Show the name of the data point (default = true).
     * @param {string} [data.title] The title for the graph.
     * @param {boolean} [data.noTitle=false] Whether we shouldn't add a title, even if `data.title` is set.
     * @returns An SVG element of the pie chart specified by `data`.
     * @typedef {data.labelOptions} LabelOptions
     */
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

    /**
     * Extremely basic bar graph support
     * @param {Object} data Object defining the bar graph.
     * Required Fields:
     *   `width`: The width of the chart.
     *   `height`: The height of the chart
     *   `points`: An array of `{ value, label }` pairs
     * @returns An SVG of the bar graph defined by `data`.
     */
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

    /**
     * Sorts a chart's data points in-place, unless we explicitly don't want to.
     * If `data.sortFn` is set, sort on that function. Otherwise di a default smallest-to-largest sort.
     * @param {Object} data The graph data.
     */
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

    /** Adds a horizontally centered text node at the given y offset */
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

    /**
     * Create a rectangle with the supplied properties.
     * @param {number} x Starting point on the x-axis.
     * @param {number} y Starting point on the y-axis.
     * @param {number} width The width of the rectangle.
     * @param {number} height The height of the rectangle.
     * @param {string} fill The fill color, as a hex string.
     * @param {Object} [extra] Extra attributes to append to the SVG node.
     * @returns An SVG rectangle.
     */
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

    /**
     * Create a single slice of a pie chart.
     * @param {string} definition The slice path.
     * @param {string} fill The fill color as a hex string.
     * @returns An SVG sector of a pie chart.
     */
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

    /**
     * Builds tooltip text for a point on the chart.
     * @param {Object} point The `{ value, label }` data for the point.
     * @param {number} total The sum of all the values in the chart.
     * @param {Object<string, boolean>} labelOptions Label options, as described by {@linkcode Chart.pie}.
     * @returns Tooltip text for the given point.
     */
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

    /** Highlights the edges of the hovered pie slice */
    let highlightPieSlice = function()
    {
        // Setting this element to be the last will ensure that
        // the full outline is drawn (i.e. not covered by another slice)
        let parent = this.parentNode;
        parent.removeChild(this);
        parent.appendChild(this);
        this.setAttribute("stroke", "#c1c1c1");
    };

    /**
     * Add a hover tooltip to the given element.
     * @param {HTMLElement} element The element to add the tooltip to.
     * @param {string} label The hover text.
     */
    let addTooltip = function(element, label)
    {
        Tooltip.setTooltip(element, label, 50);
    };

    /**
     * Given a value and total, return a point on a circle of the given radius
     * that is (`value / total * 100`) percent of the circle.
     * @param {number} radius The radius of the pie chart.
     * @param {number} value The value of the data point.
     * @param {number} total The sum of values for the entire pie chart.
     * @returns `x, y` coordinates of the point on the circle.
     */
    let getPoint = function(radius, value, total)
    {
        // Need to translate coordinate systems
        let angle = (value / total) * Math.PI * 2;
        let x = radius * Math.cos(angle) + radius + 1; // + 1 to account for stroke border
        let y = radius - radius * Math.sin(angle) + 1;
        return { x : x, y : y };
    };

    /**
     * Create a top-level SVG container.
     * @param {number} width The width of the container.
     * @param {number} height The height of the container
     * @returns {HTMLElement} An SVG `Element`
     */
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

// Hack for VSCode intellisense.
if (typeof __dontEverDefineThis !== 'undefined') {
    module.exports = { Chart };
}
