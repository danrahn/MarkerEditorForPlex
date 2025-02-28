import { ResultRow } from './ResultRow.js';

import { $$, $div, $span } from '../HtmlHelpers.js';
import { ContextualLog } from '/Shared/ConsoleLog.js';
import { PurgedMarkers } from '../PurgedMarkerManager.js';

/** @typedef {!import('/Shared/PlexTypes').SeasonData} SeasonData */


const Log = ContextualLog.Create('SeasonRowBase');

export class SeasonResultRowBase extends ResultRow {

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
        const title = $div({ class : 'selectedSeasonTitle' }, $span(`Season ${season.index}`));
        if (season.title.length > 0 && season.title.toLowerCase() !== `season ${season.index}`) {
            title.appendChild($span(` (${season.title})`, { class : 'resultRowAltTitle' }));
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
     * Show the purge overlay for this season.
     * @param {MouseEvent} e */
    #onSeasonPurgeClick(e) {
        if (this.isInfoIcon(e.target)) {
            return;
        }

        // For dummy rows, set focus back to the first tabbable row, as the purged icon might not exist anymore
        const focusBack = this.titleRow() ? $$('.tabbableRow', this.html().parentElement) : this.html();
        PurgedMarkers.showSingleSeason(this.season().metadataId, focusBack);
    }
}
