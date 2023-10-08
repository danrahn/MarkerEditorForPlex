import FormData from 'form-data';
import { gunzipSync } from 'zlib';

import { BulkMarkerResolveType } from '../../Shared/PlexTypes.js';
import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

/** @typedef {!import('../../Shared/PlexTypes').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */

/**
 * Test the behavior of bulk adding markers.
 */
class BulkAddTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.easyBulkAddEpisodeTest,
            this.easyBulkAddSeasonTest,
            this.easyBulkAddShowTest,
            this.bulkAddOverlapResolveTypeFailFailsTest,
            this.bulkAddOverlapResolveTypeFailWithIgnoreSucceedsTest,
            this.bulkAddOverlapResolveTypeMergeSucceedsTest,
            this.bulkAddOverlapResolveTypeOverwriteSucceedsTest,
            this.bulkAddOverlapSwallows1Test,
            this.bulkAddOverlapSwallows2Test,
            this.bulkAddOverlapOverwriteDeletesMultipleTest,
            this.bulkAddOverlapResolveTypeIgnoreSucceedsTest,
            this.bulkAddTruncatedTest,
            this.bulkAddCustomTest,
            this.bulkAddCustomImplicitIgnoreTest,
        ];
    }

    className() { return 'BulkAddTest'; }

    /**
     * Test the easiest scenario - bulk add a marker that has no conflicts with existing markers. */
    async easyBulkAddEpisodeTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode1;
        return this.#verifyBulkAdd(
            episode.Id,
            0,
            10000,
            BulkMarkerResolveType.Fail,
            [],
            true,
            false,
            [   { id : TestBase.NextMarkerIndex, start : 0, end : 10000, index : 0 },
                { id : episode.Marker1.Id, start : episode.Marker1.Start, end : episode.Marker1.End, index : 1 }
            ],
            {}
        );
    }

    /**
     * Basic scenario - add a marker to a season that has no conflicts. */
    async easyBulkAddSeasonTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : 0, end : 10000, index : 0 },
            { id : TestBase.NextMarkerIndex + 1, start : 0, end : 10000, index : 0 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 2),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 3),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            0,
            10000,
            BulkMarkerResolveType.Fail,
            [],
            true,
            false,
            expectedMarkers,
            {}
        );
    }

    /**
     * Basic scenario - add a marker to a show that has no conflicts. */
    async easyBulkAddShowTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const newStart = 50000;
        const newEnd = 70000;
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 1 },
            { id : TestBase.NextMarkerIndex + 1, start : newStart, end : newEnd, index : 1 },
            { id : TestBase.NextMarkerIndex + 2, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(show.Season1.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(show.Season1.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(show.Season1.Episode2.Marker2, 2),
            this.#testMarkerFromTestData(show.Season1.Episode2.Marker3, 3),
            this.#testMarkerFromTestData(show.Season2.Episode1.Marker1, 0),
        ];
        return this.#verifyBulkAdd(
            show.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Fail,
            [],
            true,
            false,
            expectedMarkers,
            {}
        );
    }

    /**
     * Ensure nothing is applied when a bulk add overlaps with an existing marker and
     * the resolve type is Fail */
    async bulkAddOverlapResolveTypeFailFailsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 2),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            30000,
            50000,
            BulkMarkerResolveType.Fail,
            [],
            false,
            true,
            expectedMarkers,
            {}
        );
    }

    /**
     * Ensure we apply a bulk add when the only episode with a conflict is explicitly ignored
     * when the resolve type is Fail. */
    async bulkAddOverlapResolveTypeFailWithIgnoreSucceedsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 300000;
        const newEnd = 350000;
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 2),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Fail,
            [season.Episode2.Id],
            false,
            false,
            expectedMarkers,
            {}
        );
    }

    /**
     * Ensure existing markers are expanded when bulk add markers overlap with existing
     * markers and the resolve type is Merge. */
    async bulkAddOverlapResolveTypeMergeSucceedsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 330000;
        const newEnd = 350000;
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1, 300000, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 2),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Merge,
            [],
            true,
            false,
            expectedMarkers,
            {}
        );
    }

    /**
     * Ensure existing markers are deleted when bulk add markers overlap with existing
     * markers and the resolve type is Overwrite. */
    async bulkAddOverlapResolveTypeOverwriteSucceedsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 330000;
        const newEnd = 350000;

        // Two new markers (S01E01/S01E02), and delete the existing S01E02 marker that overlaps.
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            { id : TestBase.NextMarkerIndex + 1, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode2.Marker3, 2),
        ];

        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Overwrite,
            [],
            true,
            false,
            expectedMarkers,
            { [season.Episode2.Id] : [{ id : season.Episode2.Marker2.Id, deleted : true }] }
        );
    }

    /**
     * Ensure a bulk add that swallows two markers expands the first and deletes the second
     * when the resolve type is Merge. Bulk add start after first marker's start. */
    async bulkAddOverlapSwallows1Test() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 16000;
        const newEnd = 350000;
        const expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0, 15000, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0, 15000, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 1),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Merge,
            [],
            true,
            false,
            expectedMarkers,
            { [season.Episode2.Id] : [{ id : season.Episode2.Marker2.Id, deleted : true }] }
        );
    }

    /**
     * Ensure a bulk add that swallows two markers expands the first and deletes the second
     * when the resolve type is Merge. Bulk add start before first marker's start. */
    async bulkAddOverlapSwallows2Test() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 0;
        const newEnd = 350000;
        const expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0, newStart, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0, newStart, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 1),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Merge,
            [],
            true,
            false,
            expectedMarkers,
            { [season.Episode2.Id] : [{ id : season.Episode2.Marker2.Id, deleted : true }] }
        );
    }

    /**
     * Ensure a bulk add that swallows two markers deletes both when the resolve type is Overwrite. */
    async bulkAddOverlapOverwriteDeletesMultipleTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 16000;
        const newEnd = 350000;

        // Two new markers, three deleted.
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 0 },
            this.#testMarkerFromTestData(season.Episode2.Marker3, 1),
            { id : TestBase.NextMarkerIndex + 1, start : newStart, end : newEnd, index : 0 },
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Overwrite,
            [],
            true,
            false,
            expectedMarkers,
            {
                [season.Episode1.Id] : [{ id : season.Episode1.Marker1.Id, deleted : true }],
                [season.Episode2.Id] : [
                    { id : season.Episode2.Marker1.Id, deleted : true },
                    { id : season.Episode2.Marker2.Id, deleted : true },
                ]
            }
        );
    }

    /**
     * Ensure episodes are ignored when existing markers conflict with the bulk
     * add when the resolve type is Ignore. */
    async bulkAddOverlapResolveTypeIgnoreSucceedsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 330000;
        const newEnd = 350000;
        const expectedMarkers = [
            { id : TestBase.NextMarkerIndex, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker3, 2),
        ];
        return this.#verifyBulkAdd(
            season.Id,
            newStart,
            newEnd,
            BulkMarkerResolveType.Ignore,
            [],
            true,
            false,
            expectedMarkers,
            {}
        );
    }

    /**
     * Ensure we limit the marker end to the end of the episode if
     * the specified end is over the duration of an episode. */
    async bulkAddTruncatedTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode1;
        return this.#verifyBulkAdd(
            episode.Id,
            50000,
            9999999, // Any value greater than the 10 minute length of 600000
            BulkMarkerResolveType.Fail,
            [],
            true,
            false,
            [   { id : TestBase.NextMarkerIndex, start : 50000, end : 600000, index : 1 },
                this.#testMarkerFromTestData(episode.Marker1, 0)
            ],
            {}
        );
    }

    async bulkAddCustomTest() {
        const season = TestBase.DefaultMetadata.Show1.Season1;
        return this.#verifyCustomBulkAdd(
            season.Id,
            {
                [season.Episode1.Id] : { start : 0, end : 20000 },
                [season.Episode2.Id] : { start : 1000, end : 12000 },
                [season.Episode3.Id] : { start : 0, end : 15000 },
            },
            BulkMarkerResolveType.Fail,
            true /*expectApply*/,
            false /*expectConflict*/,
            [
                { id : TestBase.NextMarkerIndex,     start : 0, end : 20000, index : 0 },
                { id : TestBase.NextMarkerIndex + 1, start : 1000, end : 12000, index : 0 },
                this.#testMarkerFromTestData(season.Episode2.Marker1, 1),
                { id : TestBase.NextMarkerIndex + 2, start : 0, end : 15000, index : 0 }
            ]
        );
    }

    /**
     * Verify that leaving out data for a given episode results in that episode being ignored. */
    async bulkAddCustomImplicitIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show1.Season1;
        return this.#verifyCustomBulkAdd(
            season.Id,
            {
                [season.Episode1.Id] : { start : 20000, end : 100000 },
                [season.Episode3.Id] : { start : 0, end : 120000 },
            },
            BulkMarkerResolveType.Fail,
            true /*expectApply*/,
            false /*expectConflict*/,
            [
                { id : TestBase.NextMarkerIndex,     start : 20000, end : 100000, index : 0 },
                this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
                { id : TestBase.NextMarkerIndex + 1, start : 0, end : 120000, index : 0 }
            ]
        );
    }

    /**
     * Returns minimal marker data from a DefaultMetadata marker.
     * @param {{Id : number, Start : number, End : number, Index : number}} marker
     * @param {number} newIndex
     * @param {number} [startOverride=-1]
     * @param {number} [endOverride=-1]
     * @returns {{id : number, start : number, end : number, index : number}} */
    #testMarkerFromTestData(marker, newIndex, startOverride=-1, endOverride=-1) {
        return {
            id : marker.Id,
            start : startOverride == -1 ? marker.Start : startOverride,
            end : endOverride == -1 ? marker.End : endOverride,
            index : newIndex };
    }

    /**
     * Core routine that validates a bulk add operation applied and returned the expected values.
     * @param {number} metadataId
     * @param {number} start
     * @param {number} end
     * @param {number} resolveType
     * @param {number[]} ignored
     * @param {boolean} expectApply
     * @param {boolean} expectConflict
     * @param {any[]} markersToCheck
     * @param {{[episodeId: number]: any[]}} expectedDeletes */
    async #verifyBulkAdd(metadataId, start, end, resolveType, ignored, expectApply, expectConflict, markersToCheck, expectedDeletes={}) {
        /** @type {SerializedBulkAddResult} // TODO: credits */
        const result = await this.send('bulk_add', {
            id : metadataId,
            start : start,
            end : end,
            type : 'intro',
            final : 0,
            resolveType : resolveType,
            ignored : ignored.join(',')
        });
        return this.#verifyBulkAddCore(result, resolveType, expectApply, expectConflict, markersToCheck, expectedDeletes);
    }

    async #verifyCustomBulkAdd(metadataId, markerData, resolveType, expectApply, expectConflict, markersToCheck, expectedDeletes={}) {
        const form = new FormData();
        form.append('id', metadataId);
        form.append('type', 'intro');
        form.append('resolveType', resolveType);
        form.append('markers', JSON.stringify(markerData));

        /** @type {SerializedBulkAddResult} // TODO: credits */
        const response = await new Promise(resolve => {
            form.submit('http://localhost:3233/add_custom', (err, res) => {
                if (err) throw err;
                resolve(res);
            });
        });

        const rawData = await new Promise((resolve, _) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(gunzipSync(Buffer.concat(chunks)).toString('utf8')));
        });

        const result = JSON.parse(rawData);
        return this.#verifyBulkAddCore(result, resolveType, expectApply, expectConflict, markersToCheck, expectedDeletes);
    }

    /**
     * @param {SerializedBulkAddResult} result */
    async #verifyBulkAddCore(result, resolveType, expectApply, expectConflict, markersToCheck, expectedDeletes) {
        /* eslint-disable max-len */
        const expectedMarkerCount = markersToCheck.reduce((sum, marker) => sum + (marker.deleted ? 0 : 1), 0);
        TestHelpers.verify(result, `Expected success response from bulk_add, found ${result}.`);
        TestHelpers.verify(result.applied === true || result.applied === false, `Expected result.applied to be true or false, found ${result.applied}`);
        const c = result.conflict;
        TestHelpers.verify(expectConflict ? c === true : (c === false || !Object.prototype.hasOwnProperty.call(result, 'conflict')), `Expected result.conflict to be true, false, or not present, found ${result.conflict}`);
        TestHelpers.verify(result.episodeMap, `Expected episodeMap in bulk_add response, found nothing.`);
        const episodeMap = result.episodeMap;
        let totalMarkerCount = 0;
        for (const episodeApplyInfo of Object.values(episodeMap)) {
            TestHelpers.verify(episodeApplyInfo.episodeData, `Expected episodeMap to have episodeData, found ${episodeApplyInfo.episodeData}`);
            TestHelpers.verify(episodeApplyInfo.existingMarkers instanceof Array, `Expected episodeMap to have an array of existingMarkers, found ${episodeApplyInfo.existingMarkers}`);
            totalMarkerCount += episodeApplyInfo.existingMarkers.length;
            const expectChanged = result.ignoredEpisodes?.indexOf(episodeApplyInfo.episodeData.metadataId) === -1 ?? true;
            if (expectApply && expectChanged && resolveType != BulkMarkerResolveType.Ignore) {
                TestHelpers.verify(episodeApplyInfo.changedMarker, `Expected a changed marker to be present after bulk_add apply, found ${episodeApplyInfo.changedMarker}`);
                TestHelpers.verify(episodeApplyInfo.isAdd === true || episodeApplyInfo.isAdd === false, `Expected isAdd to be true or false after bulk_add apply, found ${episodeApplyInfo.isAdd}`);
            } else if (!expectChanged) {
                TestHelpers.verify(!episodeApplyInfo.changedMarker, `Episode is in ignore list, but found a changed marker: ${episodeApplyInfo.changedMarker}`);
            }

            if (expectedDeletes[episodeApplyInfo.episodeData.metadataId]) {
                const expectedDeleted = expectedDeletes[episodeApplyInfo.episodeData.metadataId];
                const deleted = episodeApplyInfo.deletedMarkers;
                TestHelpers.verify(expectedDeleted.length == deleted.length, `Expected ${expectedDeleted.length} deleted markers for this episode, found ${deleted.length}`);
            }
        }

        TestHelpers.verify(totalMarkerCount == expectedMarkerCount, `Expected to find ${expectedMarkerCount} markers after bulk action, found ${totalMarkerCount}`);

        for (const marker of markersToCheck) {
            await TestHelpers.validateMarker(marker, null, null, null, null, marker.start, marker.end, marker.index, null, this.testDb, marker.deleted);
        }
        /* eslint-enable */
    }
}

export default BulkAddTest;
