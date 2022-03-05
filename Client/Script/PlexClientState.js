
/**
* A class that handles that keeps track of the currently UI state of Plex Intro Editor,
* including search results and the active show/season.
*/
class PlexClientState
{
    /** @type {number} */
    activeSection = -1;
    /** @type {Object<number, ShowMap>} */
    shows = {};
    /** @type {ShowData[]} */
    #activeSearch = [];
    /** @type {ShowData} */
    #activeShow;
    /** @type {SeasonData} */
    #activeSeason;

    constructor() {}

    /**
      * Set the currently active library.
      * @param {number} section The section to make active.
      */
    async setSection(section) {
        this.activeSection = isNaN(section) ? -1 : section;
        if (this.activeSection != -1) {
            await this._populate_shows();
        }
    }

    /**
      * @returns The list of shows that match the current search.
      */
    getSearchResults() {
        return this.#activeSearch;
    }

    /**
      * Sets the show with the given metadataId as active.
      * @param {number} metadataId
      * @returns {ShowData|false} The show with the given metadata id, or `false` if the show was not found.
      */
    setActiveShow(metadataId) {
        if (!this.shows[this.activeSection][metadataId]) {
            return false;
        }

        if (this.#activeShow && this.#activeShow.metadataId != metadataId) {
            this.clearActiveShow();
        } else if (!this.#activeShow) {
            this.#activeShow = this.shows[this.activeSection][metadataId];
        }

        return this.#activeShow;
    }

    /**
      * @returns {ShowData} The active show, or null if no show is active.
      */
    getActiveShow() {
        return this.#activeShow;
    }

    /** Clears out the currently active show and other dependent data (i.e. {@linkcode #activeSeason}). */
    clearActiveShow() {
        // It's probably fine to keep the season/episode data cached,
        // but it could theoretically be a memory hog if someone navigates
        // through their entire library with hundreds/thousands of seasons.
        if (this.#activeShow) {
            this.clearActiveSeason();
            this.#activeShow.clearSeasons();
            this.#activeShow = null;
        }
    }

    /** Clears out the currently active season and its episode data. */
    clearActiveSeason() {
        if (this.#activeSeason) {
            this.#activeSeason.clearEpisodes();
            this.#activeSeason = null;
        }
    }

    /**
      * Adds the given season to the current show.
      * @param {SeasonData} season
      */
    addSeason(season) {
        this.#activeShow.addSeason(season);
    }

    /**
      * Sets the season with the given metadata id as active.
      * @param {number} metadataId The metadata of the season.
      * @returns {SeasonData|false} The season with the given metadata id, or `false` if the season could not be found.
      */
    setActiveSeason(metadataId) {
        let season = this.#activeShow.getSeason(metadataId);
        if (!season) {
            return false;
        }

        if (this.#activeSeason && this.#activeSeason.metadataId != metadataId) {
            this.clearActiveSeason();
        } else if (!this.#activeSeason) {
            this.#activeSeason = season;
        }

        return this.#activeSeason;
    }

    /**
      * @returns {SeasonData} The currently active season, or `null` if now season is active.
      */
    getActiveSeason() {
        return this.#activeSeason;
    }

    /**
      * Add the given episode to the active season's episode cache.
      * @param {EpisodeData} episode
      */
    addEpisode(episode) {
        this.#activeSeason.addEpisode(episode);
    }

    /**
      * Retrieve an episode from the active season's episode cache.
      * @param {number} metadataId
      */
    getEpisode(metadataId) {
        return this.#activeSeason.getEpisode(metadataId);
    }

    /**
      * Search for shows that match the given query.
      * @param {string} query The show to search for.
      * @param {Function<Object>} successFunc The function to invoke after search the search results have been compiled.
      */
    search(query, successFunc)
    {
        // Ignore non-word characters to improve matching if there are spacing or quote mismatches. Don't use \W though, since that also clears out unicode characters.
        // Rather than import some heavy package that's aware of unicode word characters, just clear out the most common characters we want to ignore.
        // I could probably figure out how to utilize Plex's spellfix tables, but substring search on display, sort, and original titles should be good enough here.
        query = query.toLowerCase().replace(/[\s,'"_\-!?]/g, '');

        const showList = Object.values(this.shows[this.activeSection]);

        let result = [];
        for (const show of showList) {
            if (show.searchTitle.indexOf(query) != -1
                || (show.sortTitle && show.sortTitle.indexOf(query) != -1)
                || (show.originalTitle && show.originalTitle.indexOf(query) != -1)) {
                result.push(show);
            }
        }

        const defaultSort = (a, b) => {
            const aTitle = a.sortTitle || a.searchTitle;
            const bTitle = b.sortTitle || b.searchTitle;
            return aTitle.localeCompare(bTitle);
        }

        // Sort the results. Title prefix matches are first, then sort title prefix matches, the original title prefix matches, and alphabetical sort title after that.
        result.sort((a, b) => {
            if (query.length == 0) {
                // Blank query should return all shows, and in that case we just care about sort title order
                return defaultSort(a, b);
            }

            const prefixTitleA = a.searchTitle.startsWith(query);
            const prefixTitleB = b.searchTitle.startsWith(query);
            if (prefixTitleA != prefixTitleB) {
                return prefixTitleA ? -1 : 1;
            }

            const prefixSortA = a.sortTitle && a.sortTitle.startsWith(query);
            const prefixSortB = b.sortTitle && b.sortTitle.startsWith(query);
            if (prefixSortA != prefixSortB) {
                return prefixSortA ? -1 : 1;
            }

            const prefixOrigA = a.originalTitle && a.originalTitle.startsWith(query);
            const prefixOrigB = b.originalTitle && b.originalTitle.startsWith(query);
            if (prefixOrigA != prefixOrigB) {
                return prefixOrigA ? -1 : 1;
            }

            return defaultSort(a, b);
        });

        this.#activeSearch = result;
        successFunc();
    }

    /**
      * Kick off a request to get all shows in the currently active session, if it's not already cached.
      * @returns {Promise<void>}
      */
    async _populate_shows() {
        if (this.shows[this.activeSection]) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            jsonRequest(
                'get_section',
                { id : PlexState.activeSection },
                (res) => {
                    let allShows = {};
                    PlexState.shows[PlexState.activeSection] = allShows;
                    for (const show of res) {
                        let showData = new ShowData().setFromJson(show);
                        allShows[showData.metadataId] = showData;
                    }
                    resolve();
                },
                (res) => {
                    Overlay.show(`Something went wrong retrieving shows from the selected library, please try again later.<br><br>Server message:<br>${res.Error}`);
                });
        });
    }
}

// Hack for VSCode intellisense.
if (typeof __dontEverDefineThis !== 'undefined') {
    const { jsonRequest } = require('./Common');
    const { ShowData, SeasonData, EpisodeData } = require("../../Shared/PlexTypes");
    module.exports = { PlexClientState };
}
