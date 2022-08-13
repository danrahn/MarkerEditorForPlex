// External dependencies
import { existsSync, mkdirSync } from "fs";
import { join as joinPath } from "path";

// Common-JS dependencies
import CreateDatabase from "./CreateDatabase.cjs";

// Client/Server shared dependencies
import { Log } from "../Shared/ConsoleLog.js";
import { EpisodeData, MarkerData } from "../Shared/PlexTypes.js";

// Server dependencies/typedefs
import DatabaseWrapper from "./DatabaseWrapper.js";
import MarkerCacheManager from "./MarkerCacheManager.js";
import PlexQueryManager from "./PlexQueryManager.js";
import ServerError from "./ServerError.js";
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

/*
Backup table V2 additions:

| COLUMN     | TYPE | DESCRIPTION                                       |
+------------+------+---------------------------------------------------+
| section_id | INT  | The library section id this marker is attached to |
+------------+------+---------------------------------------------------+

Indexes:
* section_id

While the section id isn't a wholly unique identifier if multiple servers are using the
same database, it's still convenient to have in the context of a single server's actions.
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
 *            show_id: number, section_id: number, start: number, end: number, old_start: number?,
 *            old_end: number?, modified_at: string?, created_at: string, recorded_at: string,
 *            extra_data: string, section_uuid: string, restores_id: number?, restored_id: number?,
 *            episodeData: EpisodeData? }} MarkerAction
 */

/** @typedef {{ [seasonId: number] : { [episodeId: number] : { [markerId: number] : MarkerAction } } }} PurgeShow */
/** @typedef {{ [showId: number] : { PurgeShow } }} PurgeSection */
/**
 * A map of purged markers
 * @typedef {{ [sectionId: number] : PurgeSection }} PurgeMap
 */

/** Single-row table that indicates the current version of the actions table. */
const CheckVersionTable = `
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER
);
INSERT INTO schema_version (version) SELECT 0 WHERE NOT EXISTS (SELECT * FROM schema_version);
`;

/** The current table schema version. */
const CurrentSchemaVersion = 2;

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

    // 1 -> 2: Add the section_id column and create an index for it
    // We don't want it to be null, but don't know the right value right now, so default to -1,
    // which will indicate it needs an upgrade.
    `ALTER TABLE actions ADD COLUMN section_id INTEGER NOT NULL DEFAULT -1;
    ${ciine('sectionid', 'section_id')};
    UPDATE schema_version SET version=2;`,
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
    /** @type {DatabaseWrapper} */
    #actions;

    /** @type {PlexQueryManager} */
    #plexQueries;

    /** Unique identifiers for the library sections of the existing database.
     * Used to properly map a marker action to the right library, regardless of the underlying database used.
     * @type {{[sectionId: number]: string}} */
    #uuids = {};

    /** @type {PurgeMap} */
    #purgeCache = null;

    /** @type {(async (callback: Function) => void)[]} */
    #schemaUpgradeCallbacks = [
        async () => { return Promise.resolve(); },
        this.#updateSectionIdAfterUpgrade.bind(this)
    ];

    /**
     * @param {PlexQueryManager} plexQueries The query manager for the Plex database
     * @param {string} projectRoot The root of this project, to determine where the backup database is.
     * @param {() => void} callback The function in invoke after we have successfully initialized this class.
     * @throws If we run into any errors while initializing the database. */
    constructor(plexQueries, projectRoot, callback) {
        this.#plexQueries = plexQueries;

        Log.info('MarkerBackupManager: Initializing marker backup database...');
        plexQueries.sectionUuids().then((sections) => {
            for (const section of sections) {
                this.#uuids[section.id] = section.uuid;
            }

            const dbPath = joinPath(projectRoot, 'Backup');
            if (!existsSync(dbPath)) {
                Log.verbose('MarkerBackupManager: Backup path does not exist, creating it.');
                mkdirSync(dbPath);
            }

            const fullPath = joinPath(dbPath, 'markerActions.db');
            if (!existsSync(fullPath)) {
                // Not strictly necessary, but nice for logging.
                Log.info(`MarkerBackupManager: No backup marker database found, creating it (${fullPath}).`);
            } else {
                Log.tmi(`MarkerBackupManager: Backup database found, attempting to open...`);
            }

            CreateDatabase(fullPath, true /*allowCreate*/).then((baseDb) => {
                this.#actions = new DatabaseWrapper(baseDb);
                Log.tmi('MarkerBackupManager: Opened database, checking schema');
                this.#actions.exec(CheckVersionTable).then(() => {
                    this.#actions.get('SELECT version FROM schema_version;').then((row) => {
                        const version = row ? row.version : 0;
                        if (version != CurrentSchemaVersion) {
                            if (version != 0) {
                                // Only log if this isn't a new database, i.e. version isn't 0.
                                Log.info(`MarkerBackupManager: Old database schema detected (${version}), attempting to upgrade.`);
                            }

                            this.#upgradeSchema(version).then(() => {
                                callback();
                            });
                        } else {
                            Log.info(fullPath, 'MarkerBackupManager: Initialized backup database');
                            callback();
                        }
                    });
                });
            }).catch(err => {
                Log.error('MarkerBackupManager: Unable to create/open backup database, exiting...');
                throw err;
            });
        }).catch(err => {
            Log.error(`MarkerBackupManager: Unable to get existing library sections. Can't properly backup marker actions`);
            throw err;
        });
    }

    /** Closes the database connection. */
    async close() {
        Log.verbose('MarkerBackupManager: Shutting down backup database connection...');
        try {
            await this.#actions?.close();
            Log.verbose('MarkerBackupManager: Shut down backup database connection.'); 
        } catch (err) {
            Log.error('MarkerBackupManager: Backup marker database close failed', err.message);
        }

        return Promise.resolve();
    }

    /**
     * Attempts to update the database to match the current schema.
     * @param {number} oldVersion The current schema version of the backup database. */
    async #upgradeSchema(oldVersion) {
        const nextVersion = oldVersion + 1;
        Log.info(`MarkerBackupManager: Upgrading from schema version ${oldVersion} to ${nextVersion}...`);
        await this.#actions.exec(SchemaUpgrades[oldVersion]);
        await this.#schemaUpgradeCallbacks[oldVersion]();
        if (nextVersion != CurrentSchemaVersion) {
            await this.#upgradeSchema(nextVersion);
        } else {
            Log.info('MarkerBackupManager: Successfully upgraded database schema.');
            Log.info('MarkerBackupManager: Initialized backup database');
            return Promise.resolve();
        }
    }

    /**
     * Updates the backup database to set the correct section_id, which will be -1 if
     * the user performed any actions with the V1 database schema.
     * This should be a one-time operation (per server associated with PlexIntroEditor).
     * @param {() => void} callback Callback to invoke after updating the database's section ids. */
    async #updateSectionIdAfterUpgrade() {
        Log.verbose('MarkerBackupManager: Setting section_id after upgrading schema.');

        let query = '';
        for (const [section, uuid] of Object.entries(this.#uuids)) {
            query += DatabaseWrapper.parameterize('UPDATE actions SET section_id=? WHERE section_uuid=?; ', [section, uuid])
            query += `UPDATE actions SET section_id=${section} WHERE section_uuid="${uuid}"; `;
        }

        await this.#actions.exec(query);
        return Promise.resolve();
    }

    /**
     * Checks whether the given actions need to be updated to have the correct section id
     * @param {MarkerAction[]} actions The actions to inspect
     * @param {() => void} callback Callback to invoke after updating section ids, if necessary
     * @returns Whether section ids need to be updated */
    async #verifySectionIds(actions) {
        if (actions.length <= 0 || actions[0].section_id != -1) {
            return Promise.resolve(false);
        }

        // Remnants of schema 1 => 2 transition. The initial transition should have
        // properly updated the section_id for the current server, but this is possible
        // if the user has multiple servers that are using the same backup database.
        await this.#updateSectionIdAfterUpgrade();
        return Promise.resolve(true);
    }

    /**
     * Records a marker that was added to the Plex database.
     * @param {MarkerData} marker */
    async recordAdd(marker) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'MarkerBackupManager: Unable to record added marker - unexpected section id');
            return Promise.resolve();
        }

        // I should probably use the real timestamps from the database, but I really don't think it matters if they're a few milliseconds apart.
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, section_id, start, end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP || "*", CURRENT_TIMESTAMP, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Add, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.sectionId, marker.start, marker.end, this.#uuids[marker.sectionId]];

        try {
            this.#actions.run(query, parameters);
            Log.verbose(`MarkerBackupManager: Marker add of id ${marker.id} added to backup.`);
        } catch (err) {
            Log.error(err.message, 'MarkerBackupManager: Unable to record added marker');
        }
    }

    /**
     * Records a marker that was edited in the Plex database.
     * @param {MarkerData} marker */
    async recordEdit(marker, oldStart, oldEnd) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'MarkerBackupManager: Unable to record edited marker - unexpected section id');
            return Promise.resolve();
        }

        const modified = 'CURRENT_TIMESTAMP' + (marker.createdByUser ? ' || "*"' : '');
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, section_id, start, end, old_start, old_end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${modified}, ?, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Edit, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.sectionId, marker.start, marker.end, oldStart, oldEnd, marker.createDate, this.#uuids[marker.sectionId]];

        try {
            this.#actions.run(query, parameters);
            Log.verbose(`MarkerBackupManager: Marker edit of id ${marker.id} added to backup.`);
        } catch (err) {
            Log.error(err.message, 'MarkerBackupManager: Unable to record edited marker');
        }

        return Promise.resolve();
    }

    /**
     * Records a marker that was deleted from the Plex database.
     * @param {MarkerData} marker */
    async recordDelete(marker) {
        if (!(marker.sectionId in this.#uuids)) {
            Log.error(marker.sectionId, 'MarkerBackupManager: Unable to record deleted marker - unexpected section id');
            return Promise.resolve();
        }

        const modified = 'CURRENT_TIMESTAMP' + (marker.createdByUser ? ' || "*"' : '');
        const query = `
INSERT INTO actions
(op, marker_id, episode_id, season_id, show_id, section_id, start, end, modified_at, created_at, extra_data, section_uuid) VALUES
(?, ?, ?, ?, ?, ?, ?, ?, ${modified}, ?, "pv%3Aversion=5", ?)`;
        const parameters = [MarkerOp.Delete, marker.id, marker.episodeId, marker.seasonId, marker.showId, marker.sectionId, marker.start, marker.end, marker.createDate, this.#uuids[marker.sectionId]];

        try {
            await this.#actions.run(query, parameters);
            Log.verbose(`MarkerBackupManager: Marker delete of id ${marker.id} added to backup.`);
        } catch (err) {
            Log.error(err.message, 'MarkerBackupManager: Unable to record deleted marker');
        }

        return Promise.resolve();
    }

    /**
     * Records a restore operation in the database.
     * @param {{marker : RawMarkerData, oldMarkerId : number}[]} restores The markers to record
     * @param {number} sectionId The id of the section this marker belongs to. */
    async recordRestores(restores, sectionId) {
        let transaction = 'BEGIN TRANSACTION;\n';

        for (const restore of restores) {
            const query = `
                INSERT INTO actions
                (op, marker_id, episode_id, season_id, show_id, section_id, start, end, modified_at, created_at, extra_data, section_uuid, restores_id) VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pv%3Aversion=5", ?, ?);\n`;
        
            const m = new MarkerData(restore.marker);
            const modifiedDate = m.modifiedDate + (m.createdByUser ? '*' : '');
            const parameters = [MarkerOp.Restore, m.id, m.episodeId, m.seasonId, m.showId, m.sectionId, m.start, m.end, modifiedDate, m.createDate, this.#uuids[m.sectionId], restore.oldMarkerId];
            transaction += DatabaseWrapper.parameterize(query, parameters);

            const updateQuery = 'UPDATE actions SET restored_id=? WHERE marker_id=? AND section_uuid=?;\n';
            const updateParameters = [restore.marker.id, restore.oldMarkerId, this.#uuids[sectionId]];
            transaction += DatabaseWrapper.parameterize(updateQuery, updateParameters);
        }

        transaction += `COMMIT TRANSACTION;`;

        try {
            await this.#actions.exec(transaction);
        } catch (err) {
            // Swallow the error, though we should probably actually do something about this.
            Log.error(err.message, 'MarkerBackupManager: Unable to record restoration of marker');
            return Promise.resolve();
        }

        return Promise.resolve();
    }

    /**
     * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
     * @param {number} metadataId
     * @returns {Promise<MarkerAction[]>}
     * @throws {ServerError} On failure. */
    async checkForPurges(metadataId) {
        const markerData = await this.#plexQueries.getMarkersAuto(metadataId);
        const existingMarkers = markerData.markers;
        const typeInfo = markerData.typeInfo;

        let markerMap = {};
        for (const marker of existingMarkers) {
            markerMap[marker.id] = marker;
        }

        const mediaType = this.#columnFromMediaType(typeInfo.metadata_type);
        let episodeMap = {};
        const actions = await this.#getExpectedMarkers(metadataId, mediaType, typeInfo.section_id);
        let pruned = [];
        for (const action of actions) {
            // Don't add markers that exist in the database, or whose last recorded action was a delete.
            if (!markerMap[action.marker_id] && action.op != MarkerOp.Delete) {
                if (!episodeMap[action.episode_id]) {
                    episodeMap[action.episode_id] = [];
                }

                episodeMap[action.episode_id].push(action);
                pruned.push(action);
            }
        }

        await this.#populateEpisodeData(episodeMap);
        return Promise.resolve(pruned);
    }

    /**
     * Find and attach episode data for the given episodes.
     * @param {{ [episodeId: number]: [MarkerAction] }} episodeMap  */
    async #populateEpisodeData(episodeMap) {
        if (Object.keys(episodeMap).length == 0) {
            return Promise.resolve();
        }

        const episodes = await this.#plexQueries.getEpisodesFromList(Object.keys(episodeMap));
        for (const episode of episodes) {
            if (!episodeMap[episode.id]) {
                Log.warn(`MarkerBackupManager: Couldn't find episode ${episode.id} in purge list.`);
                continue;
            }

            const episodeData = new EpisodeData(episode);
            for (const markerAction of episodeMap[episode.id]) {
                markerAction.episodeData = episodeData;
            }
        }

        return Promise.resolve();
    }

    /**
     * Queries the backup database for markers from all sections of the server and checks
     * whether they exist in the Plex database.
     * @param {MarkerCacheManager} cacheManager
     * @returns {Promise<void>} */
    async buildAllPurges(cacheManager) {
        let uuidString = '';
        let parameters = [];
        for (const uuid of Object.values(this.#uuids)) {
            parameters.push(uuid);
            uuidString += `section_uuid=? OR `;
        }

        uuidString = uuidString.substring(0, uuidString.length - 4);

        const query = `
SELECT *, MAX(id) FROM actions
WHERE (${uuidString}) AND restored_id IS NULL
GROUP BY marker_id, section_uuid
ORDER BY id DESC;`

        /** @type {MarkerAction[]} */
        const actions = await this.#actions.all(query, parameters);
        
        // If we need to update ids, hold off for now and rerun buildAllPurges once complete.
        if (await this.#verifySectionIds(actions)) {
            return this.buildAllPurges(cacheManager);
        }

        for (const action of actions) {
            if (action.op == MarkerOp.Delete) {
                continue; // Last action was a user delete, ignore it.
            }

            if (!cacheManager.markerExists(action.marker_id)) {
                this.#addToPurgeMap(action);
            }
        }

        if (!this.#purgeCache) {
            // No purged markers found, but we should initialize an empty
            // cache to indicate that.
            this.#purgeCache = {};
        }

        return Promise.resolve();
    }

    /**
     * Add the given marker action to the purge map.
     * @param {MarkerAction} action */
    #addToPurgeMap(action) {
        if (!this.#purgeCache) {
            this.#purgeCache = {};
        }

        // Each instance of PlexIntroEditor is tied to a single server's database,
        // so it's okay to use the section_id instead of the globally unique section_uuid.
        if (!this.#purgeCache[action.section_id]) {
            this.#purgeCache[action.section_id] = {};
        }

        let section = this.#purgeCache[action.section_id];
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

    /**
     * Remove the given marker action from the purge cache.
     * @param {MarkerAction} action */
    #removeFromPurgeMap(action) {
        if (!this.#purgeCache) { return; }
        if (!this.#purgeCache[action.section_id]) { return; }
        let section = this.#purgeCache[action.section_id];
        if (!section[action.show_id]) { return; }
        let show = section[action.show_id];
        if (!show[action.season_id]) { return; }
        let season = show[action.season_id];
        if (!season[action.episode_id]) { return; }
        let episode = season[action.episode_id];
        if (!episode[action.marker_id]) { return; }

        if (episode[action.marker_id]) { delete episode[action.marker_id]; }

        if (Object.keys(episode).length == 0) { delete season[action.episode_id]; }
        if (Object.keys(season).length == 0) { delete show[action.season_id]; }
        if (Object.keys(show).length == 0) { delete section[action.show_id]; }
        if (Object.keys(section).length == 0) { delete this.#purgeCache[action.section_id]; }
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
                        count += Object.keys(episode).length;
                    }
                }
            }
        }

        return count;
    }

    /**
     * Retrieve purged markers for the given library section.
     * @param {number} sectionId The section to parse.
     * @returns {Promise<PurgeSection>} Tree of purged `MarkerAction`s.
     * @throws {ServerError} If the cache is not initialized or the section does not exist. */
    async purgesForSection(sectionId) {
        if (!this.#purgeCache) {
            throw new ServerError('Purge cache not initialized, cannot query for purges.', 500);
        }

        if (!this.#purgeCache[sectionId]) {
            return Promise.resolve({});
        }

        let needsEpisodeData = {};
        for (const show of Object.values(this.#purgeCache[sectionId])) {
            for (const season of Object.values(show)) {
                for (const episode of Object.values(season)) {
                    for (const markerAction of Object.values(episode)) {
                        if (!markerAction.episodeData) {
                            if (!needsEpisodeData[markerAction.episode_id]) {
                                needsEpisodeData[markerAction.episode_id] = [];
                            }

                            needsEpisodeData[markerAction.episode_id].push(markerAction);
                        }
                    }
                }
            }
        }

        await this.#populateEpisodeData(needsEpisodeData);
        return Promise.resolve(this.#purgeCache[sectionId]);
    }

    /**
     * @param {number} mediaType The metadata_type from the Plex database.
     * @returns The corresponding string for the media type.
     * @throws {ServerError} if `mediaType` is not an episode, season, or series. */
    #columnFromMediaType(mediaType) {
        switch (mediaType) {
            case 2: return 'show';
            case 3: return 'season';
            case 4: return 'episode';
            default:
                Log.error(`MarkerBackupManager: The caller should have verified a valid value already.`);
                throw new ServerError(`columnFromMediaType: Unexpected media type ${mediaType}`, 400);
        }
    }

    /**
     * Retrieve the list of markers that we expect to exist in the Plex database for a media item.
     * @param {number} metadataId
     * @param {string} mediaType The type metadataId points to (episode, season, or show)
     * @param {number} sectionId
     * @returns {Promise<MarkerAction[]>}*/
    async #getExpectedMarkers(metadataId, mediaType, sectionId) {
        // Get the latest marker action for each marker associated with the given metadataId,
        // ignoring those whose last operation was a delete.
        const query = `
SELECT *, MAX(id) FROM actions
WHERE ${mediaType}_id=? AND section_uuid=? AND restored_id IS NULL
GROUP BY marker_id, ${mediaType}_id, section_uuid
ORDER BY id DESC;`
        const parameters = [metadataId, this.#uuids[sectionId]];

        /**@type {MarkerAction[]}*/
        const actions = await this.#actions.all(query, parameters);
        if (await this.#verifySectionIds(actions)) {
            return this.#getExpectedMarkers(metadataId, mediaType, sectionId);
        }

        return Promise.resolve(actions);
    }

    /**
     * Attempts to restore the markers specified by the given ids
     * @param {number[]} oldMarkerIds The ids of the old markers we're trying to restore.
     * @param {number} sectionId The id of the section the old marker belonged to. */
    async restoreMarkers(oldMarkerIds, sectionId) {
        if (!(sectionId in this.#uuids)) {
            throw new ServerError(`Unable to restore marker - unexpected section id: ${sectionId}`, 400);
        }

        Log.verbose(`MarkerBackupManager: Attempting to restore ${oldMarkerIds.length} marker(s).`);
        let query = 'SELECT * FROM actions WHERE (';
        let parameters = [];
        for (const oldMarkerId of oldMarkerIds) {
            const markerId = parseInt(oldMarkerId);
            if (isNaN(markerId)) {
                throw new ServerError(`Trying to restore an invalid marker id ${oldMarkerId}`, 400);
            }

            parameters.push(markerId);
            query += `marker_id=? OR `;
        }

        query = query.substring(0, query.length - 4);
        parameters.push(this.#uuids[sectionId]);
        query += `) AND section_uuid=? ORDER BY id DESC;`;

        /** @type {MarkerAction[]} */
        const rows = await this.#actions.all(query, parameters);
        if (rows.length == 0) {
            throw new ServerError(`No markers found with ids ${oldMarkerIds} to restore.`, 400);
        }

        let foundMarkers = {};

        /** @type {{ [episode_id: number] : MarkerAction[] }} */
        let toRestore = {};
        for (const markerAction of rows) {
            if (foundMarkers[markerAction.marker_id]) {
                continue;
            }

            foundMarkers[markerAction.marker_id] = true;
            if (!toRestore[markerAction.episode_id]) {
                toRestore[markerAction.episode_id] = [];
            }

            toRestore[markerAction.episode_id].push(markerAction);
        }

        const markerData = await this.#plexQueries.bulkRestore(toRestore);
        const newMarkers = markerData.newMarkers;
        const ignoredMarkers = markerData.identicalMarkers;

        let restoredList = [];

        for (const newMarker of newMarkers) {
            let oldAction = toRestore[newMarker.episode_id].filter(a => a.start == newMarker.start && a.end == newMarker.end);
            if (oldAction.length != 1) {
                Log.warn(`Unable to match new marker against old marker action, some things may be out of sync.`);
                continue;
            }

            oldAction = oldAction[0];
            restoredList.push({ marker : newMarker, oldMarkerId : oldAction.marker_id });

            // We fire and forget the restoration action, so we're really just assuming we did
            // the right thing and preemptively remove it from the purge map.
            this.#removeFromPurgeMap(oldAction);
        }

        await this.recordRestores(restoredList, sectionId);
        restoredList = []; // reset for ignored markers.

        // Essentially the same loop as above, but separate to distinguish between newly added and existing markers
        for (const ignoredMarker of ignoredMarkers) {
            let oldAction = toRestore[ignoredMarker.episode_id].filter(a => a.start == ignoredMarker.start && a.end == ignoredMarker.end);
            if (oldAction.length != 1) {
                Log.warn(`Unable to match identical marker against old marker action, some things may be out of sync.`);
                continue;
            }

            oldAction = oldAction[0];
            Log.tmi(`MarkerBackupManager::restoreMarkers: Identical marker found, setting it as the restored id.`);
            restoredList.push({ marker : ignoredMarker.getRaw(), oldMarkerId : oldAction.marker_id });
            this.#removeFromPurgeMap(oldAction);
        }

        await this.recordRestores(restoredList, sectionId);

        return Promise.resolve({ restoredMarkers : newMarkers, existingMarkers : ignoredMarkers.map(x => x.getRaw()) });
    }

    /**
     * Ignores purged markers to exclude them from purge queries.
     * @param {number[]} oldMarkerIds The ids of the old markers we're trying to ignore.
     * @param {number} sectionId The id of the section the old markers belonged to. */
    async ignorePurgedMarkers(oldMarkerIds, sectionId,) {
        if (!(sectionId in this.#uuids)) {
            throw new ServerError(`Unable to restore marker - unexpected section id: ${sectionId}`, 400);
        }

        let idSet = {};
        Log.verbose(`MarkerBackupManager: Attempting to ignore ${oldMarkerIds} marker(s).`);

        // Set the restored_id to -1, which will exclude it from the 'look for purged' query,
        // while also letting us know that there isn't a real marker that
        let query = 'UPDATE actions SET restored_id=-1 WHERE (';
        let parameters = [];
        for (const oldMarkerId of oldMarkerIds) {
            const markerId = parseInt(oldMarkerId);
            if (isNaN(markerId)) {
                throw new ServerError(`Trying to restore an invalid marker id ${oldMarkerId}`, 400);
            }

            idSet[oldMarkerId] = true;
            parameters.push(markerId);
            query += `marker_id=? OR `;
        }

        query = query.substring(0, query.length - 4);
        parameters.push(this.#uuids[sectionId]);
        query += ') AND section_uuid=?';
        await this.#actions.run(query, parameters);

        // Inefficient, but I'm lazy
        for (const show of Object.values(this.#purgeCache[sectionId])) {
            for (const season of Object.values(show)) {
                for (const episode of Object.values(season)) {
                    for (const markerAction of Object.values(episode)) {
                        if (idSet[markerAction.marker_id]) {
                            this.#removeFromPurgeMap(markerAction);
                        }
                    }
                }
            }
        }

        return Promise.resolve();
    }
}

export default MarkerBackupManager;
