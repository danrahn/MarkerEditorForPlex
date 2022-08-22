import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedEpisodeData} SerializedEpisodeData */

/**
 * Tests functionality of the bulk_delete endpoint.
 */
class BulkDeleteTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.dryRunEpisodeTest,
            this.dryRunSeasonTest,
            this.dryRunShowTest,
            this.dryRunMovieTest,
            this.bulkDeleteEpisodeTest,
            this.bulkDeleteSeasonTest,
            this.bulkDeleteShowTest,
            this.bulkDeleteEpisodeWithIgnoreTest,
            this.bulkDeleteSeasonWithIgnoreTest,
            this.bulkDeleteShowWithIgnoreTest,
        ];
    }

    className() { return 'BulkDeleteTest'; }

    async dryRunEpisodeTest() {
        // Single marker
        let episode = TestBase.DefaultMetadata.Show3.Season1.Episode1;
        let response = await this.#bulkDelete(episode.Id, true);
        let length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length == 1, `Expected 1 marker in dry run, found ${length}`);
        await TestHelpers.validateMarker(response.markers[0], episode.Id, null, null, episode.Marker1.Start, episode.Marker1.End, episode.Marker1.Index, this.testDb);
        TestHelpers.verify(response.episodeData && response.episodeData[episode.Id], `Expected dry run to have episode data for ${episode.Id}, didn't find any.`);

        // Multiple markers
        episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        response = await this.#bulkDelete(episode.Id, true);
        length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length == 2, `Expected 2 markers in dry run, found ${length}`);
        await TestHelpers.validateMarker(response.markers[0], episode.Id, null, null, episode.Marker1.Start, episode.Marker1.End, episode.Marker1.Index, this.testDb);
        await TestHelpers.validateMarker(response.markers[1], episode.Id, null, null, episode.Marker2.Start, episode.Marker2.End, episode.Marker2.Index, this.testDb);
        TestHelpers.verify(response.episodeData && response.episodeData[episode.Id], `Expected dry run to have episode data for ${episode.Id}, didn't find any.`);
        TestHelpers.verify(Object.keys(response.episodeData).length == 1, `Expected data for a single episode, found ${Object.keys(response.episodeData).length}.`);
    }

    async dryRunSeasonTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const response = await this.#bulkDelete(season.Id, true);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length == 3, `Expected 3 markers in dry run, found ${length}`);
        const sorted = response.markers.sort((a, b) => a.id - b.id);
        let i = 0;
        for (const testMarker of [season.Episode1.Marker1, season.Episode2.Marker1, season.Episode2.Marker2]) {
            await TestHelpers.validateMarker(sorted[i++], null, season.Id, null, testMarker.Start, testMarker.End, testMarker.Index, this.testDb);
        }


        TestHelpers.verify(response.episodeData && response.episodeData[season.Episode1.Id], `Expected dry run to have episode data for ${season.Episode1.Id}, didn't find any.`);
        TestHelpers.verify(response.episodeData[season.Episode2.Id], `Expected dry run to have episode data for ${season.Episode2.Id}, didn't find any.`);
        TestHelpers.verify(Object.keys(response.episodeData).length == 2, `Expected data for two episodes, found ${Object.keys(response.episodeData).length}.`);
    }

    async dryRunShowTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const response = await this.#bulkDelete(show.Id, true);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length == 4, `Expected 4 markers in dry run, found ${length}`);
        const sorted = response.markers.sort((a, b) => a.id - b.id);
        let i = 0;
        for (const testMarker of [show.Season1.Episode1.Marker1, show.Season1.Episode2.Marker1, show.Season1.Episode2.Marker2, show.Season2.Episode1.Marker1]) {
            await TestHelpers.validateMarker(sorted[i++], null, null, show.Id, testMarker.Start, testMarker.End, testMarker.Index, this.testDb);
        }

        i = 0;
        for (const id of [show.Season1.Episode1.Id, show.Season1.Episode2.Id, show.Season2.Episode1.Id]) {
            TestHelpers.verify(response.episodeData && response.episodeData[id], `Expected dry run to have episode data for ${id}, didn't find any.`);
        }
    }

    async dryRunMovieTest() {
        this.expectFailure();
        const response = await this.#bulkDelete(100, true, [], true /*raw*/);
        TestHelpers.verifyBadRequest(response);
    }

    async bulkDeleteEpisodeTest() {
        // Single marker
        let episode = TestBase.DefaultMetadata.Show3.Season1.Episode1;
        let response = await this.#bulkDelete(episode.Id, false /*dryRun*/);
        let length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 0, `Expected bulk delete without ignore list to return empty marker array, found ${length}`);
        const fakeMarker = { id : episode.Marker1.Id };
        await TestHelpers.validateMarker(fakeMarker, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);

        // Multiple markers
        episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        response = await this.#bulkDelete(episode.Id, false /*dryRun*/);
        length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 0, `Expected bulk delete without ignore list to return empty marker array, found ${length}`);
        const fakeMarker1 = { id : episode.Marker1.Id };
        await TestHelpers.validateMarker(fakeMarker1, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
        const fakeMarker2 = { id : episode.Marker2.Id };
        await TestHelpers.validateMarker(fakeMarker2, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
    }

    async bulkDeleteSeasonTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const response = await this.#bulkDelete(season.Id, false);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 0, `Expected bulk delete without ignore list to return empty marker array, found ${length}`);
        for (const testMarker of [season.Episode1.Marker1, season.Episode2.Marker1, season.Episode2.Marker2]) {
            await TestHelpers.validateMarker({ id : testMarker.Id }, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
        }
    }

    async bulkDeleteShowTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const response = await this.#bulkDelete(show.Id, false);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 0, `Expected bulk delete without ignore list to return empty marker array, found ${length}`);
        for (const testMarker of [show.Season1.Episode1.Marker1, show.Season1.Episode2.Marker1, show.Season1.Episode2.Marker2, show.Season2.Episode1.Marker1]) {
            await TestHelpers.validateMarker({ id : testMarker.Id }, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
        }
    }

    async bulkDeleteEpisodeWithIgnoreTest() {
        // Single marker, make sure we're okay with an empty delete
        let episode = TestBase.DefaultMetadata.Show3.Season1.Episode1;
        let response = await this.#bulkDelete(episode.Id, false /*dryRun*/, [episode.Marker1.Id]);
        let length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 1, `Expected bulk delete ignore list to return marker array of size 1, found ${length}`);
        // Make sure it's not deleted
        const fakeMarker = { id : episode.Marker1.Id };
        await TestHelpers.validateMarker(fakeMarker, null, null, null, null, null, null, this.testDb, false /*isDeleted*/);

        // Multiple markers
        episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        response = await this.#bulkDelete(episode.Id, false /*dryRun*/, [episode.Marker1.Id]);
        length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 1, `Expected bulk delete ignore list to return marker array of size 1, found ${length}`);
        const fakeMarker1 = { id : episode.Marker1.Id };
        await TestHelpers.validateMarker(fakeMarker1, null, null, null, null, null, null, this.testDb, false /*isDeleted*/);
        const fakeMarker2 = { id : episode.Marker2.Id };
        await TestHelpers.validateMarker(fakeMarker2, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
    }

    async bulkDeleteSeasonWithIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const response = await this.#bulkDelete(season.Id, false, [season.Episode2.Marker2.Id]);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 1, `Expected bulk delete ignore list of 1 to return marker array of length 1, found ${length}`);
        for (const testMarker of [season.Episode1.Marker1, season.Episode2.Marker1]) {
            await TestHelpers.validateMarker({ id : testMarker.Id }, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
        }
        await TestHelpers.validateMarker({ id : season.Episode2.Marker2.Id }, null, null, null, null, null, null, this.testDb, false /*isDeleted*/);
    }

    async bulkDeleteShowWithIgnoreTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const response = await this.#bulkDelete(show.Id, false, [show.Season1.Episode1.Marker1.Id, show.Season1.Episode2.Marker1.Id]);
        const length = (response && response.markers) ? response.markers.length : undefined;
        TestHelpers.verify(length === 2, `Expected bulk delete ignore list of 2 to return marker array of length 2, found ${length}`);
        for (const testMarker of [show.Season1.Episode2.Marker2, show.Season2.Episode1.Marker1]) {
            await TestHelpers.validateMarker({ id : testMarker.Id }, null, null, null, null, null, null, this.testDb, true /*isDeleted*/);
        }

        for (const testMarker of [show.Season1.Episode1.Marker1, show.Season1.Episode2.Marker1]) {
            await TestHelpers.validateMarker({ id : testMarker.Id }, null, null, null, null, null, null, this.testDb, false /*isDeleted*/);
        }
    }

    /**
     * @param {number} id
     * @param {boolean} dryRun
     * @param {number[]} [ignored=[]]
     * @param {boolean} raw
     * @returns {Promise<{markers: SerializedMarkerData, episodeData?: SerializedEpisodeData}>} */
    async #bulkDelete(id, dryRun, ignored=[], raw=false) {
        return this.send('bulk_delete', {
            id : id,
            dryRun : dryRun ? 1 : 0,
            ignored : ignored.join(','),
        }, raw);
    }
}

export default BulkDeleteTest;
