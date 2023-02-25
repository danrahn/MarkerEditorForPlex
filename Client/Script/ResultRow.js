import { $$, appendChildren, buildNode, clearEle, errorMessage, errorResponseOverlay, pad0, plural, ServerCommand } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';
import { MarkerData, PlexData, SeasonData, ShowData } from '../../Shared/PlexTypes.js';

import Tooltip from './inc/Tooltip.js';
import Overlay from './inc/Overlay.js';

import { BulkActionType } from './BulkActionCommon.js';
import BulkAddOverlay from './BulkAddOverlay.js';
import BulkDeleteOverlay from './BulkDeleteOverlay.js';
import BulkShiftOverlay from './BulkShiftOverlay.js';
import ButtonCreator from './ButtonCreator.js';
import { ClientEpisodeData, ClientMovieData, MediaItemWithMarkerTable } from './ClientDataExtensions.js';
import { ClientSettings } from './ClientSettings.js';
import { PlexClientState } from './PlexClientState.js';
import { PlexUI, UISection } from './PlexUI.js';
import { PurgedMarkers } from './PurgedMarkerManager.js';
import { PurgedSeason, PurgedShow } from './PurgedMarkerCache.js';
import ThemeColors from './ThemeColors.js';
import { FilterDialog, FilterSettings } from './FilterDialog.js';
import MarkerBreakdown from '../../Shared/MarkerBreakdown.js';

/** @typedef {!import('../../Shared/PlexTypes.js').MarkerAction} MarkerAction */
/** @typedef {!import('../../Shared/PlexTypes.js').MarkerDataMap} MarkerDataMap */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedSeasonData} SerializedSeasonData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */

/**
 * Return a warning icon used to represent that a show/season/episode has purged markers.
 * @returns {HTMLImageElement} */
function purgeIcon() {
    return buildNode(
        'img',
        {
            src : ThemeColors.getIcon('warn', 'orange'),
            class : 'purgedIcon',
            alt   : 'Purged marker warning',
            theme : 'orange'
        })
    ;
}

/**
 * Returns a filter icon used to indicate that a season/episode list is hiding some
 * entries due to the current filter.
 * @returns {HTMLImageElement} */
function filteredListIcon() {
    return buildNode('img', {
        src : ThemeColors.getIcon('filter', 'orange'),
        class : 'filteredGroupIndicator',
        theme : 'orange',
        alt : 'Filter Icon',
        width: 16,
        height: 16 })
}

/** Represents a single row of a show/season/episode in the results page. */
class ResultRow {
    /** The HTML of the row.
     * @type {HTMLElement} */
    #html;

    /** The base data associated with this row.
     * @type {PlexData} */
    #mediaItem;

    /** The class name of the row, if any.
     * @type {string} */
    #className;

    /**
     * @param {PlexData} mediaItem The base data associated with this row.
     * @param {string} className The class name of the row, if any. */
    constructor(mediaItem, className) {
        this.#mediaItem = mediaItem;
        this.#className = className;
    }

    /** @returns the `HTMLElement` associated with this row. */
    html() { return this.#html; }

    /**
     * Sets the HTML for this row.
     * @param {HTMLElement} html */
    setHtml(html) { this.#html = html; }

    /** Build a row's HTML. Unimplemented in the base class. */
    buildRow() {}

    /** @returns {PlexData} The base media item associated with this row. */
    mediaItem() { return this.#mediaItem; }

    /** @returns The number of purged markers associated with this row. */
    getPurgeCount() { return PurgedMarkers.getPurgeCount(this.#mediaItem.metadataId); }

    /** @returns Whether this media item has any purged markers. */
    hasPurgedMarkers() { return this.getPurgeCount() > 0; }

    /** @returns {() => void} An event callback that will invoke the purge overlay if purged markers are present. */
    getPurgeEventListener() { Log.error(`ResultRow: Classes must override getPurgeEventListener.`); return () => {} }

    /** Updates the marker breakdown text ('X/Y (Z.ZZ%)) and tooltip, if necessary. */
    updateMarkerBreakdown() {
        // No updates necessary if extended breakdown stats aren't enabled
        if (!ClientSettings.showExtendedMarkerInfo()) {
            return;
        }

        const span = $$('.showResultEpisodes span', this.#html);
        if (!span) {
            Log.warn('Could not find marker breakdown span, can\'t update.');
            return;
        }

        span.replaceWith(this.episodeDisplay());
    }

    /**
     * Determine whether we should load child seasons/episodes/marker tables when
     * clicking on the row. Returns false if the group has purged markers and the
     * user clicked on the marker info.
     * @param {MouseEvent} e */
    ignoreRowClick(e) {
        if (this.hasPurgedMarkers() && (
            e.target.classList.contains('episodeDisplayText') ||
            (e.target.parentElement && e.target.parentElement.classList.contains('episodeDisplayText')) ||
            e.target.tagName.toLowerCase() == 'img')) {
            return true; // Don't show/hide if we're repurposing the marker display.
        }

        return false;
    }

    /**
     * Create and return the main content of the marker row.
     * @param {HTMLElement} titleColumn The first/title column of the row.
     * @param {HTMLElement} customColumn The second row, which is implementation specific.
     * @param {() => void} [clickCallback=null] The callback to invoke, if any, when the row is clicked. */
    buildRowColumns(titleColumn, customColumn, clickCallback=null) {
        let events = {};
        if (clickCallback) {
            events.click = clickCallback;
        }

        return appendChildren(buildNode('div', { class : this.#className }, 0, events),
            titleColumn,
            customColumn,
            buildNode('div', { class : 'showResultEpisodes' }, this.episodeDisplay()));
    }

    /**
     * Adds a 'back' button to the given row. Used by 'selected' rows.
     * @param {HTMLElement} row The row to add the button to.
     * @param {string} buttonText The text of the button.
     * @param {() => void} callback The callback to invoke when the button is clicked. */
    addBackButton(row, buttonText, callback) {
        row.classList.add('selected');
        appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
            ButtonCreator.fullButton(buttonText, 'back', 'Go back', 'standard', callback));
    }

    /**
     * Get the episode summary display, which varies depending on whether extended marker information is enabled.
     * @returns A basic 'X Episode(s)' string if extended marker information is disabled, otherwise a Span
     * that shows how many episodes have at least one marker, with tooltip text with a further breakdown of
     * how many episodes have X markers. */
    episodeDisplay() {
        const mediaItem = this.mediaItem();
        const baseText = plural(mediaItem.episodeCount, 'Episode');
        if (!ClientSettings.showExtendedMarkerInfo() || !mediaItem.markerBreakdown()) {
            // The feature isn't enabled or we don't have a marker breakdown. The breakdown can be null if the
            // user kept this application open while also adding episodes in PMS (which _really_ shouldn't be done).
            return baseText;
        }

        let atLeastOne = 0;
        // Tooltip should really handle more than plain text, but for now write the HTML itself to allow
        // for slightly larger text than the default.
        let tooltipText = `<span class="largerTooltip noBreak">${baseText}<hr>`;
        const breakdown = mediaItem.markerBreakdown();
        const intros = breakdown.itemsWithIntros();
        const credits = breakdown.itemsWithCredits();
        tooltipText += `${intros} ${intros == 1 ? 'has' : 'have'} intros<br>`;
        tooltipText += `${credits} ${credits == 1 ? 'has' : 'have'} credits<hr>`;
        for (const [key, episodeCount] of Object.entries(mediaItem.markerBreakdown().collapsedBuckets())) {
            tooltipText += `${episodeCount} ${episodeCount == 1 ? 'has' : 'have'} ${plural(parseInt(key), 'marker')}<br>`;
            if (key != 0) {
                atLeastOne += episodeCount;
            }
        }

        if (atLeastOne == 0) {
            tooltipText = `<span class="largeTooltip">${baseText}<br>None have markers.</span>`;
        } else {
            tooltipText += this.hasPurgedMarkers() ? '<hr>' : '</span>';
        }

        const percent = (atLeastOne / mediaItem.episodeCount * 100).toFixed(2);
        let innerText = buildNode('span', {}, `${atLeastOne}/${mediaItem.episodeCount} (${percent}%)`);

        if (this.hasPurgedMarkers()) {
            innerText.appendChild(purgeIcon());
            const purgeCount = this.getPurgeCount();
            const markerText = purgeCount == 1 ? 'marker' : 'markers';
            tooltipText += `<b>${purgeCount} purged ${markerText}</b><br>Click for details</span>`;
        }

        let mainText = buildNode('span', { class : 'episodeDisplayText'}, innerText);
        Tooltip.setTooltip(mainText, tooltipText);
        if (this.hasPurgedMarkers()) {
            mainText.addEventListener('click', this.getPurgeEventListener());
        }

        return mainText;
    }
}

/**
 * A result row that offers bulk marker actions, like shifting everything X milliseconds.
 */
class BulkActionResultRow extends ResultRow {
    constructor(mediaItem) {
        super(mediaItem, 'bulkResultRow');
    }

    /**
     * Build the bulk result row, returning the row */
    buildRow() {
        if (this.html()) {
            Log.warn(`buildRow has already been called for this BulkActionResultRow, that shouldn't happen!`);
            return this.html();
        }

        let titleNode = buildNode('div', { class : 'bulkActionTitle' }, 'Bulk Actions');
        let row = buildNode('div', { class : 'bulkResultRow' });
        appendChildren(row,
            titleNode,
            appendChildren(row.appendChild(buildNode('div', { class : 'goBack' })),
                ButtonCreator.textButton('Bulk Add', this.#bulkAdd.bind(this), { style : 'margin-right: 10px'}),
                ButtonCreator.textButton('Bulk Shift', this.#bulkShift.bind(this), { style : 'margin-right: 10px'}),
                ButtonCreator.textButton('Bulk Delete', this.#bulkDelete.bind(this))));

        this.setHtml(row);
        return row;
    }

    // Override default behavior and don't show anything here, since we override this with our own actions.
    episodeDisplay() { }

    /**
     * Launch the bulk add overlay for the current media item (show/season). */
    #bulkAdd() {
        new BulkAddOverlay(this.mediaItem()).show();
    }

    /**
     * Launch the bulk shift overlay for the current media item (show/season). */
    #bulkShift() {
        new BulkShiftOverlay(this.mediaItem()).show();
    }

    /**
     * Launch the bulk delete overlay for the current media item (show/season). */
    #bulkDelete() {
        new BulkDeleteOverlay(this.mediaItem()).show();
    }
}

/**
 * A section-wide header that is displayed no matter what the current view state is (beside the blank state).
 * Currently only contains the Filter entrypoint.
 */
class SectionOptionsResultRow extends ResultRow {
    /** @type {HTMLElement} */
    #filterButton;
    constructor() {
        super(null, 'topLevelResult sectionOptions');
    }

    /**
     * Build the section-wide header. */
    buildRow() {
        if (this.html()) {
            Log.warn(`buildRow has already been called for this SectionOptionsResultRow, that shouldn't happen!`);
            return this.html();
        }

        if (!ClientSettings.showExtendedMarkerInfo()) {
            Log.error(`SectionOptionsResultRow requires extended marker info`);
            return buildNode('div');
        }

        let titleNode = buildNode('div', { class : 'bulkActionTitle' }, 'Section Options');
        let row = buildNode('div', { class : 'sectionOptionsResultRow' });
        this.#filterButton = ButtonCreator.fullButton('Filter', 'filter', 'Filter results', 'standard', () => new FilterDialog().show(), { style : 'margin-right: 10px'});
        Tooltip.setTooltip(this.#filterButton, 'No Active Filter'); // Need to seed the setTooltip, then use setText for everything else.
        this.updateFilterTooltip();

        appendChildren(row,
            titleNode,
            appendChildren(row.appendChild(buildNode('div',  { class : 'goBack' })),
                this.#filterButton));
        this.setHtml(row);
        return row;
    }

    /**
     * Update the filter button's style and tooltip based on whether a filter is currently active. */
    updateFilterTooltip() {
        if (FilterSettings.hasFilter()) {
            this.#filterButton.classList.add('filterActive');
            Tooltip.setText(this.#filterButton, FilterSettings.filterTooltipText());
        } else {
            this.#filterButton.classList.remove('filterActive');
            Tooltip.setText(this.#filterButton, 'No Active Filter');
        }
    }
}

/**
 * A result row for a single show in the library.
 */
class ShowResultRow extends ResultRow {
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
    buildRow(selected=false) {
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const show = this.show();
        let titleNode = buildNode('div', {}, show.title);
        if (show.originalTitle) {
            titleNode.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${show.originalTitle})`));
        }

        let customColumn = buildNode('div', { class : 'showResultSeasons' }, plural(show.seasonCount, 'Season'));
        let row = this.buildRowColumns(titleNode, customColumn, selected ? null : this.#showClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to results', () => {
                PlexUI.clearSections(UISection.Seasons | UISection.Episodes);
                PlexUI.hideSections(UISection.Seasons | UISection.Episodes);
                PlexUI.showSections(UISection.MoviesOrShows);
            });
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
        PurgedMarkers.showSingleShow(this.show().metadataId);
    }

    /**
     * Updates various UI states after purged markers are restored/ignored.
     * @param {PurgedShow} unpurged */
    notifyPurgeChange(unpurged) {
        let needsUpdate = [];
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
    async notifyBulkAction(changedMarkers) {
        let needsUpdate = [];
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

        if (ClientSettings.backupEnabled()) {
            // Gather purge data before continuing
            try {
                await PurgedMarkers.getPurgedShowMarkers(this.show().metadataId);
            } catch (err) {
                Log.warn(errorMessage(err), `Unable to get purged marker info for show ${this.show().title}`);
            }
        }

        /*async*/ this.#getSeasons();
    }

    /** Get season details for this show */
    async #getSeasons() {
        const show = this.show();
        try {
            this.#showSeasons(await ServerCommand.getSeasons(show.metadataId));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the seasons for ${show.title}`,err);
        }
    }

    /**
     * Takes the seasons retrieved for a show and creates and entry for each season.
     * @param {SerializedSeasonData[]} seasons List of serialized {@linkcode SeasonData} seasons for a given show. */
    #showSeasons(seasons) {
        PlexUI.clearAndShowSections(UISection.Seasons);
        PlexUI.hideSections(UISection.MoviesOrShows);

        const addRow = row => PlexUI.addRow(UISection.Seasons, row);
        if (ClientSettings.showExtendedMarkerInfo()) {
            this.#sectionTitle = new SectionOptionsResultRow();
            addRow(this.#sectionTitle.buildRow())
        }

        this.#showTitle = new ShowResultRow(this.show());
        addRow(this.#showTitle.buildRow(true /*selected*/));
        addRow(new BulkActionResultRow(this.show()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        this.#seasonsFiltered = 0;
        let anyShowing = false;
        for (const serializedSeason of seasons) {
            const season = new SeasonData().setFromJson(serializedSeason);
            const seasonRow = new SeasonResultRow(season, this);
            this.#seasons[season.metadataId] = seasonRow;
            if (FilterSettings.shouldFilter(season.markerBreakdown())) {
                ++this.#seasonsFiltered;
            } else {
                addRow(seasonRow.buildRow());
                anyShowing = true;
            }

            PlexClientState.addSeason(season);
        }

        if (!anyShowing) {
            addRow(PlexUI.noResultsBecauseOfFilterRow());
        }

        this.#onFilterStatusChanged();
    }

    /**
     * Update what rows are visible based on the new filter. */
    onFilterApplied() {
        PlexUI.clearSections(UISection.Seasons);
        const addRow = row => PlexUI.addRow(UISection.Seasons, row);
        addRow(this.#sectionTitle.html());
        addRow(this.#showTitle.html());
        addRow(new BulkActionResultRow(this.show()).buildRow()); // TODO: Make this a class var too?
        const seasons = Object.values(this.#seasons).sort((a, b) => a.season().index - b.season().index);
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
            addRow(PlexUI.noResultsBecauseOfFilterRow());
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
        if (this.#seasonsFiltered !== 0) {
            Tooltip.setTooltip(seasons, `Current filter is hiding ${plural(this.#seasonsFiltered, 'season')}.`);
            clearEle(seasons);
            seasons.appendChild(filteredListIcon());
            seasons.appendChild(buildNode('span', {}, baseText));
        } else {
            seasons.innerHTML = baseText;
        }
    }
}

/**
 * A result row for a single season of a show.
 */
class SeasonResultRow extends ResultRow {
    /**
     * A dictionary of {@linkcode EpisodeResultRow}s for keeping track of marker tables to show/expand if needed.
     * @type {{[episodeId: number]: EpisodeResultRow}} */
    #episodes = {};

    /**
     * The top-level section bar that allows for common actions.
     * @type {SectionOptionsResultRow} */
    #sectionTitle;

    /**
     * The placeholder {@linkcode ShowResultRow} that displays the show name/stats when in episode view.
     * @type {ShowResultRow} */
    #showTitle;

    /**
     * The placeholder {@linkcode SeasonResultRow} that displays the season name/stats when in episode view.
     * @type {SeasonResultRow} */
    #seasonTitle;

    /**
     * If this is the active season, this is the number of episodes that we are not showing due to the active filter.
     * @type {number} */
    #episodesFiltered = 0;

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
    buildRow(selected=false) {
        if (this.html()) {
            Log.warn('buildRow has already been called for this SeasonResultRow, that shouldn\'t happen');
            return this.html();
        }

        const season = this.season();
        let title = buildNode('div', { class : 'selectedSeasonTitle' }, buildNode('span', {}, `Season ${season.index}`));
        if (season.title.toLowerCase() != `season ${season.index}`) {
            title.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${season.title})`));
        }

        let row = this.buildRowColumns(title, buildNode('div'), selected ? null : this.#seasonClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to seasons', () => {
                PlexUI.clearSections(UISection.Episodes);
                PlexUI.hideSections(UISection.Episodes)
                PlexUI.showSections(UISection.Seasons);
            });
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
        let updated = {};
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
        unpurged.forEach(/**@this {SeasonResultRow}*/function(action) {
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
        PurgedMarkers.showSingleSeason(this.season().metadataId);
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
        const season = this.season();
        try {
            await this.#parseEpisodes(await ServerCommand.getEpisodes(season.metadataId));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the episodes for ${season.title}.`, err);
        }
    }

    /**
     * Takes the given list of episodes and makes a request for marker details for each episode.
     * @param {Object[]} episodes Array of episodes in a particular season of a show. */
    async #parseEpisodes(episodes) {
        let queryIds = [];
        for (const episode of episodes) {
            PlexClientState.addEpisode(new ClientEpisodeData().setFromJson(episode));
            queryIds.push(episode.metadataId);
        }

        try {
            this.#showEpisodesAndMarkers(await ServerCommand.query(queryIds));
        } catch (err) {
            errorResponseOverlay(`Something went wrong when retrieving the markers for these episodes, please try again.`, err);
        }
    }

    /**
     * Takes the given list of episode data and creates entries for each episode and its markers.
     * @param {{[metadataId: number]: SerializedMarkerData[]}} data Map of episode ids to an array of
     * serialized {@linkcode MarkerData} for the episode. */
    #showEpisodesAndMarkers(data) {
        PlexUI.clearAndShowSections(UISection.Episodes);
        PlexUI.hideSections(UISection.Seasons);
        const addRow = row => PlexUI.addRow(UISection.Episodes, row);
        if (ClientSettings.showExtendedMarkerInfo()) {
            this.#sectionTitle = new SectionOptionsResultRow();
            addRow(this.#sectionTitle.buildRow())
        }

        this.#showTitle = new ShowResultRow(PlexClientState.getActiveShow());
        addRow(this.#showTitle.buildRow(true));
        addRow(buildNode('hr'));
        this.#seasonTitle = new SeasonResultRow(PlexClientState.getActiveSeason());
        addRow(this.#seasonTitle.buildRow(true));
        addRow(new BulkActionResultRow(this.season()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));

        // Returned data doesn't guarantee order. Create the rows, then sort by index
        let episodeRows = [];
        for (const metadataId of Object.keys(data)) {
            episodeRows.push(new EpisodeResultRow(PlexClientState.getEpisode(parseInt(metadataId)), this));
        }

        this.#episodesFiltered = 0;
        let anyShowing = false;
        episodeRows.sort((a, b) => a.episode().index - b.episode().index);
        for (const resultRow of episodeRows) {
            const markers = data[resultRow.episode().metadataId];
            if (FilterSettings.shouldFilterEpisode(markers)) {
                ++this.#episodesFiltered;
                // Still want to seed the marker table so when a filter change exposes more episodes,
                // we can grab the associated markers..
                // TODO: find a better place to expose markers
                resultRow.buildRow(markers);
            } else {
                addRow(resultRow.buildRow(markers));
                anyShowing = true;
            }

            this.#episodes[resultRow.episode().metadataId] = resultRow;
        }

        if (!anyShowing) {
            addRow(PlexUI.noResultsBecauseOfFilterRow());
        }

        this.#onFilterStatusChanged();
    }

    /**
     * Update what rows are visible based on the new filter. */
    onFilterApplied() {
        if (Object.keys(this.#episodes).length === 0) {
            // We're not the active season.
            return;
        }

        PlexUI.clearSections(UISection.Episodes);
        const addRow = row => PlexUI.addRow(UISection.Episodes, row);

        // Recreate headers
        addRow(this.#sectionTitle.html());
        addRow(this.#showTitle.html());
        addRow(buildNode('hr'));
        addRow(this.#seasonTitle.html());
        addRow(new BulkActionResultRow(this.season()).buildRow());
        addRow(buildNode('hr', { style : 'margin-top: 0' }));
        this.#episodesFiltered = 0;
        let anyShowing = false;
        const episodes = Object.values(this.#episodes).sort((a, b) => a.episode().index - b.episode().index);
        for (const episode of episodes) {
            if (FilterSettings.shouldFilterEpisode(episode.episode().markerTable().markers())) {
                ++this.#episodesFiltered;
            } else {
                addRow(episode.html() || episode.buildRow());
                anyShowing = true;
            }
        }

        if (!anyShowing) {
            addRow(PlexUI.noResultsBecauseOfFilterRow());
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

        if ((seasonName.childNodes[0].tagName == 'IMG') == this.#episodesFiltered) {
            return;
        }

        Tooltip.removeTooltip(seasonName);
        if (this.#episodesFiltered !== 0) {
            seasonName.prepend(filteredListIcon());
            Tooltip.setTooltip(seasonName, `Current filter is hiding ${plural(this.#episodesFiltered, 'episode')}.`);
        } else {
            seasonName.removeChild(seasonName.childNodes[0]);
        }
    }

    /**
     * Show or hide all marker tables associated with the episodes in this season.
     * @param {boolean} hide Whether to hide or show all marker tables. */
    showHideMarkerTables(hide) {
        for (const episode of Object.values(this.#episodes)) {
            episode.showHideMarkerTable(hide);
        }
    }

    /** Update the UI after a marker is added/deleted, including our placeholder show/season rows. */
    updateMarkerBreakdown() {
        // If this is the "real" active row, it's currently hiding behind
        // the dummy entries, which also need to be updated.
        if (this.#seasonTitle) { this.#seasonTitle.updateMarkerBreakdown(); }
        if (this.#showTitle) { this.#showTitle.updateMarkerBreakdown(); }
        super.updateMarkerBreakdown();
    }
}

/**
 * Class with functionality shared between "base" media types, i.e. movies and episodes.
 */
class BaseItemResultRow extends ResultRow {
    /** Current MarkerBreakdown key. See MarkerCacheManager.js's BaseItemNode */
    #markerCountKey = 0;

    /**
     * @param {MediaItemWithMarkerTable} mediaItem 
     * @param {string} [className] */
    constructor(mediaItem, className) {
        super(mediaItem, className);
        if (mediaItem && mediaItem.markerBreakdown()) {
            // Episodes are loaded differently from movies. It's only expected that movies have a valid value
            // here. Episodes set this when creating the marker table for the first time.
            Log.assert(mediaItem instanceof ClientMovieData, 'mediaItem instanceof ClientMovieData');
            this.#markerCountKey = MarkerBreakdown.keyFromMarkerCount(mediaItem.markerBreakdown().totalIntros(), mediaItem.markerBreakdown().totalCredits());
        }
    }

    currentKey() { return this.#markerCountKey; }
    /** @param {number} key */
    setCurrentKey(key) { this.#markerCountKey = key; }
}

/**
 * A result row for a single episode of a show.
 */
class EpisodeResultRow extends BaseItemResultRow {
    /**
     * The parent {@linkcode SeasonResultRow}, used to communicate that marker tables of all
     * episodes in the season need to be shown/hidden.
     * @type {SeasonResultRow} */
    #seasonRow;

    constructor(episode, seasonRow) {
        super(episode, 'episodeResult');
        this.#seasonRow = seasonRow;
    }

    /**
     * Return the underlying episode data associated with this result row.
     * @returns {ClientEpisodeData} */
    episode() { return this.mediaItem(); }

    /**
     * Builds a row for an episode of the form '> ShowName - SXXEYY - EpisodeName | X Marker(s)'
     * with a collapsed marker table that appears when this row is clicked.
     * @param {Object} markerData an array of serialized {@linkcode MarkerData} for the episode. */
    buildRow(markerData) {
        const ep = this.episode();
        ep.createMarkerTable(this, markerData);
        const titleText = 'Click to expand/contract. Control+Click to expand/contract all';
        const sXeY = `S${pad0(ep.seasonIndex, 2)}E${pad0(ep.index, 2)}`;
        const episodeTitle = `${ep.showName} - ${sXeY} - ${ep.title || 'Episode ' + ep.index}`;
        let row = buildNode('div');
        appendChildren(row,
            appendChildren(buildNode('div', { class : 'episodeResult', title : titleText, }, 0, { click : this.#showHideMarkerTableEvent.bind(this) }),
                appendChildren(buildNode('div', { class : 'episodeName' }),
                    buildNode('span', { class : 'markerExpand' }, '&#9205; '),
                    buildNode('span', {}, episodeTitle)
                ),
                this.#buildMarkerText()
            ),
            ep.markerTable().table(),
            buildNode('hr', { class : 'episodeSeparator' })
        );

        this.setHtml(row);
        return row;
    }

    /**
     * Builds the "X Marker(s)" span for this episode, including a tooltip if purged markers are present.
     * @returns {HTMLElement} */
    #buildMarkerText() {
        const episode = this.episode();
        const hasPurges = this.hasPurgedMarkers();
        let text = buildNode('span', {}, plural(episode.markerTable().markerCount(), 'Marker'));
        if (hasPurges) {
            text.appendChild(purgeIcon());
        }

        let main = buildNode('div', { class : 'episodeDisplayText' }, text);
        if (!hasPurges) {
            return main;
        }

        const purgeCount = this.getPurgeCount();
        const markerText = purgeCount == 1 ? 'marker' : 'markers';
        Tooltip.setTooltip(main, `Found ${purgeCount} purged ${markerText}.<br>Click for details.`);
        main.addEventListener('click', this.#onEpisodePurgeClick.bind(this));
        // Explicitly set no title so it doesn't interfere with the tooltip
        main.title = "";
        return main;
    }

    /** Launches the purge table overlay. */
    #onEpisodePurgeClick() {
        PurgedMarkers.showSingleEpisode(this.episode().metadataId);
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    #showHideMarkerTableEvent(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        const expanded = !$$('table', this.episode().markerTable().table()).classList.contains('hidden');
        if (e.ctrlKey) {
            this.#seasonRow.showHideMarkerTables(expanded);
        } else {
            this.showHideMarkerTable(expanded);

            // Only want to scroll into view if we're showing a single episode
            if (!expanded) {
                this.scrollTableIntoView();
            }
        }
    }

    /**
     * Expands or contracts the marker table for this row.
     * @param {boolean} hide */
    showHideMarkerTable(hide) {
        $$('table', this.episode().markerTable().table()).classList[hide ? 'add' : 'remove']('hidden');
        $$('.markerExpand', this.html()).innerHTML = hide ? '&#9205; ' : '&#9660; ';

        // Should really only be necessary on hide, but hide tooltips on both show and hide
        Tooltip.dismiss();
    }

    /** Scroll the marker table into view */
    scrollTableIntoView() {
        $$('table', this.episode().markerTable().table()).scrollIntoView({ behavior : 'smooth', block : 'nearest' });
    }

    /**
     * Updates the marker statistics both in the UI and the client state. */
    updateMarkerBreakdown() {
        // Don't bother updating in-place, just recreate and replace.
        const newNode = this.#buildMarkerText();
        const oldNode = $$('.episodeDisplayText', this.html());
        oldNode.replaceWith(newNode);

        const newKey = this.episode().markerTable().markerKey();
        const delta = newKey - this.currentKey();
        if (ClientSettings.showExtendedMarkerInfo()) {
            PlexClientState.updateBreakdownCache(this.episode(), delta);
        }

        this.setCurrentKey(newKey);
    }
}

class MovieResultRow extends BaseItemResultRow {

    /** @type {boolean} */
    #markersGrabbed = false;

    /**
     * @param {ClientMovieData} mediaItem */
    constructor(mediaItem) {
        super(mediaItem, 'topLevelResult movieResultRow');
        this.#markersGrabbed = this.movie().markerTable()?.hasRealData();
    }
    /**
     * Return the underlying episode data associated with this result row.
     * @returns {ClientMovieData} */
    movie() { return this.mediaItem(); }

    /**
     * Builds a row for an episode of the form '> MovieName (year) | X Marker(s)'
     * with a collapsed marker table that appears when this row is clicked. */
    buildRow() {
        const mov = this.movie();
        // Create a blank marker table, and only load when the marker table is shown
        mov.createMarkerTable(this, [] /*markerData*/);
        const titleText = 'Click to expand/contract.';
        const titleNode = buildNode('div', { class : 'movieName', title : titleText });
        titleNode.appendChild(buildNode('span', { class : 'markerExpand' }, '&#9205; '));
        titleNode.appendChild(buildNode('span', { }, mov.title));
        if (mov.originalTitle) {
            titleNode.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${mov.originalTitle})`));
        }

        titleNode.appendChild(buildNode('span', {}, ` (${mov.year})`));
        if (mov.edition) {
            titleNode.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` [${mov.edition}]`));
        }

        let row = buildNode('div');
        appendChildren(row,
            appendChildren(buildNode('div', { class : 'episodeResult' }, 0, { click : this.#showHideMarkerTableEvent.bind(this) }), // TODO: generalized class name
                appendChildren(buildNode('div', { class : 'movieName', title : titleText }),
                    titleNode
                ),

                this.#buildMarkerText()
            ),
            buildNode('hr', { class : 'episodeSeparator' })
        );

        this.setHtml(row);
        return row;
    }

    // TODO: Share with Episode?

    /**
     * Builds the "X Marker(s)" span for this movie, including a tooltip if purged markers are present.
     * @returns {HTMLElement} */
    #buildMarkerText() {
        const movie = this.movie();
        const hasPurges = this.hasPurgedMarkers();
        let text;
        let tooltipText = '';

        // Three scenarios to find the number of markers:
        // realMarkerCount == -1: we don't know how many markers we have, add '?' with a title
        // Extended stats disabled and no markers grabbed, but we have a realMarkerCount - use it
        // All other scenarios: use the actual marker table count.
        if (!ClientSettings.showExtendedMarkerInfo() && this.movie().realMarkerCount == -1) {
            text = buildNode('span', {}, '? Marker(s)');
            tooltipText = 'Click on the row to load marker counts.';
        } else {
            let markerCount = 0;;
            if (!ClientSettings.showExtendedMarkerInfo() && !this.#markersGrabbed) {
                markerCount = movie.realMarkerCount;
            } else {
                markerCount = movie.markerTable().markerCount();
            }
    
            text = buildNode('span', {}, plural(markerCount, 'Marker'));
        }

        if (hasPurges) {
            text.appendChild(purgeIcon());
        }

        let main = buildNode('div', { class : 'episodeDisplayText' }, text);
        if (!hasPurges) {
            if (tooltipText) {
                Tooltip.setTooltip(main, tooltipText);
            }
            return main;
        }

        tooltipText += tooltipText.length > 0 ? '<br><br>' : '';
        const purgeCount = this.getPurgeCount();
        const markerText = purgeCount == 1 ? 'marker' : 'markers';
        Tooltip.setTooltip(main, `${tooltipText}Found ${purgeCount} purged ${markerText}.<br>Click for details.`);
        main.addEventListener('click', this.#onMoviePurgeClick.bind(this));
        // Explicitly set no title so it doesn't interfere with the tooltip
        main.title = "";
        return main;
    }

    /** Launches the purge table overlay. */
    #onMoviePurgeClick() {
        PurgedMarkers.showSingleMovie(this.movie().metadataId);
    }

    /**
     * Updates various UI states after purged markers are restored/ignored
     * @param {MarkerData[]?} newMarkers New markers that were added as the result of a restoration, or null if there weren't any
     * @param {MarkerData[]?} deletedMarkers
     * @param {MarkerData[]?} modifiedMarkers */
    notifyPurgeChange(newMarkers, deletedMarkers, modifiedMarkers) {
        for (const marker of (newMarkers || [])) {
            this.movie().markerTable().addMarker(marker, null /*oldRow*/);
        }
        for (const marker of (deletedMarkers || [])) {
            this.movie().markerTable().deleteMarker(marker);
        }
        for (const marker of (modifiedMarkers || [])) {
            this.movie().markerTable().editMarker(marker, true /*forceReset*/);
        }
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    async #showHideMarkerTableEvent(e) {
        if (this.ignoreRowClick(e)) {
            return;
        }

        const mov = this.movie();
        if (!this.#markersGrabbed) {
            this.#markersGrabbed = true;
            try {
                const markerData = await ServerCommand.query([mov.metadataId]);
                if (mov.hasThumbnails === undefined) {
                    mov.hasThumbnails = (await ServerCommand.checkForThumbnails(mov.metadataId)).hasThumbnails;
                }
    
                markerData[mov.metadataId].sort((a, b) => a.start - b.start);
                if (mov.realMarkerCount == -1) {
                    mov.realMarkerCount = markerData[mov.metadataId].length;
                }

                if (ClientSettings.backupEnabled()) {
                    // Gather purge data before continuing
                    try {
                        await PurgedMarkers.getPurgedMovieMarkers(this.movie().metadataId);
                    } catch (err) {
                        Log.warn(errorMessage(err), `Unable to get purged marker info for movie ${this.movie().title}`);
                    }
                }

                mov.initializeMarkerTable(markerData[mov.metadataId]);
                this.html().insertBefore(mov.markerTable().table(), $$('.episodeSeparator', this.html()));
            } catch (ex) {
                this.#markersGrabbed = false;
                throw ex;
            }
        }

        const expanded = !$$('table', mov.markerTable().table()).classList.contains('hidden');
        this.showHideMarkerTable(expanded);

        // Only want to scroll into view if we're expanding the table
        if (!expanded) {
            this.scrollTableIntoView();
        }
    }

    /**
     * Expands or contracts the marker table for this row.
     * @param {boolean} hide */
    showHideMarkerTable(hide) {
        $$('table', this.movie().markerTable().table()).classList[hide ? 'add' : 'remove']('hidden');
        $$('.markerExpand', this.html()).innerHTML = hide ? '&#9205; ' : '&#9660; ';

        // Should really only be necessary on hide, but hide tooltips on both show and hide
        Tooltip.dismiss();
    }

    /** Scroll the marker table into view */
    scrollTableIntoView() {
        $$('table', this.movie().markerTable().table()).scrollIntoView({ behavior : 'smooth', block : 'nearest' });
    }

    /**
     * Updates the marker statistics both in the UI and the client state. */
    updateMarkerBreakdown() {
        // Don't bother updating in-place, just recreate and replace.
        const newNode = this.#buildMarkerText();
        const oldNode = $$('.episodeDisplayText', this.html());
        oldNode.replaceWith(newNode);

        const newKey = this.movie().markerTable().markerKey();
        const oldKey = this.currentKey();
        // Note: No need to propagate changes up like for episodes, since
        //       we're already at the top of the chain. The section-wide
        //       marker chart queries the server directly every time.
        const breakdown = this.movie().markerBreakdown();
        if (!breakdown) {
            // Extended stats not enabled.
            this.movie().realMarkerCount = this.movie().markerTable().markerCount();
            return;
        }

        breakdown.delta(oldKey, newKey - oldKey);
        this.setCurrentKey(newKey);

    }
}

export { ResultRow, ShowResultRow, SeasonResultRow, EpisodeResultRow, MovieResultRow, BaseItemResultRow, SectionOptionsResultRow }
