import { $, appendChildren, buildNode, plural } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { getPieChart, PieChartOptions } from './Chart.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import MarkerBreakdown from '../../Shared/MarkerBreakdown.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import { ThemeColors } from './ThemeColors.js';
import Tooltip from './Tooltip.js';

/** @typedef {!import('./Chart').ChartDataPoint} ChartDataPoint */

const Log = new ContextualLog('BreakdownChart');

/**
 * Available charts
 * @enum */
const BreakdownType = {
    /**@readonly*/ Combined : 0,
    /**@readonly*/ Intros   : 1,
    /**@readonly*/ Credits  : 2,
};

/**
 * Titles for the above chart types. */
const BreakdownTitles = {
    [BreakdownType.Combined] : 'Marker Breakdown',
    [BreakdownType.Intros]   : 'Intro Breakdown',
    [BreakdownType.Credits]  : 'Credits Breakdown',
};

/**
 * Tooltip labels for the given BreakdownType. */
const DataLabels = {
    [BreakdownType.Combined] : 'Marker',
    [BreakdownType.Intros]   : 'Intro Marker',
    [BreakdownType.Credits]  : 'Credits Marker',
};

class MarkerBreakdownManager {

    /** @type {MarkerBreakdown} */
    #currentBreakdown = null;

    /** Create a new marker breakdown manager for this session. */
    constructor() {
        const stats = $('#markerBreakdown');
        stats.addEventListener('click', this.#getBreakdown.bind(this));
        Tooltip.setTooltip(stats, 'Generate a graph displaying the number<br>of episodes with and without markers');
    }

    /**
     * Retrieves marker breakdown data from the server, then displays it in an overlay chart.
     * The initial request may take some time for large libraries, so first show an overlay
     * letting the user know something's actually happening. */
    async #getBreakdown() {
        this.#currentBreakdown = null;
        Overlay.show(
            appendChildren(buildNode('div'),
                buildNode('h2', {}, 'Marker Breakdown'),
                buildNode('br'),
                buildNode('div', {}, 'Getting marker breakdown. This may take awhile...'),
                buildNode('br'),
                getSvgIcon(Icons.Loading, ThemeColors.Primary, { width : 30, height : 30 })),
            'Cancel');

        Overlay.setFocusBackElement($('#markerBreakdown'));

        try {
            const rawBreakdown = await ServerCommands.getMarkerStats(PlexClientState.activeSection());
            this.#currentBreakdown = new MarkerBreakdown().initFromRawBreakdown(rawBreakdown);
            this.#showMarkerBreakdown(BreakdownType.Combined);
        } catch (err) {
            errorResponseOverlay('Failed to show breakdown', err);
        }
    }

    /**
     * Displays a pie chart of the data from the server.
     * @param {MarkerBreakdown} breakdown The marker breakdown data */
    #showMarkerBreakdown(breakdownType) {
        const overlay = Overlay.get();
        if (!overlay || !this.#currentBreakdown) {
            Log.verbose('Overlay is gone, not showing stats');
            return; // User closed out of window
        }

        /** @type {ChartDataPoint[]} */
        const dataPoints = [];
        let chartData;
        switch (breakdownType) {
            case BreakdownType.Combined:
                chartData = this.#currentBreakdown.collapsedBuckets();
                break;
            case BreakdownType.Intros:
                chartData = this.#currentBreakdown.introBuckets();
                break;
            case BreakdownType.Credits:
                chartData = this.#currentBreakdown.creditsBuckets();
                break;
            default:
                throw new Error(`Invalid breakdown type ${breakdownType}`);
        }

        for (const [bucket, value] of Object.entries(chartData)) {
            dataPoints.push({ value : value, label : plural(+bucket, DataLabels[breakdownType]) });
        }

        const radius = Math.min(Math.min(400, window.innerWidth / 2 - 40), window.innerHeight / 2 - 200);
        const options = new PieChartOptions(dataPoints, radius);
        const chartSelect = this.#buildOptions(breakdownType);
        options.colorMap = { // Set colors for 0 and 1, use defaults for everything else
            [`0 ${DataLabels[breakdownType]}s`] : '#a33e3e',
            [`1 ${DataLabels[breakdownType]}`]  : '#2e832e'
        };
        options.sortFn = (a, b) => parseInt(a.label) - parseInt(b.label);
        options.labelOptions = { count : true, percentage : true };

        const chart = getPieChart(options);

        // Our first request may be slow, and we want to show the graph immediately. Subsequent requests
        // (or the first one if extendedMarkerStats is enabled) might instantly return cached data,
        // so we want to include a fade in.
        const opacity = parseFloat(getComputedStyle(overlay).opacity);
        const delay = (1 - opacity) * 250;
        Overlay.build(
            {   dismissible : true,
                centered : true,
                delay : delay,
                noborder : true,
                closeButton : true,
                focusBack : $('#markerBreakdown')
            },
            appendChildren(buildNode('div', { style : 'text-align: center' }),
                appendChildren(buildNode('div', { style : 'padding-bottom: 20px' }), chartSelect),
                chart)
        );
    }

    /**
     * Build the dropdown that controls what specific chart is displayed.
     * @param {number} breakdownType */
    #buildOptions(breakdownType) {
        const sel = buildNode('select',
            { id : 'chartBreakdownType', class : 'fancySelect' },
            0,
            { change : this.#onChartTypeChange.bind(this) });

        for (const option of Object.values(BreakdownType)) {
            const optNode = buildNode('option', { value : option }, BreakdownTitles[option]);
            if (option === breakdownType) {
                optNode.setAttribute('selected', 'selected');
            }

            sel.appendChild(optNode);
        }

        return sel;
    }

    /**
     * Draw a new chart based on the option selected in the dropdown. */
    #onChartTypeChange() {
        this.#showMarkerBreakdown(parseInt($('#chartBreakdownType').value));
    }
}

export default MarkerBreakdownManager;
