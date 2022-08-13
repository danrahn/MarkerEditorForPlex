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

/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */
/** @typedef {!import('./MarkerBackupManager.js').MarkerAction} MarkerAction */

import { Log } from "../Shared/ConsoleLog.js";
import CreateDatabase from "./CreateDatabase.cjs";
import DatabaseWrapper from "./DatabaseWrapper.js";
import ServerError from "./ServerError.js";

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
    getRaw() { if (!this.#isRaw) { throw ServerError('Attempting to access a non-existent raw marker', 500); } return this.#raw; }

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
        Log.info(`PlexQueryManager: Verifying database ${databasePath}...`);
        /** @type {DatabaseWrapper} */
        let db;
        try {
            db = new DatabaseWrapper(await CreateDatabase(databasePath, false /*fAllowCreate*/));
        } catch (err) {
            Log.error(`PlexQueryManager: Unable to open database. Are you sure "${databasePath}" exists?`);
            throw ServerError.FromDbError(err);
        }

        Log.tmi(`PlexQueryManager: Opened database, making sure it looks like the Plex database`);
        try {
            const row = await db.get('SELECT id FROM tags WHERE tag_type=12;');
            Log.info('PlexQueryManager: Database verified');
            return Promise.resolve(new PlexQueryManager(db, pureMode, row.id));
        } catch (err) {
            Log.error(`PlexQueryManager: Are you sure "${databasePath}" is the Plex database, and has at least one existing intro marker?`);
            throw ServerError.FromDbError(err);
        }
    }

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

        return Promise.resolve();
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
     * @param {number[]} episodeMetadataIds
     * @param {MultipleRowQuery} callback
     * @returns {Promise<any[]>}*/
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
     * @param {MultipleMarkerQuery} callback
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
        for (const marker of allMarkers) {
            if (marker.index != marker.newIndex) {
                // No await, just fire-and-forget
                this.updateMarkerIndex(marker.id, marker.newIndex);
            }
        }

        const newMarker = await this.getNewMarker(metadataId, startMs, endMs);
        return Promise.resolve({ allMarkers : allMarkers, newMarker : newMarker });
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
        let transaction = 'BEGIN TRANSACTION;\n';
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
                const thumbUrl = this.#pureMode ? '""' : 'CURRENT_TIMESTAMP || "*"';
                transaction +=
                    'INSERT INTO taggings ' +
                        '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
                    'VALUES ' +
                        `(${episodeId}, ${this.#markerTagId}, ${marker.newIndex}, "intro", ${marker.start}, ${marker.end}, ${thumbUrl}, CURRENT_TIMESTAMP, "pv%3Aversion=5");\n`;
            }

            // updateMarkerIndex, without actually executing it.
            for (const marker of Object.values(existingMarkers[episodeId])) {
                if (marker.index != marker.newIndex && marker.existing()) {
                    Log.tmi(`Found marker to reindex (was ${marker.index}, now ${marker.newIndex})`);
                    transaction += 'UPDATE taggings SET `index`=' + marker.newIndex + ' WHERE id=' + marker.id + ';\n';
                }
            }
        }

        if (expectedInserts == 0) {
            // This is only expected if every marker we tried to restore already exists. In that case just
            // immediately invoke the callback without any new markers, since we didn't add any.
            Log.assert(identicalMarkers.length == potentialRestores, `PlexQueryManager::bulkRestore: identicalMarkers == potentialRestores`);
            Log.warn(`PlexQueryManager::bulkRestore: no markers to restore, did they all match against an existing marker?`);
            return Promise.resolve({ newMarkers : [], identicalMarkers : identicalMarkers });
        }

        transaction += 'COMMIT TRANSACTION;';
        Log.tmi('Built full restore query:\n' + transaction);

        try {
            this.#database.exec(transaction);
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
     * @returns {Promise<{episode_id: number, tag_id: number}[]>*/
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
}

export default PlexQueryManager;
