import { $$, buildNode, plural } from './Common.js';
import { filteredListIcon, Log, ResultRow } from './ResultRow.js';
import { FilterSettings, SortConditions, SortOrder } from './FilterDialog.js';
import { UISection, UISections } from './ResultSections.js';
import BaseItemResultRow from './BaseItemResultRow.js';
import BulkActionResultRow from './BulkActionResultRow.js';
import { BulkActionType } from './BulkActionCommon.js';
import { ClientEpisodeData } from './ClientDataExtensions.js';
import { ClientSettings } from './ClientSettings.js';
import EpisodeResultRow from './EpisodeResultRow.js';
import { errorResponseOverlay } from './ErrorHandling.js';
import MarkerBreakdown from '../../Shared/MarkerBreakdown.js';
import Overlay from './Overlay.js';
import { PlexClientState } from './PlexClientState.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import SectionOptionsResultRow from './SectionOptionsResultRow.js';
import { ServerCommands } from './Commands.js';
import ShowTitleResultRow from './ShowTitleResultRow.js';
import Tooltip from './Tooltip.js';

/**
 * A result row for a single season of a show.
 */
export default class SeasonResultRow extends ResultRow {
    /**
     * A dictionary of {@linkcode EpisodeResultRow}s for keeping track of marker tables to show/expand if needed.
     * @type {{[episodeId: number]: EpisodeResultRow}} */
    #episodes = {};

    /**
     * The top-level section bar that allows for common actions.
     * @type {SectionOptionsResultRow} */
    #sectionTitle;

    /**
     * The placeholder {@linkcode ShowTitleResultRow} that displays the show name/stats when in episode view.
     * @type {ShowTitleResultRow} */
    #showTitle;

    /**
     * The placeholder {@linkcode SeasonResultRow} that displays the season name/stats when in episode view.
     * @type {SeasonResultRow} */
    #seasonTitle;

    /**
     * If this is the active season, this is the number of episodes that we are not showing due to the active filter.
     * @type {number} */
    #episodesFiltered = 0;

    /**
     * Whether this is a "dummy" row used to navigate back to the season list.
     * @type {boolean} */
    #selected;

    constructor(season) {
        super(season, 'seasonResult');
    }

    /**
     * Return the underlying season data associated with this result row.
     * @returns {SeasonData} */
    season() { return this.mediaItem(); }

    /**
     * Creates a DOM element for this season.
     * Each row contains the season number, the season title (if applicable), and the number of episodes in the season.
     * @param {boolean} [selected=false] `true` if this row is selected and should be treated like a header
     * header opposed to a clickable entry. */
    buildRow(selected = false) {
        this.#selected = selected;
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const season = this.season();
        const title = buildNode('div', { class : 'selectedSeasonTitle' }, buildNode('span', {}, `Season ${season.index}`));
        if (season.title.length > 0 && season.title.toLowerCase() !== `season ${season.index}`) {
            title.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${season.title})`));
        }

        const row = this.buildRowColumns(title, null, selected ? null : this.#seasonClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to seasons', async () => {
                await UISections.hideSections(UISection.Episodes);
                UISections.clearSections(UISection.Episodes);
                UISections.showSections(UISection.Seasons);
            });

            row.classList.add('dynamicText');
        }

        this.setHtml(row);
        return row;
    }

    /**
     * Updates various UI states after purged markers are restored/ignored
     * @param {PurgedSeason} unpurged
     * @param {MarkerDataMap} newMarkers New markers that were added as the result of a restoration, or null if there weren't any
     * @param {MarkerDataMap} deletedMarkers
     * @param {MarkerDataMap} modifiedMarkers */
    notifyPurgeChange(unpurged, newMarkers, deletedMarkers, modifiedMarkers) {
        const updated = {};
        for (const row of Object.values(this.#episodes)) {
            const episode = row.episode();
            const metadataId = episode.metadataId;
            for (const marker of (newMarkers[metadataId] || [])) {
                updated[metadataId] = true;
                episode.markerTable().addMarker(marker, null /*oldRow*/);
            }

            for (const marker of (deletedMarkers[metadataId] || [])) {
                updated[metadataId] = true;
                episode.markerTable().deleteMarker(marker, null /*oldRow*/);
            }

            for (const marker of (modifiedMarkers[metadataId] || [])) {
                updated[metadataId] = true;
                episode.markerTable().editMarker(marker, true /*forceReset*/);
            }
        }

        // We still want to update other episodes as well, since even if we didn't add
        // new markers, we still want to update purge text.
        unpurged.forEach(/**@this {SeasonResultRow}*/ function (action) {
            if (updated[action.parent_id]) {
                return;
            }

            const episode = this.#episodes[action.parent_id];
            if (episode) {
                episode.updateMarkerBreakdown(0 /*delta*/);
            }
        }.bind(this));
    }

    /**
     * Update marker tables if necessary after a bulk operation
     * @param {MarkerData[]} changedMarkers
     * @param {number} bulkActionType */
    notifyBulkAction(changedMarkers, bulkActionType) {
        // Sort by index high to low to to avoid the marker table from
        // getting indexes out of sync.
        changedMarkers.sort((a, b) => b.start - a.start);
        for (const marker of changedMarkers) {
            const episode = this.#episodes[marker.parentId];
            if (!episode) {
                continue;
            }

            switch (bulkActionType) {
                case BulkActionType.Shift:
                    episode.episode().markerTable().editMarker(marker, true);
                    break;
                case BulkActionType.Add:
                    episode.episode().markerTable().addMarker(marker, null /*oldRow*/);
                    break;
                case BulkActionType.Delete:
                    episode.episode().markerTable().deleteMarker(marker);
                    break;
                default:
                    Log.warn(bulkActionType, `Can't parse bulk action change, invalid bulkActionType`);
                    return;
            }
        }
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
        const focusBack = this.#selected ? $$('.tabbableRow', this.html().parentElement) : this.html();
        PurgedMarkers.showSingleSeason(this.season().metadataId, focusBack);
    }

    /**
     * Click handler for clicking a show row. Initiates a request for all episodes in the given season.
     * @param {MouseEvent} e */
    #seasonClick(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        if (!PlexClientState.setActiveSeason(this)) {
            Overlay.show('Unable to retrieve data for that season. Please try again later.');
            return;
        }

        /*async*/ this.#getEpisodes();
    }

    /** Make a request for all episodes in this season. */
    async #getEpisodes() {
        this.insertInlineLoadingIcon('.showResultEpisodes');
        const season = this.season();
        try {
            await this.#parseEpisodes(await ServerCommands.getEpisodes(season.metadataId));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the episodes for ${season.title}.`, err);
        } finally {
            this.removeInlineLoadingIcon();
        }
    }

    /**
     * Takes the given list of episodes and makes a request for marker details for each episode.
     * @param {SerializedEpisodeData[]} episodes Array of episodes in a particular season of a show. */
    async #parseEpisodes(episodes) {
        // Grab chapters in bulk to avoid calling this for individual episodes. If we fail, continue without
        // chapter data and hope that the individual queries pick up the slack.
        /** @type {ChapterMap?} */
        let chapterData;
        try {
            chapterData = await ServerCommands.getChapters(this.season().metadataId);
        } catch (ex) {
            Log.warn(ex.message, `parseEpisodes - could not get bulk chapter data`);
        }

        const queryIds = [];
        for (const episode of episodes) {
            PlexClientState.addEpisode(new ClientEpisodeData().setFromJson(episode));
            queryIds.push(episode.metadataId);
        }

        try {
            this.#showEpisodesAndMarkers(await ServerCommands.query(queryIds), chapterData);
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the markers for these episodes, please try again.`, err);
        }
    }

    /**
     * Takes the given list of episode data and creates entries for each episode and its markers.
     * @param {{[metadataId: number]: SerializedMarkerData[]}} data Map of episode ids to an array of
     * serialized {@linkcode MarkerData} for the episode.
     * @param {ChapterMap?} chapterData */
    async #showEpisodesAndMarkers(data, chapterData) {
        await UISections.hideSections(UISection.Seasons);
        UISections.clearAndShowSections(UISection.Episodes);
        const addRow = row => UISections.addRow(UISection.Episodes, row);
        if (ClientSettings.showExtendedMarkerInfo()) {
            this.#sectionTitle = new SectionOptionsResultRow();
            addRow(this.#sectionTitle.buildRow());
        }

        this.#showTitle = new ShowTitleResultRow(PlexClientState.getActiveShow());
        addRow(this.#showTitle.buildRow());
        addRow(buildNode('hr'));
        this.#seasonTitle = new SeasonResultRow(PlexClientState.getActiveSeason());
        addRow(this.#seasonTitle.buildRow(true));
        addRow(new BulkActionResultRow(this.season()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));

        for (const metadataId of Object.keys(data).map(m => parseInt(m))) {
            const episodeRow = new EpisodeResultRow(PlexClientState.getEpisode(metadataId), this);

            // Even if this row is filtered out, we want to build the row to seed the marker table.
            episodeRow.buildRow(data[metadataId], chapterData?.[metadataId]);
            this.#episodes[metadataId] = episodeRow;
        }

        this.#episodesFiltered = 0;
        /** @type {HTMLElement} */
        let firstRow = undefined;
        const episodeRows = this.#sortedEpisodes(); //episodeRows.sort((a, b) => a.episode().index - b.episode().index);
        for (const resultRow of episodeRows) {
            const metadataId = resultRow.episode().metadataId;
            const markers = data[metadataId];
            if (FilterSettings.shouldFilterEpisode(markers)) {
                ++this.#episodesFiltered;
            } else {
                const rowHtml = resultRow.html() || resultRow.buildRow(markers, chapterData?.[metadataId]);
                firstRow ??= rowHtml;
                addRow(rowHtml);
            }
        }

        if (firstRow) {
            // Episode rows are tabbed a bit differently because of its marker table
            $$('.tabbableRow', firstRow)?.focus();
        } else {
            firstRow = ResultRow.NoResultsBecauseOfFilterRow();
            addRow(firstRow);
            firstRow.focus();
        }

        this.#onFilterStatusChanged();
    }

    /**
     * Retrieve the episode rows sorted based on our current sort settings. */
    #sortedEpisodes() {
        // If a percentage-based sort is active, temporary change it into the non-percentage-based order
        const orderSav = FilterSettings.sortOrder;
        if (SortOrder.percentage(orderSav)) {
            FilterSettings.sortOrder = SortOrder.asc(orderSav) ? SortOrder.Ascending : SortOrder.Descending;
        }

        const episodeRows = Object.values(this.#episodes);
        episodeRows.sort((a, b) => {
            const indexFallback = (left, right) => left.episode().index - right.episode().index;
            const asc = SortOrder.asc(FilterSettings.sortOrder);
            if (FilterSettings.sortBy === SortConditions.Alphabetical) {
                return asc ? indexFallback(a, b) : indexFallback(b, a);
            }

            // There's definitely a more efficient way to do this, but this
            // lets us avoid keeping track of a breakdown for a type that
            // doesn't actually need it, and lets us reuse sortBreakdownMethod()
            const filterMethod = FilterSettings.sortBreakdownMethod();
            const aBreakdown = new MarkerBreakdown();
            aBreakdown.initBase();
            aBreakdown.delta(0, a.currentKey());
            const aMarkers = aBreakdown[filterMethod]();
            const bBreakdown = new MarkerBreakdown();
            bBreakdown.initBase();
            bBreakdown.delta(0, b.currentKey());
            const bMarkers = bBreakdown[filterMethod]();

            if (aMarkers === bMarkers) {
                return indexFallback(a, b);
            }

            return (aMarkers - bMarkers) * (asc ? 1 : -1);
        });

        FilterSettings.sortOrder = orderSav;
        return episodeRows;
    }

    /**
     * Update what rows are visible based on the new filter. */
    onFilterApplied() {
        if (Object.keys(this.#episodes).length === 0) {
            // We're not the active season.
            return;
        }

        UISections.clearSections(UISection.Episodes);
        const addRow = row => UISections.addRow(UISection.Episodes, row);

        // Recreate headers
        addRow(this.#sectionTitle.html());
        addRow(this.#showTitle.html());
        addRow(buildNode('hr'));
        addRow(this.#seasonTitle.html());
        addRow(new BulkActionResultRow(this.season()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        this.#episodesFiltered = 0;
        let anyShowing = false;
        const episodes = this.#sortedEpisodes(); // Object.values(this.#episodes).sort((a, b) => a.episode().index - b.episode().index);
        for (const episode of episodes) {
            if (FilterSettings.shouldFilterEpisode(episode.episode().markerTable().markers())) {
                ++this.#episodesFiltered;
            } else {
                addRow(episode.html() || episode.buildRow());
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
     * Updates the 'Season X' header to include a filter icon if any episodes are currently hidden. */
    #onFilterStatusChanged() {
        if (!this.#seasonTitle) {
            return;
        }

        const seasonName = $$('.selectedSeasonTitle', this.#seasonTitle.html());
        if (!seasonName) {
            return;
        }

        if ((seasonName.childNodes[0].tagName.toLowerCase() === 'i') === !!this.#episodesFiltered) {
            return;
        }

        Tooltip.removeTooltip(seasonName);
        if (this.#episodesFiltered === 0) {
            seasonName.removeChild(seasonName.childNodes[0]);
        } else {
            seasonName.prepend(filteredListIcon());
            Tooltip.setTooltip(seasonName, `Current filter is hiding ${plural(this.#episodesFiltered, 'episode')}.`);
        }
    }

    /**
     * Show or hide all marker tables associated with the episodes in this season.
     * @param {boolean} hide Whether to hide or show all marker tables. */
    showHideMarkerTables(hide) {
        return BaseItemResultRow.ShowHideMarkerTables(hide, Object.values(this.#episodes));
    }

    /** Update the UI after a marker is added/deleted, including our placeholder show/season rows. */
    updateMarkerBreakdown() {
        // If this is the "real" active row, it's currently hiding behind
        // the dummy entries, which also need to be updated.
        if (this.#seasonTitle) { this.#seasonTitle.updateMarkerBreakdown(); }

        if (this.#showTitle) { this.#showTitle.updateMarkerBreakdown(); }

        super.updateMarkerBreakdown();
    }

    /** Ensure all episode results marker counts are expanded/minified when the
     * window is resized. */
    notifyWindowResize() {
        if (!this.#episodes) {
            return;
        }

        for (const episode of Object.values(this.#episodes)) {
            episode.updateMarkerBreakdown();
            episode.updateTitleOnWindowResize();
        }
    }
}
