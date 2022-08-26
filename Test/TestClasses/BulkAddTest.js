import { Log } from '../../Shared/ConsoleLog.js';
import { BulkMarkerResolveType } from '../../Shared/PlexTypes.js';
import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

/** @typedef {!import('../../Shared/PlexTypes.js').SerializedBulkAddResult} SerializedBulkAddResult */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedEpisodeData} SerializedEpisodeData */

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
            this.bulkAddOverlapSwallows1Test,
            this.bulkAddOverlapSwallows2Test,
            this.bulkAddOverlapResolveTypeIgnoreSucceedsTest,
            this.bulkAddTruncatedTest,
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
            [   { id : 6, start : 0, end : 10000, index : 0},
                { id : episode.Marker1.Id, start : episode.Marker1.Start, end : episode.Marker1.End, index : 1 }
            ],
            {}
        );
    }

    /**
     * Basic scenario - add a marker to a season that has no conflicts. */
    async easyBulkAddSeasonTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        let expectedMarkers = [
            { id : 6, start : 0, end : 10000, index : 0 },
            { id : 7, start : 0, end : 10000, index : 0 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 1),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 2)
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
        let expectedMarkers = [
            { id : 6, start : newStart, end : newEnd, index : 1 },
            { id : 7, start : newStart, end : newEnd, index : 1 },
            { id : 8, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(show.Season1.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(show.Season1.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(show.Season1.Episode2.Marker2, 2),
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
        let expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1)
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
        let expectedMarkers = [
            { id : 6, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1)
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
        let expectedMarkers = [
            { id : 6, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1, 300000, newEnd)
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
     * Ensure a bulk add that swallows two markers expands the first and deletes the second
     * when the resolve type is Merge. Bulk add start after first marker's start. */
    async bulkAddOverlapSwallows1Test() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 16000;
        const newEnd = 350000;
        let expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0, 15000, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0, 15000, newEnd),
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
            {[season.Episode2.Id] : [{ id : season.Episode2.Marker2.Id, deleted : true }]}
        );
    }

    /**
     * Ensure a bulk add that swallows two markers expands the first and deletes the second
     * when the resolve type is Merge. Bulk add start before first marker's start. */
    async bulkAddOverlapSwallows2Test() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 0;
        const newEnd = 350000;
        let expectedMarkers = [
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0, newStart, newEnd),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0, newStart, newEnd),
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
            {[season.Episode2.Id] : [{ id : season.Episode2.Marker2.Id, deleted : true }]}
        );
    }


    /**
     * Ensure episodes are ignored when existing markers conflict with the bulk
     * add when the resolve type is Ignore. */
    async bulkAddOverlapResolveTypeIgnoreSucceedsTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const newStart = 330000;
        const newEnd = 350000;
        let expectedMarkers = [
            { id : 6, start : newStart, end : newEnd, index : 1 },
            this.#testMarkerFromTestData(season.Episode1.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker1, 0),
            this.#testMarkerFromTestData(season.Episode2.Marker2, 1),
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
            [   { id : 6, start : 50000, end : 600000, index : 1},
                this.#testMarkerFromTestData(episode.Marker1, 0)
            ],
            {}
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
        return { id : marker.Id, start : startOverride == -1 ? marker.Start : startOverride, end : endOverride == -1 ? marker.End : endOverride, index : newIndex };
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
        let totalMarkerCount = 0;
        const expectedMarkerCount = markersToCheck.reduce((sum, marker) => sum + (marker.deleted ? 0 : 1), 0);
        /** @type {SerializedBulkAddResult} */
        const result = await this.send('bulk_add', { id : metadataId, start : start, end : end, resolveType : resolveType, ignored : ignored.join(',') });
        Log.info(result);
        TestHelpers.verify(result, `Expected success response from bulk_add, found ${result}.`);
        TestHelpers.verify(result.applied === true || result.applied === false, `Expected result.applied to be true or false, found ${result.applied}`);
        const c = result.conflict;
        TestHelpers.verify(expectConflict ? c === true : (c === false || !result.hasOwnProperty('conflict')), `Expected result.conflict to be true, false, or not present, found ${result.conflict}`);
        TestHelpers.verify(result.episodeMap, `Expected episodeMap in bulk_add response, found nothing.`);
        const episodeMap = result.episodeMap;
        for (const episodeApplyInfo of Object.values(episodeMap)) {
            TestHelpers.verify(episodeApplyInfo.episodeData, `Expected episodeMap to have episodeData, found ${episodeApplyInfo.episodeData}`);
            TestHelpers.verify(episodeApplyInfo.existingMarkers instanceof Array, `Expected episodeMap to have an array of existingMarkers, found ${episodeApplyInfo.existingMarkers}`);
            totalMarkerCount += episodeApplyInfo.existingMarkers.length;
            if (expectApply && resolveType != BulkMarkerResolveType.Ignore) {
                TestHelpers.verify(episodeApplyInfo.changedMarker, `Expected a changed marker to be present after bulk_add apply, found ${episodeApplyInfo.changedMarker}`);
                TestHelpers.verify(episodeApplyInfo.isAdd === true || episodeApplyInfo.isAdd === false, `Expected isAdd to be true or false after bulk_add apply, found ${episodeApplyInfo.isAdd}`);
            }

            if (expectedDeletes[episodeApplyInfo.episodeData.metadataId]) {
                const expectedDeleted = expectedDeletes[episodeApplyInfo.episodeData.metadataId];
                const deleted = episodeApplyInfo.deletedMarkers;
                TestHelpers.verify(expectedDeleted.length == deleted.length, `Expected ${expectedDeleted.length} deleted markers for this episode, found ${deleted.length}`);
            }
        }

        TestHelpers.verify(totalMarkerCount == expectedMarkerCount, `Expected to find ${expectedMarkerCount} markers after bulk action, found ${totalMarkerCount}`);

        for (const marker of markersToCheck) {
            await TestHelpers.validateMarker(marker, null, null, null, marker.start, marker.end, marker.index, this.testDb, marker.deleted);
        }
    }
}

export default BulkAddTest;
