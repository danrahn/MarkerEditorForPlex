// External dependencies
import { existsSync, mkdirSync } from "fs";
import { join as joinPath } from "path";

// Common-JS dependencies
import CreateDatabase from "./CreateDatabase.cjs";

// Client/Server shared dependencies
import { Log } from "../Shared/ConsoleLog.js";
import { MarkerData } from "../Shared/PlexTypes.js";

// Server dependencies/typedefs
import MarkerCacheManager from "./MarkerCacheManager.js";
import PlexQueryManager from "./PlexQueryManager.js";
/** @typedef {!import('./CreateDatabase.cjs').SqliteDatabase} SqliteDatabase */
/** @typedef {!import("./PlexQueryManager.js").RawMarkerData} RawMarkerData */
/** @typedef {!import("./PlexQueryManager.js").MultipleMarkerQuery} MultipleMarkerQuery */


/*
Backup table V1:

| COLUMN       | TYPE         | DESCRIPTION                                                                       |
+--------------+--------------+-----------------------------------------------------------------------------------+
| id           | INT NOT NULL | Autoincrement primary key                                                         |
+ -------------|--------------+-----------------------------------------------------------------------------------+
| op           | INT NOT NULL | The operation type, see MarkerOp above.                                           |
+--------------|--------------+-----------------------------------------------------------------------------------+
| marker_id    | INT NOT NULL | The id of the modified marker.                                                    |
+--------------|--------------+-----------------------------------------------------------------------------------+
| episode_id   | INT NOT NULL | The metadata id of the episode the marker is attached to                          |
+--------------|--------------+-----------------------------------------------------------------------------------+
| season_id    | INT NOT NULL | The metadata id of the season the marker is attached to                           |
+--------------|--------------+-----------------------------------------------------------------------------------+
| show_id      | INT NOT NULL | The metadata id of the show the marker is attached to                             |
+--------------|--------------+-----------------------------------------------------------------------------------+
| start        | INT NOT NULL | The start time of the marker                                                      |
+--------------|--------------+-----------------------------------------------------------------------------------+
| end          | INT NOT NULL | The end time of the marker                                                        |
+--------------|--------------+-----------------------------------------------------------------------------------+
| old_start    | INT          | MarkerOp.Edit only - the previous start time of the marker                        |
+--------------|--------------+-----------------------------------------------------------------------------------+
| old_end      | INT          | MarkerOp.Edit only - the previous end time of the marker                          |
+--------------|--------------+-----------------------------------------------------------------------------------+
| modified_at  | VARCHAR(255) | The date the marker was last edited, if any.                                      |
+--------------|--------------+-----------------------------------------------------------------------------------+
| created_at   | DATETIME     | The date the marker was added to the Plex database. Also follows the thumb_url    |
|              |              | schema of appending a '*' if the marker was not created by Plex.                  |
+--------------|--------------+-----------------------------------------------------------------------------------+
| recorded_at  | DATETIME     | The date the marker was added to this backup table.                               |
+--------------|--------------+-----------------------------------------------------------------------------------+
| extra_data   | VARCHAR(255) | The extra data field from the Plex database (currently "pv%3Aversion=5")          |
+--------------|--------------+-----------------------------------------------------------------------------------+
| section_uuid | VARCHAR(255) | The unique identifier for the library section this marker belongs to, aiming to   |
|              |              | avoid confusion if the same backup database is used for multiple Plex databases.  |
+--------------|--------------+-----------------------------------------------------------------------------------+
| restores_id  | INT          | MarkerOp.Restore only - the marker_id that this marker restored                   |
+--------------|--------------+-----------------------------------------------------------------------------------+
| restored_id  | INT          | If this marker was deleted by Plex and restored by the user, this is the marker   |
|              |              | id of the new marker created to replace this one.                                 |
+--------------|--------------+-----------------------------------------------------------------------------------+

Indexes:
* episode_id, season_id, show_id, section_uuid -> grouping options that may be common (find lost markers
  at the episode/season/show/section level).
* restored_id, marker_id -> potentially useful if we're making a bunch of chained calls to find a trail of deletes/restores.
*/

/**
 * The accepted operation types
 * @enum */
 const MarkerOp = {
    /** The user added a marker. */
    Add : 1,
    /** The user edited a marker. */
    Edit : 2,
    /** The user deleted a marker. */
    Delete : 3,
    /** Restoring a previous marker that exists in the table. */
    Restore : 4
};

/** The main table. See above for details. */
const ActionsTable = `
CREATE TABLE IF NOT EXISTS actions (
    id           INTEGER      PRIMARY KEY AUTOINCREMENT,
    op           INTEGER      NOT NULL,
    marker_id    INTEGER      NOT NULL,
    episode_id   INTEGER      NOT NULL,
    season_id    INTEGER      NOT NULL,
    show_id      INTEGER      NOT NULL,
    start        INTEGER      NOT NULL,
    end          INTEGER      NOT NULL,
    old_start    INTEGER,
    old_end      INTEGER,
    modified_at  VARCHAR(255) DEFAULT NULL,
    created_at   DATETIME     NOT NULL,
    recorded_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    extra_data   VARCHAR(255) NOT NULL,
    section_uuid VARCHAR(255) NOT NULL,
    restores_id  INTEGER,
    restored_id  INTEGER
);
`;

/**
 * A full row in the Actions table
 * @typedef {{id: number, op: MarkerOp, marker_id: number, episode_id: number, season_id: number,
 *            show_id: number, start: number, end: number, old_start: number?, old_end: number?,
 *            modified_at: string?, created_at: string, recorded_at: string, extra_data: string,
 *            section_uuid: string, restores_id: number?, restored_id: number? }} MarkerAction
 */

/**
 * A map of purged markers
 * @typedef {{ [sectionUUID: string] : { [showId: number] : { [seasonId: number] : { [episodeId: number] : { [markerId: number] : MarkerAction } } } } }} PurgeMap
 */

/** Single-row table that indicates the current version of the actions table. */
const CheckVersionTable = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER
);
INSERT INTO schema_version (version) SELECT 0 WHERE NOT EXISTS (SELECT * FROM schema_version);
`;

/** The current table schema version. */
const CurrentSchemaVersion = 1;

/** "Create index if not exists"
 * @type {(indexName: string, columnName: string) => string} */
const ciine = (indexName, columnName) => `CREATE INDEX IF NOT EXISTS idx_actions_${indexName} ON actions(${columnName})`;

/** The list of CREATE INDEX statements to execute after creating the Actions table. */
const CreateIndexes = `
${ciine('uuid', 'section_uuid')};
${ciine('eid', 'episode_id')};
${ciine('seasonid', 'season_id')};
${ciine('showid', 'show_id')};
${ciine('mid', 'marker_id')};
${ciine('resid', 'restored_id')};
`;

// Queries to execute when upgrading from SchemaUpgrades[version] to SchemaUpgrades[version + 1]
const SchemaUpgrades = [
    // 0 -> 1: New database. Create the V1 table and its indexes. (and drop the existing actions table as a precaution)
    `DROP TABLE IF EXISTS actions;
    ${ActionsTable} ${CheckVersionTable} ${CreateIndexes}
    UPDATE schema_version SET version=1`,
];

/**
 * The MarkerRecorder class handles interactions with a database that keeps track of all the user's marker actions.
 *
 * The main motivation behind this class is Plex's behavior of wiping out all intro markers when a new episode is
 * added to a season (even its own previous markers). This database of recorded actions can be used to help
 * determine what user-modified markers no longer exist, and restore them in the Plex database.
 *
 * [Maybe] TODO: Add a different view to the main page that shows recently added episodes, and allow drilling down
 * into its season to detect whether any markers were lost, and give the user the option to recover them.
 */
class MarkerBackupManager {
    /** @type {SqliteDatabase} */
    #actions;

    /** @type {PlexQueryManager} */
    #plexQueries;

    /** Unique identifiers for the library sections of the existing database.
     * Used to properly map a marker action to the right library, regardless of the underlying database used.
     * @type {{[sectionId: number], string}} */
    #uuids = {};

    /** @type {PurgeMap} */
    #purgeCache = null;

    /**
     * @param {PlexQueryManager} plexQueries The query manager for the Plex database
     * @param {string} projectRoot The root of this project, to determine where the backup database is.
     * @param {() => void} callback The function in invoke after we have successfully initialized this class.
     * @throws If we run into any errors while initializing the database. */
    constructor(plexQueries, projectRoot, callback) {
        this.#plexQueries = plexQueries;

        plexQueries.sectionUuids((err, sections) => {
            if (err) {
                Log.error(`Unable to get existing library sections. Can't properly backup marker actions`);
                throw err;
            }

            for (const section of sections) {
                this.#uuids[section.id] = section.uuid;
            }

            const dbPath = joinPath(projectRoot, 'Backup');
            if (!existsSync(dbPath)) {
                Log.verbose('Backup path does not exist, creating it.');
                mkdirSync(dbPath);
            }

            const fullPath = joinPath(dbPath, 'markerActions.db');
            if (!existsSync(fullPath)) {
                // Not strictly necessary, but nice for logging.
                Log.info(`No backup marker database found, creating it (${fullPath}).`);
            }

            this.#actions = CreateDatabase(fullPath, true /*allowCreate*/, (err) => {
                if (err) {
                    Log.error('Unable to create/open backup database, exiting...');
                    throw err;
                }

                this.#actions.exec(CheckVersionTable, (err) => { if (err) { throw err; }
                    this.#actions.get('SELECT version FROM schema_version;', (err, row) => { if (err) { throw err; }
                        const version = row ? row.version : 0;
                        if (version != CurrentSchemaVersion) {
                            if (version != 0) {
                                // Only log if this isn't a new database, i.e. version isn't 0.
                                Log.info(`Old database schema detected (${version}), attempting to upgrade.`);
                            }

                            this.#upgradeSchema(version, callback);
                        } else {
                            Log.info(fullPath, 'Initalized backup database');
                            callback();
                        }
                    })
                });
            });
        });
    }

    /** Closes the database connection. */
    close() {
        this.#actions?.close();
    }

    /**
     * Attempts to update the database to match the current schema.
     * @param {number} oldVersion The current schema version of the backup database.
     * @param {() => void} finalCallback The function to invoke once the database is up to date. */
    #upgradeSchema(oldVersion, finalCallback) {
        const nextVersion = oldVersion + 1;
        Log.info(`Upgrading from schema version ${oldVersion} to ${nextVersion}...`);
        this.#actions.exec(SchemaUpgrades[oldVersion], (err) => { if (err) { throw err; }
            if (nextVersion != CurrentSchemaVersion) {
                this.#upgradeSchema(nextVersion, finalCallback);
            } else {
                Log.info('Successfully upgraded database schema.');
                Log.info('Initalized backup database');
                finalCallback();
            }
        });
    }

    /**
     * Records a marker that was added to the Plex database.
     * @param {MarkerData} marker */
    recordAdd(marker) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'Unable to record added marker - unexpected section id');
            return;
        }

        // I should probably use the real timestamps from the database, but I really don't think it matters if they're a few milliseconds apart.
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, start, end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP || "*", CURRENT_TIMESTAMP, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Add, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.start, marker.end, this.#uuids[marker.sectionId]];
        this.#actions.run(query, parameters, (err) => {
            if (err) {
                Log.error(err.message, 'Unable to record added marker');
            } else {
                Log.verbose(`Marker add of id ${marker.id} added to backup.`);
            }
        });
    }

    /**
     * Records a marker that was edited in the Plex database.
     * @param {MarkerData} marker */
    recordEdit(marker, oldStart, oldEnd) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'Unable to record edited marker - unexpected section id');
            return;
        }

        const modified = 'CURRENT_TIMESTAMP' + (marker.createdByUser ? ' || "*"' : '');
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, start, end, old_start, old_end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, ?, ?, ${modified}, ?, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Edit, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.start, marker.end, oldStart, oldEnd, marker.createDate, this.#uuids[marker.sectionId]];
        this.#actions.run(query, parameters, (err) => {
            if (err) {
                Log.error(err.message, 'Unable to record edited marker');
            } else {
                Log.verbose(`Marker edit of id ${marker.id} added to backup.`);
            }
        });
    }

    /**
     * Records a marker that was deleted from the Plex database.
     * @param {MarkerData} marker */
    recordDelete(marker) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'Unable to record deleted marker - unexpected section id');
            return;
        }

        const modified = 'CURRENT_TIMESTAMP' + (marker.createdByUser ? ' || "*"' : '');
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, start, end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, ${modified}, ?, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Delete, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.start, marker.end, marker.createDate, this.#uuids[marker.sectionId]];
        this.#actions.run(query, parameters, (err) => {
            if (err) {
                Log.error(err.message, 'Unable to record deleted marker');
            } else {
                Log.verbose(`Marker delete of id ${marker.id} added to backup.`);
            }
        });
    }

    /**
     * Records a restore operation in the database.
     * @param {RawMarkerData} newMarker The new marker that was added
     * @param {number} oldMarkerId The old id of the marker the new one is based on.
     * @param {number} sectionId The id of the section this marker belongs to. */
    recordRestore(newMarker, oldMarkerId, sectionId) {
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, start, end, modified_at, created_at, extra_data, section_uuid, restores_id) VALUES
(?, ?, ?, ?, ?, ?, ?, ?, ?, "pv%3Aversion=5", ?, ?)`;

        const m = new MarkerData(newMarker);
        const modifiedDate = m.modifiedDate + (m.createdByUser ? '*' : '');
        const parameters = [MarkerOp.Restore, m.id, m.episodeId, m.seasonId, m.showId, m.start, m.end, modifiedDate, m.createDate, this.#uuids[m.sectionId], oldMarkerId];
        this.#actions.run(query, parameters, (err) => {
            if (err) {
                Log.error(err.message, 'Unable to record restoration of marker');
                return;
            }

            const updateQuery = 'UPDATE actions SET restored_id=? WHERE marker_id=? AND section_uuid=?;';
            const updateParameters = [newMarker.id, oldMarkerId, this.#uuids[sectionId]];
            this.#actions.run(updateQuery, updateParameters, (err) => {
                if (err) {
                    Log.error(err.message, 'Failed to set restored_id on purged marker');
                }
            });
        });
    }

    /**
     * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
     * @param {number} metadataId
     * @param {(err: Error?, actions: MarkerAction[]?) => void} callback */
    checkForPurges(metadataId, callback) {
        this.#plexQueries.getMarkersAuto(metadataId, (err, existingMarkers, typeInfo) => {
            if (err) { return callback(err, null); }

            let markerMap = {};
            for (const marker of existingMarkers) {
                markerMap[marker.id] = marker;
            }

            const mediaType = this.#columnFromMediaType(typeInfo.metadata_type);
            this.#getExpectedMarkers(metadataId, mediaType, typeInfo.section_id, (err, actions) => {
                if (err) { return callback(err, null); }
                let pruned = [];
                for (const action of actions) {
                    // Don't add markers that exist in the database, or whose last recorded action was a delete.
                    if (!markerMap[action.marker_id] && action.op != MarkerOp.Delete) {
                        pruned.push(action);
                    }
                }

                callback(null, pruned);
            })
        });
    }

    /**
     * Queries the backup database for markers from all sections of the server and checks
     * whether they exist in the Plex database.
     * @param {MarkerCacheManager} cacheManager
     * @param {(err: string?) => void} callback */
    buildAllPurges(cacheManager, callback) {
        this.#plexQueries.sectionUuids((err, sections) => {
            if (err) {
                return callback('Could not get sections for purge query.');
            }

            let uuidString = '';
            for (const section of sections) {
                uuidString += `section_uuid="${section.uuid}" OR `;
            }

            uuidString = uuidString.substring(0, uuidString.length - 4);

            const query = `
SELECT *, MAX(id) FROM actions
WHERE (${uuidString}) AND restored_id IS NULL
GROUP BY marker_id, section_uuid
ORDER BY id DESC;`

            this.#actions.all(query, (err, actions) => {
                if (err) { return callback(err.message); }
                for (const action of actions) {
                    if (!cacheManager.markerExists(action.marker_id)) {
                        this.#addToPurgeMap(action);
                    }
                }

                callback();
            });
        });
    }

    /**
     * Add the given marker action to the purge map.
     * @param {MarkerAction} action */
    #addToPurgeMap(action) {
        if (!this.#purgeCache) {
            this.#purgeCache = {};
        }

        if (!this.#purgeCache[action.section_uuid]) {
            this.#purgeCache[action.section_uuid] = {};
        }

        let section = this.#purgeCache[action.section_uuid];
        if (!section[action.show_id]) {
            section[action.show_id] = {};
        }
        let show = section[action.show_id];
        if (!show[action.season_id]) {
            show[action.season_id] = {};
        }
        let season = show[action.season_id];
        if (!season[action.episode_id]) {
            season[action.episode_id] = {};
        }
        season[action.episode_id][action.marker_id] = action;
    }

    /** @returns The number of purged markers found for the entire server. */
    purgeCount() {
        if (!this.#purgeCache) {
            return 0; // Didn't initialize main purge cache, return 0
        }

        let count = 0;
        for (const section of Object.values(this.#purgeCache)) {
            for (const show of Object.values(section)) {
                for (const season of Object.values(show)) {
                    for (const episode of Object.values(season)) {
                        count += Object.values(episode).length;
                    }
                }
            }
        }

        return count;
    }

    /**
     * @param {number} mediaType The metadata_type from the Plex database.
     * @returns The corresponding string for the media type.
     * @throws {TypeError} if `mediaType` is not an episode, season, or series. */
    #columnFromMediaType(mediaType) {
        switch (mediaType) {
            case 2: return 'show';
            case 3: return 'season';
            case 4: return 'episode';
            default:
                Log.error(`The caller should have verified a valid value already.`);
                throw new TypeError(`columnFromMedaiType: Unexpected media type ${mediaType}`);
        }
    }

    /**
     * Retrieve the list of markers that we expect to exist in the Plex database for a media item.
     * @param {number} metadataId
     * @param {string} mediaType The type metadataId points to (episode, season, or show)
     * @param {number} sectionId
     * @param {(err: Error?, markers: MarkerAction[]?) => void} callback */
    #getExpectedMarkers(metadataId, mediaType, sectionId, callback) {
        // Get the latest marker action for each marker associated with the given metadataId,
        // ignoring those whose last operation was a delete.
        const query = `
SELECT *, MAX(id) FROM actions
WHERE ${mediaType}_id=? AND section_uuid=? AND restored_id IS NULL
GROUP BY marker_id, ${mediaType}_id, section_uuid
ORDER BY id DESC;`
        const parameters = [metadataId, this.#uuids[sectionId]];
        this.#actions.all(query, parameters, (err, actions) => {
            if (err) { return callback(err.message, null); }
            callback(null, actions);
        });
    }

    /**
     * Attempts to restore the marker specified by the given id
     * @param {number} oldMarkerId The id of the old marker we're trying to restore.
     * @param {number} sectionId The id of the section the old marker belonged to.
     * @param {(err: Error?, restoredValues: RawMarkerData?) => void} callback */
    restoreMarker(oldMarkerId, sectionId, callback) {
        if (!(sectionId in this.#uuids)) {
            callback(`Unable to restore marker - unexpected section id: ${sectionId}`, null);
            return;
        }

        const query = 'SELECT * FROM actions WHERE marker_id=? AND section_uuid=? ORDER BY id DESC;';
        this.#actions.all(query, [oldMarkerId, this.#uuids[sectionId]], (err, rows) => {
            if (err) {
                callback(err.message, null);
                return;
            }

            if (rows.length == 0) {
                callback(`No markers found with id ${oldMarkerId} to restore.`, null);
                return;
            }

            const successFunc = (_, newMarker) => {
                this.recordRestore(newMarker, oldMarkerId, sectionId);
                callback(null, newMarker);
            }

            const failureFunc = (_, message) => {
                callback(message, null);
            }

            // Apply the latest data we have.
            const restore = rows[0];
            this.#plexQueries.addMarker(restore.episode_id, restore.start, restore.end, successFunc, failureFunc, true /*allowOverlap*/);
        });
    }

    /**
     * Ignores a purged marker to exclude it from purge queries.
     * @param {number} oldMarkerId The id of the old marker we're trying to restore.
     * @param {number} sectionId The id of the section the old marker belonged to.
     * @param {(err: Error?) => void} callback */
    ignorePurgedMarker(oldMarkerId, sectionId, callback) {
        if (!(sectionId in this.#uuids)) {
            callback(`Unable to restore marker - unexpected section id: ${sectionId}`);
            return;
        }

        // Set the restored_id to -1, which will exclude it from the 'look for purged' query,
        // while also letting us know that there isn't a real marker that
        const query = 'UPDATE actions SET restored_id=-1 WHERE marker_id=? AND section_uuid=?;';
        this.#actions.run(query, [oldMarkerId, this.#uuids[sectionId]], callback);
    }
}

export default MarkerBackupManager;
