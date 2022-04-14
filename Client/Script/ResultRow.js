import { $$, appendChildren, buildNode, errorMessage, jsonRequest, pad0, plural } from "./Common.js";
import { Log } from "../../Shared/ConsoleLog.js";
import { PlexData, SeasonData, ShowData } from "../../Shared/PlexTypes.js";

import { PlexState, PlexUI, Settings } from "./index.js";

import Tooltip from "./inc/Tooltip.js";
import Overlay from "./inc/Overlay.js";

import ButtonCreator from "./ButtonCreator.js";
import ClientEpisodeData from "./ClientEpisodeData.js";
import { UISection } from "./PlexClientUI.js";
import PurgeTable from "./PurgeTable.js";

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

    /** @returns The base media item associated with this row. */
    mediaItem() { return this.#mediaItem; }

    /** Updates the marker breakdown text ('X/Y (Z.ZZ%)) and tooltip, if necessary. */
    updateMarkerBreakdown() {
        // No updates necessary if extended breakdown stats aren't enabled
        if (!Settings.showExtendedMarkerInfo()) {
            return;
        }

        const span = $$('.showResultEpisodes span', this.#html);
        if (!span) {
            Log.warn('Could not find marker breakdown span, can\'t update.');
            return;
        }

        this.episodeDisplay(span);
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
    episodeDisplay(currentDisplay=null) {
        const mediaItem = this.mediaItem();
        const baseText = plural(mediaItem.episodeCount, 'Episode');
        if (!Settings.showExtendedMarkerInfo() || !mediaItem.markerBreakdown) {
            // The feature isn't enabled or we don't have a marker breakdown. The breakdown can be null if the
            // user kept this application open while also adding episodes in PMS (which _really_ shouldn't be done).
            return baseText;
        }

        let atLeastOne = 0;
        let tooltipText = `${baseText}<br>`;
        const keys = Object.keys(mediaItem.markerBreakdown).sort((a, b) => parseInt(a) - parseInt(b));
        for (const key of keys) {
            const episodeCount = mediaItem.markerBreakdown[key];
            tooltipText += `${episodeCount} ${episodeCount == 1 ? 'has' : 'have'} ${plural(parseInt(key), 'marker')}<br>`;
            if (key != 0) {
                atLeastOne += episodeCount;
            }
        }

        if (atLeastOne == 0) {
            tooltipText = `${baseText}<br>None have markers.`;
        }

        const percent = (atLeastOne / mediaItem.episodeCount * 100).toFixed(2);
        const innerText = `${atLeastOne}/${mediaItem.episodeCount} (${percent}%)`;
        if (currentDisplay) {
            currentDisplay.innerText = innerText;
            Tooltip.setText(currentDisplay, tooltipText);
            return true;
        }

        let mainText = buildNode('span', {}, innerText);
        Tooltip.setTooltip(mainText, tooltipText);
        return mainText;
    }
}

/**
 * A result row for a single show in the library.
 */
class ShowResultRow extends ResultRow {
    /** @param {ShowData} show */
    constructor(show) {
        super(show, 'showResult');
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
                PlexUI.clearAndShowSections(UISection.Seasons | UISection.Episodes);
                PlexUI.showSections(UISection.Shows);
            });
        }

        this.setHtml(row);
        return row;
    }

    /** Click handler for clicking a show row. Initiates a request for season details. */
    #showClick() {
        if (!PlexState.setActiveShow(this)) {
            Overlay.show('Unable to retrieve data for that show. Please try again later.', 'OK');
            return;
        }

        const show = this.show();
        let failureFunc = response => {
            Overlay.show(`Something went wrong when retrieving the seasons for ${show.title}.<br><br>` +
                         `Server message:<br>${errorMessage(response)}`, 'OK')
        };

        jsonRequest('get_seasons', { id : show.metadataId }, this.#showSeasons.bind(this), failureFunc);
    }

    /**
     * Takes the seasons retrieved for a show and creates and entry for each season.
     * @param {Object[]} seasons List of serialized {@linkcode SeasonData} seasons for a given show. */
    #showSeasons(seasons) {
        PlexUI.clearAndShowSections(UISection.Seasons);
        PlexUI.hideSections(UISection.Shows);

        const addRow = row => PlexUI.addRow(UISection.Seasons, row);
        addRow(new ShowResultRow(this.show()).buildRow(true /*selected*/));
        addRow(buildNode('hr'));
        for (const serializedSeason of seasons) {
            const season = new SeasonData().setFromJson(serializedSeason);
            addRow(new SeasonResultRow(season).buildRow());
            PlexState.addSeason(season);
        }
    }
}

/**
 * A result row for a single season of a show.
 */
class SeasonResultRow extends ResultRow {
    /**
     * An array of {@linkcode EpisodeResultRow}s for keeping track of marker tables to show/expand if needed.
     * @type {EpisodeResultRow[]} */
    #episodes = [];

    /**
     * The placeholder {@linkcode ShowResultRow} that displays the show name/stats when in episode view.
     * @type {ShowResultRow} */
    #showTitle;

    /**
     * The placeholder {@linkcode SeasonResultRow} that displays the season name/stats when in episode view.
     * @type {SeasonResultRow} */
    #seasonTitle;

    /** @typedef {!import('../../Server/MarkerBackupManager').MarkerAction} MarkerAction */

    /**
     * The set of purged markers found for episodes in this season. Aggregated at the season level
     * to avoid individual requests for each episode.
     * @type {{[episodeId: number]: MarkerAction}} */
    #purgeData = {};

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
        let title = buildNode('div', {}, `Season ${season.index}`);
        if (season.title.toLowerCase() != `season ${season.index}`) {
            title.appendChild(buildNode('span', { class : 'resultRowAltTitle' }, ` (${season.title})`));
        }

        let row = this.buildRowColumns(title, buildNode('div'), selected ? null : this.#seasonClick.bind(this));
        if (selected) {
            this.addBackButton(row, 'Back to seasons', () => {
                PlexUI.clearAndShowSections(UISection.Episodes);
                PlexUI.showSections(UISection.Seasons);
            });
        }

        this.setHtml(row);
        return row;
    }

    /** Click handler for clicking a show row. Initiates a request for all episodes in the given season. */
    #seasonClick() {
        if (!PlexState.setActiveSeason(this)) {
            Overlay.show('Unable to retrieve data for that season. Please try again later.', 'OK');
            return;
        }

        if (Settings.backupEnabled()) {
            this.#purgeCheck();
        } else {
            this.#getEpisodes();
        }
    }

    /** Make a request for all episodes in this season. */
    #getEpisodes() {
        const season = this.season();
        let failureFunc = response => {
            Overlay.show(`Something went wrong when retrieving the episodes for ${season.title}.<br>Server message:<br>${errorMessage(response)}`, 'OK');
        };

        jsonRequest('get_episodes', { id : season.metadataId }, this.#parseEpisodes.bind(this), failureFunc);
    }

    /**
     * Takes the given list of episodes and makes a request for marker details for each episode.
     * @param {Object[]} episodes Array of episodes in a particular season of a show. */
    #parseEpisodes(episodes) {
        let queryString = [];
        for (const episode of episodes) {
            PlexState.addEpisode(new ClientEpisodeData().setFromJson(episode));
            queryString.push(episode.metadataId);
        }
    
        let failureFunc = (response) => {
            Overlay.show(`Something went wrong when retrieving the markers for these episodes, please try again.<br><br>Server Message:<br>${errorMessage(response)}`, 'OK');
        }
    
        jsonRequest('query', { keys : queryString.join(',') }, this.#showEpisodesAndMarkers.bind(this), failureFunc);
    }

    /**
     * Takes the given list of episode data and creates entries for each episode and its markers.
     * @param {{[metadataId: number]: Object[]}} data Map of episode ids to an array of
     * serialized {@linkcode MarkerData} for the episode. */
    #showEpisodesAndMarkers(data) {
        PlexUI.clearSections(UISection.Episodes);
        PlexUI.hideSections(UISection.Seasons);
        const addRow = row => PlexUI.addRow(UISection.Episodes, row);
        this.#showTitle = new ShowResultRow(PlexState.getActiveShow());
        addRow(this.#showTitle.buildRow(true));
        addRow(buildNode('hr'));
        this.#seasonTitle = new SeasonResultRow(PlexState.getActiveSeason());
        addRow(this.#seasonTitle.buildRow(true));
        addRow(buildNode('hr'));

        // Returned data doesn't guarantee order. Create the rows, then sort by index
        let episodeRows = [];
        for (const metadataId of Object.keys(data)) {
            episodeRows.push(new EpisodeResultRow(PlexState.getEpisode(parseInt(metadataId)), this));
        }

        episodeRows.sort((a, b) => a.episode().index - b.episode().index);
        for (const resultRow of episodeRows) {
            addRow(resultRow.buildRow(data[resultRow.episode().metadataId]));
            this.#episodes.push(resultRow);
        }
    }

    /**
     * Show or hide all marker tables associated with the episodes in this season.
     * @param {boolean} hide Whether to hide or show all marker tables. */
    showHideMarkerTables(hide) {
        for (const episode of this.#episodes) {
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

    /** Makes a request to the server for all purged markers in this season. Forwards to `#getEpisodes` on failure. */
    #purgeCheck() {
        let failureFunc = response => {
            Log.error(errorMessage(response), `Unable to check for purged markers`);
            this.#getEpisodes();
        }
    
        jsonRequest('purge_check', { id : this.season().metadataId }, this.#onPurgeResponse.bind(this), failureFunc.bind(this));
    }

    /**
     * Takes the array of purged markers found and adds them to `#purgeData`.
     * @param {MarkerAction[]} purgedMarkers */
    #onPurgeResponse(purgedMarkers) {
        this.#purgeData = {};
        for (const purged of purgedMarkers) {
            if (!this.#purgeData[purged.episode_id]) {
                this.#purgeData[purged.episode_id] = [];
            }

            this.#purgeData[purged.episode_id].push(purged);
        }

        this.#getEpisodes();
    }

    /**
     * Retreieves markers that we think should exist, but don't.
     * Returns an empty array if no purged markers are found, or the feature is not enabled.
     * @param {number} episodeId
     * @returns {MarkerAction[]} */
    getPurgedMarkers(episodeId) {
        return this.#purgeData[episodeId] ?? [];
    }
}

/**
 * A result row for a single episode of a show.
 */
class EpisodeResultRow extends ResultRow {
    /**
     * The parent {@linkcode SeasonResultRow}, used to communicate that marker tables of all
     * episodes in the season need to be shown/hidden.
     * @type {SeasonResultRow} */
    #seasonRow;

    /** Tracks whether this episode has has markers that we think have been purged from the Plex database. */
    #hasPurgedMarkers = false;

    constructor(episode, seasonRow) {
        super(episode);
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
                buildNode('div', { class : 'episodeResultMarkers' }, plural(ep.markerCount(), 'Marker'))
            ),
            ep.markerTable(),
            buildNode('hr', { class : 'episodeSeparator' })
        );
        
        this.#setupPurgeCallback(row);

        this.setHtml(row);
        return row;
    }

    /** Adds the click handler to the 'X markers' text that will display purged markers for the episode. */
    #setupPurgeCallback(row) {
        const episode = this.episode();
        const purgeData = this.#seasonRow.getPurgedMarkers(episode.metadataId);
        if (purgeData.length <= 0) {
            return;
        }

        this.#hasPurgedMarkers = true;
        const markerCount = $$('.episodeResultMarkers', row);
        markerCount.innerText += ' (!)';
        markerCount.title = ''; // Don't overlap with the row title.
        Tooltip.setTooltip(markerCount, `Found ${purgeData.length} purged markers for this episode.<br>Click for details.`);
        markerCount.addEventListener('click', this.#onEpisodePurgeClick.bind(this, purgeData));
    }

    /** Launches the purge table overlay.
     * @param {MarkerAction[]} purgeData */
    #onEpisodePurgeClick(purgeData) {
        new PurgeTable(PlexState.activeSection(), purgeData).show();
    }

    /**
     * Expand or collapse the marker table for the clicked episode.
     * If the user ctrl+clicks the episode, expand/contract for all episodes.
     * @param {MouseEvent} e */
    #showHideMarkerTableEvent(e) {
        if (this.#hasPurgedMarkers && e.target.classList.contains('episodeResultMarkers')) {
            return; // Don't show/hide if we're repurposing the marker display.
        }

        const expanded = !$$('table', this.episode().markerTable()).classList.contains('hidden');
        if (e.ctrlKey) {
            this.#seasonRow.showHideMarkerTables(expanded);
        } else {
            this.showHideMarkerTable(expanded);
        }
    }

    /**
     * Expands or contracts the marker table for this row.
     * @param {boolean} hide */
    showHideMarkerTable(hide) {
        $$('table', this.episode().markerTable()).classList[hide ? 'add' : 'remove']('hidden');
        $$('.markerExpand', this.html()).innerHTML = hide ? '&#9205; ' : '&#9660; ';
    }

    /**
     * Updates the marker statistics both in the UI and the client state.
     * @param {number} delta 1 if a marker was added to this episode, -1 if one was removed. */
    updateMarkerBreakdown(delta) {
        const text = plural(this.episode().markerCount(), 'Marker') + (this.#hasPurgedMarkers ? ' (!)' : '');
        $$('.episodeResultMarkers', this.html()).innerText = text;
        if (Settings.showExtendedMarkerInfo()) {
            PlexState.updateBreakdownCache(this.episode(), delta);
        }
    }
}

export { ShowResultRow, SeasonResultRow, EpisodeResultRow }
