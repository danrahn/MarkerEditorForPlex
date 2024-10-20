import { $, $br, $div, $divHolder, $h, $option, $plainDivHolder, $select } from './HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { plural } from './Common.js';

import { getPieChart, PieChartOptions } from './Chart.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import { getSvgIcon } from './SVGHelper.js';
import Icons from './Icons.js';
import MarkerBreakdown from '/Shared/MarkerBreakdown.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { ServerCommands } from './Commands.js';
import { ThemeColors } from './ThemeColors.js';

/** @typedef {!import('./Chart').ChartDataPoint} ChartDataPoint */

const Log = ContextualLog.Create('BreakdownChart');

/**
 * Available charts
 * @enum */
const BreakdownType = {
    /**@readonly*/ Combined : 0,
    /**@readonly*/ Intros   : 1,
    /**@readonly*/ Credits  : 2,
    /**@readonly*/ Ads      : 3,
};

/**
 * Titles for the above chart types. */
const BreakdownTitles = {
    [BreakdownType.Combined] : 'Marker Breakdown',
    [BreakdownType.Intros]   : 'Intro Breakdown',
    [BreakdownType.Credits]  : 'Credits Breakdown',
    [BreakdownType.Ads]      : 'Commercial Breakdown',
};

/**
 * Tooltip labels for the given BreakdownType. */
const DataLabels = {
    [BreakdownType.Combined] : 'Marker',
    [BreakdownType.Intros]   : 'Intro Marker',
    [BreakdownType.Credits]  : 'Credits Marker',
    [BreakdownType.Ads]      : 'Commercial Marker',
};

class MarkerBreakdownChart {

    /** @type {MarkerBreakdown} */
    static #currentBreakdown = null;
    /** @type {HTMLElement} */
    static #focusBack = null;

    /**
     * Retrieves marker breakdown data from the server, then displays it in an overlay chart.
     * The initial request may take some time for large libraries, so first show an overlay
     * letting the user know something's actually happening.
     * @param {HTMLElement} focusBack The element to focus after dismissing the breakdown chart. */
    static async GetBreakdown(focusBack) {
        MarkerBreakdownChart.#currentBreakdown = null;
        MarkerBreakdownChart.#focusBack = focusBack;
        Overlay.show(
            $plainDivHolder(
                $h(2, 'Marker Breakdown'),
                $br(),
                $div({}, 'Getting marker breakdown. This may take awhile...'),
                $br(),
                getSvgIcon(Icons.Loading, ThemeColors.Primary, { width : 30, height : 30 })),
            'Cancel');

        Overlay.setFocusBackElement(focusBack);

        try {
            const rawBreakdown = await ServerCommands.getMarkerStats(PlexClientState.activeSection());
            MarkerBreakdownChart.#currentBreakdown = new MarkerBreakdown().initFromRawBreakdown(rawBreakdown);
            MarkerBreakdownChart.#showMarkerBreakdown(BreakdownType.Combined);
        } catch (err) {
            errorResponseOverlay('Failed to show breakdown', err);
        }
    }

    /**
     * Displays a pie chart of the data from the server.
     * @param {MarkerBreakdown} breakdown The marker breakdown data */
    static #showMarkerBreakdown(breakdownType) {
        const overlay = Overlay.get();
        if (!overlay || !MarkerBreakdownChart.#currentBreakdown) {
            Log.verbose('Overlay is gone, not showing stats');
            return; // User closed out of window
        }

        /** @type {ChartDataPoint[]} */
        const dataPoints = [];
        let chartData;
        switch (breakdownType) {
            case BreakdownType.Combined:
                chartData = MarkerBreakdownChart.#currentBreakdown.collapsedBuckets();
                break;
            case BreakdownType.Intros:
                chartData = MarkerBreakdownChart.#currentBreakdown.introBuckets();
                break;
            case BreakdownType.Credits:
                chartData = MarkerBreakdownChart.#currentBreakdown.creditsBuckets();
                break;
            case BreakdownType.Ads:
                chartData = MarkerBreakdownChart.#currentBreakdown.adBuckets();
                break;
            default:
                throw new Error(`Invalid breakdown type ${breakdownType}`);
        }

        for (const [bucket, value] of Object.entries(chartData)) {
            dataPoints.push({ value : value, label : plural(+bucket, DataLabels[breakdownType]) });
        }

        const radius = Math.min(Math.min(400, window.innerWidth / 2 - 40), window.innerHeight / 2 - 200);
        const options = new PieChartOptions(dataPoints, radius);
        const chartSelect = MarkerBreakdownChart.#buildOptions(breakdownType);
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
                focusBack : MarkerBreakdownChart.#focusBack
            },
            $divHolder({ style : 'text-align: center' },
                $div({ style : 'padding-bottom: 20px' }, chartSelect),
                chart)
        );
    }

    /**
     * Build the dropdown that controls what specific chart is displayed.
     * @param {number} breakdownType */
    static #buildOptions(breakdownType) {
        const sel = $select('chartBreakdownType', MarkerBreakdownChart.#onChartTypeChange, { class : 'fancySelect' });
        for (const option of Object.values(BreakdownType)) {
            const optNode = $option(BreakdownTitles[option], option);
            if (option === breakdownType) {
                optNode.setAttribute('selected', 'selected');
            }

            sel.appendChild(optNode);
        }

        return sel;
    }

    /**
     * Draw a new chart based on the option selected in the dropdown. */
    static #onChartTypeChange() {
        MarkerBreakdownChart.#showMarkerBreakdown(parseInt($('#chartBreakdownType').value));
    }
}

export default MarkerBreakdownChart;
