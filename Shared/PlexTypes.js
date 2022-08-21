/**
 * Contains classes that represent show, season, episode, and marker data.
 */

/**
 * @typedef {!import('../Server/MarkerCacheManager').MarkerBreakdownMap} MarkerBreakdownMap
 * @typedef {{id: number, name: string}} LibrarySection A library in the Plex database.
 * @typedef {{[metadataId: number]: ShowData}} ShowMap A map of show metadata ids to the show itself.
 * @typedef {{[metadataId: number]: SeasonData}} SeasonMap A map of season metadata ids to the season itself.
 * @typedef {{[metadataId: number]: EpisodeData}} EpisodeMap A map of episode metadata ids to the episode itself.
 * @typedef {{metadataId : number, markerBreakdown? : MarkerBreakdownMap}} PlexDataBaseData
 * @typedef {{start: number, end: number, index: number, id: number, episodeId: number,
 *            seasonId: number, showId: number, sectionId: number}} SerializedMarkerData
 * @typedef {{applied: boolean, conflict: boolean, allMarkers: SerializedMarkerData[], episodeData?: {[episodeId: number]: EpisodeData}}} ShiftResult
 *            The result of a call to shiftMarkers. `episodeData` is only valid if `applied` is `false`.
 */

/**
 * Retrieve an object to initialize the base PlexData of a derived class.
 * @param {object} item
 * @returns {PlexDataBaseData} */
function getBaseData(item) {
    if (!item) {
        return null;
    }

    return { metadataId : item.id, markerBreakdown : item.markerBreakdown };
}

/**
 * Base class for a representation of a Plex item, containing
 * the handful of shared functions/fields.
 */
class PlexData {
    /**
     * The Plex metadata id for this item.
     * @type {number} */
    metadataId;

    /**
     * The breakdown of how many episodes have X markers.
     * @type {MarkerBreakdownMap} */
    markerBreakdown;

    /**
     * @param {PlexDataBaseData} [data]
     */
    constructor(data)
    {
        if (data) {
            this.metadataId = data.metadataId;
            this.markerBreakdown = data.markerBreakdown;
        }
    }

    /**
     * Restores a serialized version of this class by importing its properties into this instance.
     * @param {Object} json The serialized instance of a PlexData derivative.
     * @returns itself. */
     setFromJson(json) {
        Object.assign(this, json);
        return this;
    }
}

/**
 * Information about a TV show in the Plex database.
 */
 class ShowData extends PlexData {
    // Note: It'd be nice for these fields (and those in the classes below) to be private
    // and accessed via getters only, but as these are stringified when sent from server
    // to client, JSON.stringify needs access to them.

    /**
     * The name of the show.
     * @type {string} */
    title;

    /**
     * The name of the show used for search purposes.
     * This is the lowercase name of the show with whitespace and punctuation removed.
     * @type {string} */
    searchTitle;

    /**
     * The sort title of the show if different from the title, otherwise an empty string.
     * The same transformations done to {@linkcode searchTitle} are done to `sortTitle`.
     * @type {string} */
    sortTitle;

    /**
     * The original title of the show, if any.
     * The same transformations done to {@linkcode searchTitle} are done to `originalTitle`.
     * @type {string} */
    originalTitle;

    /**
     * The number of seasons that exist in Plex for this show.
     * @type {number} */
    seasonCount;

    /**
     * The number of episodes that exist in Plex for this show.
     * @type {number} */
    episodeCount;

    /**
     * A map of season metadata ids to the season data
     * Only present client-side if this show is currently selected.
     * @type {SeasonMap} */
    #seasons = {};

    /**
     * Constructs ShowData based on the given database row, or an empty show if not provided.
     * @param {Object<string, any>} [show] */
    constructor(show) {
        super(getBaseData(show));
        if (!show) {
            return;
        }

        this.title = show.title;
        this.searchTitle = ShowData.#transformTitle(show.title);
        this.sortTitle = (show.title_sort && show.title.toLowerCase() != show.title_sort.toLowerCase()) ? ShowData.#transformTitle(show.title_sort) : '';
        this.originalTitle = show.original_title ? ShowData.#transformTitle(show.original_title) : '';
        this.seasonCount = show.season_count;
        this.episodeCount = show.episode_count;
    }

    /**
     * Add the given season to our SeasonMap.
     * @param {SeasonData} season
     */
    addSeason(season) {
        this.#seasons[season.metadataId] = season;
    }

    /**
     * Retrieve a season of this show with the given metadataId, or
     * `undefined` if it doesn't exist or it isn't cached.
     * @param {number} metadataId
     */
    getSeason(metadataId) {
        return this.#seasons[metadataId];
    }

    /** Clears out this show's cache of seasons. */
    clearSeasons() {
        this.#seasons = {};
    }

    static #transformTitle(title) {
        return title.toLowerCase().replace(/[\s,'"_\-!?]/g, '');
    }
}

/**
 * Information about a season of a TV show in the Plex database.
 */
class SeasonData extends PlexData {
    /**
     * The season index. 0 == specials, 1 == season 1, etc.
     * @type {number} */
    index;

    /**
     * The title of the season, if any.
     * @type {string} */
    title;

    /**
     * The number of episodes in the season.
     * @type {number} */
    episodeCount;

    /**
     * A map of episode metadata ids to the episode in this season.
     * Only present client-side if this season is currently selected.
     * @type {EpisodeMap} */
    #episodes = {};

    /**
     * Constructs SeasonData based on the given database row, or an empty season if not provided.
     * @param {Object<string, any>} [season] */
    constructor(season) {
        super(getBaseData(season));
        if (!season) {
            return;
        }

        this.index = season.index;
        this.title = season.title;
        this.episodeCount = season.episode_count;
    }

    /**
     * Add the given episode to this season's EpisodeMap.
     * @param {EpisodeData} episode
     */
    addEpisode(episode) {
        this.#episodes[episode.metadataId] = episode;
    }

    /**
     * Retrieve the episode of this season with the given metadata id,
     * or `undefined` if the episode doesn't exist or it isn't cached.
     * @param {number} metadataId
     */
    getEpisode(metadataId) {
        return this.#episodes[metadataId];
    }

    /** Clear out this season's episode cache. */
    clearEpisodes() {
        this.#episodes = {};
    }
}

/**
 * Information about an episode of a TV show in the Plex database.
 */
class EpisodeData extends PlexData {
    /**
     * The name of the episode.
     * @type {string} */
    title;

    /**
     * The episode number of its season.
     * @type {number} */
    index;

    /**
     * The name of the season this episode belongs to.
     * @type {string} */
    seasonName;

    /**
     * The season number that this episode belongs to.
     * @type {number} */
    seasonIndex;

    /**
     * The name of the show this episode is a part of.
     * @type {string} */
    showName;

    /**
     * The length of the show, in milliseconds.
     * @type {number} */
    duration;

    /**
     * Indicates whether we found a preview thumbnail file for this episode.
     * @type {boolean} */
    hasThumbnails = false;

    /**
     * Creates a new EpisodeData from the given episode, if provided.
     * @param {Object<string, any>} [episode] */
    constructor(episode) {
        super(getBaseData(episode));
        if (!episode) {
            return;
        }

        this.title = episode.title;
        this.index = episode.index;
        this.seasonName = episode.season,
        this.seasonIndex = episode.season_index;
        this.showName = episode.show;
        this.duration = episode.duration;
    }
}

/**
 * Information about a single marker for an episode of a TV show in the Plex database.
 */
class MarkerData extends PlexData {
    /**
     * The start of the marker, in milliseconds.
     * @type {number} */
    start;

    /**
     * The end of the marker, in milliseconds.
     * @type {number} */
    end;

    /**
     * The 0-based index of the marker.
     * @type {number} */
    index;

    /**
     * The date the marker was modified by the user.
     * @type {string} */
    modifiedDate;

    /**
     * Whether the user created this marker, or it's an edit of a marker Plex created.
     * @type {boolean} */
    createdByUser;

    /**
     * The date the marker was created.
     * @type {string} */
    createDate;

    /**
     * The Plex taggings id for this marker.
     * @type {number} */
    id;

    /**
     * The Plex metadata id of the episode this marker is attached to.
     * @type {number} */
    episodeId;

    /**
     * The Plex metadata id of the season this marker is attached to.
     * @type {number} */
    seasonId;

    /**
     * The Plex metadata id of the show this marker is attached to.
     * @type {number} */
    showId;

    /**
     * The section id of the episode this marker is attached to.
     * @type {number} */
    sectionId;

    /**
     * Creates a new MarkerData from the given marker, if provided.
     * @param {Object<string, any>} [marker] */
    constructor(marker) {
        super(null);
        if (!marker) {
            return;
        }

        this.start = marker.start;
        this.end = marker.end;
        this.index = marker.index;

        if (marker.modified_date) {
            let modified = marker.modified_date;
            // Check to see if it has a 'user created' flag.
            // For legacy purposes, also check whether the create date equals the modified date,
            // as previous versions of this application didn't include the 'manually created' marker.
            this.createdByUser = modified[modified.length - 1] == '*' || modified == marker.created_at;

            // Modified date is stored as a UTC timestamp, but JS date functions don't know without the 'Z'.
            this.modifiedDate = modified.substring(0, modified.length - 1);
            if (!this.modifiedDate.endsWith('Z')) {
                this.modifiedDate += 'Z';
            }
        } else {
            this.createdByUser = false;
            this.modifiedDate = '';
        }

        // Plex stores timestamps in local time for some reason, so only "convert" to UTC time
        // if the marker was created by the user.
        this.createDate = marker.created_at + ((this.createdByUser && !marker.created_at.endsWith('Z')) ? 'Z' : '');

        this.id = marker.id;
        this.episodeId = marker.episode_id;
        this.seasonId = marker.season_id;
        this.showId = marker.show_id;
        this.sectionId = marker.section_id;
    }
}

export { PlexData, ShowData, SeasonData, EpisodeData, MarkerData }
