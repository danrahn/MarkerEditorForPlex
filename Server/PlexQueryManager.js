/**
 * @typedef {(err: Error, rows: any[]) => void} MultipleRowQuery
 * @typedef {(err: Error, row: any) => void} SingleRowQuery
 * @typedef {(err: Error) => void} NoResultQuery
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

    #defaultMarkerFields = 'id, metadata_item_id, \`index\`, time_offset AS start, end_time_offset AS end, thumb_url AS modified_date, created_at';

    /**
     * Initializes the manager and attempts to retrieve the marker tag_id.
     * Forcefully exits the process on failure, as we can't continue with an invalid database.
     * @param {string} databasePath
     * @param {() => void} callback */
    constructor(databasePath, callback) {
        this.#database = CreateDatabase(databasePath, (err) => {
            if (err) {
                Log.critical(err.message);
                Log.error(`Unable to open database. Are you sure "${Config.databasePath()}" exists?`);
                process.exit(1);
            }

            this.#database.get('SELECT id FROM tags WHERE tag_type=12;', (err, row) => {
                if (err) {
                    Log.critical(err.message);
                    Log.error(`Are you sure "${Config.databasePath()}" is the Plex database, and has at least one existing intro marker?`);
                    process.exit(1);
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
        // Multiple joins to grab the season name, show name, and episode duration (MIN so that we don't go beyond the length of the shortest episode version to be safe).
        const query = `
SELECT
    e.title AS title,
    e.\`index\` AS \`index\`,
    e.id AS id,
    p.title AS season,
    p.\`index\` AS season_index,
    g.title AS show,
    MIN(m.duration) AS duration,
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
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number[]} episodeIds
     * @param {MultipleRowQuery} callback */
    getMarkersForEpisodes(episodeIds, callback) {
        let query = `SELECT ${this.#defaultMarkerFields} FROM taggings WHERE tag_id=? AND (`;
        episodeIds.forEach(episodeId => {
            if (isNaN(episodeId)) {
                // Don't accept bad keys, but don't fail the entire operation either.
                Log.warn(episodeId, 'Found bad key in queryIds, skipping');
                return;
            }
    
            query += '`metadata_item_id`=' + episodeId + ' OR ';
        });
    
        // Strip trailing ' OR '
        query = query.substring(0, query.length - 4) + ');';

        this.#database.all(query, [this.#markerTagId], callback);
    }

    /**
     * Retrieve all markers for a single episode.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} episodeId
     * @param {MultipleRowQuery} callback */
    getEpisodeMarkers(episodeId, callback) {
        this.#database.all(
            `SELECT ${this.#defaultMarkerFields} from taggings WHERE metadata_item_id=? AND tag_id=? ORDER BY \`index\` ASC;`,
            [episodeId, this.#markerTagId],
            callback);
    }

    /**
     * Retrieve a single marker with the given maraker id.
     *
     * Fields returned: `id`, `metadata_item_id`, `index`, `start`, `end`, `modified_date`, `created_at`
     * @param {number} markerId
     * @param {SingleRowQuery} callback */
    getSingleMarker(markerId, callback) {
        this.#database.get(
            `SELECT ${this.#defaultMarkerFields} FROM taggings WHERE id=? AND text='intro';`,
            [markerId],
            callback);
    }

    /**
     * Add a marker to the database.
     * @param {number} metadataId The metadata id of the episode to add the marker to.
     * @param {number} index The index of the marker in the marker table.
     * @param {number} startMs Start time, in milliseconds.
     * @param {number} endMs End time, in milliseconds.
     * @param {NoResultQuery} callback */
    addMarker(metadataId, index, startMs, endMs, callback) {
        this.#database.run(
            'INSERT INTO taggings ' +
                '(metadata_item_id, tag_id, `index`, text, time_offset, end_time_offset, thumb_url, created_at, extra_data) ' +
            'VALUES ' +
                '(?, ?, ?, "intro", ?, ?, CURRENT_TIMESTAMP || "*", CURRENT_TIMESTAMP, "pv%3Aversion=5");',
            [metadataId, this.#markerTagId, index, startMs.toString(), endMs],
            callback);
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
     * @param {SingleRowQuery} callback */
    getNewMarker(metadataId, index, callback) {
        this.#database.get(
            `SELECT ${this.#defaultMarkerFields} FROM taggings WHERE metadata_item_id=? AND tag_id=? AND \`index\`=?;`,
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
}

export default PlexQueryManager;
