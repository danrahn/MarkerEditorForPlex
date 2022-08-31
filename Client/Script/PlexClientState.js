import { errorMessage, errorResponseOverlay, ServerCommand } from './Common.js';
import { Log } from '../../Shared/ConsoleLog.js';
import { ShowData, SeasonData } from '../../Shared/PlexTypes.js';

import { BulkActionType } from './BulkActionCommon.js';
import ClientEpisodeData from './ClientEpisodeData.js';
import { PurgedSection } from './PurgedMarkerCache.js';
import { SeasonResultRow, ShowResultRow } from './ResultRow.js';
import SettingsManager from './ClientSettings.js';
import { PlexUI } from './PlexUI.js';

/** @typedef {!import('../../Shared/PlexTypes.js').ShowMap} ShowMap */
/** @typedef {!import('../../Shared/PlexTypes.js').PurgeSection} PurgeSection */
/** @typedef {!import('./BulkActionCommon.js').BulkActionCommon} BulkMarkerResult */

/**
* A class that keeps track of the currently UI state of the Intro Editor,
* including search results and the active show/season.
*/
class PlexClientState {
    /** @type {number} */
    #activeSection = -1;
    /** @type {{[sectionId: number]: ShowMap}} */
    #shows = {};
    /** @type {ShowData[]} */
    #activeSearch = [];
    /** @type {ShowResultRow} */
    #activeShow;
    /** @type {SeasonResultRow} */
    #activeSeason;
    /**@type {PlexClientState} */
    static #clientState;

    /** Create the singleton PlexClientState instance. */
    static Initialize() {
        if (PlexClientState.#clientState) {
            Log.error('We should only have a single PlexClientState instance!');
            return;
        }

        PlexClientState.#clientState = new PlexClientState();
    }

    constructor() {
        if (PlexClientState.#clientState) {
            throw new Error(`Don't create a new PlexClientState when the singleton already exists!`);
        }
    }

    /** @returns {PlexClientState} */
    static GetState() {
        if (!this.#clientState) {
            Log.error(`Accessing client state before it's been initialized'! Initializing now...`);
            PlexClientState.Initialize();
        }

        return this.#clientState;
    }

    /**
      * Set the currently active library.
      * @param {number} section The section to make active. */
    async setSection(section) {
        this.#activeSection = isNaN(section) ? -1 : section;
        if (this.#activeSection != -1) {
            await this.#populateShows();
        }
    }

    /** @returns The active Plex library section. */
    activeSection() { return this.#activeSection; }

    /** @returns The list of shows that match the current search. */
    getSearchResults() {
        return this.#activeSearch;
    }

    /**
      * Sets the show with the given metadataId as active.
      * @param {ShowResultRow} showResultRow
      * @returns {ShowData|false} The show with the given metadata id, or `false` if the show was not found. */
    setActiveShow(showResultRow) {
        // We could/should just use showResultRow.show() directly, but this verifies that we've been
        // given a show we expect.
        const metadataId = showResultRow.show().metadataId;
        if (!this.#shows[this.#activeSection][metadataId]) {
            return false;
        }

        if (this.#activeShow && this.#activeShow.show().metadataId != metadataId) {
            this.clearActiveShow();
        }

        if (!this.#activeShow) {
            this.#activeShow = showResultRow;
        }

        return true;
    }

    /** @returns {ShowData} The active show, or null if no show is active. */
    getActiveShow() {
        return this.#activeShow?.show();
    }

    /** Clears out the currently active show and other dependent data (i.e. {@linkcode #activeSeason}). */
    clearActiveShow() {
        // It's probably fine to keep the season/episode data cached,
        // but it could theoretically be a memory hog if someone navigates
        // through their entire library with hundreds/thousands of seasons.
        if (this.#activeShow) {
            this.clearActiveSeason();
            this.#activeShow.show().clearSeasons();
            this.#activeShow = null;
        }
    }

    /** Clears out the currently active season and its episode data. */
    clearActiveSeason() {
        if (this.#activeSeason) {
            this.#activeSeason.season().clearEpisodes();
            this.#activeSeason = null;
        }
    }

    /**
      * Adds the given season to the current show.
      * @param {SeasonData} season */
    addSeason(season) {
        this.#activeShow.show().addSeason(season);
    }

    /**
      * Sets the season with the given metadata id as active.
      * @param {SeasonResultRow} seasonResultRow The metadata of the season.
      * @returns {SeasonData|false} The season with the given metadata id, or `false` if the season could not be found. */
    setActiveSeason(seasonResultRow) {
        const metadataId = seasonResultRow.season().metadataId;
        if (!this.#activeShow.show().getSeason(metadataId)) {
            return false;
        }

        if (this.#activeSeason && this.#activeSeason.season().metadataId != metadataId) {
            this.clearActiveSeason();
        }

        if (!this.#activeSeason) {
            this.#activeSeason = seasonResultRow;
        }

        return true;
    }

    /** @returns {SeasonData} The currently active season, or `null` if now season is active. */
    getActiveSeason() {
        return this.#activeSeason?.season();
    }

    /**
      * Add the given episode to the active season's episode cache.
      * @param {ClientEpisodeData} episode */
    addEpisode(episode) {
        this.#activeSeason.season().addEpisode(episode);
    }

    /**
      * Retrieve an episode from the active season's episode cache.
      * @param {number} metadataId
      * @returns {ClientEpisodeData} */
    getEpisode(metadataId) {
        return this.#activeSeason.season().getEpisode(metadataId);
    }

    /**
     * Updates the marker breakdown cache after a marker is added/removed, and signals to the UI
     * to update things on their end.
     * @param {ClientEpisodeData} episode The episode to update.
     * @param {number} delta 1 if a marker was added, -1 if removed, 0 if purged markers changed. */
    updateBreakdownCache(episode, delta) {
        if (delta != 0) {
            this.#updateBreakdownCacheInternal(episode, delta);
        }

        this.#activeSeason.updateMarkerBreakdown();
        this.#activeShow.updateMarkerBreakdown();
    }

    /**
     * Trigger marker breakdown updates for an active show that had purge actions
     * that didn't apply to the active season (or if there is no active season)
     * @param {ShowResultRow} show The show to update.
     * @param {SeasonResultRow[]} seasons The list of seasons of the show that need to be updated. */
    async updateNonActiveBreakdown(show, seasons) {
        // Nothing to do at the season/show level if extended marker stats aren't enabled.
        if (!SettingsManager.Get().showExtendedMarkerInfo()) {
            return;
        }

        let response;
        try {
            response = await ServerCommand.getBreakdown(show.show().metadataId, seasons.length == 0 /*includeSeasons*/);
        } catch (err) {
            Log.warn(`Failed to update ("${errorMessage(err)}"), marker stats will be incorrect.`);
            return;
        }

        for (const seasonRow of seasons) {
            const newBreakdown = response.seasonData[seasonRow.season().metadataId];
            if (!newBreakdown) {
                Log.warn(`PlexClientState::UpdateNonActiveBreakdown: Unable to find season breakdown data for ${seasonRow.season().metadataId}`);
                continue;
            }

            seasonRow.season().markerBreakdown = newBreakdown;
            seasonRow.updateMarkerBreakdown();
        }

        if (!response.showData) {
            Log.warn(`PlexClientState::UpdateNonActiveBreakdown: Unable to find show breakdown data for ${show.show().metadataId}`);
        } else {
            show.show().markerBreakdown = response.showData;
        }

        show.updateMarkerBreakdown();
    }

    /**
     * Internal core marker cache update method, called when
     * we actually have a delta to apply, which isn't always the case.
     * @param {ClientEpisodeData} episode The episode a marker was added to/removed from.
     * @param {number} delta 1 if a marker was added, -1 if removed. */
    #updateBreakdownCacheInternal(episode, delta) {
        const newCount = episode.markerCount();
        const oldCount = newCount - delta;
        for (const media of [this.#activeShow, this.#activeSeason]) {
            const breakdown = media.mediaItem().markerBreakdown;
            if (!(oldCount in breakdown)) {
                Log.warn(`Old marker count bucket doesn't exist, that's not right!`);
                breakdown[oldCount] = 1;
            }

            --breakdown[oldCount];
            if (breakdown[oldCount] == 0) {
                delete breakdown[oldCount];
            }

            if (!(newCount in breakdown)) {
                breakdown[newCount] = 0;
            }

            ++breakdown[newCount];
        }
    }

    /**
      * Search for shows that match the given query.
      * @param {string} query The show to search for. */
    async search(query)
    {
        // Ignore non-word characters to improve matching if there are spacing or quote mismatches. Don't use \W though, since that also clears out unicode characters.
        // Rather than import some heavy package that's aware of unicode word characters, just clear out the most common characters we want to ignore.
        // I could probably figure out how to utilize Plex's spellfix tables, but substring search on display, sort, and original titles should be good enough here.
        query = query.toLowerCase().replace(/[\s,'"_\-!?]/g, '');

        /** @type {ShowData[]} */
        const showList = Object.values(this.#shows[this.#activeSection]);

        let result = [];
        for (const show of showList) {
            if (show.searchTitle.indexOf(query) != -1
                || (show.sortTitle && show.sortTitle.indexOf(query) != -1)
                || (show.originalTitle && show.originalTitle.indexOf(query) != -1)) {
                result.push(show);
            }
        }

        // Sort the results. Title prefix matches are first, then sort title prefix matches, the original title prefix matches, and alphabetical sort title after that.
        result.sort((a, b) => {
            if (query.length == 0) {
                // Blank query should return all shows, and in that case we just care about sort title order
                return this.#defaultSort(a, b);
            }

            // Title prefix matches are first, then sort title, then original title.
            for (const key of ['searchTitle', 'sortTitle', 'originalTitle']) {
                const prefixA = a[key] && a[key].startsWith(query);
                const prefixB = b[key] && b[key].startsWith(query);
                if (prefixA != prefixB) {
                    return prefixA ? -1 : 1;
                }
            }

            // If there aren't any prefix matches, go by alphabetical sort title.
            return this.#defaultSort(a, b);
        });

        this.#activeSearch = result;
        return;
    }

    /**
     * Notify various parts of the app that purged markers have been restored/ignored.
     * @param {PurgedSection} unpurged Map of markers purged markers that are no longer purged.
     * @param {MarkerData[]} newMarkers List of newly restored markers, if any. */
    notifyPurgeChange(unpurged, newMarkers) {

        // Update non-active shows (as they're all cached for quick search results)
        for (const searchRow of PlexUI.Get().getActiveSearchRows()) {
            if (unpurged.get(searchRow.mediaItem().metadataId)) {
                Log.verbose(`Updating search result show row ${searchRow.show().title} after purge update.`);
                this.updateNonActiveBreakdown(searchRow, []);
            }
        }

        if (!this.#activeShow) {
            return;
        }

        const showData = unpurged.get(this.#activeShow.mediaItem().metadataId);
        if (!showData) {
            // The currently active show didn't have any purged markers adjusted.
            return;
        }

        if (!this.#activeSeason) {
            this.#activeShow.notifyPurgeChange(showData);
            return;
        }

        const seasonData = showData.get(this.#activeSeason.mediaItem().metadataId);
        if (!seasonData) {
            this.#activeShow.notifyPurgeChange(showData);
            return;
        }

        // If possible we want to update the activeSeason first to avoid
        // any conflicts when updating marker breakdown caches.
        this.#activeSeason.notifyPurgeChange(seasonData, newMarkers);
        this.#activeShow.notifyPurgeChange(showData);
    }

    /**
     * Ensure all the right UI bits are updated after a bulk marker action.
     * TODO: Very similar to notifyPurgeChange. Can anything be shared?
     * @param {BulkMarkerResult} markers 
     * @param {number} bulkActionType */
    async notifyBulkActionChange(markers, bulkActionType) {
        // Shifts/edits don't result in different marker breakdowns,
        // so most of this can be skipped (for now).
        const isShift = bulkActionType == BulkActionType.Shift;

        if (!this.#activeShow) {
            return this.#updateBulkActionSearchRow(markers, bulkActionType);
        }

        const showData = markers[this.#activeShow.show().metadataId];

        if (!showData) {
            return this.#updateBulkActionSearchRow(markers, bulkActionType);
        }

        if (!this.#activeSeason) {
            this.#activeShow.notifyBulkAction(showData);
            return this.#updateBulkActionSearchRow(markers, bulkActionType);
        }

        const seasonData = showData[this.#activeSeason.season().metadataId];
        if (!seasonData) {
            if (!isShift) {
                await this.#activeShow.notifyBulkAction(showData);
            }
            return this.#updateBulkActionSearchRow(markers, bulkActionType);
        }

        // If possible we want to update the activeSeason first to avoid
        // any conflicts when updating marker breakdown caches.
        this.#activeSeason.notifyBulkAction(seasonData, bulkActionType);
        if (!isShift) {
            await this.#activeShow.notifyBulkAction(showData);
        }

        return this.#updateBulkActionSearchRow(markers, bulkActionType);
    }

    /**
     * Updates marker breakdown after a bulk action for the search row result, if present.
     * @param {BulkMarkerResult} markers
     * @param {number} bulkActionType */
    async #updateBulkActionSearchRow(markers, bulkActionType) {
        // Shifts don't update marker counts (for now)
        if (bulkActionType == BulkActionType.Shift) {
            return;
        }

        const affectedShows = Object.keys(markers).length;
        Log.assert(affectedShows <= 1, `Bulk actions should target a single show, found ${affectedShows}`);
        for (const searchRow of PlexUI.Get().getActiveSearchRows()) {
            if (markers[searchRow.show().metadataId]) {
                return this.updateNonActiveBreakdown(searchRow, []);
            }
        }
    }

    /** Comparator that sorts shows by sort title, falling back to the regular title if needed.
     * @type {(a: ShowData, b: ShowData) => number} */
    #defaultSort(a, b) {
        const aTitle = a.sortTitle || a.searchTitle;
        const bTitle = b.sortTitle || b.searchTitle;
        return aTitle.localeCompare(bTitle);
    }

    /**
      * Kick off a request to get all shows in the currently active session, if it's not already cached.
      * @returns {Promise<void>} */
    async #populateShows() {
        if (this.#shows[this.#activeSection]) {
            return;
        }

        try {
            const shows = await ServerCommand.getSection(this.#activeSection);
            let allShows = {};
            this.#shows[this.#activeSection] = allShows;
            for (const show of shows) {
                let showData = new ShowData().setFromJson(show);
                allShows[showData.metadataId] = showData;
            }
        } catch (err) {
            errorResponseOverlay('Something went wrong retrieving shows from the selected library, please try again later.', err);
        }
    }
}

export default PlexClientState;
