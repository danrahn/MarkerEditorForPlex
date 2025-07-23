/**
 * Contains classes that represent show, season, episode, and marker data.
 */

import MarkerBreakdown from './MarkerBreakdown.js';
import { MarkerType } from './MarkerType.js';

/**
 * @typedef {!import('./MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap
 * @typedef {{id: number, type: number, name: string}} LibrarySection A library in the Plex database.
 * @typedef {{[metadataId: number]: MovieData}} MovieMap A map of movie metadata ids to the movie itself.
 * @typedef {{[metadataId: number]: ShowData}} ShowMap A map of show metadata ids to the show itself.
 * @typedef {{[metadataId: number]: SeasonData}} SeasonMap A map of season metadata ids to the season itself.
 * @typedef {{[metadataId: number]: EpisodeData}} EpisodeMap A map of episode metadata ids to the episode itself.
 * @typedef {{metadataId : number, markerBreakdown? : MarkerBreakdownMap}} PlexDataBaseData
 * @typedef {{start: number, end: number, index: number, id: number, parentId: number,
 *            seasonId: number?, showId: number?, sectionId: number, markerType: string, isFinal: boolean}} SerializedMarkerData
 *
 * @typedef {{metadataId: number, markerBreakdown: MarkerBreakdownMap, title: string, normalizedTitle: string,
 *            sortTitle: string, normalizedSortTitle: string, originalTitle: string, normalizedOriginalTitle: string,
 *            year: number, hasThumbnails: boolean? }} SerializedMovieData
 *
 * @typedef {{metadataId: number, markerBreakdown: MarkerBreakdownMap, title: string, normalizedTitle: string,
 *            sortTitle: string, normalizedSortTitle: string, originalTitle: string, normalizedOriginalTitle: string,
 *            seasonCount: number, episodeCount: number }} SerializedShowData
 *
 * @typedef {{metadataId: number, markerBreakdown: MarkerBreakdownMap, index: number,
 *            title: string, episodeCount: number }} SerializedSeasonData
 *
 * @typedef {{metadataId: number, markerBreakdown: MarkerBreakdownMap, title: string, index: number,
 *            seasonName: string, seasonIndex: number, showName: string, duration: number}} SerializedEpisodeData
 *
 * @typedef {SerializedEpisodeData & { markers: SerializedMarkerData[] }} SerializedEpisodeAndMarkerData
 *
 * @typedef {{applied: boolean, conflict: boolean, overflow: boolean, allMarkers: SerializedMarkerData[],
 *            episodeData?: {[episodeId: number]: EpisodeData}}} ShiftResult
 *            The result of a call to shiftMarkers. `episodeData` is only valid if `applied` is `false`.
 *
 * @typedef {{ [seasonId: number] : { [episodeId: number] : { [markerId: number] : MarkerAction } } }} PurgeShow
 * @typedef {{ [showId: number]: PurgeShow }} PurgeShowSection
 * @typedef {{ [movieId: number]: { [markerId: number] : MarkerAction } }} PurgeMovieSection
 * @typedef {PurgeShowSection|PurgeMovieSection} PurgeSection
 *
 * @typedef {{
 *      episodeData: EpisodeData,
 *      existingMarkers: MarkerData[],
 *      changedMarker: MarkerData?,
 *      isAdd: boolean?,
 *      deletedMarkers: MarkerData[]?
 * }} BulkAddResultEntry
 *
 * @typedef {{
 *      applied: boolean,
 *      notAppliedReason: string?,
 *      episodeMap: {[episodeId: number]: BulkAddResultEntry},
 *      ignoredEpisodes: number[]?
 * }} BulkAddResult
 *
 * @typedef {{
 *      episodeData: SerializedEpisodeData,
 *      existingMarkers: SerializedMarkerData[],
 *      changedMarker: SerializedMarkerData?,
 *      isAdd: boolean?,
 *      deletedMarkers: SerializedMarkerData[]?
 * }} SerializedBulkAddResultEntry
 *
 * @typedef {{
 *      applied: boolean,
 *      conflict: boolean?,
 *      episodeMap: {[episodeId: number]: SerializedBulkAddResultEntry},
 *      ignoredEpisodes: number[]?
 * }} SerializedBulkAddResult
 *
 * @typedef {{
 *      markers: SerializedMarkerData[],
 *      deletedMarkers: SerializedMarkerData[],
 *      episodeData?: { [episodeId: number]: SerializedEpisodeData }
 * }} BulkDeleteResult
 *
 * @typedef {{[metadataId: number]: MarkerData[] }} MarkerDataMap
 * @typedef {{[metadataId: number]: SerializedMarkerData[] }} SerializedMarkerDataMap
 *
 * @typedef {{ name : string, index : number, start : number, end : number }} ChapterData
 * @typedef {{ [metadataId: number]: ChapterData[] }} ChapterMap
 * @typedef {{ [episodeId: number]: { start : number, end : number } }} CustomBulkAddMap
 *
 * @typedef {{ [markerId: number]: { start: number|null, end: number|null }}} OldMarkerTimings
 */
/**
 * @typedef {Object} BulkRestoreResponse
 * @property {SerializedMarkerDataMap} newMarkers Markers that were added as the result of a bulk restore.
 * @property {SerializedMarkerDataMap} deletedMarkers Existing markers that were deleted during the restoration.
 *                                     Will be empty if MarkerConflictResolution was not Overwrite.
 * @property {SerializedMarkerDataMap} modifiedMarkers Existing markers that were adjusted instead of creating a new marker.
 *                                     Will be empty if MarkerConflictResolution was not Merge.
 * @property {number} ignoredMarkers Number of markers we decided to ignore, either because an identical marker already existed,
 *                    or because it overlapped with an existing marker and the MarkerConflictResolution was Merge or Ignore.
 */
/**
 * A full row in the Actions table
 * @typedef {{id: number, op: MarkerOp, marker_id: number, marker_type: string, final: number, parent_id: number,
 *            season_id: number, show_id: number, section_id: number, start: number, end: number, old_start: number?,
 *            old_end: number?, modified_at: number|null, created_at: number, recorded_at: number, extra_data: string,
 *            section_uuid: string, restores_id: number?, restored_id: number?, user_created: number, parent_guid: string?,
 *            readded: boolean?, readded_id: number?, episodeData: EpisodeData?, movieData: MovieData? }} MarkerAction
 */

/**
 * Query information necessary to create a marker table.
 * @typedef {{
 *      markers : SerializedMarkerData[],
 *      hasThumbnails: boolean,
 *      chapters: ChapterData[] }} ExtendedQueryInfo
 */

/**
 * Retrieve an object to initialize the base PlexData of a derived class.
 * @param {object} item
 * @returns {PlexDataBaseData} */
function getBaseData(item) {
    if (!item) {
        return null;
    }

    // Sometimes we get called with "raw" data, sometimes with "serialized" data, so find the right existing id.
    return { metadataId : item.id || item.metadataId, markerBreakdown : item.markerBreakdown };
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
     * The breakdown of how many episodes have X markers, as a raw dictionary of values.
     * @type {MarkerBreakdownMap|undefined} */
    rawMarkerBreakdown;

    /**
     * The "real" marker breakdown class based on the raw marker breakdown.
     * Should only be used client-side.
     * @type {MarkerBreakdown|undefined} */
    #markerBreakdown;

    /**
     * @param {PlexDataBaseData|null} data
     */
    constructor(data) {
        if (data) {
            this.metadataId = data.metadataId;
            this.rawMarkerBreakdown = data.markerBreakdown;
        }
    }

    /**
     * Restores a serialized version of this class by importing its properties into this instance.
     * @param {Object} json The serialized instance of a PlexData derivative.
     * @returns itself. */
    setFromJson(json) {
        Object.assign(this, json);
        if (this.rawMarkerBreakdown) {
            this.#markerBreakdown = new MarkerBreakdown().initFromRawBreakdown(this.rawMarkerBreakdown);
            // We don't want to reference rawMarkerBreakdown after this.
            this.rawMarkerBreakdown = undefined;
        }

        return this;
    }

    /**
     * @param {MarkerBreakdownMap} */
    setBreakdownFromRaw(rawBreakdown) {
        this.#markerBreakdown = new MarkerBreakdown().initFromRawBreakdown(rawBreakdown);
    }

    /**
     * Overwrites the current marker breakdown with the new one.
     * @param {MarkerBreakdown} newBreakdown */
    setBreakdown(newBreakdown) {
        this.#markerBreakdown = newBreakdown;
    }

    /** @returns {MarkerBreakdown|undefined} */
    markerBreakdown() { return this.#markerBreakdown; }
}

/**
 * Intermediate class that holds the fields common among top-level items, i.e. movies and TV shows
 */
class TopLevelData extends PlexData {

    /**
     * The name of the item.
     * @type {string} */
    title;

    /**
     * The name of the item used for search purposes.
     * This is the lowercase name of the item with whitespace and punctuation removed.
     * @type {string} */
    normalizedTitle;

    /**
     * The original sort title if different from the title, otherwise an empty string.
     * @type {string} */
    sortTitle;

    /**
     * The sort title above, but with the same transformations done to {@linkcode normalizedTitle}.
     * @type {string} */
    normalizedSortTitle;

    /**
     * The "original" original title, if any.
     * @type {string} */
    originalTitle;

    /**
     * The original title above, but with the same transformations done to {@linkcode normalizedTitle}.
     * @type {string} */
    normalizedOriginalTitle;

    constructor(mediaItem) {
        super(getBaseData(mediaItem));
        if (!mediaItem) {
            return;
        }

        this.title = mediaItem.title;
        this.normalizedTitle = TopLevelData.#transformTitle(mediaItem.title);
        this.sortTitle = mediaItem.title_sort && mediaItem.title_sort !== this.title ? mediaItem.title_sort : '';
        this.normalizedSortTitle =
            (mediaItem.title_sort && mediaItem.title.toLowerCase() !== mediaItem.title_sort.toLowerCase()) ?
                TopLevelData.#transformTitle(mediaItem.title_sort) : '';
        this.originalTitle = mediaItem.original_title || '';
        this.normalizedOriginalTitle = mediaItem.original_title ? TopLevelData.#transformTitle(mediaItem.original_title) : '';
    }

    /**
     * Transforms a show title to the search-friendly title.
     * @param {string} title */
    static #transformTitle(title) {
        return title.toLowerCase().replace(/[\s,'"_\-!?]/g, '');
    }
}

/**
 * Information about a TV show in the Plex database.
 */
class ShowData extends TopLevelData {
    // Note: It'd be nice for these fields (and those in the classes below) to be private
    // and accessed via getters only, but as these are stringified when sent from server
    // to client, JSON.stringify needs access to them.

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
     * @param {Record<string, any>} [show] */
    constructor(show) {
        super(show);
        if (!show) {
            return;
        }

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
     * @param {Record<string, any>} [season] */
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
        this.seasonName = episode.season;
        this.seasonIndex = episode.season_index;
        this.showName = episode.show;
        this.duration = episode.duration;
    }
}

/**
 * Information about a single movie in the Plex database.
 */
class MovieData extends TopLevelData {

    /**
     * The year the movie was released.
     * @type {number} */
    year;

    /**
     * The edition title, if any (e.g. 'Extended', 'Theatrical', etc)
     * @type {string} */
    edition;

    /**
     * The length of the movie, in milliseconds.
     * @type {number} */
    duration;

    /**
     * Indicates whether we found a preview thumbnail file for this movie.
     * @type {boolean?} */
    hasThumbnails = undefined;

    /**
     * This should only be used when extendedMarkerStats are disabled, since we won't
     * initially have any marker data, but as soon as a row is clicked, we load it
     * in and can display it.
     * @type {number} */
    realMarkerCount = -1;

    /**
     * @param {RawMovieData} movie */
    constructor(movie) {
        super(movie);
        if (!movie) {
            return;
        }

        this.year = movie.year;
        this.duration = movie.duration;
        this.edition = movie.edition;
        this.realMarkerCount = -1;
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
     * The date the marker was modified by the user (epoch).
     * @type {number} */
    modifiedDate;

    /**
     * Whether the user created this marker, or it's an edit of a marker Plex created.
     * @type {boolean} */
    createdByUser;

    /**
     * The date the marker was created (epoch).
     * @type {number} */
    createDate;

    /**
     * The Plex taggings id for this marker.
     * @type {number} */
    id;

    /**
     * The Plex metadata id of the episode this marker is attached to.
     * @type {number} */
    parentId;

    /**
     * The Plex metadata id of the season this marker is attached to.
     * -1 implies a movie marker.
     * @type {number} */
    seasonId;

    /**
     * The Plex metadata id of the show this marker is attached to.
     * -1 implies a movie marker.
     * @type {number} */
    showId;

    /**
     * The section id of the episode this marker is attached to.
     * @type {number} */
    sectionId;

    /**
     * The guid of the episode this marker is attached to.
     * @type {string} */
    parentGuid;

    /**
     * The type of marker this represents.
     * @type {[keyof MarkerType]} */
    markerType;

    /**
     * Whether this marker extends to the end of the movie/episode
     * Only applies if type == MarkerType.Credits
     * @type {boolean} */
    isFinal;

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

        // For legacy purposes, also check whether the create date equals the modified date,
        // as previous versions of this application didn't include the 'manually created' marker.
        this.createdByUser = marker.user_created || marker.modified_date === marker.created_at;

        // Conversely, ignore the modified date if it's equal to the create date
        this.modifiedDate = marker.modified_date === marker.created_at ? null : marker.modified_date;

        this.createDate = marker.created_at;

        this.id = marker.id;
        this.sectionId = marker.section_id;
        this.parentGuid = marker.parent_guid;
        this.markerType = marker.marker_type;

        // true && 1/0 == 1/0, but we want this to be a boolean, so !!marker.final
        this.isFinal = this.markerType === MarkerType.Credits && !!marker.final;

        // TODO: Find a better way to distinguish between episode versus movie marker
        //       Potentially a base marker class, with episode/season/show and movie tacked on.
        this.parentId = marker.parent_id;
        this.seasonId = marker.season_id || -1;
        this.showId = marker.show_id || -1;
    }
}

/**
 * Encapsulates both the main episode data and the markers associated with it. */
class EpisodeAndMarkerData extends EpisodeData {
    /**
     * The markers associated with this episode.
     * @type {MarkerData[]} */
    markers = [];

    constructor(episode, markers=[]) {
        super(episode);
        for (const marker of markers) {
            this.markers.push(new MarkerData(marker));
        }
    }
}

/**
 * Behavior of bulk marker actions that might conflict with existing markers.
 * TODO: Share with MarkerConflictResolution, potentially ShiftApplyType as well. */
const BulkMarkerResolveType = {
    /** @readonly Don't apply anything, just check existing markers and whether there are any conflicts */
    DryRun : 0,
    /** @readonly Try to apply, but fail the entire operation if any markers overlap with existing ones. */
    Fail   : 1,
    /** @readonly Force apply, merging any overlapping markers into a single longer marker. */
    Merge  : 2,
    /** @readonly Apply if there aren't any overlapping markers, skipping episodes that do have overlap. */
    Ignore : 3,
    /** @readonly Delete any existing markers that conflict with the marker we're adding/adjusting. */
    Overwrite : 4,
    /** @readonly Sentinel value indicating the last resolve type. */
    Max : 4,
};

/**
 * Supported library types
 * @enum */
const SectionType = {
    /** @readonly */
    Movie : 1,
    /** @readonly */
    TV : 2,
};

/**
 * Ways to resolve restoring purged markers.
 * @enum */
const MarkerConflictResolution = {
    /** If any existing markers overlap the restored marker, delete the existing marker. */
    Overwrite : 1,
    /** Merge overlapping markers into a single marker that spans the entire length of both. */
    Merge : 2,
    /** Keep the existing marker and mark the purged marker as ignored. */
    Ignore : 3,
};

export {
    BulkMarkerResolveType,
    PlexData,
    TopLevelData,
    ShowData,
    SeasonData,
    EpisodeData,
    EpisodeAndMarkerData,
    MovieData,
    MarkerConflictResolution,
    MarkerData,
    SectionType };
