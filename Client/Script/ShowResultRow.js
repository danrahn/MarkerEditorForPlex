import { $$, buildNode, clearEle, plural } from './Common.js';
import { errorMessage, errorResponseOverlay } from './ErrorHandling.js';
import { filteredListIcon, ResultRow } from './ResultRow.js';
import { FilterSettings, SortConditions, SortOrder } from './FilterDialog.js';
import { UISection, UISections } from './ResultSections.js';
import BulkActionResultRow from './BulkActionResultRow.js';
import { ClientSettings } from './ClientSettings.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { SeasonData } from '../../Shared/PlexTypes.js';
import SeasonResultRow from './SeasonResultRow.js';
import SectionOptionsResultRow from './SectionOptionsResultRow.js';
import { ServerCommands } from './Commands.js';
import Tooltip from './Tooltip.js';


const Log = new ContextualLog('ShowRow');

/**
 * A result row for a single show in the library.
 */
export default class ShowResultRow extends ResultRow {
    /**
     * When this show is active, holds a map of season metadata ids to its corresponding SeasonResultRow
     * @type {{[metadataId: number]: SeasonResultRow}} */
    #seasons = {};

    /**
     * If this is the active show, this is the number of rows that are currently filtered out.
     * @type {number} */
    #seasonsFiltered = 0;

    /** @type {SectionOptionsResultRow} */
    #sectionTitle;

    /**
     * The placeholder {@linkcode ShowResultRow} that displays the show name/stats when in season view.
     * @type {ShowResultRow} */
    #showTitle;

    /**
     * Whether this is a "dummy" row when displaying seasons/episodes
     * @type {boolean} */
    #selected;

    /** @param {ShowData} show */
    constructor(show) {
        super(show, 'topLevelResult showResult');
    }

    /**
     * Return the underlying show data associated with this result row.
     * @returns {ShowData} */
    show() { return this.mediaItem(); }

    /**
     * Creates a DOM element for this show.
     * Each entry contains three columns - the show name, the number of seasons, and the number of episodes.
     * @param {boolean} [selected=false] True if this row is selected and should be treated like
     * a header opposed to a clickable entry. */
    buildRow(selected = false) {
        this.#selected = selected;
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const show = this.show();
        const titleNode = buildNode('div', {}, show.title);
        if (show.originalTitle) {
            titleNode.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${show.originalTitle})`));
        }

        const customColumn = buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season'));
        const row = this.buildRowColumns(titleNode, customColumn, selected ? null : this.#showClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to results', async () => {
                UISections.clearSections(UISection.Seasons | UISection.Episodes);
                await UISections.hideSections(UISection.Seasons | UISection.Episodes);
                UISections.showSections(UISection.MoviesOrShows);
            });

            row.classList.add('dynamicText');
        }

        this.setHtml(row);
        return row;
    }

    /**
     * Returns the callback invoked when clicking on the marker count when purged markers are present. */
    getPurgeEventListener() {
        return this.#onShowPurgeClick.bind(this);
    }

    /**
     * Launches the purge overlay for this show. */
    #onShowPurgeClick() {
        // For dummy rows, set focus back to the first tabbable row, as the purged icon might not exist anymore
        const focusBack = this.#selected ? $$('.tabbableRow', this.html().parentElement) : this.html();
        PurgedMarkers.showSingleShow(this.show().metadataId, focusBack);
    }

    /**
     * Updates various UI states after purged markers are restored/ignored.
     * @param {PurgedShow} unpurged */
    notifyPurgeChange(unpurged) {
        const needsUpdate = [];
        for (const [seasonId, seasonRow] of Object.entries(this.#seasons)) {
            // Only need to update if the season was affected
            const unpurgedSeason = unpurged.get(seasonId);
            if (!unpurgedSeason) {
                continue;
            }

            needsUpdate.push(seasonRow);
        }

        /*async*/ PlexClientState.updateNonActiveBreakdown(this, needsUpdate);
    }

    /**
     * Update marker breakdown data after a bulk update.
     * @param {{[seasonId: number]: MarkerData[]}} changedMarkers */
    notifyBulkAction(changedMarkers) {
        const needsUpdate = [];
        for (const [seasonId, seasonRow] of Object.entries(this.#seasons)) {
            // Only need to update if the season was affected
            if (changedMarkers[seasonId]) {
                needsUpdate.push(seasonRow);
            }
        }

        return PlexClientState.updateNonActiveBreakdown(this, needsUpdate);
    }

    /** Update the UI after a marker is added/deleted, including our placeholder show row. */
    updateMarkerBreakdown() {
        if (this.#showTitle) { this.#showTitle.updateMarkerBreakdown(); }

        super.updateMarkerBreakdown();
    }

    /** Click handler for clicking a show row. Initiates a request for season details.
     * @param {MouseEvent} e */
    async #showClick(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        if (!PlexClientState.setActiveShow(this)) {
            Overlay.show('Unable to retrieve data for that show. Please try again later.');
            return;
        }

        // Gather purge data before continuing
        try {
            await PurgedMarkers.getPurgedShowMarkers(this.show().metadataId);
        } catch (err) {
            Log.warn(errorMessage(err), `Unable to get purged marker info for show ${this.show().title}`);
        }

        /*async*/ this.#getSeasons();
    }

    /** Get season details for this show */
    async #getSeasons() {
        const show = this.show();
        try {
            this.#showSeasons(await ServerCommands.getSeasons(show.metadataId));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the seasons for ${show.title}`, err);
        }
    }

    /**
     * Takes the seasons retrieved for a show and creates and entry for each season.
     * @param {SerializedSeasonData[]} seasons List of serialized {@linkcode SeasonData} seasons for a given show. */
    async #showSeasons(seasons) {
        await UISections.hideSections(UISection.MoviesOrShows);
        UISections.clearAndShowSections(UISection.Seasons);

        const addRow = row => UISections.addRow(UISection.Seasons, row);
        if (ClientSettings.showExtendedMarkerInfo()) {
            this.#sectionTitle = new SectionOptionsResultRow();
            addRow(this.#sectionTitle.buildRow());
        }

        this.#showTitle = new ShowResultRow(this.show());
        addRow(this.#showTitle.buildRow(true /*selected*/));
        addRow(new BulkActionResultRow(this.show()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        this.#seasonsFiltered = 0;
        /** @type {HTMLElement?} */
        let firstRow = undefined;

        // Two loops:
        // Loop to create SeasonResultRows
        // Sort result rows based on current sort order
        // Loop to apply filter/add rows to the table
        for (const serializedSeason of seasons) {
            const season = new SeasonData().setFromJson(serializedSeason);
            const seasonRow = new SeasonResultRow(season, this);
            this.#seasons[season.metadataId] = seasonRow;
        }

        const sortedSeasons = this.#sortedSeasons();
        for (const seasonRow of sortedSeasons) {
            if (FilterSettings.shouldFilter(seasonRow.season().markerBreakdown())) {
                ++this.#seasonsFiltered;
            } else {
                const rowHtml = seasonRow.buildRow();
                firstRow ??= rowHtml;
                addRow(rowHtml);
            }

            PlexClientState.addSeason(seasonRow.season());
        }


        if (!firstRow) {
            firstRow = ResultRow.NoResultsBecauseOfFilterRow();
            addRow(firstRow);
        }

        firstRow.focus();

        this.#onFilterStatusChanged();
    }

    /**
     * Retrieve the season rows sorted based on our current sort settings. */
    #sortedSeasons() {
        const seasons = Object.values(this.#seasons);
        seasons.sort((a, b) => {
            const indexFallback = (left, right) => left.season().index - right.season().index;
            const asc = SortOrder.asc(FilterSettings.sortOrder);
            if (FilterSettings.sortBy === SortConditions.Alphabetical) {
                return asc ? indexFallback(a, b) : indexFallback(b, a);
            }

            if (FilterSettings.sortBy < SortConditions.MarkerCount || FilterSettings.sortBy > SortConditions.CreditsMarkerCount) {
                Log.warn(`sortedSeasons - Unexpected sort by condition "${FilterSettings.sortBy}", defaulting to index-based`);
                return indexFallback(a, b);
            }

            // TODO: share with PlexClientState.#defaultSort/#sortedEpisodes
            const filterMethod = FilterSettings.sortBreakdownMethod();
            let aMarkers = a.season().markerBreakdown()[filterMethod]();
            let bMarkers = b.season().markerBreakdown()[filterMethod]();
            if (SortOrder.percentage(FilterSettings.sortOrder)) {
                aMarkers /= a.season().episodeCount;
                bMarkers /= b.season().episodeCount;
            }

            if (aMarkers === bMarkers) {
                return indexFallback(a, b);
            }

            return (aMarkers - bMarkers) * (asc ? 1 : -1);
        });

        return seasons;
    }

    /**
     * Update what rows are visible based on the new filter. */
    onFilterApplied() {
        UISections.clearSections(UISection.Seasons);
        const addRow = row => UISections.addRow(UISection.Seasons, row);
        addRow(this.#sectionTitle.html());
        addRow(this.#showTitle.html());
        addRow(new BulkActionResultRow(this.show()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        const seasons = this.#sortedSeasons();
        this.#seasonsFiltered = 0;
        let anyShowing = false;
        for (const season of seasons) {
            if (FilterSettings.shouldFilter(season.season().markerBreakdown())) {
                ++this.#seasonsFiltered;
            } else {
                addRow(season.html() || season.buildRow());
                anyShowing = true;
            }
        }

        if (!anyShowing) {
            addRow(ResultRow.NoResultsBecauseOfFilterRow());
        }

        this.#onFilterStatusChanged();
        this.#sectionTitle?.updateFilterTooltip();
    }

    /**
     * Updates the 'X Season(s)' header with a filter icon if any seasons are hidden by the current filter. */
    #onFilterStatusChanged() {
        if (!this.#showTitle) {
            return;
        }

        const seasons = $$('.showResultSeasons', this.#showTitle.html());
        if (!seasons) {
            return;
        }

        const baseText = plural(this.show().seasonCount, 'Season');

        // Clear any existing tooltip to be safe
        Tooltip.removeTooltip(seasons);
        if (this.#seasonsFiltered === 0) {
            seasons.innerHTML = baseText;
        } else {
            Tooltip.setTooltip(seasons, `Current filter is hiding ${plural(this.#seasonsFiltered, 'season')}.`);
            clearEle(seasons);
            seasons.appendChild(filteredListIcon());
            seasons.appendChild(buildNode('span', {}, baseText));
        }
    }
}
