import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';
import { TestLog } from '../TestRunner.js';

import { createReadStream, createWriteStream, existsSync, rmSync } from 'fs';
import FormData from 'form-data';
import { gunzipSync } from 'zlib';
import { join } from 'path';

import { ExtraData } from '../../Server/PlexQueryManager.js';
import { MarkerConflictResolution } from '../../Shared/PlexTypes.js';
import { MarkerType } from '../../Shared/MarkerType.js';
import { Readable } from 'stream';
import SqliteDatabase from '../../Server/SqliteDatabase.js';
import TransactionBuilder from '../../Server/TransactionBuilder.js';

/** @typedef {!import('express').Response} ExpressResponse */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */

/**
 * End-to-end testing of import/export.
 */
class ImportExportTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.exportAllMarkersTest,
            this.exportSection1Test,
            this.exportSection2Test,
            this.basicImportTest,
            this.overwriteImportTest,
            this.identicalImportTest,
            this.ignoreImportTest,
            this.mergeImportTest,
            this.importMultiEpisodeGuid,
        ];
    }

    className() { return 'ImportExportTest'; }

    async testMethodSetup() {
        await this.#cleanup();
    }

    async testMethodTeardown() {
        await this.#cleanup();
    }

    /**
     * Export all markers in the database and ensure we get the right number of markers back.
     * TODO: Validation of the actual marker contents. */
    async exportAllMarkersTest() {
        const data = await this.#getExportedData(-1);
        const expected = TestBase.NextMarkerIndex - 1;
        TestHelpers.verify(data.length === expected, `Expected ${expected} markers in exported database, found ${data.length}`);
    }

    /**
     * Ensure only section 1 (TV) markers are exported. */
    async exportSection1Test() {
        const data = await this.#getExportedData(1);
        const expected = 6;
        TestHelpers.verify(data.length === expected, `Expected ${expected} markers in exported database, found ${data.length}`);
        const expectedGuids = new Set(['2', '3', '4', '6', '9', 'c', 'd', 'f']);
        for (const row of data) {
            TestHelpers.verify(expectedGuids.has(row.guid),
                `DB export should only have guids associated with Section 1, found ${row.guid}`);
        }
    }

    /**
     * Ensure only section 2 (Movies) markers are exported. */
    async exportSection2Test() {
        const data = await this.#getExportedData(2);
        const expected = 5;
        TestHelpers.verify(data.length === expected, `Expected ${expected} markers in exported database, found ${data.length}`);
        const expectedGuids = new Set(['00', '01', '02']);
        for (const row of data) {
            TestHelpers.verify(expectedGuids.has(row.guid),
                `DB export should only have guids associated with Section 2, found ${row.guid}`);
        }
    }

    /**
     * Import intro and credits markers to an episode that has no existing markers and ensure everything goes as expected. */
    async basicImportTest() {
        // DefaultMetadata.Show1.Season2.Episode1
        const importData = [
            ['intro', 0, 10000, undefined, 1000, ExtraData.Intro, '6'],
            ['credits', 500000, 550000, -1001, 1000, ExtraData.Credits, '6'],
            ['credits', 560000, 600000, 1002, 1000, ExtraData.CreditsFinal, '6'],
        ];

        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Overwrite);
        this.#verifyImportResultValues(result, {
            added : 3,
            identical : 0,
            deleted : 0,
            modified : 0,
            ignored : 0
        });

        const sd = TestBase.DefaultMetadata.Show1;
        const showId = sd.Id;
        const seasonId = sd.Season2.Id;
        const episodeId = sd.Season2.Episode1.Id;

        /** @type {SerializedMarkerData} */
        const markerMap = await this.send('query', { keys : episodeId });
        TestHelpers.verify(episodeId in markerMap);
        const markers = markerMap[episodeId];
        TestHelpers.verify(markers.length === 3, `Expected episode to have 3 markers after import, found ${markers.length}`);
        const vm = async (m, mType, start, end, index, final, db) => {
            await TestHelpers.validateMarker(m, mType, episodeId, seasonId, showId, start, end, index, final, db);
        };

        await vm(markers[0], MarkerType.Intro, 0, 10000, 0, false, this.testDb);
        await vm(markers[1], MarkerType.Credits, 500000, 550000, 1, false, this.testDb);
        await vm(markers[2], MarkerType.Credits, 560000, 600000, 2, true, this.testDb);
    }

    /**
     * Import a marker that overlaps an existing marker with an overwrite resolution, and ensure the existing marker is removed. */
    async overwriteImportTest() {
        const ep = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const importData = [['intro', ep.Marker1.Start - 1000, ep.Marker1.End - 1000, undefined, 1000, ExtraData.Intro, '3']];

        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Overwrite);
        this.#verifyImportResultValues(result, {
            added : 1,
            identical : 0,
            deleted : 1,
            modified : 0,
            ignored : 0
        });

        await this.#validateS1S1E2(ep.Marker1.Start - 1000, ep.Marker1.End - 1000);
    }

    /**
     * Import a marker that's identical to an existing marker and ensure nothing changes. */
    async identicalImportTest() {
        const ep = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const importData = [['intro', ep.Marker1.Start, ep.Marker1.End, undefined, 1000, ExtraData.Intro, '3']];
        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Overwrite);
        this.#verifyImportResultValues(result, {
            added : 0,
            identical : 1,
            deleted : 0,
            modified : 0,
            ignored : 0
        });

        await this.#validateS1S1E2(ep.Marker1.Start, ep.Marker1.End);
    }

    /**
     * Import a marker that overlaps with an existing marker with an Ignore resolution, and ensure the imported marker is ignored. */
    async ignoreImportTest() {
        const ep = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const importData = [['intro', ep.Marker1.Start - 1000, ep.Marker1.End, undefined, 1000, ExtraData.Intro, '3']];
        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Ignore);
        this.#verifyImportResultValues(result, {
            added : 0,
            identical : 0,
            deleted : 0,
            modified : 0,
            ignored : 1
        });

        await this.#validateS1S1E2(ep.Marker1.Start, ep.Marker1.End);
    }

    /**
     * Import a marker that overlaps with an existing marker with a merge resolution, and ensure they are combined. */
    async mergeImportTest() {
        const ep = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const importData = [['intro', ep.Marker1.Start - 1000, ep.Marker1.End - 1000, undefined, 1000, ExtraData.Intro, '3']];
        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Merge);

        // Merge == ignore+modify
        this.#verifyImportResultValues(result, {
            added : 0,
            identical : 0,
            deleted : 0,
            modified : 1,
            ignored : 1
        });

        await this.#validateS1S1E2(ep.Marker1.Start - 1000, ep.Marker1.End);
    }

    /**
     * Ensure that episodes with the same guid get the same markers. */
    async importMultiEpisodeGuid() {
        const importData = [['intro', 15000, 45000, undefined, 1000, ExtraData.Intro, '2']];
        const result = await this.#importInternal(importData, 1 /*sectionId*/, MarkerConflictResolution.Overwrite);
        this.#verifyImportResultValues(result, {
            added : 2,
            identical : 0,
            deleted : 0,
            modified : 0,
            ignored : 0
        });

        const e1 = TestBase.DefaultMetadata.Show1.Season1.Episode1;
        const e2 = TestBase.DefaultMetadata.Show1_1.Season1.Episode1;
        const markerMap = await this.send('query', { keys : [e1.Id, e2.Id] });
        TestHelpers.verify(e1.Id in markerMap && e2.Id in markerMap, `Unexpected query response`);
        const m1 = markerMap[e1.Id];
        const m2 = markerMap[e2.Id];
        TestHelpers.verify(m1.length === 1, `Expected episode1 to have 1 marker after import, found ${m1.length}`);
        TestHelpers.verify(m2.length === 1, `Expected episode2 to have 1 marker after import, found ${m1.length}`);
        await TestHelpers.validateMarker(m1[0], MarkerType.Intro, e1.Id, null, null, 15000, 45000, 0, false, this.testDb);
        await TestHelpers.validateMarker(m2[0], MarkerType.Intro, e2.Id, null, null, 15000, 45000, 0, false, this.testDb);
    }

    /**
     * Handles creating the import database and sending it to the server as a POST request
     * @param {any[][]} importData
     * @param {number} sectionId
     * @param {number} resolveType */
    async #importInternal(importData, sectionId, resolveType) {
        await this.#writeImportDb(importData);
        const form = new FormData();
        form.append('sectionId', sectionId);
        form.append('resolveType', resolveType);
        form.append('database', createReadStream(this.#dbPath()));
        /** @type {ExpressResponse} */
        const response = await new Promise((resolve, _) => {
            form.submit('http://localhost:3233/import_db', (err, res) => {
                if (err) throw err;
                resolve(res);
            });
        });

        /** @type {Buffer} */
        const data = await new Promise((resolve, _) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(gunzipSync(Buffer.concat(chunks))));
        });

        return JSON.parse(data.toString());
    }

    /**
     * Ensure the import request returned the expected response.
     * @param {*} result Import result
     * @param {*} expected Expected import result */
    #verifyImportResultValues(result, expected) {
        const verifyMsg = (t, e, a) => `Expected ${e} ${t} markers in DB import result, found ${a}`;
        for (const t of ['added', 'identical', 'deleted', 'modified', 'ignored']) {
            TestHelpers.verify(result[t] === expected[t], verifyMsg(t, expected[t], result[t]));
        }
    }

    /**
     * Ensure our single Show1/Season1/Episode1 marker is modified as expected.
     * @param {number} expectedStart
     * @param {number} expectedEnd */
    async #validateS1S1E2(expectedStart, expectedEnd) {
        const show = TestBase.DefaultMetadata.Show1;
        const episodeId = TestBase.DefaultMetadata.Show1.Season1.Episode2.Id;
        const markerMap = await this.send('query', { keys : episodeId });
        TestHelpers.verify(episodeId in markerMap, `Expected id ${episodeId} in marker query results`);
        const markers = markerMap[episodeId];
        TestHelpers.verify(markers.length === 1, `Expected episode to have 1 marker after import, found ${markers.length}`);
        await TestHelpers.validateMarker(
            markers[0],
            MarkerType.Intro,
            episodeId,
            show.Season1.Id,
            show.Id,
            expectedStart,
            expectedEnd,
            0 /*expectedIndex*/,
            false /*deleted*/,
            this.testDb);
    }

    /**
     * Ask the server for the marker export for the given section, and does some basic validation
     * before returning all rows in the database.
     * @param {number} section
     * @returns {Promise<any[]>} */
    async #getExportedData(section) {
        const exported = await this.get(`export/${section}`);
        const stream = createWriteStream(this.#dbPath());
        Readable.fromWeb(exported.body).pipe(stream);
        await new Promise((resolve, _) => { stream.on('finish', resolve); });
        await new Promise(resolve => { stream.end(() => resolve()); });

        const db = await SqliteDatabase.OpenDatabase(this.#dbPath(), false /*allowCreate*/);
        const data = await db.all('SELECT * FROM markers;');
        this.#verifyData(data);
        await db.close();
        return data;
    }

    /**
     * Basic validation that ensures all fields are set, but not necessarily that they're what we want.
     * @param {any[]} rows */
    #verifyData(rows) {
        for (const row of rows) {
            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'id'));

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'marker_type'));
            TestHelpers.verify(Object.values(MarkerType).indexOf(row.marker_type) !== -1,
                `DB export should have a valid marker type, found ${row.marker_type}.`);

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'start'));
            TestHelpers.verify(/^\d+$/.test(row.start), `DB export should have a numerical start, found ${row.start}`);

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'end'));
            TestHelpers.verify(/^\d+$/.test(row.end), `DB export should have a numerical end, found ${row.end}`);

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'modified_at'));
            TestHelpers.verify(!row.modified_at || /^\d+$/.test(row.end),
                `DB export should have undefined or numerical modified_at, found ${row.modified_at}`);

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'created_at'));
            TestHelpers.verify(/^\d+$/.test(row.created_at), `DB export should have a numerical created_at, found ${row.created_at}`);

            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'extra'));
            TestHelpers.verify(Object.prototype.hasOwnProperty.call(row, 'guid'));
        }
    }

    /**
     * Write the given rows to a new database to be imported
     * @param {any[][]} rows */
    async #writeImportDb(rows) {
        const db = await SqliteDatabase.OpenDatabase(this.#dbPath(), true /*allowCreate*/);

        // Copied from Server/ImportExport.js
        let query = new TransactionBuilder(db);
        query.addStatement(`
        CREATE TABLE IF NOT EXISTS markers (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            marker_type  TEXT    NOT NULL,
            start        INTEGER NOT NULL,
            end          INTEGER NOT NULL,
            modified_at  INTEGER DEFAULT NULL,
            created_at   INTEGER NOT NULL,
            extra        TEXT    NOT NULL,
            guid         TEXT    NOT NULL
        );`);
        query.addStatement(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER);`);
        query.addStatement(`
            INSERT INTO schema_version (version) SELECT 1 WHERE NOT EXISTS (SELECT * FROM schema_version);`);
        await query.exec();

        query = new TransactionBuilder(db);
        for (const row of rows) {
            if (row[3] === undefined) {
                query.addStatement(`
                INSERT INTO markers (marker_type, start, end, created_at, extra, guid)
                VALUES
                (?, ?, ?, ?, ?, ?)`, [row[0], row[1], row[2], row[4], row[5], row[6]]);
            } else {
                query.addStatement(`
                INSERT INTO markers (marker_type, start, end, modified_at, created_at, extra, guid)
                VALUES
                (?, ?, ?, ?, ?, ?, ?)`, row);
            }
        }

        await query.exec();
        await db.close();
    }

    /** Delete exported DB on teardown */
    async #cleanup() {
        if (existsSync(this.#dbPath())) {
            // TODO: investigate node.exe holding on to ie.db even after we've awaited db.close()
            for (let i = 0; i < 5; ++i) {
                try {
                    rmSync(this.#dbPath());
                    return;
                } catch (ex) {
                    TestLog.warn(`\t\tUnable to delete temporary import database (try ${i + 1} of 5)`);
                    await new Promise(r => { setTimeout(r, 2000); });
                }
            }

            TestLog.error('\t\tFailed to clean up ie.db, the next test may fail.');
        }
    }

    /** Return the path to the test import/export database */
    #dbPath() {
        return join(TestBase.root, 'ie.db');
    }
}

export default ImportExportTest;
