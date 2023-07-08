import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ContextualLog } from '../Shared/ConsoleLog.js';

import { MetadataType, PlexQueries } from './PlexQueryManager.js';
import { sendJsonError, sendJsonSuccess } from './ServerHelpers.js';
import DatabaseWrapper from './DatabaseWrapper.js';
import { MarkerConflictResolution } from '../Shared/PlexTypes.js';
import { ProjectRoot } from './IntroEditorConfig.js';
import ServerError from './ServerError.js';
import { softRestart } from './IntroEditor.js';
import TransactionBuilder from './TransactionBuilder.js';

/** @typedef {!import('http').IncomingMessage} IncomingMessage */
/** @typedef {!import('http').ServerResponse} ServerResponse */

/** @typedef {!import('./MarkerCacheManager').MarkerQueryResult} MarkerQueryResult */
/** @typedef {!import('../Shared/PlexTypes').MarkerAction} MarkerAction */

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


const Log = new ContextualLog('ImportExport');

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

        const db = await DatabaseWrapper.CreateDatabase(backupFullPath, true /*allowCreate*/);
        await db.exec(CheckVersionTable);
        await db.exec(ExportTable);

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
     * Import the markers in the database uploaded in the request.
     * @param {IncomingMessage} request
     * @param {ServerResponse} response */
    static async importDatabase(request, response) {
        try {
            const formData = rebuildFormData(await DatabaseImportExport.#awaitImport(request));
            if (!formData.database
                || !formData.database.filename
                || !formData.database.data
                || !formData.sectionId
                || isNaN(parseInt(formData.sectionId.data))
                || !formData.resolveType
                || isNaN(parseInt(formData.resolveType.data))
                || Object.keys(MarkerConflictResolution).filter(
                    k => MarkerConflictResolution[k] == parseInt(formData.resolveType.data)).length == 0) {
                throw new ServerError(`Invalid parameters for import_db`);
            }

            // Form data looks good. Write the database to a real file.
            const backupDir = join(ProjectRoot(), 'Backup', 'MarkerExports');
            mkdirSync(backupDir, { recursive : true });
            const dbData = Buffer.from(formData.database.data, 'binary');
            const fullPath = join(backupDir, `Import-${formData.database.filename}`);
            writeFileSync(fullPath, dbData);

            const stats = await DatabaseImportExport.#doImport(
                fullPath,
                parseInt(formData.sectionId.data),
                parseInt(formData.resolveType.data));

            // Try to delete the temporarily uploaded file. Not a big deal if we can't though
            try {
                rmSync(fullPath);
            } catch (err) {
                Log.warn(err.message, `Unable to clean up uploaded database file`);
            }

            return sendJsonSuccess(response, stats);

        } catch (err) {
            return sendJsonError(response, err);
        }
    }

    /**
     * Read the newly uploaded database file and attempt to import its markers into this section (or server)
     * @param {string} importedFile Full path to the uploaded database file.
     * @param {number} sectionId Section ID to apply markers to. -1 to apply server-wide
     * @param {number} resolveType The MarkerConflictResolution type */
    static async #doImport(importedFile, sectionId, resolveType) {
        const db = await DatabaseWrapper.CreateDatabase(importedFile, false /*allowCreate*/);
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

        const params = {};
        let allMedia =
`SELECT
    base.id AS id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.id END) AS season_id,
    (CASE WHEN season.id IS NULL THEN -1 ELSE season.parent_id END) AS show_id,
    base.guid AS guid,
    base.library_section_id AS library_section_id,
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
         * @param {MarkerQueryResult} baseItem Not actually a MarkerQueryResult, but very close */
        const backupRowToMarkerAction = (backupRows, baseItem) => {
            const markerActions = [];
            for (const backupRow of backupRows) {
                markerActions.push({
                    marker_type : backupRow.marker_type,
                    final : backupRow.extra.includes('%3Afinal=1'),
                    start : backupRow.start,
                    end : backupRow.end,
                    modified_at : Math.abs(backupRow.modified_at) || '',
                    created_at : backupRow.created_at,
                    extra_data : backupRow.extra,
                    user_created : backupRow.modified_at < 0,
                    parent_guid : backupRow.guid,
                    parent_id : baseItem.id,
                    season_id : baseItem.season_id,
                    show_id : baseItem.show_id,
                    section_id : baseItem.library_section_id,
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
        const plexItems = await PlexQueries.database().all(allMedia, params);
        for (const item of plexItems) {
            if (!sectionsToUpdate[item.library_section_id]) {
                sectionsToUpdate[item.library_section_id] = {
                    sectionType : item.metadata_type == MetadataType.Movie ? MetadataType.Movie : MetadataType.Show,
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

        for (const [sectionId, sectionInfo] of Object.entries(sectionsToUpdate)) {
            const itemsToUpdate = Object.keys(sectionInfo.items).length;
            if (itemsToUpdate === 0) {
                Log.verbose(`Ignoring section ${sectionId}, no relevant items.`);
                continue;
            }

            Log.info(`Attempting to restore markers for ${itemsToUpdate} items in section ${sectionId}`);
            const restoredMarkerData = await PlexQueries.bulkRestore(
                sectionInfo.items,
                parseInt(sectionId),
                sectionInfo.sectionType,
                resolveType);
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

        // Force a mini-reload, as it's easier than trying to perfectly account for the right
        // marker deltas, and import isn't expected to be a common scenario, so I don't really care
        // about the slightly worse user experience.
        await softRestart();

        return stats;
    }

    /**
     * Waits for all the data from the request to load, returning a promise
     * that resolves to the complete text.
     *
     * Note: There's a hard 32MB limit. If anything larger is needed in the future,
     *       this data should probably get streamed to a file first, and then read in chunks.
     * @param {IncomingMessage} request
     * @returns {Promise<string>} */
    static async #awaitImport(request) {
        return new Promise((resolve, reject) => {
            let body = '';
            request.on('data', chunk => {
                if (Buffer.isBuffer(chunk)) {
                    body += chunk.toString('binary');
                } else {
                    body += chunk;
                }

                if (body.length > 1024 * 1024 * 32) {
                    Log.error(`Import upload failed - File too large.`);
                    reject('File is too large.');
                }
            });
            request.on('end', () => {
                Log.verbose(`File uploaded (${body.length} bytes)`);
                resolve(body);
            });
        });
    }

    /**
     * On server close, clear out any exported/imported databases that are still lying around, if we can. */
    static Close() {
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

/** Regex that looks for expected 'Content-Disposition: form-data' key/value pairs */
const headerRegex = /\b(?<key>\w+)="(?<value>[^"]+)"/g;

/**
 * Takes raw form input and rebuilds a key-value dictionary.
 * Note: I _really_ should use a library. There's probably a built-in one I
 *       should be using, but a very quick search didn't bring up anything.
 * @param {string} raw */
function rebuildFormData(raw) {
    const data = {};

    const sentinelBase = raw.substring(0, raw.indexOf('\r\n'));
    if (!sentinelBase) {
        throw new ServerError('Malformed response, did not find form data sentinel', 500);
    }

    const sentinel = sentinelBase + '\r\n';
    const responseEnd = '\r\n' + sentinelBase + '--\r\n';

    let index = sentinel.length;
    for (;;) {
        const headerStart = index;
        const headerEnd = raw.indexOf('\r\n\r\n', index) + 4;
        index = headerEnd;
        if (!sentinel || headerEnd === 3) {
            return data;
        }

        const rawHeaders = raw.substring(headerStart, headerEnd).split('\r\n').filter(h => !!h);
        let name = '';
        // We specifically are looking for form-data
        // Also make our lives easier and assume no double quotes in names
        for (const header of rawHeaders) {
            const headerNorm = header.toLowerCase();
            if (headerNorm.startsWith('content-disposition:') && headerNorm.includes('form-data;')) {
                const fields = {};
                for (const match of header.matchAll(headerRegex)) {
                    fields[match.groups.key] = match.groups.value;
                }

                if (!fields['name']) {
                    throw new ServerError('Invalid form data - no name for field', 500);
                }

                name = fields['name'];
                data[name] = fields;

                // Are any other fields relevant? If so, parse those as well instead of breaking
                break;
            }
        }

        const dataStart = index;
        const dataEnd = raw.indexOf(sentinelBase, index);
        if (dataEnd === -1) {
            throw new ServerError('Invalid form input - could not find data sentinel', 500);
        }

        data[name].data = raw.substring(dataStart, dataEnd - 2); // Don't include CRLF before sentinel
        index = raw.indexOf(sentinel, dataEnd);
        if (index === -1) {
            // If we don't find the sentinel, we better be at the end
            if (raw.indexOf(responseEnd, dataEnd - 2) != dataEnd - 2) {
                Log.warn('Unexpected response end, returning what we have.');
            }

            Log.verbose(`Parsed POST body. Found ${Object.keys(data).length} fields.`);
            return data;
        }

        index += sentinel.length;
    }
}

export default DatabaseImportExport;
