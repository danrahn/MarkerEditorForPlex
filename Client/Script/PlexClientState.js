import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { errorMessage, errorResponseOverlay } from './ErrorHandling.js';
import { FilterSettings, SortConditions, SortOrder } from './FilterDialog.js';
import { PurgedMovieSection, PurgedTVSection } from './PurgedMarkerCache.js';
import { SectionType, ShowData } from '../../Shared/PlexTypes.js';
import { addWindowResizedListener } from './WindowResizeEventHandler.js';
import { BulkActionType } from './BulkActionCommon.js';
import { ClientMovieData } from './ClientDataExtensions.js';
import { ClientSettings } from './ClientSettings.js';
import { PlexUI } from './PlexUI.js';
import { ServerCommands } from './Commands.js';

/** @typedef {!import('../../Shared/PlexTypes').MarkerDataMap} MarkerDataMap */
/** @typedef {!import('../../Shared/PlexTypes').MovieMap} MovieMap */
/** @typedef {!import('../../Shared/PlexTypes').PurgeSection} PurgeSection */
/** @typedef {!import('../../Shared/PlexTypes').SeasonData} SeasonData */
/** @typedef {!import('../../Shared/PlexTypes').ShowMap} ShowMap */
/** @typedef {!import('../../Shared/PlexTypes').TopLevelData} TopLevelData */
/** @typedef {!import('./BulkActionCommon').BulkActionCommon} BulkMarkerResult */
/** @typedef {!import('./ClientDataExtensions').ClientEpisodeData} ClientEpisodeData */
/** @typedef {!import('./PurgedMarkerCache').PurgedSection} PurgedSection */
/** @typedef {!import('./ResultRow').MovieResultRow} MovieResultRow */
/** @typedef {!import('./ResultRow').SeasonResultRow} SeasonResultRow */
/** @typedef {!import('./ResultRow').ShowResultRow} ShowResultRow */

const Log = new ContextualLog('PlexClientState');

/**
 * A class that contains two maps, mapping words of media titles
 * to the set of the media items that have that word. */
class SearchTokenMaps {
    /** @type {{[token: string]: Set<TopLevelData>}} */
    titles = {};
    /** @type {{[token: string]: Set<TopLevelData>}} */
    originalTitles = {};
}

/**
 * The Singleton client state.
 * @type {PlexClientStateManager}
 * @readonly */ // Externally readonly
let Instance;
/**
* A class that keeps track of the current UI state of the Marker Editor,
* including search results and the active show/season.
*/
class PlexClientStateManager {
    /** @type {number} */
    #activeSection = -1;
    /** @type {number} */
    #activeSectionType = SectionType.TV;
    /** @type {{[sectionId: number]: { items: ShowMap|MovieMap, searchTokens: SearchTokenMaps }}} */
    #sections = {};
    /** @type {ShowData[]|ClientMovieData[]} */
    activeSearchUnfiltered = [];
    /** @type {ShowResultRow} */
    #activeShow;
    /** @type {SeasonResultRow} */
    #activeSeason;
    /** Whether we're currently bulk adding/deleting/restoring markers. */
    #inBulkOperation = false;

    /** Create the singleton PlexClientState instance. */
    static CreateInstance() {
        if (Instance) {
            Log.error('We should only have a single PlexClientState instance!');
            return;
        }

        Instance = new PlexClientStateManager();

        // When the window resizes, let search results know so they can
        // adjust their UI accordingly.
        addWindowResizedListener(() => {
            if (Instance.#activeSeason) {
                Instance.#activeSeason.notifyWindowResize();
            }

            if (Instance.#activeSectionType === SectionType.Movie) {
                /** @type {MovieResultRow} */
                let searchRow;
                for (searchRow of PlexUI.getActiveSearchRows()) {
                    searchRow.updateMarkerBreakdown();
                }
            }
        });
    }

    constructor() {
        if (Instance) {
            throw new Error(`Don't create a new PlexClientState when the singleton already exists!`);
        }
    }

    /**
      * Set the currently active library.
      * @param {number} section The section to make active.
      * @param {number} sectionType The SectionType of the section. */
    async setSection(section, sectionType) {
        this.#activeSection = isNaN(section) ? -1 : section;
        this.#activeSectionType = sectionType;
        if (this.#activeSection !== -1) {
            await this.populateTopLevel();
        }
    }

    /** @returns The active Plex library section. */
    activeSection() { return this.#activeSection; }
    /** @returns The current section type. */
    activeSectionType() { return this.#activeSectionType; }

    /** @returns The list of shows that match the current search. */
    getUnfilteredSearchResults() {
        return this.activeSearchUnfiltered;
    }

    /**
      * Sets the show with the given metadataId as active.
      * @param {ShowResultRow} showResultRow
      * @returns {ShowData|false} The show with the given metadata id, or `false` if the show was not found. */
    setActiveShow(showResultRow) {
        if (this.#activeSectionType !== SectionType.TV) {
            Log.error(`Attempting to set the active show when we're not in a TV library.`);
            return;
        }

        // We could/should just use showResultRow.show() directly, but this verifies that we've been
        // given a show we expect.
        const metadataId = showResultRow.show().metadataId;
        if (!this.#sections[this.#activeSection].items[metadataId]) {
            return false;
        }

        if (this.#activeShow && this.#activeShow.show().metadataId !== metadataId) {
            this.clearActiveShow();
        }

        if (!this.#activeShow) {
            this.#activeShow = showResultRow;
        }

        return true;
    }

    /** @returns {ShowData} The active show, or null if no show is active. */
    getActiveShow() {
        if (this.#activeSectionType !== SectionType.TV) {
            Log.error(`Attempting to retrieve the active show when we're not in a TV library.`);
            return;
        }

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
        if (this.#activeSectionType !== SectionType.TV) {
            Log.error(`Attempting to set the active show when we're not in a TV library.`);
            return;
        }

        this.#activeShow.show().addSeason(season);
    }

    /**
      * Sets the season with the given metadata id as active.
      * @param {SeasonResultRow} seasonResultRow The metadata of the season.
      * @returns {SeasonData|false} The season with the given metadata id, or `false` if the season could not be found. */
    setActiveSeason(seasonResultRow) {
        if (this.#activeSectionType !== SectionType.TV) {
            Log.error(`Attempting to set the active show when we're not in a TV library.`);
            return;
        }

        const metadataId = seasonResultRow.season().metadataId;
        if (!this.#activeShow.show().getSeason(metadataId)) {
            return false;
        }

        if (this.#activeSeason && this.#activeSeason.season().metadataId !== metadataId) {
            this.clearActiveSeason();
        }

        if (!this.#activeSeason) {
            this.#activeSeason = seasonResultRow;
        }

        return true;
    }

    /** @returns {SeasonData} The currently active season, or `null` if now season is active. */
    getActiveSeason() {
        if (this.#activeSectionType !== SectionType.TV) {
            Log.error(`Attempting to retrieve the active season when we're not in a TV library.`);
            return;
        }

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
     * Whether we're in the middle of applying a bulk action/purge restoration. */
    inBulkOperation() {
        return this.#inBulkOperation;
    }

    /**
     * Set whether we're in the middle of a bulk operation.
     * @param {boolean} inBulkOperation */
    setInBulkOperation(inBulkOperation) {
        this.#inBulkOperation = inBulkOperation;
    }

    /**
     * Update any necessary season/episode lists based on a new filter. */
    onFilterApplied() {
        this.#activeShow?.onFilterApplied();
        this.#activeSeason?.onFilterApplied();
    }

    /**
     * Updates the marker breakdown cache after a marker is added/removed, and signals to the UI
     * to update things on their end.
     * @param {ClientEpisodeData} episode The episode to update.
     * @param {number} delta 1 if a marker was added, -1 if removed, 0 if purged markers changed. */
    updateBreakdownCache(episode, delta) {
        // Updating purged markers in-place is complicated. It attempts to update the UI in-place
        // to avoid refreshing the entire page after a bulk restoration, but the UI isn't really
        // designed to handle "out-of-band" changes (marker count changes outside of the currently)
        // active marker table(s)).
        // A better approach would probably be to properly calculate all the deltas client-side,
        // not relying on server-side queries that might result in the double-updates that
        // this hacked call to inBulkOperation prevents.
        if (delta !== 0 && !this.inBulkOperation()) {
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
        if (!ClientSettings.showExtendedMarkerInfo()) {
            return;
        }

        let response;
        try {
            response = await ServerCommands.getBreakdown(show.show().metadataId, seasons.length !== 0 /*includeSeasons*/);
        } catch (err) {
            Log.warn(`Failed to update ("${errorMessage(err)}"), marker stats will be incorrect.`);
            return;
        }

        for (const seasonRow of seasons) {
            const newBreakdown = response.seasonData[seasonRow.season().metadataId];
            if (!newBreakdown) {
                Log.warn(`updateNonActiveBreakdown: ` +
                    `Unable to find season breakdown data for ${seasonRow.season().metadataId}`);
                continue;
            }

            seasonRow.season().setBreakdownFromRaw(newBreakdown);
            seasonRow.updateMarkerBreakdown();
        }

        if (response.mainData) {
            show.show().setBreakdownFromRaw(response.mainData);
        } else {
            Log.warn(`PlexClientState::UpdateNonActiveBreakdown: Unable to find show breakdown data for ${show.show().metadataId}`);
        }

        show.updateMarkerBreakdown();
    }

    /**
     * Updates the breakdown for an item in the library that's currently
     * hidden from view (i.e. doesn't have an actual HTML row associated with it)
     *
     * TODO: Verify that this works with hidden items that do have HTML associated with them
     * @param {TopLevelData} topLevelItem */
    async #updateInactiveBreakdownCore(topLevelItem) {
        if (!ClientSettings.showExtendedMarkerInfo()) {
            return;
        }

        Log.verbose(`Updating breakdown for inactive item ${topLevelItem.metadataId}`);
        let response;
        try {
            response = await ServerCommands.getBreakdown(topLevelItem.metadataId, false /*includeSeasons*/);
        } catch (err) {
            Log.warn(`Failed to update ("${errorMessage(err)}'), marker stats may be incorrect.`);
            return;
        }

        topLevelItem.setBreakdownFromRaw(response.mainData);
    }

    /**
     * Internal core marker cache update method, called when
     * we actually have a delta to apply, which isn't always the case.
     * @param {ClientEpisodeData} episode The episode a marker was added to/removed from.
     * @param {number} delta 1 if a marker was added, -1 if removed. */
    #updateBreakdownCacheInternal(episode, delta) {
        const newKey = episode.markerTable().markerKey();
        const oldBucket = newKey - delta;
        for (const media of [this.#activeShow, this.#activeSeason]) {
            media.mediaItem().markerBreakdown().delta(oldBucket, delta);
        }
    }

    /**
      * Search for top-level items (movies/shows) that match the given query.
      * @param {string} query The show to search for. */
    search(query) {
        let regexp = undefined;
        // Not a perfect test, but close enough
        const match = /^\/(?<regex>.+)\/(?<modifiers>g?i?d?y?)$/.exec(query);
        if (match) {
            regexp = new RegExp(match.groups.regex, match.groups.modifiers);
        }

        // For movies, also try matching any year that's present.
        const queryYear = /\b(?<year>1[8-9]\d{2}|20\d{2})\b/.exec(query);
        let year = -1;
        if (queryYear) { year = parseInt(queryYear.groups.year); }

        // Ignore non-word characters to improve matching if there are spacing or quote mismatches.
        // Don't use \W though, since that also clears out unicode characters. Rather than import
        // some heavy package that's aware of unicode word characters, just clear out the most common
        // characters we want to ignore. I could probably figure out how to utilize Plex's spellfix
        // tables, but substring search on display, sort, and original titles should be good enough here.
        const fuzzyQuery = query.toLowerCase().replace(/[\s,'"_\-!?]/g, '');

        const section = this.#sections[this.#activeSection];
        /** @type {TopLevelData[]} */
        const itemList = Object.values(section.items);

        /** @type {Set<TopLevelData>} */
        const result = new Set();
        for (const item of itemList) {
            // If we have a regular expression, it takes precedence over our plain query string
            if (regexp) {
                if (regexp.test(item.title) || regexp.test(item.sortTitle) || regexp.test(item.originalTitle)
                    || (this.#activeSectionType === SectionType.Movie && regexp.test(queryYear))) {
                    result.add(item);
                }
            } else if (item.normalizedTitle.indexOf(fuzzyQuery) !== -1
                    || (item.normalizedSortTitle && item.normalizedSortTitle.indexOf(fuzzyQuery) !== -1)
                    || (item.normalizedOriginalTitle && item.normalizedOriginalTitle.indexOf(fuzzyQuery) !== -1)
                    || (this.#activeSectionType === SectionType.Movie && queryYear && item.year === year)) {
                result.add(item);
            }
        }

        // After the fuzzy search, look at individual tokens so something like 'lord rings' will still match
        // 'The Lord of the Rings'.
        for (const tokenMatch of this.#tokenSearch(query, section.searchTokens)) {
            result.add(tokenMatch);
        }

        // Sort the results. Title prefix matches are first, then sort title prefix matches,
        // then original title prefix matches, and alphabetical sort title after that.
        const resultArr = [...result.keys()].sort((/**@type {TopLevelData}*/a, /**@type {TopLevelData}*/b) => {
            // Only readjust text matches if we're using the default sort.
            if (fuzzyQuery.length === 0 || !FilterSettings.isDefaultSort()) {
                // Blank query should return all shows, and in that case we just care about sort title order
                return this.#defaultSort(a, b);
            }

            // Title prefix matches are first, then sort title, then original title.
            for (const key of ['normalizedTitle', 'normalizedSortTitle', 'normalizedOriginalTitle']) {
                const prefixA = a[key] && a[key].startsWith(fuzzyQuery);
                const prefixB = b[key] && b[key].startsWith(fuzzyQuery);
                if (prefixA !== prefixB) {
                    return prefixA ? -1 : 1;
                }
            }

            // If there aren't any prefix matches, go by alphabetical sort title.
            return this.#defaultSort(a, b);
        });

        this.activeSearchUnfiltered = resultArr;
    }

    /**
     * Do a token-based search, returning the set of media items that have
     * every token of the query string.
     * @param {string} query
     * @param {SearchTokenMaps} tokenMaps
     * @returns {Set<TopLevelData>} */
    #tokenSearch(query, tokenMaps) {
        // Assume longer words will have a smaller number of matches, which may improve performance.
        const tokens = [...this.#getSearchTokens(query)].sort((a, b) => b.length - a.length);
        if (tokens.length === 0) {
            return new Set();
        }

        /** @type {Set<TopLevelData>} */
        const finalResult = new Set();
        /** @type {Set<TopLevelData>} */
        let intersection;
        for (const tokenMap of [tokenMaps.titles, tokenMaps.originalTitles]) {
            intersection = tokenMap[tokens[0]];
            if (!intersection) {
                continue;
            }

            for (const token of tokens.slice(1)) {
                const next = tokenMap[token];
                if (!next) {
                    intersection.clear();
                    break;
                }

                intersection = new Set([...intersection].filter(t => next.has(t)));
                if (intersection.size === 0) {
                    break;
                }
            }

            if (intersection.size === 0) {
                continue;
            }

            for (const item of intersection) {
                finalResult.add(item);
            }
        }

        return finalResult;
    }

    /**
     * @param {Set<number>} activeIds
     * @param {PurgedSection} unpurged Map of markers purged markers that are no longer purged. */
    #updateInactiveBreakdown(activeIds, unpurged) {
        const promises = [];
        for (const [metadataId, item] of Object.entries(this.#sections[this.#activeSection].items)) {
            if (activeIds.has(+metadataId) || !unpurged.get(metadataId)) {
                continue;
            }

            Log.verbose(`Updating unshown movie row ${item.title} after purge update`);
            promises.push(this.#updateInactiveBreakdownCore(item));
        }

        return Promise.all(promises);
    }

    /**
     * Notify various parts of the app that purged markers have been restored/ignored.
     * @param {PurgedSection} unpurged Map of markers purged markers that are no longer purged.
     * @param {MarkerDataMap} newMarkers List of newly restored markers, if any.
     * @param {MarkerDataMap} deletedMarkers List of newly deleted markers, if any.
     * @param {MarkerDataMap} modifiedMarkers List of newly edited markers, if any. */
    async notifyPurgeChange(unpurged, newMarkers, deletedMarkers, modifiedMarkers) {
        const activeIds = new Set();

        // Duplicated a bit for movies, but it's simpler than a bunch of if/else
        if (unpurged instanceof PurgedMovieSection) {
            // Update any visible movies
            /** @type {MovieResultRow} */
            let searchRow;
            for (searchRow of PlexUI.getActiveSearchRows()) {
                const metadataId = searchRow.mediaItem().metadataId;
                activeIds.add(metadataId);
                const newItems = unpurged.get(metadataId);
                if (newItems) {
                    Log.verbose(`Updating search result movie row ${searchRow.movie().title} after purge update.`);
                    // Movies don't have the active/inactive/hierarchy issues, so we can get away with the single notification.
                    searchRow.notifyPurgeChange(newMarkers[metadataId], deletedMarkers[metadataId], modifiedMarkers[metadataId]);
                }
            }

            // We want to (a)wait here, since it may affect our current filter
            await this.#updateInactiveBreakdown(activeIds, unpurged);
            return;
        }

        if (!(unpurged instanceof PurgedTVSection)) {
            Log.warn(`We shouldn't be calling notifyPurgeChange with anything other than a PurgedMovieSection or PurgedTVSection`);
            return;
        }

        // Update non-active shows (as they're all cached for quick search results)
        /** @type {ShowResultRow} */
        let searchRow;
        for (searchRow of PlexUI.getActiveSearchRows()) {
            activeIds.add(searchRow.mediaItem().metadataId);
            if (unpurged.get(searchRow.mediaItem().metadataId)) {
                Log.verbose(`Updating search result show row ${searchRow.show().title} after purge update.`);
                this.updateNonActiveBreakdown(searchRow, []); // TODO: Await? Was this on purpose for perf, or did I just miss this?
            }
        }

        // We want to (a)wait here, since it may affect our current filter
        await this.#updateInactiveBreakdown(activeIds, unpurged);

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
        this.#activeSeason.notifyPurgeChange(seasonData, newMarkers, deletedMarkers, modifiedMarkers);
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
        const isShift = bulkActionType === BulkActionType.Shift;

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
    #updateBulkActionSearchRow(markers, bulkActionType) {
        // Shifts don't update marker counts (for now)
        if (bulkActionType === BulkActionType.Shift) {
            return;
        }

        const affectedShows = Object.keys(markers).length;
        Log.assert(affectedShows <= 1, `Bulk actions should target a single show, found ${affectedShows}`);
        for (const searchRow of PlexUI.getActiveSearchRows()) {
            if (markers[searchRow.show().metadataId]) {
                return this.updateNonActiveBreakdown(searchRow, []);
            }
        }
    }


    /**
     * Sorts two TopLevelData items based on the current sort settings.
     * @param {TopLevelData} a
     * @param {TopLevelData} b
     * @returns {number} */
    #defaultSort(a, b) {
        // This relies on the sort/filter dialog being gated on extendedMarkerStats
        const standardSort = FilterSettings.sortBy === SortConditions.Alphabetical && FilterSettings.sortOrder === SortOrder.Ascending;
        Log.assert(standardSort || ClientSettings.showExtendedMarkerInfo(),
            `We should only have custom sort settings if extended marker info is enabled.`);

        const titleFallback = (left, right) => {
            const leftTitle = left.normalizedSortTitle || left.normalizedTitle;
            const rightTitle = right.normalizedSortTitle || right.normalizedTitle;
            return leftTitle.localeCompare(rightTitle);
        };

        if (!ClientSettings.showExtendedMarkerInfo()) {
            return titleFallback(a, b);
        }

        const asc = SortOrder.asc(FilterSettings.sortOrder);
        switch (FilterSettings.sortBy) {
            default:
                Log.warn(`Unknown filter method ${FilterSettings.sortBy}, defaulting to alphabetical.`);
                // fallthrough
            case SortConditions.Alphabetical:
                return asc ? titleFallback(a, b) : titleFallback(b, a);
            case SortConditions.MarkerCount:
            case SortConditions.IntroMarkerCount:
            case SortConditions.CreditsMarkerCount:
            {
                const filterMethod = FilterSettings.sortBreakdownMethod();
                let aMarkers = a.markerBreakdown()[filterMethod]();
                let bMarkers = b.markerBreakdown()[filterMethod]();

                if (SortOrder.percentage(FilterSettings.sortOrder)) {
                    // Percentage-based filtering should only be available on tv libraries.
                    if (a instanceof ShowData && b instanceof ShowData) {
                        aMarkers /= a.episodeCount;
                        bMarkers /= b.episodeCount;
                    }

                    if (aMarkers === bMarkers) {
                        // In the case of an equal percentage, consider those
                        // with more overall markers as "higher"
                        aMarkers = a.markerBreakdown()[filterMethod]();
                        bMarkers = b.markerBreakdown()[filterMethod]();
                    }
                }

                if (aMarkers === bMarkers) {
                    return titleFallback(a, b);
                }

                return (aMarkers - bMarkers) * (asc ? 1 : -1);
            }
        }
    }

    /**
      * Kick off a request to get all items in the currently active session, if it's not already cached.
      * @returns {Promise<void>} */
    async populateTopLevel() {
        if (this.#sections[this.#activeSection]) {
            return;
        }

        try {
            const items = await ServerCommands.getSection(this.#activeSection);
            const allItems = {};
            this.#sections[this.#activeSection] = { items : allItems, searchTokens : new SearchTokenMaps() };
            const section = this.#sections[this.#activeSection];
            for (const movieOrShow of items) {
                let itemData;
                switch (this.#activeSectionType) {
                    case SectionType.Movie:
                        // TODO: investigate whether creating ClientMovieData
                        // directly causes any perf issues, or whether it's offset
                        // by not needing to do new ClientMovieData().setFromJson(...) within ResultRow
                        itemData = new ClientMovieData().setFromJson(movieOrShow);
                        break;
                    case SectionType.TV:
                        itemData = new ShowData().setFromJson(movieOrShow);
                        break;
                    default:
                        Log.error(this.#activeSectionType, `Encountered unknown section type when populating top-level data`);
                        break;
                }

                allItems[itemData.metadataId] = itemData;
                for (const token of this.#getSearchTokens(itemData.title)) {
                    (section.searchTokens.titles[token] ??= new Set()).add(itemData);
                }

                for (const token of this.#getSearchTokens(itemData.originalTitle)) {
                    (section.searchTokens.originalTitles[token] ??= new Set()).add(itemData);
                }
            }
        } catch (err) {
            errorResponseOverlay('Something went wrong retrieving shows from the selected library, please try again later.', err);
        }
    }

    /**
     * Breaks an item down into individual searchable tokens
     * @param {string} value */
    #getSearchTokens(value) {
        return new Set(value.toLowerCase().replace(/[,'"_\-!?:]/g, '').split(/[ .]/)
            .filter(str => !!str)
            .map(str => str.endsWith('s') ? str.substring(0, str.length - 1) : str)
        );
    }
}

export { PlexClientStateManager, Instance as PlexClientState };
