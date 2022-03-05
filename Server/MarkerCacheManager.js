const { Database } = require('sqlite3');
const { ConsoleLog, Log } = require('../Shared/ConsoleLog');

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
 * @typedef {{ [markerCount: number] : [episodeCount: number] }} MarkerBreakdown
 */

/** Representation of a library section in the marker cache. */
class MarkerSectionNode {
    /** @type {MarkerShowMap} */
    shows = {};
    markerCount = 0;
}

/** Representation of a TV show in the marker cache. */
class MarkerShowNode {
    /** @type {MarkerSeasonMap} */
    seasons = {};
    markerCount = 0;
}

/** Representation of a season of a TV show in the marker cache. */
class MarkerSeasonNode {
    /** @type {MarkerEpisodeMap} */
    episodes = {};
    markerCount = 0;
}

/** Representation of an episode of a TV show in the marker cache. */
class MarkerEpisodeNode {
    /** @type {MarkerId[]} */
    markers = [];
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

    /** The logging instance for this application. */
    #log;

    /**
     * Instantiate a MarkerCache.
     * @param {Database} database The connection to the Plex database.
     * @param {number} tagId The tag_id in the Plex database that corresponds to intro markers.
     * @param {ConsoleLog} log The logging instance for this application. */
    constructor(database, tagId, log) {
        this.#database = database;
        this.#tagId = tagId;
        this.#log = log;
    }

    /**
     * Build the marker cache for the entire Plex server.
     * @param {Function} successFunction The function to invoke if the cache was built successfully.
     * @param {Function} failureFunction The function to invoke if the cache failed to build. */
    buildCache(successFunction, failureFunction) {
        this.#log.info('Gathering markers...');
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

            this.#log.info(`Cached ${markerCount} markers, starting server...`);
            successFunction();
        });
    }

    /**
     * Remove the marker with the given id from the cache.
     * @param {number} markerId The marker id of the marker to delete from the cache. */
    removeMarkerFromCache(markerId) {
        const markerData = this.#allMarkers[markerId];
        if (!markerData) {
            this.#log.warn(`The marker we're attempting to delete isn't in our cache. That's not right!`);
            return;
        }

        delete this.#allMarkers[markerId];
        const episode = this.#drillDown(markerData);
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
                this.#log.error(`Unable to get the episode associated with this marker. Reinitializing cache to ensure things stay in sync.`);
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
        let buckets = {};
        try { // This _really_ shouldn't fail, but ¯\_(ツ)_/¯
            for (const show of Object.values(this.#markerHierarchy[sectionId].shows)) {
                for (const season of Object.values(show.seasons)) {
                    for (const episode of Object.values(season.episodes)) {
                        if (!buckets[episode.markers.length]) {
                            buckets[episode.markers.length] = 0;
                        }

                        ++buckets[episode.markers.length];
                    }
                }
            }
        } catch (ex) {
            Log.error(ex.message,'Something went wrong when gathering the section overview');
            Log.error('Attempting to fall back to markerBreakdownCache data.');
            return false;
        }

        return buckets;
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
            thisSection.shows[row.show_id] = new MarkerShowNode();
        }

        let show = thisSection.shows[row.show_id];
        if (!show.seasons[row.season_id]) {
            show.seasons[row.season_id] = new MarkerSeasonNode();
        }

        let season = show.seasons[row.season_id];
        if (!season.episodes[row.episode_id]) {
            season.episodes[row.episode_id] = new MarkerEpisodeNode();
        }

        let episode = season.episodes[row.episode_id];
        if (isMarker) {
            if (episode.markers.length == 0) {
                ++show.markerCount;
                ++season.markerCount;
            }

            episode.markers.push(row.marker_id);

            if (row.marker_id in this.#allMarkers) {
                this.#log.warn(`Found marker id ${row.marker_id} multiple times, that's not right!`);
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

module.exports = MarkerCacheManager;
