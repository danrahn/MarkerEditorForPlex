/**
 * @typedef {{ id : number, index : number, start : number, end : number, modified_date : string, created_at : string,
 *             episode_id : number, season_id : number, show_id : number, section_id : number }} RawMarkerData
 * @typedef {(err: Error?, rows: any[]) => void} MultipleRowQuery
 * @typedef {(err: Error?, rows: RawMarkerData[])} MultipleMarkerQuery
 * @typedef {(err: Error?, row: any) => void} SingleRowQuery
 * @typedef {(err: Error?, row: RawMarkerData) => void} SingleMarkerQuery
 * @typedef {(err: Error?) => void} NoResultQuery
 */

/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */

import { Log } from "../Shared/ConsoleLog.js";
import CreateDatabase from "./CreateDatabase.cjs";

/**
 * The PlexQueryManager handles the underlying queries made to the Plex database to retrieve
 * library, season, show, episode, and marker data.
 */
class PlexQueryManager {
    /**
     * The tag id in the database that represents an intro marker.
     * @type {number} */
    #markerTagId;

    /** @type {SqliteDatabase} */
    #database;

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
     * Initializes the manager and attempts to retrieve the marker tag_id.
     * Forcefully exits the process on failure, as we can't continue with an invalid database.
     * @param {string} databasePath
     * @param {() => void} callback */
    constructor(databasePath, callback) {
        this.#database = CreateDatabase(databasePath, false /*allowCreate*/, (err) => {
            if (err) {
                Log.error(`Unable to open database. Are you sure "${databasePath}" exists?`);
                throw err;
            }

            this.#database.get('SELECT id FROM tags WHERE tag_type=12;', (err, row) => {
                if (err) {
                    Log.error(`Are you sure "${databasePath}" is the Plex database, and has at least one existing intro marker?`);
                    throw err;
                }
    
                this.#markerTagId = row.id;
                callback();
            });
        });
    }

    /** On process exit, close the database connection. */
    close() {
        if (this.#database) {
            this.#database.close();
        }
    }

    markerTagId() { return this.#markerTagId; }
    database() { return this.#database; }

    /** Retrieve all TV show libraries in the database.
     *
     * Fields returned: `id`, `name`.
     * @param {MultipleRowQuery} callback */
    getShowLibraries(callback) {
        this.#database.all('SELECT id, name FROM library_sections WHERE section_type=2', callback);
    }

    /**
     * Retrieve all shows in the given library section.
     *
     * Fields returned: `id`, `title`, `title_sort`, `original_title`, `season_count`, `episode_count`.
     * @param {number} sectionId
     * @param {MultipleRowQuery} callback */
    getShows(sectionId, callback) {
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

        this.#database.all(query, [sectionId], callback);
    }

    /**
     * Retrieve all seaons in the given show.
     *
     * Fields returned: `id`, `title`, `index`, `episode_count`.
     * @param {number} showMetadataId
     * @param {MultipleRowQuery} callback */
   getSeasons(showMetadataId, callback) {
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

        this.#database.all(query, [showMetadataId], callback);
    }

    /**
     * Retrieve all episodes in the given season.
     *
     * Fields returned: `title`, `index`, `id`, `season`, `season_index`, `show`, `duration`, `parts`.
     * @param {number} seasonMetadataId
     * @param {MultipleRowQuery} callback */
    getEpisodes(seasonMetadataId, callback) {
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
GROUP BY e.id;`;

        this.#database.all(query, [seasonMetadataId], callback);
    }

    /**
     * Retrieve all markers for the given episodes.
     * @param {number[]} episodeIds
     * @param {MultipleMarkerQuery} callback */
    getMarkersForEpisodes(episodeIds, callback) {
        let query = `SELECT ${this.#extendedMarkerFields} WHERE taggings.tag_id=? AND (`;
        episodeIds.forEach(episodeId => {
            if (isNaN(episodeId)) {
                // Don't accept bad keys, but don't fail the entire operation either.
                Log.warn(episodeId, 'Found bad key in queryIds, skipping');
                return;
            }
    
            query += 'metadata_item_id=' + episodeId + ' OR ';
        });
    
        // Strip trailing ' OR '
        query = query.substring(0, query.length - 4) + ') ORDER BY taggings.`index` ASC;';

        this.#database.all(query, [this.#markerTagId], callback);
    }

    /**
     * Retrieve all markers for a single episode.
     * @param {number} episodeId
     * @param {MultipleMarkerQuery} callback */
    getEpisodeMarkers(episodeId, callback) {
        this.#getMarkersForMetadataItem(episodeId, `taggings.metadata_item_id`, callback);
    }

    /**
     * Retrieve all markers for a single season.
     * @param {number} seasonId
     * @param {MultipleMarkerQuery} callback */
    getSeasonMarkers(seasonId, callback) {
        this.#getMarkersForMetadataItem(seasonId, `seasons.id`, callback);
    }

    /**
     * Retrieve all markers for a single show.
     * @param {number} showId
     * @param {MultipleMarkerQuery} callback */
    getShowMarkers(showId, callback) {
        this.#getMarkersForMetadataItem(showId, `seasons.parent_id`, callback);
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @param {(err: Error?, rows: RawMarkerData[]?, typeInfo: { metadata_type: number, section_id: number }) => void} callback */
    getMarkersAuto(metadataId, callback) {
        this.#mediaTypeFromId(metadataId, (err, typeInfo) => {
            if (err) { return callback(err, null, null); }
            let where = '';
            switch (typeInfo.metadata_type) {
                case 2: where = `seasons.parent_id`; break;
                case 3: where = `seasons.id`; break;
                case 4: where = `taggings.metadata_item_id`; break;
                default:
                    return callback(new Error(`Item ${metadataId} is not an episode, season, or series`), null, null);
            }

            this.#getMarkersForMetadataItem(metadataId, where, (err, markers) => {
                callback(err, markers, typeInfo);
            });
        });
    }

    /**
     * Retrieve the media type and section id for item with the given metadata id.
     * @param {number} metadataId
     * @param {SingleRowQuery} callback */
    #mediaTypeFromId(metadataId, callback) {
        this.#database.get('SELECT metadata_type, library_section_id AS section_id FROM metadata_items WHERE id=?;', [metadataId], (err, row) => {
            if (err) {
                return callback(err, null);
            }

            if (!row) {
                return callback(new Error(`Metadata item ${metadataId} not found in database.`), null);
            }

            callback(null, row);
        });
    }

    /**
     * Retrieve all markers tied to the given metadataId.
     * @param {number} metadataId
     * @param {string} whereClause The field to match against `metadataId`.
     * @param {MultipleMarkerQuery} callback */
    #getMarkersForMetadataItem(metadataId, whereClause, callback) {
        this.#database.all(
            `SELECT ${this.#extendedMarkerFields}
            WHERE ${whereClause}=? AND taggings.tag_id=?
            ORDER BY taggings.\`index\` ASC;`,
            [metadataId, this.#markerTagId],
            callback);
    }

    /**
     * Retrieve a single marker with the given maraker id.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} markerId
     * @param {SingleMarkerQuery} callback */
    getSingleMarker(markerId, callback) {
        this.#database.get(
            `SELECT ${this.#extendedMarkerFields} WHERE taggings.id=? AND taggings.tag_id=?;`,
            [markerId, this.#markerTagId],
            callback);
    }

    /**
     * Add a marker to the database, taking care of reindexing if necessary.
     * @param {number} metadataId The metadata id of the episode to add the marker to.
     * @param {number} startMs Start time, in milliseconds.
     * @param {number} endMs End time, in milliseconds.
     * @param {(allMarkers: RawMarkerData[], newMarker: RawMarkerData) => void} successCallback
     * @param {(userError: boolean, errorMessage: string) => void} failureCallback
     * @param {boolean} [allowOverlap=false] Whether to allow overlapping markers to be added to the database. */
    addMarker(metadataId, startMs, endMs, successCallback, failureCallback, allowOverlap=false) {
        this.getEpisodeMarkers(metadataId, (err, allMarkers) => {
            if (err) {
                return failureCallback(false, err.message);
            }

            const newIndex = this.#reindexForAdd(allMarkers, startMs, endMs);
            if (!allowOverlap && newIndex == -1) {
                return failureCallback(true, 'Overlapping markers. The existing marker should be expanded to include this range instead.');
            }

            const addQuery = 
                'INSERT INTO taggings ' +
                    '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
                'VALUES ' +
                    '(?, ?, ?, "intro", ?, ?, CURRENT_TIMESTAMP || "*", CURRENT_TIMESTAMP, "pv%3Aversion=5");';
            const parameters = [metadataId, this.#markerTagId, newIndex, startMs.toString(), endMs];
            this.#database.run(addQuery, parameters, (err) => {
                if (err) {
                    return failureCallback(false, err.message);
                }

                // Insert succeeded, update indexes of other markers if necessary
                for (const marker of allMarkers) {
                    if (marker.index != marker.newIndex) {
                        this.updateMarkerIndex(marker.id, marker.newIndex);
                    }
                }

                this.getNewMarker(metadataId, newIndex, (err, newMarker) => {
                    if (err) {
                        return failureCallback(false, 'Unable to retrieve newly added marker.');
                    }

                    successCallback(allMarkers, newMarker);
                });
            });
        });
    }

    /**
     * Finds the new indexes for the given markers, given the start and end time of the
     * new marker to be inserted. New indexes are stored in the marker's `newIndex` field,
     * and the index for the new marker is returned directly. If overlapping markers are
     * not allowed, -1 is returned if overlap is detected.
     * @param {[]} markers
     * @param {number} newStart The start time of the new marker, in millseconds.
     * @param {number} newEnd The end time of the new marker, in milliseconds.
     * @param {boolean} [allowOverlap=false] Whether we're okay with the new marker overlapping with an existing one. */
    #reindexForAdd(markers, newStart, newEnd, allowOverlap=false) {
        let pseudoData = { start : newStart, end : newEnd };
        markers.push(pseudoData);
        markers.sort((a, b) => a.start - b.start).forEach((marker, index) => {
            marker.newIndex = index;
        });

        pseudoData.index = pseudoData.newIndex;
        if (allowOverlap) {
            return pseudoData.newIndex;
        }

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
     * @param {NoResultQuery} callback */
    editMarker(markerId, index, startMs, endMs, userCreated, callback) {
        const thumbUrl = `CURRENT_TIMESTAMP${userCreated ? " || '*'" : ''}`;

        // Use startMs.toString() to ensure we properly set '0' instead of a blank value if we're starting at the very beginning of the file
        this.#database.run(
            'UPDATE taggings SET `index`=?, time_offset=?, end_time_offset=?, thumb_url=' + thumbUrl + ' WHERE id=?;',
            [index, startMs.toString(), endMs, markerId],
            callback);
    }

    /**
     * Delete the given marker from the database.
     * @param {number} markerId
     * @param {NoResultQuery} callback */
    deleteMarker(markerId, callback) {
        this.#database.run('DELETE FROM taggings WHERE id=?;', [markerId], callback);
    }

    /** Update the given marker's index to `newIndex`.
     * We assume this always succeeds, only logging an error message if something goes wrong.
     * @param {number} markerId
     * @param {number} newIndex */
    updateMarkerIndex(markerId, newIndex) {
        // Fire and forget. Fingers crossed this does the right thing.
        this.#database.run('UPDATE taggings SET `index`=? WHERE id=?;', [newIndex, markerId], (err) => {
            if (err) {
                Log.error(`Failed to update marker index for marker ${markerId} (new index: ${newIndex})`);
            }
        });
    }

    /**
     * Retrieve a marker that was just added to the database.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} metadataId The metadata id of the episode the marker belongs to.
     * @param {number} index The index of the marker in the marker table.
     * @param {SingleMarkerQuery} callback */
    getNewMarker(metadataId, index, callback) {
        this.#database.get(
            `SELECT ${this.#extendedMarkerFields} WHERE metadata_item_id=? AND tag_id=? AND taggings.\`index\`=?;`,
            [metadataId, this.#markerTagId, index],
            callback);
    }

    /**
     * Retrieve the library section id for the given episode
     * @param {number} episodeMetadataId
     * @param {SingleRowQuery} callback */
    librarySectionFromEpisode(episodeMetadataId, callback) {
        this.#database.get('SELECT library_section_id FROM metadata_items WHERE id=?', [episodeMetadataId], callback);
    }

    /**
     * Retrieve all episodes and their markers (if any) in the given section.
     *
     * Fields returned: `episode_id`, `tag_id`
     * @param {number} sectionId
     * @param {MultipleRowQuery} callback */
    markerStatsForSection(sectionId, callback) {
        // Note that the query below that grabs _all_ tags for an episode and discarding
        // those that aren't intro markers is faster than doing an outer join on a
        // temporary taggings table that only includes markers
        const query = `
SELECT e.id AS episode_id, m.tag_id AS tag_id FROM metadata_items e
    LEFT JOIN taggings m ON e.id=m.metadata_item_id
WHERE e.library_section_id=? AND e.metadata_type=4
ORDER BY e.id ASC;`;

        this.#database.all(query, [sectionId], callback);
    }

    /**
     * Return the ids and UUIDs for all sections in the database.
     * @param {MultipleRowQuery} callback */
    sectionUuids(callback) {
        this.#database.all('SELECT id, uuid FROM library_sections;', callback);
    }
}

export default PlexQueryManager;
