import { $, appendChildren, buildNode, errorResponseOverlay, plural, ServerCommand } from "./Common.js";
import { Chart, PieChartOptions } from "./inc/Chart.js";
import Overlay from "./inc/Overlay.js";
import Tooltip from "./inc/Tooltip.js";
import PlexClientState from "./PlexClientState.js";

class MarkerBreakdownManager {

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
        Overlay.show(
            appendChildren(buildNode('div'),
                buildNode('h2', {}, 'Marker Breakdown'),
                buildNode('br'),
                buildNode('div', {}, 'Getting marker breakdown. This may take awhile...'),
                buildNode('br'),
                buildNode('img', { width : 30, height : 30, src : 'i/c1c1c1/loading.svg' })),
            'Cancel');

        try {
            const markerStats = await ServerCommand.getMarkerStats(PlexClientState.GetState().activeSection());
            MarkerBreakdownManager.#showMarkerBreakdown(markerStats);
        } catch (err) {
            errorResponseOverlay('Failed to show breakdown', err);
        }
    }

    /**
     * Displays a pie chart of the data from the server.
     * @param {{[markerCount : number] : number }} response The marker breakdown data */
    static #showMarkerBreakdown(response) {
        const overlay = $('#mainOverlay');
        if (!overlay) {
            Log.verbose('Overlay is gone, not showing stats');
            return; // User closed out of window
        }

        /** @type {import("./inc/Chart").ChartDataPoint[]} */
        let dataPoints = [];
        for (const [bucket, value] of Object.entries(response)) {
            dataPoints.push({ value : value, label : plural(bucket, 'Marker') });
        }

        const radius = Math.min(Math.min(400, window.innerWidth / 2 - 40), window.innerHeight / 2 - 200);
        let options = new PieChartOptions(dataPoints, radius);
        options.title = 'Marker Breakdown';
        options.colorMap = { // Set colors for 0 and 1, use defaults for everything else
            '0 Markers' : '#a33e3e',
            '1 Marker'  : '#2e832e'
        };
        options.sortFn = (a, b) => parseInt(a.label) - parseInt(b.label);
        options.labelOptions = { count : true, percentage : true };

        const chart = Chart.pie(options);

        // Our first request may be slow, and we want to show the graph immediately. Subsequent requests
        // (or the first one if extendedMarkerStats is enabled) might instantly return cached data,
        // so we want to include a fade in.
        const opacity = parseFloat(getComputedStyle(overlay).opacity);
        const delay = (1 - opacity) * 250;
        Overlay.build({ dismissible : true, centered : true, delay : delay, noborder : true, closeButton : true },
            appendChildren(buildNode('div', { style : 'text-align: center' }), chart));
    }
}

export default MarkerBreakdownManager;
