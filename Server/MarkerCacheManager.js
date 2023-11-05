import { ContextualLog } from '../Shared/ConsoleLog.js';

import { MarkerEnum, supportedMarkerType } from '../Shared/MarkerType.js';
import MarkerBreakdown from '../Shared/MarkerBreakdown.js';

/** @typedef {!import('./DatabaseWrapper').default} DatabaseWrapper */
/** @typedef {!import('./PlexQueryManager').RawMarkerData} RawMarkerData */
/** @typedef {!import('../Shared/MarkerBreakdown').MarkerBreakdownMap} MarkerBreakdownMap */

/**
 * @typedef {{[markerId: number] : MarkerQueryResult}} MarkerMap
 * @typedef {{[metadataId: number] : MarkerSectionNode}} MarkerSectionMap
 * @typedef {{[metadataId: number] : MarkerShowNode}} MarkerShowMap
 * @typedef {{[metadataId: number] : MarkerSeasonNode}} MarkerSeasonMap
 * @typedef {{[metadataId: number] : MarkerEpisodeNode}} MarkerEpisodeMap
 * @typedef {{[metadataId: number] : MarkerMovieNode}} MarkerMovieMap
 * @typedef {number} MarkerId
 * @typedef {{
 *     id : number,
 *     marker_type : string,
 *     parent_id : number,
 *     season_id : number,
 *     show_id : number,
 *     tag_id : number,
 *     section_id : number}} MarkerQueryResult
 * @typedef {{ id: number, season_id: number, show_id: number, section_id: number }} MediaItemQueryResult
 * @typedef {{ mainData: MarkerBreakdownMap, seasonData: { [seasonId: number]: MarkerBreakdownMap } }} TreeStats
 */


const Log = new ContextualLog('MarkerCache');

/**
 * Extension of MarkerBreakdown to handle the parent hierarchy that the client-side breakdown doesn't have.
 */
class ServerMarkerBreakdown extends MarkerBreakdown {
    /** @type {MarkerNodeBase|null} */
    #parent;

    /** @param {MarkerNodeBase|null} parent */
    constructor(parent=null) {
        super();
        this.#parent = parent;
    }

    delta(oldCount, delta) {
        super.delta(oldCount, delta);
        this.#parent?.markerBreakdown.delta(oldCount, delta);
    }

    initBase() {
        super.initBase();
        this.#parent?.markerBreakdown.initBase();
    }
}

/** Base class for a node in the {@linkcode MarkerCacheManager}'s hierarchical data. */
class MarkerNodeBase {
    /** @type {ServerMarkerBreakdown} */
    markerBreakdown;
    /** @param {MarkerNodeBase|null} parent */
    constructor(parent=null) {
        this.markerBreakdown = new ServerMarkerBreakdown(parent);
    }
}

/** Representation of a library section in the marker cache. */
class MarkerSectionNode extends MarkerNodeBase {
    /** @type {MarkerShowMap|MarkerMovieMap} */
    items = {};
    constructor() {
        super(null);
    }
}

/** Represents the lowest-level media node, i.e. a node that can have markers added to it. */
class BaseItemNode extends MarkerNodeBase {

    /** @type {MarkerId[]} */
    markers = [];
    /** The current bucket key for this breakdown, which indicates the number of both intros and credits. */
    #currentKey = 0;

    /** @param {MarkerNodeBase} */
    constructor(parent) {
        super(parent);
        this.markerBreakdown.initBase();
    }

    /**
     * Add the given marker to the breakdown cache.
     * @param {MarkerQueryResult} markerData */
    add(markerData) {
        this.#deltaBase(markerData, 1);
    }

    /**
     * Remove the given marker to the breakdown cache.
     * @param {MarkerQueryResult} markerData */
    remove(markerData) {
        this.#deltaBase(markerData, -1);
    }

    /**
     * Signals the addition/removal of a marker.
     * @param {MarkerQueryResult} markerData
     * @param {number} multiplier 1 if we're adding a marker, -1 if we're removing one */
    #deltaBase(markerData, multiplier) {
        // TODO: temporary. Make sure that base items only have a single "active" bucket, it doesn't
        //       make sense for a single episode/movie to have multiple buckets.
        Log.assert(this.markerBreakdown.buckets() === 1, 'A base item should only have a single bucket.');
        // Silently ignore unsupported marker types.
        // TODO: better support for unsupported types (i.e. commercials)
        if (!supportedMarkerType(markerData.marker_type)) {
            return;
        }

        const deltaReal = MarkerBreakdown.deltaFromType(multiplier, markerData.marker_type);
        this.markerBreakdown.delta(this.#currentKey, deltaReal);
        this.#currentKey += deltaReal;
    }
}

/** Representation of a movie in the marker cache. */
class MarkerMovieNode extends BaseItemNode {
    /** @param {MarkerSectionNode} parent */
    constructor(parent) {
        super(parent);
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
class MarkerEpisodeNode extends BaseItemNode {
    /** @param {MarkerSeasonNode} parent */
    constructor(parent) {
        super(parent);
    }
}

/**
 * Singleton cache manager instance
 * @type {MarkerCacheManager}
 * @readonly */ // Externally readonly
let Instance;

/**
  * The MarkerCacheManager class compiles information about all markers present in the database.
  */
class MarkerCacheManager {
    /**
     * Instantiate the singleton MarkerCacheManager.
     * @param {DatabaseWrapper} database The connection to the Plex database.
     * @param {number} tagId The tag_id in the Plex database that corresponds to markers. */
    static Create(database, tagId) {
        if (Instance) {
            Log.warn(`Marker cache already initialized, we shouldn't do it again!`);
        }

        Instance = new MarkerCacheManager(database, tagId);
        return Instance;
    }

    /** Clear out any cached data and rebuild it from scratch. */
    static async Reinitialize() {
        Instance?.reinitialize();
    }

    static Close() { Instance = null; }

    /** All markers in the database.
     * @type {MarkerMap} */
    #allMarkers = {};

    /** All markers, arranged in a section > show > season > episode hierarchy
     * @type {MarkerSectionMap} */
    #markerHierarchy = {};

    /** Ids of all episodes in the database.
     * @type {Set<number>} */
    #allBaseItems = new Set();

    /** The tag_id in the Plex database that corresponds to markers.
     * @type {number} */
    #tagId;

    /** The connection to the Plex database.
     * @type {DatabaseWrapper} */
    #database;

    /**
     * Instantiate a MarkerCache.
     * @param {DatabaseWrapper} database The connection to the Plex database.
     * @param {number} tagId The tag_id in the Plex database that corresponds to markers. */
    constructor(database, tagId) {
        this.#database = database;
        this.#tagId = tagId;
    }

    /**
     * Clear out and rebuild the marker cache. */
    async reinitialize() {
        this.#allMarkers = {};
        this.#markerHierarchy = {};
        this.#allBaseItems = new Set();
        await this.buildCache();
    }

    /**
     * Build the marker cache for the entire Plex server. */
    async buildCache() {
        Log.info('Gathering markers...');
        const start = Date.now();
        // Note: Creating separate queries for relevant markers and all media items, then combining them
        //       ourselves is _significantly_ faster than combining it into a single query.
        /** @type {MarkerQueryResult[]} */
        const markers = await this.#database.all(MarkerCacheManager.#markerOnlyQuery, [this.#tagId]);
        /** @type {MediaItemQueryResult[]} */
        const media = await this.#database.all(MarkerCacheManager.#mediaOnlyQuery);
        const end = Date.now();
        Log.verbose(`Queried all markers (${markers.length} in ${((end- start) / 1000).toFixed(2)} seconds), analyzing...`);
        /** @type {{ [mediaId: number]: MediaItemQueryResult }} */
        const mediaMap = {};
        for (const mediaItem of media) {
            mediaMap[mediaItem.id] = mediaItem;
            this.#initializeHierarchy(mediaItem);
        }

        let missingData = 0;
        for (const marker of markers) {
            const baseItem = mediaMap[marker.parent_id];
            if (baseItem) {
                marker.season_id = baseItem.season_id;
                marker.show_id = baseItem.show_id;
                marker.tag_id = this.#tagId;
                marker.section_id = baseItem.section_id;
                this.#addMarkerData(marker);
            } else {
                ++missingData;
            }
        }

        if (missingData > 0) {
            Log.warn(`Found ${missingData} marker(s) without an associated media item, these can't be tracked.`);
        }

        Log.verbose(`Analyzed all markers in ${Date.now() - end}ms (${((Date.now() - start) / 1000).toFixed(2)} seconds total)`);
        Log.info(`Cached ${markers.length} markers, starting server...`);
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
        const baseItem = this.#drillDown(markerData);
        baseItem.remove(markerData);
        baseItem.markers = baseItem.markers.filter(marker => marker !== markerId);
    }

    /**
     * Add a new marker to the cache with the given marker id.
     * Assumes the marker has already been added to the database.
     * @param {MarkerQueryResult} marker */
    addMarkerToCache(marker) {
        marker.tag_id = this.#tagId;
        this.#addMarkerData(marker);
    }

    /**
     * Retrieve {@link MarkerBreakdown} statistics for the given library section.
     * @param {number} sectionId The library section to iterate over.
     * @returns {MarkerBreakdown|false} */
    getSectionOverview(sectionId) {
        try { // This _really_ shouldn't fail, but ¯\_(ツ)_/¯
            return this.#markerHierarchy[sectionId].markerBreakdown.data();
        } catch (ex) {
            Log.error(ex.message, 'Something went wrong when gathering the section overview');
            Log.error('Attempting to fall back to markerBreakdownCache data.');
            return false;
        }
    }

    /**
     * Retrieve marker breakdown stats for a top-level library item (i.e. a movie or an entire show).
     * @param {number} metadataId The metadata id for the TV Show/movie
     * @returns {MarkerBreakdownMap|false} */
    getTopLevelStats(metadataId) {
        const item = this.#topLevelItemFromId(metadataId);
        if (!item) {
            Log.error(`Didn't find the right section for show:${metadataId}. Marker breakdown will not be available`);
            // Attempt to update the cache after the fact.
            this.#tryUpdateCache(MarkerCacheManager.#showMarkerQuery, metadataId);
            return false;
        }

        return item.markerBreakdown.data();
    }

    /**
     * Retrieve marker breakdown stats for a given season of a show.
     * @param {number} showId The metadata id of the show that `seasonId` belongs to.
     * @param {number} seasonId The metadata id of the season. */
    getSeasonStats(showId, seasonId) {
        // Like topLevelItemFromId, just the show's metadataId is okay.
        /** @type {MarkerShowNode} */
        const show = this.#topLevelItemFromId(showId);
        if (!show) {
            Log.error(`Didn't find the right section for show:${showId}. Marker breakdown will not be available`);
            this.#tryUpdateCache(MarkerCacheManager.#showMarkerQuery, showId);
            return null;
        }

        // Show exists, but season is new? Try to update.
        if (!show.seasons[seasonId]) {
            this.#tryUpdateCache(MarkerCacheManager.#seasonMarkerQuery, seasonId);
        }

        return show.seasons[seasonId]?.markerBreakdown.data();
    }

    /**
     * Retrieve marker breakdown stats for a given show, along with individual season stats.
     * @param {number} showId The metadata id of the show to retrieve data for.
     * @returns {TreeStats|false} */
    getTreeStats(showId) {
        /** @type {MarkerShowNode} */
        const show = this.#topLevelItemFromId(showId);
        if (!show) { return null; }

        const treeData = {
            mainData : show.markerBreakdown.data(),
            seasonData : {}
        };

        for (const [seasonId, seasonData] of Object.entries(show.seasons)) {
            treeData.seasonData[seasonId] = seasonData.markerBreakdown.data();
        }

        return treeData;
    }

    /**
     * Return whether a marker with the given id exists in the database
     * @param {number} markerId */
    markerExists(markerId) {
        return !!this.#allMarkers[markerId];
    }

    /**
     * Return whether the given base id (movie/episode) exists in the database.
     * Used by backup manager to check whether a purged marker is associated with an item
     * that actually exists.
     * @param {number} metadataId */
    baseItemExists(metadataId) {
        return this.#allBaseItems.has(metadataId);
    }

    /**
     * Deletes all markers of the given type from the given section.
     * @param {number} sectionId
     * @param {number} deleteType */
    nukeSection(sectionId, deleteType) {
        let removed = 0;
        const allMarkers = Object.values(this.#allMarkers);
        for (const marker of allMarkers) {
            if (marker.section_id === sectionId && MarkerEnum.typeMatch(marker.marker_type, deleteType)) {
                this.removeMarkerFromCache(marker.id);
                ++removed;
            }
        }

        Log.info(`Removed ${removed} markers from the cache due to section delete.`);
        return removed;
    }

    /**
     * Attempts to add additional markers to a show/series if none were previously found.
     * This can happen if the user is (inadvisably) running PMS and adding shows/episodes
     * after the initial startup of this server.
     * @param {string} query The query to run on the database
     * @param {number} metadataId */
    async #tryUpdateCache(query, metadataId) {
        try {
            /** @type {MarkerQueryResult[]} */
            const rows = await this.#database.all(query, [metadataId]);
            if (this.#topLevelItemFromId(metadataId)) {
                return Log.verbose('tryUpdateCache: Multiple update requests fired for this item, ignoring this one.');
            }

            let markerCount = 0;
            for (const row of rows) {
                this.#addMarkerData(row);
                if (row.tag_id !== this.#tagId) {
                    continue;
                }

                ++markerCount;
            }

            Log.info(`tryUpdateCache: Cached ${markerCount} markers for metadata item ${metadataId}`);
        } catch (err) {
            Log.error(`Unable to update marker cache for metadata item ${metadataId}`);
        }
    }

    /**
     * @param {number} metadataId */
    #topLevelItemFromId(metadataId) {
        // Just a metadataId is okay. Someone would need thousands of libraries before
        // the perf hit of looking for the right section was noticeable.
        for (const section of Object.values(this.#markerHierarchy)) {
            if (section.items[metadataId]) {
                return section.items[metadataId];
            }
        }

        return null;
    }

    /**
     * Return the episode in the season associated with the given marker.
     * @param {MarkerQueryResult} markerData
     * @returns {BaseItemNode} */
    #drillDown(markerData) {
        if (markerData.show_id === -1) {
            return this.#markerHierarchy[markerData.section_id].items[markerData.parent_id];
        }

        return this.#markerHierarchy[markerData.section_id]
            .items[markerData.show_id]
            .seasons[markerData.season_id]
            .episodes[markerData.parent_id];
    }

    /**
     * Add the given row to the marker cache.
     * Note that the row doesn't necessarily have a marker associated with it.
     * If it doesn't, we still want to create an entry for the episode the row represents.
     * @param {MarkerQueryResult} tag The row to (potentially) add to our cache. */
    #addMarkerData(tag) {
        const isMarker = tag.tag_id === this.#tagId;
        const isMovie = tag.show_id === -1;
        const thisSection = this.#markerHierarchy[tag.section_id] ??= new MarkerSectionNode();
        /** @type {BaseItemNode} */
        let base;
        if (isMovie) {
            base = thisSection.items[tag.parent_id] ??= new MarkerMovieNode(thisSection);
        } else {
            /** @type {MarkerShowNode} */
            const show = thisSection.items[tag.show_id] ??= new MarkerShowNode(thisSection);
            const season = show.seasons[tag.season_id] ??= new MarkerSeasonNode(show);
            base = season.episodes[tag.parent_id] ??= new MarkerEpisodeNode(season);
        }

        if (isMarker) {
            base.add(tag);
            base.markers.push(tag.id);

            if (tag.id in this.#allMarkers) {
                Log.warn(`Found marker id ${tag.id} multiple times, that's not right!`);
            }

            this.#allMarkers[tag.id] = tag;
        }

        // Core query includes episodes without markers, so this should
        // cover all episodes, not just those with markers.
        this.#allBaseItems.add(tag.parent_id);
    }

    /**
     * Seeds the section/show/season/episode (or section/movie) hierarchy to ensue
     * we track all base media items, even if they currently don't have markers.
     * @param {MediaItemQueryResult} mediaItem */
    #initializeHierarchy(mediaItem) {
        const isMovie = mediaItem.show_id === -1;
        const thisSection = this.#markerHierarchy[mediaItem.section_id] ??= new MarkerSectionNode();
        /** @type {BaseItemNode} */
        if (isMovie) {
            thisSection.items[mediaItem.id] ??= new MarkerMovieNode(thisSection);
        } else {
            /** @type {MarkerShowNode} */
            const show = thisSection.items[mediaItem.show_id] ??= new MarkerShowNode(thisSection);
            const season = show.seasons[mediaItem.season_id] ??= new MarkerSeasonNode(show);
            season.episodes[mediaItem.id] ??= new MarkerEpisodeNode(season);
        }

        this.#allBaseItems.add(mediaItem.id);
    }

    /**
     * Query to retrieve all episodes in the database along with their associated tags (if any).
     * One thing to note is that we join _all_ tags for an episode, not just markers. While
     * seemingly excessive, it's significantly faster than doing an outer join on a temporary
     * taggings table that's been filtered to only include markers. */
    static #episodeMarkerQueryBase = `
SELECT
    marker.id AS id,
    marker.text AS marker_type,
    base.id AS parent_id,
    season.id AS season_id,
    season.parent_id AS show_id,
    marker.tag_id AS tag_id,
    base.library_section_id AS section_id
FROM metadata_items base
    INNER JOIN metadata_items season ON base.parent_id=season.id
    LEFT JOIN taggings marker ON base.id=marker.metadata_item_id
WHERE base.metadata_type=4
    `;

    /** Query to grab all intro/credits markers on the server. */
    static #markerOnlyQuery = `SELECT id, text AS marker_type, metadata_item_id AS parent_id FROM taggings WHERE tag_id=?;`;

    /** Query to grab all episodes and movies from the database. For episodes, also include season/show id (replaced with -1 for movies) */
    static #mediaOnlyQuery = `
SELECT
    base.id AS id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.id END) AS season_id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.parent_id END) AS show_id,
    base.library_section_id AS section_id
FROM metadata_items base
    LEFT JOIN metadata_items season ON base.parent_id=season.id
WHERE base.metadata_type=1 OR base.metadata_type=4;`;

    static #markerQuerySort = `
ORDER BY base.id ASC;`;

    static #showMarkerQuery = MarkerCacheManager.#episodeMarkerQueryBase + `
AND season.parent_id=?
` + MarkerCacheManager.#markerQuerySort;

    static #seasonMarkerQuery = MarkerCacheManager.#episodeMarkerQueryBase + `
AND season.id=?
` + MarkerCacheManager.#markerQuerySort;

}

export { MarkerCacheManager, Instance as MarkerCache };
