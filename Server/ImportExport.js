import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { MarkerConflictResolution, MarkerData } from '../Shared/PlexTypes.js';
import { MetadataType, PlexQueries } from './PlexQueryManager.js';
import { ServerEvents, waitForServerEvent } from './ServerEvents.js';
import { BackupManager } from './MarkerBackupManager.js';
import MarkerEditCache from './MarkerEditCache.js';
import { PostCommands } from '../Shared/PostCommands.js';
import { ProjectRoot } from './MarkerEditorConfig.js';
import { registerCommand } from './Commands/PostCommand.js';
import ServerError from './ServerError.js';
import SqliteDatabase from './SqliteDatabase.js';
import TransactionBuilder from './TransactionBuilder.js';

/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

/** @typedef {!import('./FormDataParse').ParsedFormData} ParsedFormData */
/** @typedef {!import('./FormDataParse').ParsedFormField} ParsedFormField */
/** @typedef {!import('./MarkerCacheManager').MarkerQueryResult} MarkerQueryResult */
/** @typedef {!import('./SqliteDatabase').DbDictParameters} DbDictParameters */
/** @typedef {!import('../Shared/PlexTypes').MarkerAction} MarkerAction */
/** @typedef {!import('../Shared/PlexTypes').OldMarkerTimings} OldMarkerTimings */

/**
 * @typedef {Object} BackupRow
 * @property {number} id
 * @property {string} marker_type
 * @property {number} start
 * @property {number} end
 * @property {number|null} modified_at
 * @property {number} created_at
 * @property {string} extra
 * @property {string} guid
 */

/**
 * @typedef {{
 *  id: number,
 *  season_id: number,
 *  show_id: number,
 *  guid: string,
 *  section_id: number,
 *  metadata_type: number
 * }} MinimalBaseItem
 */

/*
Export table V1:

Keep this pretty simple as far as matching goes. Don't bother with potentially more
specific matching options (matching metadata_id/section_id), just keep track of the
GUID, so that it can be applied to any item in the library that might not be the exact
same file, and should also persist across e.g. the Plex Dance.

| COLUMN       | TYPE          | DESCRIPTION                                                          |
+--------------+---------------+----------------------------------------------------------------------+
| id           | INT           | Autoincrement primary key                                            |
+--------------+---------------+----------------------------------------------------------------------+
| marker_type  | TEXT NOT NULL | The type of marker (intro/credits/etc)                               |
+--------------+---------------+----------------------------------------------------------------------+
| start        | INT NOT NULL  | Start timestamp of the marker (ms)                                   |
+--------------+---------------+----------------------------------------------------------------------+
| end          | INT NOT NULL  | End timestamp of the marker (ms)                                     |
+--------------+---------------+----------------------------------------------------------------------+
| modified_at  | INT [NULL]    | Modified date, if any (epoch seconds). Negative implies user-created |
+--------------+---------------+----------------------------------------------------------------------+
| created_at   | INT NOT NULL  | Create date (epoch seconds)                                          |
+--------------+---------------+----------------------------------------------------------------------+
| extra        | TEXT NOT NULL | Extra data indicating e.g. final credits, and detection version      |
+--------------+---------------+----------------------------------------------------------------------+
| guid         | TEXT NOT NULL | GUID of the associated episode/movie                                 |
+--------------+---------------+----------------------------------------------------------------------+

*/

/** Main table schema */
const ExportTable = `
CREATE TABLE IF NOT EXISTS markers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    marker_type  TEXT    NOT NULL,
    start        INTEGER NOT NULL,
    end          INTEGER NOT NULL,
    modified_at  INTEGER DEFAULT NULL,
    created_at   INTEGER NOT NULL,
    extra        TEXT    NOT NULL,
    guid         TEXT    NOT NULL
);`;

const CurrentSchemaVersion = 1;

/** Housekeeping table */
const CheckVersionTable = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER);
INSERT INTO schema_version (version) SELECT ${CurrentSchemaVersion} WHERE NOT EXISTS (SELECT * FROM schema_version);`;


const Log = new ContextualLog('ImportExport');

/**
 * Static class that handles the import/export of markers
 */
export class DatabaseImportExport {

    /**
     * Exports a database of markers for the given section (or -1 for the entire library)
     * @param {ServerResponse} response
     * @param {number} sectionId */
    static async exportDatabase(response, sectionId) {
        if (isNaN(sectionId)) {
            response.writeHead(400).end('Invalid section id');
            return;
        }

        let sectionName = 'Server';
        if (sectionId !== -1) {
            let valid = false;
            const sections = await PlexQueries.getLibraries();
            for (const section of sections) {
                if (section.id === sectionId) {
                    sectionName = `${section.name.replace(/[<>:"/\\|?*]/g, '')}[${section.id}]`;
                    valid = true;
                    break;
                }
            }

            if (!valid) {
                response.writeHead(400).end('Invalid section id');
                return;
            }
        }

        // Save to backup subdirectory.
        const backupDir = join(ProjectRoot(), 'Backup', 'MarkerExports');
        mkdirSync(backupDir, { recursive : true });
        const time = new Date();
        const padL = (val, pad=2) => { val = val.toString(); return '0'.repeat(Math.max(0, pad - val.length)) + val; };

        const backupName = `${sectionName}-${time.getFullYear()}.${padL(time.getMonth() + 1)}.` +
                           `${padL(time.getDate())}-${padL(time.getHours())}.${padL(time.getMinutes())}.${padL(time.getSeconds())}.db`;
        const backupFullPath = join(backupDir, backupName);
        if (existsSync(backupFullPath)) {
            Log.warn(`Backup file "${backupName}" already exists, removing first...`);
            rmSync(backupFullPath); // Just bubble up any errors
        }

        const db = await SqliteDatabase.OpenDatabase(backupFullPath, true /*allowCreate*/);
        await db.exec(CheckVersionTable);
        await db.exec(ExportTable);

        /** @type {DbDictParameters} */
        const params = { $tagId : PlexQueries.markerTagId() };
        let query =
`SELECT t.id AS id,
        t.text AS marker_type,
        t.time_offset AS start,
        t.end_time_offset AS end,
        t.created_at AS created_at,
        t.extra_data AS extra,
        m.guid AS guid
FROM taggings t
INNER JOIN metadata_items m ON m.id=t.metadata_item_id
WHERE t.tag_id=$tagId`;

        if (sectionId !== -1) {
            query += ` AND m.library_section_id=$sectionId`;
            params.$sectionId = sectionId;
        }

        /** @type {BackupRow[]} */
        const markers = await PlexQueries.database().all(query, params);

        // Note: some markers might overlap with each other for the same GUID.
        //       This is okay, since our import method should handle it gracefully.

        const txn = new TransactionBuilder(db);
        for (const marker of markers) {
            // TODO: Update the schema to add user_created instead of this current disconnect.
            let modifiedAt = MarkerEditCache.getModifiedAt(marker.id);
            if (modifiedAt === null && MarkerEditCache.getUserCreated(marker.id)) {
                modifiedAt = -marker.created_at;
            }

            txn.addStatement(
                `INSERT INTO markers
                    (marker_type, start, end, modified_at, created_at, extra, guid) VALUES
                    ($markerType, $start, $end, $modifiedAt, $createdAt, $extra, $guid)`,
                {
                    $markerType : marker.marker_type,
                    $start : marker.start,
                    $end : marker.end,
                    $modifiedAt : modifiedAt,
                    $createdAt : marker.created_at,
                    $extra : marker.extra,
                    $guid : marker.guid,
                });
        }

        Log.info(`Adding ${markers.length} markers to database export.`);
        await txn.exec();

        // All items have been added, close the db for writing and pipe it to the user.
        db.close();

        const stats = statSync(backupFullPath);
        if (!stats.isFile()) {
            // Failed to save db file?
            response.writeHead(500).end('Unable to retrieve marker database.');
            return;
        }

        const mimetype = 'application/x-sqlite3';
        const readStream = createReadStream(backupFullPath);
        response.writeHead(200, {
            'Content-Type' : mimetype,
            'Content-Length' : stats.size,
            'Content-Disposition' : `attachment; filename="${backupName}"`,
        });

        Log.info(`Successfully created marker backup.`);
        readStream.pipe(response);
    }

    /**
     * @param {ParsedFormField} database
     * @param {number} sectionId
     * @param {number} resolveType */
    static async importDatabase(database, sectionId, resolveType) {
        if (!database.filename) {
            throw new ServerError(`importDatabase: no filename provided for database`);
        }

        if (Object.keys(MarkerConflictResolution).filter(k => MarkerConflictResolution[k] === resolveType).length === 0) {
            throw new ServerError(`importDatabase: resolveType must be a MarkerConflictResolution type, found ${resolveType}`);
        }

        const backupDir = join(ProjectRoot(), 'Backup', 'MarkerExports');
        mkdirSync(backupDir, { recursive : true });
        const dbData = Buffer.from(database.data, 'binary');
        const fullPath = join(backupDir, `Import-${database.filename}`);
        writeFileSync(fullPath, dbData);

        const stats = await DatabaseImportExport.#doImport(fullPath, sectionId, resolveType);

        // Try to delete the temporarily uploaded file. Not a big deal if we can't though
        try {
            rmSync(fullPath);
        } catch (err) {
            Log.warn(err.message, `Unable to clean up uploaded database file`);
        }

        // Success. Instead of trying to properly adjust everything, rebuild necessary caches from
        // scratch, since this shouldn't be a common action, so efficiency isn't super important.
        await Promise.all([
            waitForServerEvent(ServerEvents.ReloadMarkerStats),
            waitForServerEvent(ServerEvents.RebuildPurgedCache)]);
        return stats;
    }

    /**
     * Read the newly uploaded database file and attempt to import its markers into this section (or server)
     * @param {string} importedFile Full path to the uploaded database file.
     * @param {number} sectionId Section ID to apply markers to. -1 to apply server-wide
     * @param {number} resolveType The MarkerConflictResolution type */
    static async #doImport(importedFile, sectionId, resolveType) {
        const db = await SqliteDatabase.OpenDatabase(importedFile, false /*allowCreate*/);
        try {
            let row = await db.get('SELECT version FROM schema_version;');
            if (row.version > CurrentSchemaVersion) {
                throw new ServerError('Database was created with a newer version of this application, cannot continue.', 400);
            }

            row = await db.get('SELECT * from markers LIMIT 1;');
            if (!row) {
                throw new ServerError('Database does not have any markers to import!', 400);
            }
        } catch (err) {
            Log.error(err);
            if (err instanceof ServerError) {
                throw err;
            }

            throw new ServerError('Unable to read imported database. Are you sure it was created by this application?', 400);
        }

        // We've verified our data seems correct. Now grab all of them and
        // transform them into something that bulkRestore can reason with.
        /** @type {BackupRow[]} */
        const backupMarkers = await db.all('SELECT * FROM markers;');
        db.close(); // We don't need this once we've read all rows.

        /** @type {{[guid: string]: BackupRow[]}} */
        const backupGuidMap = {};
        for (const backupMarker of backupMarkers) {
            (backupGuidMap[backupMarker.guid] ??= []).push(backupMarker);
        }

        /** @type {DbDictParameters} */
        const params = {};
        let allMedia =
`SELECT
    base.id AS id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.id END) AS season_id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.parent_id END) AS show_id,
    base.guid AS guid,
    base.library_section_id AS section_id,
    base.metadata_type AS metadata_type
FROM metadata_items base
LEFT JOIN metadata_items season ON base.parent_id=season.id
WHERE (base.metadata_type=1 OR base.metadata_type=4)`;

        if (sectionId !== -1) {
            allMedia += ' AND base.library_section_id=$sectionId';
            params.$sectionId = sectionId;
        }

        allMedia += ';';

        /**
         * @param {BackupRow[]} backupRows
         * @param {MinimalBaseItem} baseItem Not actually a MarkerQueryResult, but close */
        const backupRowToMarkerAction = (backupRows, baseItem) => {
            const markerActions = [];
            for (const backupRow of backupRows) {
                markerActions.push({
                    marker_type : backupRow.marker_type,
                    final : backupRow.extra.includes('%3Afinal=1') ? 1 : 0,
                    start : backupRow.start,
                    end : backupRow.end,
                    modified_at : backupRow.modified_at === null ? null : Math.abs(backupRow.modified_at),
                    created_at : backupRow.created_at,
                    extra_data : backupRow.extra,
                    user_created : backupRow.modified_at < 0,
                    parent_guid : backupRow.guid,
                    parent_id : baseItem.id,
                    season_id : baseItem.season_id,
                    show_id : baseItem.show_id,
                    section_id : baseItem.section_id,
                });
            }

            return markerActions;
        };

        // For each section, go through all items and check to see if its guid matches one from the imported DB.
        // If it does, create a mapping the Plex DB's metadata id to the markers associated with that guid.
        // Note that this means multiple individual items can match to the same set of markers, e.g. the same
        // movies/episodes across different episodes, or split apart items (that don't use Editions).

        /** @type {{[sectionId: number]: {sectionType: number, items : {[baseId: number]: MarkerAction[]}}}} */
        const sectionsToUpdate = {};
        /** @type {MinimalBaseItem[]} */
        const plexItems = await PlexQueries.database().all(allMedia, params);
        for (const item of plexItems) {
            if (!sectionsToUpdate[item.library_section_id]) {
                sectionsToUpdate[item.library_section_id] = {
                    sectionType : item.metadata_type === MetadataType.Movie ? MetadataType.Movie : MetadataType.Show,
                    items : {},
                };
            }

            if (backupGuidMap[item.guid]) {
                sectionsToUpdate[item.library_section_id].items[item.id] = backupRowToMarkerAction(backupGuidMap[item.guid], item);
            }
        }

        const stats = {
            added : 0,
            identical : 0,
            deleted : 0,
            modified : 0,
            ignored : 0
        };

        for (const [sectionIdToUpdate, sectionInfo] of Object.entries(sectionsToUpdate)) {
            const itemsToUpdate = Object.keys(sectionInfo.items).length;
            if (itemsToUpdate === 0) {
                Log.verbose(`Ignoring section ${sectionIdToUpdate}, no relevant items.`);
                continue;
            }

            Log.info(`Attempting to restore markers for ${itemsToUpdate} items in section ${sectionIdToUpdate}`);
            const restoredMarkerData = await PlexQueries.bulkRestore(
                sectionInfo.items,
                parseInt(sectionIdToUpdate),
                sectionInfo.sectionType,
                resolveType);

            // Add changed markers to the backup database. While we'll clear out the BackupManager after this
            // action, we still want the database to know about these changes so they can be restored if needed.
            await BackupManager.recordAdds(restoredMarkerData.newMarkers.map(x => new MarkerData(x)));
            await BackupManager.recordDeletes(restoredMarkerData.deletedMarkers.map(x => new MarkerData(x)));
            /** @type {OldMarkerTimings} */
            const oldMarkerTimings = {};
            /** @type {MarkerData[]} */
            const editedMarkers = [];
            // Copied from MarkerBackupManager. Can this be shared?
            for (const mod of restoredMarkerData.modifiedMarkers) {
                const edited = mod.marker;
                const newData = mod.newData;
                oldMarkerTimings[edited.id] = { start : edited.start, end : edited.end };
                edited.start = newData.newStart;
                edited.end = newData.newEnd;
                edited.modified_date = newData.newModified;
                edited.marker_type = newData.newType;
                edited.final = newData.newFinal;
                editedMarkers.push(new MarkerData(edited));
            }

            await BackupManager.recordEdits(editedMarkers, oldMarkerTimings);

            stats.added += restoredMarkerData.newMarkers.length;
            stats.identical += restoredMarkerData.identicalMarkers.length;
            stats.deleted += restoredMarkerData.deletedMarkers.length;
            stats.modified += restoredMarkerData.modifiedMarkers.length;
            stats.ignored += restoredMarkerData.ignoredActions.length;
        }

        const ll = (k, v) => `\n\t\t${k}: ${v}`;
        Log.info(`Successfully imported markers:` +
            ll('Markers imported', stats.added) +
            ll('Existing markers deleted (overwrite)', stats.deleted) +
            ll('Existing markers modified (merged)', stats.modified) +
            ll('Ignored imports', stats.ignored));

        return stats;
    }

    /**
     * On server close, clear out any exported/imported databases that are still lying around, if we can.
     * @param {boolean} fullShutdown */
    static Close(fullShutdown) {
        if (!fullShutdown) {
            // We can wait until server shutdown to clean everything up
            return;
        }

        const tempRoot = join(ProjectRoot(), 'Backup', 'MarkerExports');
        if (!existsSync(tempRoot)) {
            Log.verbose('No database files to clean up.');
            return;
        }

        try {
            rmSync(tempRoot, { recursive : true, force : true });
            Log.verbose('Successfully removed cached databases.');
        } catch (err) {
            Log.warn(err.message, 'Failed to clear cached databases.');
        }
    }
}

/**
 * Register POST handlers related to custom marker database import/export. */
export function registerImportExportCommands() {
    registerCommand(PostCommands.ImportDb,
        q => DatabaseImportExport.importDatabase(q.fs('database'), q.fi('sectionId'), q.fi('resolveType')));
}
