import { Log } from '../Shared/ConsoleLog.js';
/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

/**
 * @typedef {{[markerId: number] : MarkerQueryResult}} MarkerMap
 * @typedef {{[metadataId: number] : MarkerSectionNode}} MarkerSectionMap
 * @typedef {{[metadataId: number] : MarkerShowNode}} MarkerShowMap
 * @typedef {{[metadataId: number] : MarkerSeasonNode}} MarkerSeasonMap
 * @typedef {{[metadataId: number] : MarkerEpisodeNode}} MarkerEpisodeMap
 * @typedef {number} MarkerId
 * @typedef {{
 *     show_id : number,
 *     season_id : number,
 *     episode_id : number,
 *     marker_id : number,
 *     tag_id : number,
 *     section_id : number}} MarkerQueryResult
 * @typedef {{ [markerCount: number] : number }} MarkerBreakdownMap
 */

/**
 * Manages marker statistics at an arbitrary level (section/series/season/episode)
 */
class MarkerBreakdown {
    /** @type {MarkerBreakdownMap} */
    #counts = { 0 : 0 };
    /** @type {MarkerNodeBase} */
    #parent;

    /** @param {MarkerNodeBase} parent */
    constructor(parent=null) {
        this.#parent = parent;
    }

    /** @returns {MarkerBreakdownMap} */
    data() {
        // Create a copy by stringifying/serializing to prevent underlying data from being overwritten.
        this.#minify();
        return JSON.parse(JSON.stringify(this.#counts));
    }

    /** Increase the marker count for an episode that previously had `oldCount` markers.
     * @param {number} oldCount */
    add(oldCount) {
        this.delta(oldCount, 1);
    }

    /** Decrease the marker count for an episode that previously had `oldCount` markers.
     * @param {number} oldCount */
    remove(oldCount) {
        this.delta(oldCount, -1);
    }

    /** Adjust the marker count for an episode that previously had `oldCount` markers
     * @param {number} oldCount
     * @param {number} delta 1 if a marker was added, -1 if one was deleted. */
    delta(oldCount, delta) {
        if (!this.#counts[oldCount + delta]) {
            this.#counts[oldCount + delta] = 0;
        }

        --this.#counts[oldCount];
        ++this.#counts[oldCount + delta];
        if (this.#parent) {
            this.#parent.markerBreakdown.delta(oldCount, delta);
        }
    }

    /**
     * Handles a new episode in the database.
     * Adds to the 'episodes with 0 markers' bucket for the episode and all parent categories. */
    initEpisode() {
        ++this.#counts[0];
        this.#parent?.markerBreakdown.initEpisode();
    }

    /** Removes any marker counts that have no episodes in `#counts` */
    #minify() {
        // Remove episode counts that have no episodes.
        const keys = Object.keys(this.#counts);
        for (const key of keys) {
            if (this.#counts[key] == 0) {
                delete this.#counts[key];
            }
        }
    }
}

/** Base class for a node in the {@linkcode MarkerCacheManager}'s hierarchical data. */
class MarkerNodeBase {
    markerBreakdown;
    /** @param {MarkerNodeBase} parent */
    constructor(parent=null) {
        this.markerBreakdown = new MarkerBreakdown(parent);
    }
}

/** Representation of a library section in the marker cache. */
class MarkerSectionNode extends MarkerNodeBase {
    /** @type {MarkerShowMap} */
    shows = {};
    constructor() {
        super(null);
    }
}

/** Representation of a TV show in the marker cache. */
class MarkerShowNode extends MarkerNodeBase {
    /** @type {MarkerSeasonMap} */
    seasons = {};

    /** @param {MarkerSectionNode} parent */
    constructor(parent) {
        super(parent);
    }
}

/** Representation of a season of a TV show in the marker cache. */
class MarkerSeasonNode extends MarkerNodeBase {
    /** @type {MarkerEpisodeMap} */
    episodes = {};

    /** @param {MarkerShowNode} parent */
    constructor(parent) {
        super(parent);
    }
}

/** Representation of an episode of a TV show in the marker cache. */
class MarkerEpisodeNode extends MarkerNodeBase {
    /** @type {MarkerId[]} */
    markers = [];

    /** @param {MarkerSeasonNode} parent */
    constructor(parent) {
        super(parent);
        this.markerBreakdown.initEpisode();
    }
}

/**
  * The MarkerCacheManager class compiles information about all markers present in the database.
  */
class MarkerCacheManager {
    /** All markers in the database.
     * @type {MarkerMap} */
    #allMarkers = {};

    /** All markers, arranged in a section > show > season > episode hierarchy
     * @type {MarkerSectionMap} */
    #markerHierarchy = {};

    /** The tag_id in the Plex database that corresponds to intro markers. */
    #tagId;

    /** The connection to the Plex database. */
    #database;

    /**
     * Instantiate a MarkerCache.
     * @param {SqliteDatabase} database The connection to the Plex database.
     * @param {number} tagId The tag_id in the Plex database that corresponds to intro markers. */
    constructor(database, tagId) {
        this.#database = database;
        this.#tagId = tagId;
    }

    /**
     * Build the marker cache for the entire Plex server.
     * @param {Function} successFunction The function to invoke if the cache was built successfully.
     * @param {Function} failureFunction The function to invoke if the cache failed to build. */
    buildCache(successFunction, failureFunction) {
        Log.info('Gathering markers...');
        this.#database.all(MarkerCacheManager.#markerQuery, [], (err, rows) => {
            if (err) {
                failureFunction(err.message);
                return;
            }

            let markerCount = 0;
            for (const row of rows) {
                this.#addMarkerData(row);
                if (row.tag_id != this.#tagId) {
                    continue;
                }

                ++markerCount;
            }

            Log.info(`Cached ${markerCount} markers, starting server...`);
            successFunction();
        });
    }

    /**
     * Remove the marker with the given id from the cache.
     * @param {number} markerId The marker id of the marker to delete from the cache. */
    removeMarkerFromCache(markerId) {
        const markerData = this.#allMarkers[markerId];
        if (!markerData) {
            Log.warn(`The marker we're attempting to delete isn't in our cache. That's not right!`);
            return;
        }

        delete this.#allMarkers[markerId];
        const episode = this.#drillDown(markerData);
        episode.markerBreakdown.remove(episode.markers.length);
        episode.markers = episode.markers.filter(marker => marker != markerId);
    }

    /**
     * Add a new marker to the cache with the given marker id.
     * Assumes the marker has already been added to the database.
     * @param {number} metadataId
     * @param {number} markerId */
    addMarkerToCache(metadataId, markerId) {
        this.#database.get(MarkerCacheManager.#newMarkerQuery, [metadataId], (err, row) => {
            if (err) {
                Log.error(`Unable to get the episode associated with this marker. Reinitializing cache to ensure things stay in sync.`);
                this.#markerHierarchy = {};
                this.#allMarkers = {};
                this.buildCache(() => {}, () => {}); // Is this safe to do? Probably not, but we _really_ shouldn't be hitting it anyway
                return;
            }

            row.marker_id = markerId;
            row.tag_id = this.#tagId;
            this.#addMarkerData(row);
        });
    }

    /**
     * Retrieve {@link MarkerBreakdown} statistics for the given library section.
     * @param {number} sectionId The library section to iterate over.
     * @returns {MarkerBreakdown} */
    getSectionOverview(sectionId) {
        try { // This _really_ shouldn't fail, but ¯\_(ツ)_/¯
            return this.#markerHierarchy[sectionId].markerBreakdown.data();
        } catch (ex) {
            Log.error(ex.message,'Something went wrong when gathering the section overview');
            Log.error('Attempting to fall back to markerBreakdownCache data.');
            return false;
        }
    }

    getShowStats(metadataId) {
        let show = this.#showFromId(metadataId);
        if (!show) {
            Log.error(`Didn't find the right section for show:${metadataId}. Marker breakdown will not be available`);
            return null;
        }

        return show.markerBreakdown.data();
    }

    getSeasonStats(showId, seasonId) {
        // Like getShowStats, just the show's metadataId is okay.
        let show = this.#showFromId(showId);
        if (!show) {
            Log.error(`Didn't find the right section for show:${showId}. Marker breakdown will not be available`);
            return null;
        }

        return show.seasons[seasonId]?.markerBreakdown.data();
    }

    #showFromId(showId) {
        // Just a show metadataId is okay. Someone would need thousands of libraries before
        // the perf hit of looking for the right section was noticeable.
        for (const section of Object.values(this.#markerHierarchy)) {
            if (section.shows[showId]) {
                return section.shows[showId];
            }
        }

        return null;
    }

    /**
     * Return the episode in the season associated with the given marker.
     * @param {MarkerQueryResult} markerData */
    #drillDown(markerData) {
        return this.#markerHierarchy[markerData.section_id]
            .shows[markerData.show_id]
            .seasons[markerData.season_id]
            .episodes[markerData.episode_id];
    }

    /**
     * Add the given row to the marker cache.
     * Note that the row doesn't necessarily have a marker associated with it.
     * If it doesn't, we still want to create an entry for the episode the row represents.
     * @param {MarkerQueryResult} row The row to add to our cache. */
    #addMarkerData(row) {
        const isMarker = row.tag_id == this.#tagId;
        if (!this.#markerHierarchy[row.section_id]) {
            this.#markerHierarchy[row.section_id] = new MarkerSectionNode();
        }

        let thisSection = this.#markerHierarchy[row.section_id];
        if (!thisSection.shows[row.show_id]) {
            thisSection.shows[row.show_id] = new MarkerShowNode(thisSection);
        }

        let show = thisSection.shows[row.show_id];
        if (!show.seasons[row.season_id]) {
            show.seasons[row.season_id] = new MarkerSeasonNode(show);
        }

        let season = show.seasons[row.season_id];
        if (!season.episodes[row.episode_id]) {
            season.episodes[row.episode_id] = new MarkerEpisodeNode(season);
        }

        let episode = season.episodes[row.episode_id];
        if (isMarker) {
            episode.markerBreakdown.add(episode.markers.length);
            episode.markers.push(row.marker_id);

            if (row.marker_id in this.#allMarkers) {
                Log.warn(`Found marker id ${row.marker_id} multiple times, that's not right!`);
            }

            this.#allMarkers[row.marker_id] = row;
        }
    }

    /**
     * Query to retrieve all episodes in the database along with their associated tags (if any).
     * One thing to note is that we join _all_ tags for an episode, not just markers. While
     * seemingly excessive, it's significantly faster than doing an outer join on a temporary
     * taggings table that's been filtered to only include markers. */
    static #markerQuery = `
SELECT show.id AS show_id,
    season.id AS season_id,
    episode.id AS episode_id,
    marker.id AS marker_id,
    marker.tag_id AS tag_id,
    episode.library_section_id AS section_id
FROM metadata_items episode
    INNER JOIN metadata_items season ON episode.parent_id=season.id
    INNER JOIN metadata_items show ON season.parent_id=show.id
    LEFT JOIN taggings marker ON episode.id=marker.metadata_item_id
WHERE episode.metadata_type=4
ORDER BY episode.id ASC;`;

    /** Query to retrieve the data required for a {@linkcode MarkerQueryResult} for an added marker */
    static #newMarkerQuery = `
SELECT show.id AS show_id,
    season.id AS season_id,
    episode.id AS episode_id,
    episode.library_section_id AS section_id
FROM metadata_items episode
    INNER JOIN metadata_items season ON episode.parent_id=season.id
    INNER JOIN metadata_items show ON season.parent_id=show.id
WHERE episode.id=?;`;
}

export default MarkerCacheManager;
