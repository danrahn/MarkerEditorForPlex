import { $$, buildNode } from './Common.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { ResultRow } from './ResultRow.js';

/** @typedef {!import('../../Shared/PlexTypes').SeasonData} SeasonData */


const Log = new ContextualLog('SeasonRowBase');

export default class SeasonResultRowBase extends ResultRow {

    /** @param {SeasonData} season */
    constructor(season) {
        super(season, 'seasonResult');
    }

    /** Whether this row is a placeholder title row, used when a specific season is selected. */
    titleRow() { return false; }

    /**
     * Return the underlying season data associated with this result row.
     * @returns {SeasonData} */
    season() { return this.mediaItem(); }

    onClick() { return null; }

    /**
     * Creates a DOM element for this season. */
    buildRow() {
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const season = this.season();
        const title = buildNode('div', { class : 'selectedSeasonTitle' }, buildNode('span', {}, `Season ${season.index}`));
        if (season.title.length > 0 && season.title.toLowerCase() !== `season ${season.index}`) {
            title.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${season.title})`));
        }

        const row = this.buildRowColumns(title, null, this.onClick());
        this.setHtml(row);
        return row;
    }

    /**
     * Returns the callback invoked when clicking on the marker count when purged markers are present. */
    getPurgeEventListener() {
        return this.#onSeasonPurgeClick.bind(this);
    }

    /**
     * Show the purge overlay for this season. */
    #onSeasonPurgeClick() {
        // For dummy rows, set focus back to the first tabbable row, as the purged icon might not exist anymore
        const focusBack = this.titleRow() ? $$('.tabbableRow', this.html().parentElement) : this.html();
        PurgedMarkers.showSingleSeason(this.season().metadataId, focusBack);
    }
}
