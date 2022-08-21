import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';
/** @typedef {!import('../../Shared/PlexTypes.js').ShiftResult} ShiftResult */

/**
 * Test the behavior of bulk shifting markers. */
class ShiftTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.shiftSingleEpisodeTest,
            this.shiftSingleEpisodeNegativeTest,
            this.checkShiftSingleEpisodeTest,
            this.shiftSingleEpisodeCutsOffStartTest,
            this.shiftSingleEpisodeCutsOffEndTest,
            this.shiftSingleEpisodeTooMuchTest,
            this.shiftSingleSeasonTest,
            this.shiftSingleShowTest,
            this.shiftSingleEpisodeWithMultipleMarkersDontApplyTest,
            this.shiftSingleEpisodeWithMultipleMarkersTryApplyTest,
            this.shiftSingleEpisodeWithMultipleMarkersTryApplyWithIgnoreTest,
            this.shiftSingleEpisodeWithMultipleMarkersForceApplyTest,
            this.shiftSeasonWithIgnoreTest,
            this.tryShiftSeasonWithoutIgnoreTest,
            this.shiftShowWithIgnoreTest
        ]
    }

    className() { return 'ShiftTest'; }

    /**
     * Test shifting an episode with a single marker. */
    async shiftSingleEpisodeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, this.testDb);
    }

    /**
     * Shift a marker with a negative offset. */
    async shiftSingleEpisodeNegativeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = -3000;
        const result = await this.#verifyShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, this.testDb);
    }

    /**
     * Ensure changes aren't applied when only checking a shift, even if there are no conflicts. */
    async checkShiftSingleEpisodeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const expectedMarker = episode.Marker1;
        /** @type {ShiftResult} */
        const result = await this.#verifyAttemptedShift(episode.Id, 1, 1, true, false);
        const checkedMarker = result.allMarkers[0];

        return TestHelpers.validateMarker(checkedMarker, episode.Id, null, null, expectedMarker.Start, expectedMarker.End, expectedMarker.Index, this.testDatabase);
    }

    /**
     * Ensure we don't shift the start of a marker before 0, even if the shift is greater than the current start. */
    async shiftSingleEpisodeCutsOffStartTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = -16000;
        TestHelpers.verify(episode.Marker1.Start + shift < 0, `episode.Marker1.Start + shift < 0: Can't test start cutoff if we don't shift this enough!`);
        const result = await this.#verifyShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Id, null, null, 0, episode.Marker1.End + shift, 0, this.testDb);
    }

    /**
     * Ensure we don't shift the end of the marker beyond the episode duration. */
    async shiftSingleEpisodeCutsOffEndTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = 600000 - 16000;
        TestHelpers.verify(episode.Marker1.End + shift > 600000, `episode.Marker1.End + shift > 600000: Can't test end cutoff if we don't shift this enough!`);
        const result = await this.#verifyShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Id, null, null, episode.Marker1.Start + shift, 600000, 0, this.testDb);
    }

    /**
     * Ensure we fail to offset a marker that would either force the end time to be 0 or
     * less, or the start time to be greater than or equal to the duration of the episode. */
    async shiftSingleEpisodeTooMuchTest() {
        this.expectFailure();
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;

        // Shift too early
        let shift = -45000;
        /** @type {ShiftResult} */
        let result = await this.send('shift', {
            id : episode.Id,
            shift : shift,
            force : 0,
        });
        TestHelpers.verify(result, `Expected shift beyond episode bounds to return JSON, found nothing.`);
        TestHelpers.verify(result.applied === false, `Expected shift beyond episode bounds to have applied=false, found ${result.applied}`);
        TestHelpers.verify(result.overflow, `Expected shift beyond episode bounds to have overflow bit set, found ${result.overflow}`);

        // Shift too late
        shift = 600000;
        result = await this.send('shift', {
            id : episode.Id,
            shift : shift,
            force : 0,
        });

        TestHelpers.verify(result, `Expected shift beyond episode bounds to return JSON, found nothing.`);
        TestHelpers.verify(result.applied === false, `Expected shift beyond episode bounds to have applied=false, found ${result.applied}`);
        TestHelpers.verify(result.overflow, `Expected shift beyond episode bounds to have overflow bit set, found ${result.overflow}`);
    }

    /**
     * Test shifting a season with a single marker among all episodes. */
    async shiftSingleSeasonTest() {
        // Really the same as shiftSingleEpisodeTest
        const season = TestBase.DefaultMetadata.Show1.Season1;
        const shift = 3000;
        const result = await this.#verifyShift(season.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        const oldMarker = season.Episode2.Marker1;
        return TestHelpers.validateMarker(newMarker, null, season.Id, null, oldMarker.Start + shift, oldMarker.End + shift, 0, this.testDb);
    }

    /**
     * Test shifting a show with a single marker among all episodes. */
    async shiftSingleShowTest() {
        const show = TestBase.DefaultMetadata.Show1;
        const shift = 3000;
        const result = await this.#verifyShift(show.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        const oldMarker = show.Season1.Episode2.Marker1;
        return TestHelpers.validateMarker(newMarker, null, null, show.Id, oldMarker.Start + shift, oldMarker.End + shift, 0, this.testDb);

    }

    /**
     * Ensure we don't apply anything when only checking the shift and the episode has multiple markers. */
    async shiftSingleEpisodeWithMultipleMarkersDontApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        return this.#verifyAttemptedShift(episode.Id, 2, 1, true);
    }

    /**
     * Ensure we don't apply anything when an episode has multiple markers and we aren't forcing the operation. */
    async shiftSingleEpisodeWithMultipleMarkersTryApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        return this.#verifyAttemptedShift(episode.Id, 2, 1);
    }

    /**
     * Ensure we apply the shift when an episode has multiple markers, but only one isn't being ignored. */
    async shiftSingleEpisodeWithMultipleMarkersTryApplyWithIgnoreTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyShift(episode.Id, shift, 1, [episode.Marker2.Id]);
        const newMarker = result.allMarkers[0];
        await TestHelpers.validateMarker(newMarker, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, this.testDb);

        // Fake marker data to verify that the second marker wasn't changed
        const marker2 = episode.Marker2;
        const fakeMarkerData = { id : marker2.Id, start : marker2.Start, end : marker2.End, index : marker2.Index };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, marker2.Start, marker2.End, marker2.Index);
    }

    /**
     * Ensure we apply the shift to multiple markers in the same episode when forcing the operation. */
    async shiftSingleEpisodeWithMultipleMarkersForceApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyShift(episode.Id, shift, 2, [], true, 1);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, this.testDb);
        await TestHelpers.validateMarker(sorted[1], episode.Id, null, null, episode.Marker2.Start + shift, episode.Marker2.End + shift, 1, this.testDb);
    }

    /**
     * Ensure multiple markers in a season are shifted when the ignore list ensures all episodes only have a single
     * marker to shift. */
    async shiftSeasonWithIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const shift = 3000;
        const result = await this.#verifyShift(season.Id, shift, 2, [season.Episode2.Marker2.Id]);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], null, season.Id, null, season.Episode1.Marker1.Start + shift, season.Episode1.Marker1.End + shift, 0, this.testDb);
        await TestHelpers.validateMarker(sorted[1], null, season.Id, null, season.Episode2.Marker1.Start + shift, season.Episode2.Marker1.End + shift, 0, this.testDb);

        // Fake marker data to verify that the ignored marker wasn't changed
        const marker2 = season.Episode2.Marker2;
        const fakeMarkerData = { id : marker2.Id, start : marker2.Start, end : marker2.End, index : marker2.Index };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, marker2.Start, marker2.End, marker2.Index);
    }

    /**
     * Ensure we don't apply if any episodes in the season have multiple markers when not force applying. */
    async tryShiftSeasonWithoutIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        return this.#verifyAttemptedShift(season.Id, 3, 2, true);
    }

    /**
     * Ensure multiple markers in a show are shifted when the ignore list ensures all episodes only have a single
     * marker to shift. */
    async shiftShowWithIgnoreTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const shift = 3000;
        const result = await this.#verifyShift(show.Id, shift, 3, [show.Season1.Episode2.Marker1.Id]);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], null, null, show.Id, show.Season1.Episode1.Marker1.Start + shift, show.Season1.Episode1.Marker1.End + shift, 0, this.testDb);
        await TestHelpers.validateMarker(sorted[1], null, null, show.Id, show.Season1.Episode2.Marker2.Start + shift, show.Season1.Episode2.Marker2.End + shift, 1, this.testDb);
        await TestHelpers.validateMarker(sorted[2], null, null, show.Id, show.Season2.Episode1.Marker1.Start + shift, show.Season2.Episode1.Marker1.End + shift, 0, this.testDb);

        // Fake marker data to verify that the ignored marker wasn't changed
        const marker1 = show.Season1.Episode2.Marker1;
        const fakeMarkerData = { id : marker1.Id, start : marker1.Start, end : marker1.End, index : marker1.Index };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, marker1.Start, marker1.End, marker1.Index);
    }

    /**
     * Helper that validates a successfully applied shift.
     * @param {number} metadataId The show/season/episode metadata id.
     * @param {number} shift The ms to shift.
     * @param {number} expectedLength The expected number of shifted markers.
     * @param {number[]} [ignoreList=[]] The list of marker ids to ignore.
     * @param {boolean} expectConflict Whether we expect to encounter a conflict.
     * @param {boolean} force Whether the shift operation should be forced.
     * @returns {Promise<ShiftResult>} */
    async #verifyShift(metadataId, shift, expectedLength, ignoreList=[], expectConflict=false, force=0) {
        const params = {
            id : metadataId,
            shift : shift,
            force : force
        };
        if (ignoreList.length != 0) {
            params.ignored = ignoreList.join(',');
        }

        /** @type {ShiftResult} */
        let result = await this.send('shift', params);

        TestHelpers.verify(result, `Expected successful 'shift' to return an object, found nothing.`);
        TestHelpers.verify(result.applied === true, `Expected successful 'shift' to return applied=true, found ${result.applied}.`);
        TestHelpers.verify(result.conflict == expectConflict, `Expected shift.conflict to be ${expectConflict}, found ${result.conflict}.`);
        TestHelpers.verify(result.overflow === false, `Expected successful 'shift' to have overflow bit unset, found ${result.overflow}.`);

        let newMarkers = result.allMarkers;
        TestHelpers.verify(newMarkers instanceof Array, `Expected successful 'shift' to have an allMarkers field with an array of shifted markers.`);
        TestHelpers.verify(newMarkers.length == expectedLength, `Expected ${expectedLength} shifted marker(s), found ${newMarkers.length}`);
        return result;
    }

    /**
     * Verifies that the shift request doesn't result in markers actually being shifted, returning the result.
     * @param {number} metadataId
     * @param {number} expectedMarkerCount
     * @param {number} expectedEpisodeCount
     * @param {boolean} [checkOnly=false]
     * @param {boolean} [expectConflict=true] */
    async #verifyAttemptedShift(metadataId, expectedMarkerCount, expectedEpisodeCount, checkOnly=false, expectConflict=true) {
        /**
         * @type {ShiftResult}
         * @readonly */ // readonly after assign
        let result;
        if (checkOnly) {
            result = await this.send('check_shift', { id : metadataId });
        } else {
            result = await this.send('shift', { id : metadataId, shift : 3000, force : 0 });
        }

        TestHelpers.verify(result, `Expected shift to return a valid object, found nothing.`);
        TestHelpers.verify(result.applied === false, `Expected result.applied to be false, found ${result.applied}.`);
        TestHelpers.verify(result.conflict === expectConflict, `Expected result.conflict to be true, found ${result.conflict}.`);
        TestHelpers.verify(result.allMarkers instanceof Array, `Expected result.allMarkers to be an array.`);
        TestHelpers.verify(result.allMarkers.length == expectedMarkerCount, `Expected result.allMarkers.length to be ${expectedMarkerCount}, found ${result.allMarkers.length}.`);
        TestHelpers.verify(result.episodeData, `Expected non-applied shift to return episode data, didn't find any.`);
        const episodeCount = Object.keys(result.episodeData).length;
        TestHelpers.verify(episodeCount == expectedEpisodeCount, `Expected EpisodeData for ${expectedEpisodeCount} episode(s), found ${episodeCount}`);
        return result;
    }
}

export default ShiftTest;
