/**
 * @typedef {{ id : number, index : number, start : number, end : number, modified_date : string, created_at : string,
 *             episode_id : number, season_id : number, show_id : number, section_id : number }} RawMarkerData
 * @typedef {{ title: string, index: number, id: number, season: string, season_index: number,
 *             show: string, duration: number, parts: number}} RawEpisodeData
 * @typedef {(err: Error?, rows: any[]) => void} MultipleRowQuery
 * @typedef {(err: Error?, rows: RawMarkerData[])} MultipleMarkerQuery
 * @typedef {(err: Error?, row: any) => void} SingleRowQuery
 * @typedef {(err: Error?, row: RawMarkerData) => void} SingleMarkerQuery
 * @typedef {(err: Error?) => void} NoResultQuery
 * @typedef {{ metadata_type : number, section_id : number}} MetadataItemTypeInfo
 */

/** @typedef {!import('../Shared/PlexTypes.js').BulkAddResult} BulkAddResult */
/** @typedef {!import('../Shared/PlexTypes.js').BulkAddResultEntry} BulkAddResultEntry */
/** @typedef {!import('./MarkerBackupManager.js').MarkerAction} MarkerAction */

import { Log } from '../Shared/ConsoleLog.js';
import { BulkMarkerResolveType, EpisodeData, MarkerData } from '../Shared/PlexTypes.js';

import DatabaseWrapper from './DatabaseWrapper.js';
import ServerError from './ServerError.js';
import TransactionBuilder from './TransactionBuilder.js';

/** Helper class used to align RawMarkerData and MarkerAction fields that are
 *  relevant for restoring purged markers. */
class TrimmedMarker {
    static #newMarkerId = -1;
    /** @type {number} */ id;
    /** @type {number} */ episode_id;
    /** @type {number} */ start;
    /** @type {number} */ end;
    /** @type {number} */ index;
    /** @type {number} */ newIndex;
    /** @type {boolean} */ #isRaw = false;
    /** @type {RawMarkerData} */ #raw;
    getRaw() { if (!this.#isRaw) { throw new ServerError('Attempting to access a non-existent raw marker', 500); } return this.#raw; }

    constructor(id, eid, start, end, index) {
        this.id = id, this.episode_id = eid, this.start = start, this.end = end, this.index = index, this.newIndex = -1;
    }

    /** Return whether this is an existing marker */
    existing() { return this.id != TrimmedMarker.#newMarkerId; }

    /** @param {RawMarkerData} marker */
    static fromRaw(marker) {
        let trimmed = new TrimmedMarker(marker.id, marker.episode_id, marker.start, marker.end, marker.index);
        trimmed.#raw = marker;
        trimmed.#isRaw = true;
        return trimmed;
    }

    /** @param {MarkerAction} action */
    static fromBackup(action) {
        return new TrimmedMarker(TrimmedMarker.#newMarkerId, action.episode_id, action.start, action.end, -1);
    }
}

/**
 * Singleton PlexQueryManager instance.
 * @type {PlexQueryManager}
 * @readonly */
let Instance;

/**
 * The PlexQueryManager handles the underlying queries made to the Plex database to retrieve
 * library, season, show, episode, and marker data.
 */
class PlexQueryManager {
    /**
     * The tag id in the database that represents an intro marker.
     * @type {number} */
    #markerTagId;

    /** @type {DatabaseWrapper} */
    #database;

    /** Whether to commandeer the thumb_url column for extra marker information.
     *  If "pure" mode is enabled, we don't use the field. */
    #pureMode = false;

    /** The default fields to return for an individual marker, which includes the episode/season/show/section id. */
    #extendedMarkerFields = `
    taggings.id,
    taggings.\`index\`,
    taggings.time_offset AS start,
    taggings.end_time_offset AS end,
    taggings.thumb_url AS modified_date,
    taggings.created_at,
    episodes.id AS episode_id,
    seasons.id AS season_id,
    seasons.parent_id AS show_id,
    seasons.library_section_id AS section_id
FROM taggings
    INNER JOIN metadata_items episodes ON taggings.metadata_item_id = episodes.id
    INNER JOIN metadata_items seasons ON episodes.parent_id = seasons.id
`;

    /**
     * Creates a new PlexQueryManager instance. This show always be used opposed to creating
     * a PlexQueryManager directly via 'new'.
     * @param {string} databasePath The path to the Plex database.
     * @param {boolean} pureMode Whether we should avoid writing to an unused database column to store extra data. */
    static async CreateInstance(databasePath, pureMode) {
        if (Instance) {
            Log.warn(`Query manager already initialized, we shouldn't be initializing it again`);
            Instance.close();
        }

        Log.info(`PlexQueryManager: Verifying database ${databasePath}...`);
        /** @type {DatabaseWrapper} */
        let db;
        try {
            db = await DatabaseWrapper.CreateDatabase(databasePath, false /*fAllowCreate*/);
        } catch (err) {
            Log.error(`PlexQueryManager: Unable to open database. Are you sure "${databasePath}" exists?`);
            throw ServerError.FromDbError(err);
        }

        Log.tmi(`PlexQueryManager: Opened database, making sure it looks like the Plex database`);
        try {
            let row = await db.get('SELECT id FROM tags WHERE tag_type=12;');
            if (!row) {
                // What's the path forward if/when Plex adds custom extensions to the `taggings` table?
                // Probably some gross solution that invokes shell commands to Plex SQLite.
                Log.error(`PlexQueryManager: tags table exists, but didn't find intro tag. Plex SQLite is required to modify this table, so we cannot continue.`);
                Log.error(`                  Either ensure at least one episode has an intro marker, or manually run the following using Plex SQLite:`);
                Log.error();
                Log.error(`                 INSERT INTO tags (tag_type, created_at, updated_at) VALUES (12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`);
                Log.error();
                Log.error(`See https://support.plex.tv/articles/repair-a-corrupted-database/ for more information on Plex SQLite and the database location.`);
                throw new ServerError(`Plex database must contain at least one intro marker.`, 500);
            }

            Log.info('PlexQueryManager: Database verified');
            Instance = new PlexQueryManager(db, pureMode, row.id);
            return Instance;
        } catch (err) {
            Log.error(`PlexQueryManager: Are you sure "${databasePath}" is the Plex database, and has at least one existing intro marker?`);
            throw ServerError.FromDbError(err);
        }
    }

    /** Close the query connection. */
    static Close() { Instance?.close(); Instance = null; }

    /**
     * Initializes the query manager. Should only be called via the static CreateInstance.
     * @param {DatabaseWrapper} database
     * @param {boolean} pureMode Whether we should avoid writing to an unused database column to store extra data.
     * @param {markerTagId} markerTagId The database tag id that represents intro markers. */
    constructor(database, pureMode, markerTagId) {
        this.#database = database;
        this.#pureMode = pureMode;
        this.#markerTagId = markerTagId;
    }

    /** On process exit, close the database connection. */
    async close() {
        Log.verbose(`PlexQueryManager: Shutting down Plex database connection...`);
        if (this.#database) {
            try {
                await this.#database.close();
                Log.verbose('PlexQueryManager: Shut down Plex database connection.');
            } catch (err) {
                Log.error('PlexQueryManager: Database close failed', err.message);
            }

            this.#database = null;
        }
    }

    markerTagId() { return this.#markerTagId; }
    database() { return this.#database; }

    /** Retrieve all TV show libraries in the database.
     *
     * Fields returned: `id`, `name`.
     * @returns {Promise<{id: number, name: string}[]>} */
    async getShowLibraries() {
        return this.#database.all('SELECT id, name FROM library_sections WHERE section_type=2');
    }

    /**
     * Retrieve all shows in the given library section.
     *
     * Fields returned: `id`, `title`, `title_sort`, `original_title`, `season_count`, `episode_count`.
     * @param {number} sectionId
     * @returns {Promise<{id:number,title:string,title_sort:string,original_title:string,season_count:number,episode_count:number}[]>} */
    async getShows(sectionId) {
        // Create an inner table that contains all unique seasons across all shows, with episodes per season attached,
        // and join that to a show query to roll up the show, the number of seasons, and the number of episodes all in a single row
        const query = `
SELECT
    shows.id,
    shows.title,
    shows.title_sort,
    shows.original_title,
    COUNT(shows.id) AS season_count,
    SUM(seasons.episode_count) AS episode_count
FROM metadata_items shows
    INNER JOIN (
        SELECT seasons.id, seasons.parent_id AS show_id, COUNT(episodes.id) AS episode_count FROM metadata_items seasons
        INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id
        WHERE seasons.library_section_id=? AND seasons.metadata_type=3
        GROUP BY seasons.id
    ) seasons
WHERE shows.metadata_type=2 AND shows.id=seasons.show_id
GROUP BY shows.id;`;

        return this.#database.all(query, [sectionId]);
    }

    /**
     * Retrieve all seasons in the given show.
     *
     * Fields returned: `id`, `title`, `index`, `episode_count`.
     * @param {number} showMetadataId
     * @returns {Promise<{id:number,title:string,index:number,episode_count:number}[]>} */
   async getSeasons(showMetadataId) {
        const query = `
SELECT
    seasons.id,
    seasons.title,
    seasons.\`index\`,
    COUNT(episodes.id) AS episode_count
FROM metadata_items seasons
    INNER JOIN metadata_items episodes ON episodes.parent_id=seasons.id
WHERE seasons.parent_id=?
GROUP BY seasons.id
 ORDER BY seasons.\`index\` ASC;`;

        return this.#database.all(query, [showMetadataId]);
    }

    /**
     * Retrieve all episodes in the given season.
     *
     * Fields returned: `title`, `index`, `id`, `season`, `season_index`, `show`, `duration`, `parts`.
     * @param {number} seasonMetadataId
     * @returns {Promise<RawEpisodeData[]>} */
    async getEpisodes(seasonMetadataId) {
        // Multiple joins to grab the season name, show name, and episode duration (MAX so that we capture)
        // (the longest available episode, as Plex seems fine with ends beyond the media's length).
        const query = `
SELECT
    e.title AS title,
    e.\`index\` AS \`index\`,
    e.id AS id,
    p.title AS season,
    p.\`index\` AS season_index,
    g.title AS show,
    MAX(m.duration) AS duration,
    COUNT(e.id) AS parts
FROM metadata_items e
    INNER JOIN metadata_items p ON e.parent_id=p.id
    INNER JOIN metadata_items g ON p.parent_id=g.id
    INNER JOIN media_items m ON e.id=m.metadata_item_id
WHERE e.parent_id=?
GROUP BY e.id
ORDER BY e.\`index\` ASC;`;

        return this.#database.all(query, [seasonMetadataId]);
    }

    /**
     * Retrieve episode info for each of the episode ids in `episodeMetadataIds`
     * @param {Iterable<number>} episodeMetadataIds
     * @returns {Promise<RawEpisodeData[]>}*/
    async getEpisodesFromList(episodeMetadataIds) {
        let query = `
    SELECT
        e.title AS title,
        e.\`index\` AS \`index\`,
        e.id AS id,
        p.title AS season,
        p.\`index\` AS season_index,
        g.title AS show,
        MAX(m.duration) AS duration,
        COUNT(e.id) AS parts
    FROM metadata_items e
        INNER JOIN metadata_items p ON e.parent_id=p.id
        INNER JOIN metadata_items g ON p.parent_id=g.id
        INNER JOIN media_items m ON e.id=m.metadata_item_id
    WHERE (`;

        let parameters = [];
        for (const episodeId of episodeMetadataIds) {
            // We should have already ensured only integers are passed in here, but be safe.
            const metadataId = parseInt(episodeId);
            if (isNaN(metadataId)) {
                Log.warn(`PlexQueryManager: Can't get episode information for non-integer id ${episodeId}`);
                continue;
            }

            parameters.push(metadataId);
            query += `e.id=? OR `;
        }

        query = query.substring(0, query.length - 4);
        query += `)
    GROUP BY e.id
    ORDER BY e.\`index\` ASC;`;

        return this.#database.all(query, parameters);
    }

    /**
     * Retrieve all markers for the given episodes.
     * @param {number[]} episodeIds
     * @returns {Promise<RawMarkerData[]>}*/
    async getMarkersForEpisodes(episodeIds) {
        let query = `SELECT ${this.#extendedMarkerFields} WHERE taggings.tag_id=? AND (`;
        episodeIds.forEach(episodeId => {
            if (isNaN(episodeId)) {
                // Don't accept bad keys, but don't fail the entire operation either.
                Log.warn(episodeId, 'PlexQueryManager: Found bad key in queryIds, skipping');
                return;
            }

            query += 'metadata_item_id=' + episodeId + ' OR ';
        });

        // Strip trailing ' OR '
        query = query.substring(0, query.length - 4) + ') ORDER BY taggings.`index` ASC;';

        return this.#database.all(query, [this.#markerTagId]);
    }

    /**
     * Retrieve all markers for a single episode.
     * @param {number} episodeId */
    async getEpisodeMarkers(episodeId) {
        return this.#getMarkersForMetadataItem(episodeId, `taggings.metadata_item_id`);
    }

    /**
     * Retrieve all markers for a single season.
     * @param {number} seasonId */
    async getSeasonMarkers(seasonId) {
        return this.#getMarkersForMetadataItem(seasonId, `seasons.id`);
    }

    /**
     * Retrieve all markers for a single show.
     * @param {number} showId */
    async getShowMarkers(showId) {
        return this.#getMarkersForMetadataItem(showId, `seasons.parent_id`);
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @returns {Promise<{ markers : RawMarkerData[], typeInfo : MetadataItemTypeInfo}>} */
    async getMarkersAuto(metadataId) {
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        let where = '';
        switch (typeInfo.metadata_type) {
            case 2: where = `seasons.parent_id`; break;
            case 3: where = `seasons.id`; break;
            case 4: where = `taggings.metadata_item_id`; break;
            default:
                throw new ServerError(`Item ${metadataId} is not an episode, season, or series`, 400);
        }

        const markers = await this.#getMarkersForMetadataItem(metadataId, where);
        return Promise.resolve({ markers : markers, typeInfo : typeInfo });
    }

    /**
     * Retrieve the media type and section id for item with the given metadata id.
     * @param {number} metadataId
     * @returns {Promise<MetadataItemTypeInfo} */
    async #mediaTypeFromId(metadataId) {
        const row = await this.#database.get('SELECT metadata_type, library_section_id AS section_id FROM metadata_items WHERE id=?;', [metadataId]);
        if (!row) {
            throw new ServerError(`Metadata item ${metadataId} not found in database.`, 400);
        }

        return Promise.resolve(row);
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @param {string} whereClause The field to match against `metadataId`.
     * @returns {Promise<RawMarkerData[]>} */
    async #getMarkersForMetadataItem(metadataId, whereClause) {
        return this.#database.all(
            `SELECT ${this.#extendedMarkerFields}
            WHERE ${whereClause}=? AND taggings.tag_id=?
            ORDER BY taggings.\`index\` ASC;`,
            [metadataId, this.#markerTagId]);
    }

    /**
     * Retrieve a single marker with the given marker id.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} markerId
     * @returns {Promise<RawMarkerData>} */
    async getSingleMarker(markerId) {
        return this.#database.get(
            `SELECT ${this.#extendedMarkerFields} WHERE taggings.id=? AND taggings.tag_id=?;`,
            [markerId, this.#markerTagId]);
    }

    /**
     * Add a marker to the database, taking care of reindexing if necessary.
     * @param {number} metadataId The metadata id of the episode to add the marker to.
     * @param {number} startMs Start time, in milliseconds.
     * @param {number} endMs End time, in milliseconds.
     * @returns {Promise<{ allMarkers: RawMarkerData[], newMarker: RawMarkerData}>} */
    async addMarker(metadataId, startMs, endMs) {
        // Ensure metadataId is an episode, it doesn't make sense to add one to any other media type
        const typeInfo = await this.#mediaTypeFromId(metadataId);
        if (typeInfo.metadata_type != 4) {
            throw new ServerError(`Attempting to add marker to a media item that's not an episode!`, 400);
        }

        const allMarkers = await this.getEpisodeMarkers(metadataId);
        const newIndex = this.#reindexForAdd(allMarkers, startMs, endMs);
        if (newIndex == -1) {
            throw new ServerError('Overlapping markers. The existing marker should be expanded to include this range instead.', 400);
        }

        const thumbUrl = this.#pureMode ? '""' : 'CURRENT_TIMESTAMP || "*"';
        const addQuery =
            'INSERT INTO taggings ' +
                '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
            'VALUES ' +
                '(?, ?, ?, "intro", ?, ?, ' + thumbUrl + ', CURRENT_TIMESTAMP, "pv%3Aversion=5");';
        const parameters = [metadataId, this.#markerTagId, newIndex, startMs.toString(), endMs];
        await this.#database.run(addQuery, parameters);

        // Insert succeeded, update indexes of other markers if necessary
        await this.reindex(metadataId);

        const newMarker = await this.getNewMarker(metadataId, startMs, endMs);
        return Promise.resolve({ allMarkers : allMarkers, newMarker : newMarker });
    }

    /**
     * Helper that adds an 'add marker' statement to the given transaction.
     * @param {TransactionBuilder} transaction
     * @param {number} episodeId The episode to add the marker to.
     * @param {number} newIndex New marker's index in the list of existing markers.
     * @param {number} startMs Start time of the new marker, in milliseconds.
     * @param {number} endMs End time of the new marker, in milliseconds. */
    #addMarkerStatement(transaction, episodeId, newIndex, startMs, endMs) {
        const thumbUrl = this.#pureMode ? '""' : 'CURRENT_TIMESTAMP || "*"';
        const addQuery =
            'INSERT INTO taggings ' +
                '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
            'VALUES ' +
                '(?, ?, ?, "intro", ?, ?, ' + thumbUrl + ', CURRENT_TIMESTAMP, "pv%3Aversion=5");';
        const parameters = [episodeId, this.#markerTagId, newIndex, startMs.toString(), endMs];
        transaction.addStatement(addQuery, parameters);
    }

    /**
     * Restore multiple markers at once.
     * @param {{ [episodeId: number] : MarkerAction[] }} actions Map of episode IDs to the list of markers to restore for that episode
     * @returns {Promise<{newMarkers: RawMarkerData[], identicalMarkers: RawMarkerData[]}} */
    async bulkRestore(actions) {
        /** @type {RawMarkerData[]} */
        let markerList;
        try {
            markerList = await this.getMarkersForEpisodes(Object.keys(actions));
        } catch (err) {
            throw new ServerError(`Unable to retrieve existing markers to correlate marker restoration:\n\n${err.message}`, 500);
        }

        // One query + postprocessing is faster than a query for each episode
        /** @type {{ [episode_id: number] : TrimmedMarker[] }} */
        let existingMarkers = {};
        for (const marker of markerList) {
            if (!existingMarkers[marker.episode_id]) {
                existingMarkers[marker.episode_id] = [];
            }

            Log.tmi(marker, 'Adding existing marker');
            existingMarkers[marker.episode_id].push(TrimmedMarker.fromRaw(marker));
        }

        let expectedInserts = 0;
        let identicalMarkers = [];
        let potentialRestores = 0;
        const transaction = new TransactionBuilder(this.#database);
        for (const [episodeId, markerActions] of Object.entries(actions)) {
            // Calculate new indexes
            for (const action of markerActions) {
                ++potentialRestores;
                if (!existingMarkers[episodeId]) {
                    existingMarkers[episodeId] = [];
                }

                // Ignore identical markers, though we should probably have better
                // messaging, or not show them to the user at all.
                let identicalMarker = existingMarkers[episodeId].find(marker => marker.start == action.start && marker.end == action.end);
                if (!identicalMarker) {
                    Log.tmi(action, 'Adding marker to restore');
                    existingMarkers[episodeId].push(TrimmedMarker.fromBackup(action));
                } else {
                    Log.verbose(action, `Ignoring purged marker that is identical to an existing marker.`);
                    identicalMarkers.push(identicalMarker);
                }
            }

            // TODO: Better overlap strategy. Should we silently merge them? Or let the user decide what to do?
            existingMarkers[episodeId].sort((a, b) => a.start - b.start).forEach((marker, index) => {
                marker.newIndex = index;
            });

            for (const marker of Object.values(existingMarkers[episodeId])) {
                if (marker.existing()) {
                    continue;
                }

                ++expectedInserts;
                this.#addMarkerStatement(transaction, episodeId, marker.newIndex, marker.start, marker.end);
            }

            // updateMarkerIndex, without actually executing it.
            for (const marker of Object.values(existingMarkers[episodeId])) {
                if (marker.index != marker.newIndex && marker.existing()) {
                    Log.tmi(`Found marker to reindex (was ${marker.index}, now ${marker.newIndex})`);
                    transaction.addStatement('UPDATE taggings SET `index`=? WHERE id=?;', [marker.newIndex, marker.id]);
                }
            }
        }

        if (expectedInserts == 0) {
            // This is only expected if every marker we tried to restore already exists. In that case just
            // immediately return without any new markers, since we didn't add any.
            Log.assert(identicalMarkers.length == potentialRestores, `PlexQueryManager::bulkRestore: identicalMarkers == potentialRestores`);
            Log.warn(`PlexQueryManager::bulkRestore: no markers to restore, did they all match against an existing marker?`);
            return Promise.resolve({ newMarkers : [], identicalMarkers : identicalMarkers });
        }

        Log.tmi('Built full restore query:\n' + transaction.toString());

        try {
            transaction.exec();
        } catch (err) {
            throw ServerError.FromDbError(err);
        }

        Log.verbose('Successfully restored markers to Plex database');

        // All markers were added successfully. Now query them all to return back to the backup manager
        // so it can update caches accordingly.
        let params = [this.#markerTagId];
        let query = `SELECT ${this.#extendedMarkerFields} WHERE taggings.tag_id=? AND (`;
        for (const newMarkers of Object.values(existingMarkers)) {
            for (const newMarker of newMarkers) {
                if (newMarker.existing()) {
                    continue;
                }

                query += '(taggings.metadata_item_id=? AND taggings.time_offset=? AND taggings.end_time_offset=?) OR ';
                params.push(newMarker.episode_id, newMarker.start, newMarker.end);
            }
        }

        query = query.substring(0, query.length - 4) + ')';

        // If this throws, the server really should restart. We added the markers successfully,
        // but we can't update our caches since we couldn't retrieve them.
        const newMarkers = await this.#database.all(query, params);
        if (newMarkers.length != expectedInserts) {
            Log.warn(`Expected to find ${expectedInserts} new markers, found ${newMarkers.length} instead.`);
        }

        return Promise.resolve({ newMarkers : newMarkers, identicalMarkers : identicalMarkers });
    }

    /**
     * Finds the new indexes for the given markers, given the start and end time of the
     * new marker to be inserted. New indexes are stored in the marker's `newIndex` field,
     * and the index for the new marker is returned directly. If overlapping markers are
     * not allowed, -1 is returned if overlap is detected.
     * @param {[]} markers
     * @param {number} newStart The start time of the new marker, in milliseconds.
     * @param {number} newEnd The end time of the new marker, in milliseconds.*/
    #reindexForAdd(markers, newStart, newEnd) {
        let pseudoData = { start : newStart, end : newEnd };
        markers.push(pseudoData);
        markers.sort((a, b) => a.start - b.start).forEach((marker, index) => {
            marker.newIndex = index;
        });

        pseudoData.index = pseudoData.newIndex;
        const newIndex = pseudoData.newIndex;
        const startOverlap = newIndex != 0 && markers[newIndex - 1].end >= pseudoData.start;
        const endOverlap = newIndex != markers.length - 1 && markers[newIndex + 1].start <= pseudoData.end;
        return (startOverlap || endOverlap) ? -1 : newIndex;
    }

    /**
     * Updates the start/end/update time of the marker with the given id.
     * @param {number} markerId
     * @param {number} index The marker's new index in the marker table.
     * @param {number} startMs The new start time, in milliseconds.
     * @param {number} endMs The new end time, in milliseconds.
     * @param {boolean} userCreated Whether we're editing a marker the user created, or one that Plex created automatically.
     * @returns {Promise<void>} */
    async editMarker(markerId, index, startMs, endMs, userCreated) {
        const thumbUrl = this.#pureMode ? '""' : `CURRENT_TIMESTAMP${userCreated ? " || '*'" : ''}`;

        // Use startMs.toString() to ensure we properly set '0' instead of a blank value if we're starting at the very beginning of the file
        return this.#database.run(
            'UPDATE taggings SET `index`=?, time_offset=?, end_time_offset=?, thumb_url=' + thumbUrl + ' WHERE id=?;',
            [index, startMs.toString(), endMs, markerId]);
    }

    /**
     * Delete the given marker from the database.
     * @param {number} markerId
     * @returns {Promise<void>} */
    async deleteMarker(markerId) {
        return this.#database.run('DELETE FROM taggings WHERE id=?;', [markerId]);
    }

    /** Update the given marker's index to `newIndex`.
     * We don't throw if this fails, only logging an error message. TODO: this should probably change.
     * @param {number} markerId
     * @param {number} newIndex */
    async updateMarkerIndex(markerId, newIndex) {
        // Fire and forget. Fingers crossed this does the right thing.
        try {
            await this.#database.run('UPDATE taggings SET `index`=? WHERE id=?;', [newIndex, markerId]);
        } catch (err) {
            Log.error(`PlexQueryManager: Failed to update marker index for marker ${markerId} (new index: ${newIndex})`);
        }
    }

    /**
     * Retrieve a marker that was just added to the database.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} metadataId The metadata id of the episode the marker belongs to.
     * @param {number} index The index of the marker in the marker table.
     * @returns {Promise<RawMarkerData>} */
    async getNewMarker(metadataId, startMs, endMs) {
        return this.#database.get(
            `SELECT ${this.#extendedMarkerFields} WHERE metadata_item_id=? AND tag_id=? AND taggings.time_offset=? AND taggings.end_time_offset=?;`,
            [metadataId, this.#markerTagId, startMs, endMs]);
    }

    /**
     * Retrieve all episodes and their markers (if any) in the given section.
     *
     * Fields returned: `episode_id`, `tag_id`
     * @param {number} sectionId
     * @returns {Promise<{episode_id: number, tag_id: number}[]>} */
    async markerStatsForSection(sectionId) {
        // Note that the query below that grabs _all_ tags for an episode and discarding
        // those that aren't intro markers is faster than doing an outer join on a
        // temporary taggings table that only includes markers
        const query = `
SELECT e.id AS episode_id, m.tag_id AS tag_id FROM metadata_items e
    LEFT JOIN taggings m ON e.id=m.metadata_item_id
WHERE e.library_section_id=? AND e.metadata_type=4
ORDER BY e.id ASC;`;

        return this.#database.all(query, [sectionId]);
    }

    /**
     * Return the ids and UUIDs for all sections in the database.
     * @returns {Promise<{ id: number, uuid: string }[]>} */
    async sectionUuids() {
        return this.#database.all('SELECT id, uuid FROM library_sections;');
    }

    /**
     * Shift the given markers by the given offset
     * @param {{[episodeId: number]: RawMarkerData[]}} markers The markers to shift
     * @param {RawEpisodeData[]} episodeData 
     * @param {number} shift The time to shift the markers by, in milliseconds */
    async shiftMarkers(markers, episodeData, shift) {
        const episodeIds = Object.keys(markers);
        const limits = {};
        for (const episode of episodeData) {
            limits[episode.id] = episode.duration;
        }

        const transaction = new TransactionBuilder(this.#database);
        let expectedShifts = 0;
        for (const episodeMarkers of Object.values(markers)) {
            for (const marker of episodeMarkers) {
                ++expectedShifts;
                const userCreated = marker.modified_date && marker.modified_date.endsWith('*');
                const thumbUrl = this.#pureMode ? '""' : `CURRENT_TIMESTAMP${userCreated ? " || '*'" : ''}`;
                let maxDuration = limits[marker.episode_id];
                if (!maxDuration) {
                    throw new ServerError(`Unable to find max episode duration, the episode id ${marker.episode_id} doesn't appear to be valid.`);
                }

                const newStart = Math.max(0, Math.min(marker.start + shift, maxDuration));
                const newEnd = Math.max(0, Math.min(marker.end + shift, maxDuration));
                if (newStart == newEnd) {
                    // Shifted entirely outside of the episode? We should have already checked for that.
                    throw new ServerError(`Attempting to shift marker (${marker.start}-${marker.end}) by ${shift} ` +
                        `puts it outside the bounds of the episode (0-${maxDuration})!`, 400);
                }

                transaction.addStatement(
                    'UPDATE taggings SET time_offset=?, end_time_offset=?, thumb_url=' + thumbUrl + ' WHERE id=?',
                    [newStart, newEnd, marker.id]
                );
            }
        }

        await transaction.exec();
        const newMarkers = await this.getMarkersForEpisodes(episodeIds);
        // No ignored markers, no need to prune
        if (newMarkers.length == expectedShifts) {
            return newMarkers;
        }

        const pruned = [];
        for (const marker of newMarkers) {
            if (markers[marker.episode_id] && markers[marker.episode_id].find(x => x.id == marker.id)) {
                pruned.push(marker);
            }
        }

        return pruned;
    }

    /**
     * Ensure the indexes for the markers under the given show/season/episode metadataId are in order.
     * @param {number} metadataId */
    async reindex(metadataId) {
        const markerInfo = await this.getMarkersAuto(metadataId);
        /** @type {{[episodeId: number]: RawMarkerData[]}} */
        const episodeMap = {};
        for (const marker of markerInfo.markers) {
            if (!episodeMap[marker.episode_id]) {
                episodeMap[marker.episode_id] = [];
            }

            episodeMap[marker.episode_id].push(marker);
        }

        const transaction = new TransactionBuilder(this.#database);
        for (const markerGroup of Object.values(episodeMap)) {
            markerGroup.sort((a, b) => a.start - b.start).forEach((marker, index) => {
                marker.newIndex = index;
            });

            for (const marker of markerGroup) {
                if (marker.newIndex != marker.index) {
                    transaction.addStatement('UPDATE taggings SET `index`=? WHERE id=?;', [marker.newIndex, marker.id]);
                    marker.index = marker.newIndex;
                }
            }
        }

        if (!transaction.empty()) {
            Log.verbose(`PlexQueryManager::reindex: Reindexing ${transaction.statementCount()} markers.`);
            await transaction.exec();
        }

        return markerInfo;
    }

    /**
     * Delete all markers with the given ids.
     * @param {RawMarkerData[]} markers */
    async bulkDelete(markers) {
        const transaction = new TransactionBuilder(this.#database);
        for (const marker of markers) {
            transaction.addStatement(`DELETE FROM taggings WHERE id=?;`, [marker.id]);
        }
        return transaction.exec();
    }

    /**
     * Add a marker to every episode under metadataId (a show, season, or episode id)
     * @param {RawMarkerData[]} markerData Existing markers for the given metadata id.
     * @param {number} metadataId
     * @param {number} baseStart Marker start, in milliseconds
     * @param {number} baseEnd Marker end, in milliseconds
     * @param {number} resolveType The `BulkMarkerResolveType`
     * @param {number[]} ignored List of episode ids to skip.
     * @returns {Promise<BulkAddResult>} */
    async bulkAdd(markerData, metadataId, baseStart, baseEnd, resolveType, ignored=[]) {
        // This is all very inefficient. It's probably fine even in extreme scenarios since DB queries will take
        // up the majority of the time, but there are most definitely more efficient ways to do this.
        const existingMarkers = markerData.markers;
        const ignoredEpisodes = new Set(ignored);
        const episodeIds = new Set();
        const newIgnoredEpisodes = [];
        switch (markerData.typeInfo.metadata_type) {
            case 4: // Single episode. No reason to go through bulk, but might as well support it
                if (!ignoredEpisodes.has(metadataId)) { episodeIds.add(metadataId); }
                break;
            case 3: // Season
            {
                const ids = await this.#database.all(`SELECT id FROM metadata_items WHERE parent_id=?;`, [metadataId]);
                ids.forEach(i => episodeIds.add(i.id));
                break;
            }
            case 2: // Show
            {
                const ids = await this.#database.all(`SELECT e.id FROM metadata_items e INNER JOIN metadata_items p ON p.id=e.parent_id WHERE p.parent_id=?;`, [metadataId]);
                ids.forEach(i => episodeIds.add(i.id));
                break;
            }
            default:
                throw new ServerError(`Attempting to bulk add to an unexpected media type '${markerData.typeInfo.metadata_type}'`, 400);
        }

        // This could probably be combined with the switch above, but it shouldn't be _that_ much slower
        const episodeData = await this.getEpisodesFromList(episodeIds);

        /** @type {{[episodeId: number]: BulkAddResultEntry}} */
        const episodeMarkerMap = {};
        episodeData.forEach(e => episodeMarkerMap[e.id] = { episodeData : new EpisodeData(e), existingMarkers : [] });
        existingMarkers.forEach(m => episodeMarkerMap[m.episode_id].existingMarkers.push(new MarkerData(m)));
        Object.values(episodeMarkerMap).forEach(ed => ed.existingMarkers.sort((a, b) => a.start - b.start));

        // For dry runs, we just return all episodes and their associated markers (if any)
        if (resolveType == BulkMarkerResolveType.DryRun) {
            return {
                applied : false,
                episodeMap : episodeMarkerMap
            };
        }

        // First conflict pass
        for (const marker of existingMarkers) {
            if (ignoredEpisodes.has(marker.episode_id)) { continue; }
            if (baseStart <= marker.start ? baseEnd >= marker.start : baseStart <= marker.end) {
                // Conflict.
                if (resolveType == BulkMarkerResolveType.Fail) {
                    // Still a success, because the users _wants_ this to fail.
                    return {
                        applied : false,
                        conflict : true,
                        episodeMap : episodeMarkerMap
                    };
                }

                if (resolveType == BulkMarkerResolveType.Ignore) {
                    episodeIds.delete(marker.episode_id);
                    ignoredEpisodes.add(marker.episode_id);
                    newIgnoredEpisodes.push(marker.episode_id);
                }
            }
        }

        const mergeEdited = new Set(); // Set of RawMarkerData ids that were edited. Map from RawMarkerData after reindex to map to episodeMap.editedMarkers
        const plainAdd = new Set(); // Set of episodeIds that have a normal add. Correlate after reindex with start and end time, map to episodeMap.addedMarkers
        const transaction = new TransactionBuilder(this.#database);
        for (const episodeId of episodeIds) {
            if (ignoredEpisodes.has(episodeId)) { continue; }
            const episodeEnd = Math.min(episodeMarkerMap[episodeId].episodeData.duration, baseEnd);
            const episodeMarkers = episodeMarkerMap[episodeId].existingMarkers;
            if (!episodeMarkers || episodeMarkers.length == 0) {
                this.#addMarkerStatement(transaction, episodeId, 0 /*newIndex*/, baseStart, episodeEnd);
                plainAdd.add(episodeId);
                episodeMarkerMap[episodeId].isAdd = true;
                continue;
            }

            // Process merges and envelops.
            for (let i = 0; i < episodeMarkers.length; ++i) {
                let episodeMarker = episodeMarkers[i];
                if (episodeMarker.end < baseStart) {
                    if (i == episodeMarkers.length - 1) {
                        // We're adding beyond the last marker
                        this.#addMarkerStatement(transaction, episodeId, episodeMarkers.length, baseStart, episodeEnd);
                        plainAdd.add(episodeId);
                        episodeMarkerMap[episodeId].isAdd = true;
                    }

                    continue;
                }

                if (baseStart <= episodeMarker.start ? episodeEnd >= episodeMarker.start : baseStart <= episodeMarker.end) {
                    // If we have a conflict here, resolve type better be merge.
                    if (resolveType != BulkMarkerResolveType.Merge) {
                        throw new ServerError(`Attempted to merge markers during a bulk add when the user didn't request it`, 500);
                    }

                    episodeMarker.start = Math.min(baseStart, episodeMarker.start);
                    episodeMarker.end = Math.max(episodeEnd, episodeMarker.end);
                    while (i < episodeMarkers.length - 1 && episodeMarkers[i + 1].start <= episodeMarker.end) {
                        // Merge next marker into existing, deleting next marker.
                        const nextMarker = episodeMarkers[++i];
                        episodeMarker.end = Math.max(episodeMarker.end, nextMarker.end);
                        transaction.addStatement(`DELETE FROM taggings WHERE id=?;`, [nextMarker.id]);
                        if (!episodeMarkerMap[episodeId].deletedMarkers) {
                            episodeMarkerMap[episodeId].deletedMarkers = [];
                        }

                        episodeMarkerMap[episodeId].deletedMarkers.push(nextMarker);
                    }

                    const thumbUrl = this.#pureMode ? '""' : `CURRENT_TIMESTAMP${episodeMarker.createdByUser ? " || '*'" : ''}`;
                    transaction.addStatement(
                        `UPDATE taggings SET time_offset=?, end_time_offset=?, thumb_url=${thumbUrl} WHERE id=?;`,
                        [episodeMarker.start, episodeMarker.end, episodeMarker.id]);
                    episodeMarkerMap[episodeId].isAdd = false;
                    mergeEdited.add(episodeMarker.id);
                    break;
                }

                this.#addMarkerStatement(transaction, episodeId, i, baseStart, episodeEnd);
                episodeMarkerMap[episodeId].isAdd = true;
                plainAdd.add(episodeId);
                break;
            }
        }

        // Clear existing markers and refill with reindexed markers
        Object.values(episodeMarkerMap).forEach(eg => eg.existingMarkers = []);

        await transaction.exec();
        const newMarkers = (await this.reindex(metadataId)).markers;
        for (const marker of newMarkers) {
            const markerData = new MarkerData(marker);
            if (mergeEdited.has(marker.id)) {
                episodeMarkerMap[marker.episode_id].changedMarker = markerData;
            } else if (plainAdd.has(marker.episode_id) && marker.start == baseStart) {
                // End may be truncated, so only check for start. All the checks above should guarantee
                // that only checking the start is unique.
                episodeMarkerMap[marker.episode_id].changedMarker = markerData;
            }

            episodeMarkerMap[marker.episode_id].existingMarkers.push(markerData);
        }

        Object.values(episodeMarkerMap).forEach(eg => eg.existingMarkers.sort((a, b) => a.start - b.start));
        return {
            applied : true,
            episodeMap : episodeMarkerMap,
            ignoredEpisodes : Array.from(ignoredEpisodes),
        }
    }
}

export { PlexQueryManager, Instance as PlexQueries };
