import { Log } from '../../../Shared/ConsoleLog.js';
import { buildNodeNS } from './../Common.js';
import Tooltip from './Tooltip.js';

/**
 * @typedef {string} DataLabel A label for a point in the chart.
 * @typedef {number} DataValue The value for a point in the chart.
 * @typedef {{ value : DataValue, label : DataLabel }} ChartDataPoint
 * @typedef {{ percentage : [boolean=true], count : [boolean=false], name : [boolean=true] }} ChartLabelOptions
 * */

class ChartOptions {
    /** The values to chart. */
    points;

    /**
     * Optional: A sort function to apply to {@linkcode points}.
     * @type {(a: ChartDataPoint, b: ChartDataPoint) => number} */
    sortFn;

    /**
     * Whether to leave the data points as-is, bypassing {@linkcode sortFn}
     * and the default smallest->largest sort order.
     * @type {boolean} */
    noSort;

    /**
     * The title of the chart.
     * @type {string} */
    title;

    /**
     * Whether we should hide the chart title, even if {@linkcode title} is set.
     * @type {boolean} */
    noTitle;

    /** Initialize ChartOptions with the given data points.
     * @param {ChartDataPoint[]} points */
    constructor(points) {
        if (!points) {
            Log.warn('Attempting to create a chart without any data points!');
            points = [{ value : 1, label : 'No Data To Chart' }];
        }

        this.points = points;
    }
}

class PieChartOptions extends ChartOptions {
    /** The radius of the pie chart, in pixels. */
    radius;

    /**
     * Optional: An array of colors to override the default choices. 
     * @type {string[]} */
     colors;

     /**
      * Optional: A dictionary mapping labels to colors. Takes precedences over {@linkcode colors}.
      * @type { { [label : DataLabel] : [color : string] } } */
     colorMap;

     /**
      * Optional: Determines the information to include in chart labels.
      * @type {ChartLabelOptions} */
     labelOptions;

     /** Initialize PieChartOptions with the two required fields, `points` and `radius`
      * @param {ChartDataPoint[]} points
      * @param {number} radius */
     constructor(points, radius) {
         super(points);
         if (!radius) {
             Log.error('Attempting to create a pie chart without a radius! Defaulting to 100.');
             radius = 100;
         }

         this.radius = radius;
     }
}

class BarChartOptions extends ChartOptions {
    /** The width of the bar chart, in pixels.
     * @type {number} */
    width;

    /** The height of the bar chart, in pixels.
     * @type {number} */
    height;

    constructor(points, width, height) {
        super(points);
        if (!width) {
            Log.error('Attempting to create a chart without a width! Defaulting to 100.');
            width = 100;
        }

        if (!height) {
            Log.error('Attempting to create a chart without a height! Defaulting to 100.');
            height = 100;
        }

        this.width = width;
        this.height = height;
    }
}

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
     * @param {PieChartOptions} data The pie chart definition
     * @returns An SVG element of the pie chart specified by `data`.
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
     * @param {BarChartOptions} data Object defining the bar graph.
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

export { Chart, ChartOptions, PieChartOptions, BarChartOptions };
