import { contentType, lookup } from 'mime-types';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

import { Log } from '../Shared/ConsoleLog.js';

import { Config } from './IntroEditorConfig.js';
import DatabaseWrapper from './DatabaseWrapper.js';
import { PlexQueries } from './PlexQueryManager.js';
import TransactionBuilder from './TransactionBuilder.js';

/** @typedef {!import('http').ServerResponse} ServerResponse */

/**
 * @typedef {Object} BackupRow
 * @property {string} marker_type
 * @property {number} start
 * @property {number} end
 * @property {number} modified_at
 * @property {number} created_at
 * @property {string} extra
 * @property {string} guid
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

/**
 * Static class that handles the import/export of markers
 */
class DatabaseImportExport {

    /**
     * Exports a database of markers for the given section (or -1 for the entire library)
     * @param {ServerResponse} response
     * @param {number} sectionId */
    static async exportDatabase(response, sectionId) {
        if (isNaN(sectionId)) {
            return response.writeHead(400).end('Invalid section id');
        }

        let sectionName = 'Server';
        if (sectionId != -1) {
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
                return response.writeHead(400).end('Invalid section id');
            }
        }

        // Save to backup subdirectory.
        // TODO: cleanup on shutdown/startup?
        const backupDir = join(Config.projectRoot(), 'Backup', 'MarkerExports');
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

        const db = await DatabaseWrapper.CreateDatabase(backupFullPath, true /*allowCreate*/);
        await db.run(CheckVersionTable);
        await db.run(ExportTable);

        const params = { $tagId : PlexQueries.markerTagId() };
        let query =
`SELECT t.text AS marker_type,
        t.time_offset AS start,
        t.end_time_offset AS end,
        t.thumb_url AS modified_at,
        t.created_at AS created_at,
        t.extra_data AS extra,
        m.guid AS guid
FROM taggings t
INNER JOIN metadata_items m ON m.id=t.metadata_item_id
WHERE t.tag_id=$tagId`;

        if (sectionId != -1) {
            query += ` AND m.library_section_id=$sectionId`;
            params.$sectionId = sectionId;
        }

        /** @type {BackupRow[]} */
        const markers = await PlexQueries.database().all(query, params);

        // Note: some markers might overlap with each other for the same GUID.
        //       This is okay, since our import method should handle it gracefully.

        const txn = new TransactionBuilder(db);
        for (const marker of markers) {
            txn.addStatement(
                `INSERT INTO markers
                    (marker_type, start, end, modified_at, created_at, extra, guid) VALUES
                    ($markerType, $start, $end, $modifiedAt, $createdAt, $extra, $guid)`,
                {
                    $markerType : marker.marker_type,
                    $start : marker.start,
                    $end : marker.end,
                    $modifiedAt : marker.modified_at,
                    $createdAt : marker.created_at,
                    $extra : marker.extra,
                    $guid : marker.guid
                });
        }

        Log.info(`Adding ${markers.length} markers to database export.`);
        await txn.exec();

        // All items have been added, close the db for writing and pipe it to the user.
        db.close();

        const stats = statSync(backupFullPath);
        if (!stats.isFile()) {
            // Failed to save db file?
            return response.writeHead(500).end('Unable to retrieve marker database.');
        }

        const mimetype = contentType(lookup(backupName));
        const readStream = createReadStream(backupFullPath);
        response.writeHead(200, {
            'Content-Type' : mimetype,
            'Content-Length' : stats.size,
            'Content-Disposition' : `attachment; filename="${backupName}"`,
        });

        Log.info(`Successfully created marker backup.`);
        readStream.pipe(response);
    }
}

export default DatabaseImportExport;
