/* eslint-disable max-len */
import { MarkerEnum } from '../../Shared/MarkerType.js';
import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';
/** @typedef {!import('../../Shared/PlexTypes').ShiftResult} ShiftResult */

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
            this.shiftShowWithIgnoreTest,
            this.splitShiftSeasonTest,
            this.shiftIntroTest,
            this.shiftCreditsTest,
        ];
    }

    className() { return 'ShiftTest'; }

    /**
     * Test shifting an episode with a single marker. */
    async shiftSingleEpisodeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Marker1.Type, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, episode.Marker1.Final, this.testDb);
    }

    /**
     * Shift a marker with a negative offset. */
    async shiftSingleEpisodeNegativeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = -3000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Marker1.Type, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, episode.Marker1.Final, this.testDb);
    }

    /**
     * Ensure changes aren't applied when only checking a shift, even if there are no conflicts. */
    async checkShiftSingleEpisodeTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const expectedMarker = episode.Marker1;
        /** @type {ShiftResult} */
        const result = await this.#verifyAttemptedShift(episode.Id, 1, 1, true, false);
        const checkedMarker = result.allMarkers[0];

        return TestHelpers.validateMarker(checkedMarker, expectedMarker.Type, episode.Id, null, null, expectedMarker.Start, expectedMarker.End, expectedMarker.Index, expectedMarker.Final, this.testDatabase);
    }

    /**
     * Ensure we don't shift the start of a marker before 0, even if the shift is greater than the current start. */
    async shiftSingleEpisodeCutsOffStartTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = -16000;
        TestHelpers.verify(episode.Marker1.Start + shift < 0, `episode.Marker1.Start + shift < 0: Can't test start cutoff if we don't shift this enough!`);
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Marker1.Type, episode.Id, null, null, 0, episode.Marker1.End + shift, 0, episode.Marker1.Final, this.testDb);
    }

    /**
     * Ensure we don't shift the end of the marker beyond the episode duration. */
    async shiftSingleEpisodeCutsOffEndTest() {
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;
        const shift = 600000 - 16000;
        TestHelpers.verify(episode.Marker1.End + shift > 600000, `episode.Marker1.End + shift > 600000: Can't test end cutoff if we don't shift this enough!`);
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        return TestHelpers.validateMarker(newMarker, episode.Marker1.Type, episode.Id, null, null, episode.Marker1.Start + shift, 600000, 0, episode.Marker1.Final, this.testDb);
    }

    /**
     * Ensure we fail to offset a marker that would put it beyond the bounds of the
     * episode, or the shift results in the start time being greater than the end time. */
    async shiftSingleEpisodeTooMuchTest() {
        this.expectFailure();
        const episode = TestBase.DefaultMetadata.Show1.Season1.Episode2;

        // Shift too early
        await this.#verifyBadShift(episode, -45000, -45000);

        // Shift too late
        await this.#verifyBadShift(episode, 600000, 600000);

        // Separate shift results in equal start/end
        await this.#verifyBadShift(episode, 15000, -15000);

        // Separate shifts end in crossing start/end
        await this.#verifyBadShift(episode, 16000, -16000);
    }

    async #verifyBadShift(episode, startShift, endShift) {
        /** @type {ShiftResult} */
        const result = await this.send('shift', {
            id : episode.Id,
            startShift : startShift,
            endShift : endShift,
            applyTo : MarkerEnum.All,
            force : 0,
        });

        TestHelpers.verify(result, `Expected shift with invalid bounds to return JSON, found nothing.`);
        TestHelpers.verify(result.applied === false, `Expected shift with invalid bounds to have applied=false, found ${result.applied}`);
        TestHelpers.verify(result.overflow, `Expected shift with invalid bounds to have overflow bit set, found ${result.overflow}`);

    }

    /**
     * Test shifting a season with a single marker among all episodes. */
    async shiftSingleSeasonTest() {
        // Really the same as shiftSingleEpisodeTest
        const season = TestBase.DefaultMetadata.Show1.Season1;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(season.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        const oldMarker = season.Episode2.Marker1;
        return TestHelpers.validateMarker(newMarker, oldMarker.Type, null, season.Id, null, oldMarker.Start + shift, oldMarker.End + shift, 0, oldMarker.Final, this.testDb);
    }

    /**
     * Test shifting a show with a single marker among all episodes. */
    async shiftSingleShowTest() {
        const show = TestBase.DefaultMetadata.Show1;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(show.Id, shift, 1);
        const newMarker = result.allMarkers[0];
        const oldMarker = show.Season1.Episode2.Marker1;
        return TestHelpers.validateMarker(newMarker, oldMarker.Type, null, null, show.Id, oldMarker.Start + shift, oldMarker.End + shift, 0, oldMarker.Final, this.testDb);
    }

    /**
     * Ensure we don't apply anything when only checking the shift and the episode has multiple markers. */
    shiftSingleEpisodeWithMultipleMarkersDontApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        return this.#verifyAttemptedShift(episode.Id, 3, 1, true);
    }

    /**
     * Ensure we don't apply anything when an episode has multiple markers and we aren't forcing the operation. */
    shiftSingleEpisodeWithMultipleMarkersTryApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        return this.#verifyAttemptedShift(episode.Id, 3, 1);
    }

    /**
     * Ensure we apply the shift when an episode has multiple markers, but only one isn't being ignored. */
    async shiftSingleEpisodeWithMultipleMarkersTryApplyWithIgnoreTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = 345000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1, MarkerEnum.All, [episode.Marker2.Id, episode.Marker3.Id]);
        const newMarker = result.allMarkers[0];
        await TestHelpers.validateMarker(newMarker, episode.Marker1.Type, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 1, episode.Marker1.Final, this.testDb);

        // Fake marker data to verify that the second marker wasn't changed
        const marker2 = episode.Marker2;
        TestHelpers.verify(marker2.Index === 1, `This test assumes marker2 has an index of 1, test data has changed!`);
        const fakeMarkerData = { id : marker2.Id, start : marker2.Start, end : marker2.End, index : 0 };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, null, marker2.Start, marker2.End, 0, null, this.testDb);
    }

    /**
     * Ensure we apply the shift to multiple markers in the same episode when forcing the operation. */
    async shiftSingleEpisodeWithMultipleMarkersForceApplyTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 3, MarkerEnum.All, [], true, 1);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], episode.Marker1.Type, episode.Id, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, episode.Marker1.Final, this.testDb);
        await TestHelpers.validateMarker(sorted[1], episode.Marker2.Type, episode.Id, null, null, episode.Marker2.Start + shift, episode.Marker2.End + shift, 1, episode.Marker2.Final, this.testDb);
    }

    /**
     * Ensure multiple markers in a season are shifted when the ignore list ensures all episodes only have a single
     * marker to shift. */
    async shiftSeasonWithIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(season.Id, shift, 2, MarkerEnum.All, [season.Episode2.Marker2.Id, season.Episode2.Marker3.Id]);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], season.Episode1.Marker1.Type, null, season.Id, null, season.Episode1.Marker1.Start + shift, season.Episode1.Marker1.End + shift, 0, season.Episode1.Marker1.Final, this.testDb);
        await TestHelpers.validateMarker(sorted[1], season.Episode2.Marker1.Type, null, season.Id, null, season.Episode2.Marker1.Start + shift, season.Episode2.Marker1.End + shift, 0, season.Episode2.Marker1.Final, this.testDb);

        // Fake marker data to verify that the ignored marker wasn't changed
        const marker2 = season.Episode2.Marker2;
        const fakeMarkerData = { id : marker2.Id, start : marker2.Start, end : marker2.End, index : marker2.Index };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, null, marker2.Start, marker2.End, marker2.Index, null);
    }

    /**
     * Ensure we don't apply if any episodes in the season have multiple markers when not force applying. */
    tryShiftSeasonWithoutIgnoreTest() {
        const season = TestBase.DefaultMetadata.Show3.Season1;
        return this.#verifyAttemptedShift(season.Id, 4, 2, true);
    }

    /**
     * Ensure multiple markers in a show are shifted when the ignore list ensures all episodes only have a single
     * marker to shift. */
    async shiftShowWithIgnoreTest() {
        const show = TestBase.DefaultMetadata.Show3;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(show.Id, shift, 3, MarkerEnum.All, [show.Season1.Episode2.Marker1.Id, show.Season1.Episode2.Marker3.Id]);
        /** @type {MarkerData[]} */
        const newMarkers = result.allMarkers;

        // Order not guaranteed.
        const sorted = newMarkers.sort((a, b) => a.id - b.id);
        await TestHelpers.validateMarker(sorted[0], null, null, null, show.Id, show.Season1.Episode1.Marker1.Start + shift, show.Season1.Episode1.Marker1.End + shift, 0, null, this.testDb);
        await TestHelpers.validateMarker(sorted[1], null, null, null, show.Id, show.Season1.Episode2.Marker2.Start + shift, show.Season1.Episode2.Marker2.End + shift, 1, null, this.testDb);
        await TestHelpers.validateMarker(sorted[2], null, null, null, show.Id, show.Season2.Episode1.Marker1.Start + shift, show.Season2.Episode1.Marker1.End + shift, 0, null, this.testDb);

        // Fake marker data to verify that the ignored marker wasn't changed
        const marker1 = show.Season1.Episode2.Marker1;
        const fakeMarkerData = { id : marker1.Id, start : marker1.Start, end : marker1.End, index : marker1.Index };
        return TestHelpers.validateMarker(fakeMarkerData, null, null, null, null, marker1.Start, marker1.End, marker1.Index, null);
    }

    /**
     * Ensure markers are shifted correctly when a separate start and end shift time are given. */
    async splitShiftSeasonTest() {
        const season = TestBase.DefaultMetadata.Show1.Season1;
        // Cut off 6 seconds, 3 from the start and 3 from the end.
        const startShift = 3000;
        const endShift = -3000;
        const result = await this.#verifySplitShift(season.Id, startShift, endShift, 1);
        const newMarker = result.allMarkers[0];
        const oldMarker = season.Episode2.Marker1;
        return TestHelpers.validateMarker(newMarker, null, null, season.Id, null, oldMarker.Start + startShift, oldMarker.End + endShift, 0, null, this.testDb);
    }

    /**
     * Ensure we can shift only Intro markers. */
    async shiftIntroTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = 3000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 1, MarkerEnum.Intro);
        const newMarker = result.allMarkers[0];
        await TestHelpers.validateMarker(newMarker, episode.Marker1.Type, null, null, null, episode.Marker1.Start + shift, episode.Marker1.End + shift, 0, episode.Marker1.Final, this.testDb);
        await TestHelpers.validateMarker(this.#testMarkerFromTestData(episode.Marker2), episode.Marker2.Type, null, null, null, episode.Marker2.Start, episode.Marker2.End, 1, episode.Marker2.Final, this.testDb);
        return TestHelpers.validateMarker(this.#testMarkerFromTestData(episode.Marker3), episode.Marker3.Type, null, null, null, episode.Marker3.Start, episode.Marker3.End, 2, episode.Marker3.Final, this.testDb);
    }

    /** Ensure we can shift only Credits markers. */
    async shiftCreditsTest() {
        const episode = TestBase.DefaultMetadata.Show3.Season1.Episode2;
        const shift = -3000;
        const result = await this.#verifyJoinedShift(episode.Id, shift, 2, MarkerEnum.Credits, [], true /*expectConflict*/, 1 /*force*/);
        await TestHelpers.validateMarker(this.#testMarkerFromTestData(episode.Marker1), episode.Marker1.Type, null, null, null, episode.Marker1.Start, episode.Marker1.End, 0, episode.Marker1.Final, this.testDb);
        await TestHelpers.validateMarker(result.allMarkers[0], episode.Marker2.Type, episode.Id, null, null, episode.Marker2.Start + shift, episode.Marker2.End + shift, 1, episode.Marker2.Final, this.testDb);
        return TestHelpers.validateMarker(result.allMarkers[1], episode.Marker3.Type, episode.Id, null, null, episode.Marker3.Start + shift, episode.Marker3.End + shift, 2, episode.Marker3.Final, this.testDb);
    }

    /**
     * Returns minimal marker data from a DefaultMetadata marker.
     * @param {{Id : number, Start : number, End : number, Index : number, Type : string, Final : boolean}} marker
     * @returns {{id : number, start : number, end : number, index : number}} */
    #testMarkerFromTestData(marker) {
        return {
            id : marker.Id,
            markerType : marker.Type,
            start : marker.Start,
            end : marker.End,
            index : marker.Index,
            isFinal : marker.Final };
    }

    /**
     * Helper that validates a successfully applied shift.
     * @param {number} metadataId The show/season/episode metadata id.
     * @param {number} shift The ms to shift.
     * @param {number} expectedLength The expected number of shifted markers.
     * @param {number} [applyTo] The marker type(s) to apply the shift to.
     * @param {number[]} [ignoreList=[]] The list of marker ids to ignore.
     * @param {boolean} expectConflict Whether we expect to encounter a conflict.
     * @param {boolean} force Whether the shift operation should be forced.
     * @returns {Promise<ShiftResult>} */
    #verifyJoinedShift(metadataId, shift, expectedLength, applyTo=MarkerEnum.All, ignoreList=[], expectConflict=false, force=0) {
        return this.#verifySplitShift(metadataId, shift, shift, expectedLength, applyTo, ignoreList, expectConflict, force);
    }

    /**
     * Helper that validates a successfully applied shift with separate start and end shifts.
     * @param {number} id The show/season/episode metadata id.
     * @param {number} startShift The ms to shift the start of markers.
     * @param {number} endShift The ms to shift the end of markers.
     * @param {number} expectedLength The expected number of shifted markers.
     * @param {number} applyTo The marker type(s) to apply the shift to.
     * @param {number[]} [ignoreList=[]] The list of marker ids to ignore.
     * @param {boolean} expectConflict Whether we expect to encounter a conflict.
     * @param {boolean} force Whether the shift operation should be forced.
     * @returns {Promise<ShiftResult>} */
    async #verifySplitShift(id, startShift, endShift, expectedLength, applyTo=MarkerEnum.All, ignoreList=[], expectConflict=false, force=0) {
        const params = {
            id,
            startShift,
            endShift,
            applyTo,
            force
        };
        if (ignoreList.length !== 0) {
            params.ignored = ignoreList.join(',');
        }

        /** @type {ShiftResult} */
        const result = await this.send('shift', params);

        TestHelpers.verify(result, `Expected successful 'shift' to return an object, found nothing.`);
        TestHelpers.verify(result.applied === true, `Expected successful 'shift' to return applied=true, found ${result.applied}.`);
        TestHelpers.verify(result.conflict === expectConflict, `Expected shift.conflict to be ${expectConflict}, found ${result.conflict}.`);
        TestHelpers.verify(result.overflow === false, `Expected successful 'shift' to have overflow bit unset, found ${result.overflow}.`);

        const newMarkers = result.allMarkers;
        TestHelpers.verify(newMarkers instanceof Array, `Expected successful 'shift' to have an allMarkers field with an array of shifted markers.`);
        TestHelpers.verify(newMarkers.length === expectedLength, `Expected ${expectedLength} shifted marker(s), found ${newMarkers.length}`);
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
            result = await this.send('check_shift', { id : metadataId, applyTo : MarkerEnum.All });
        } else {
            result = await this.send('shift', { id : metadataId, startShift : 3000, endShift : 3000, applyTo : MarkerEnum.All, force : 0 });
        }

        TestHelpers.verify(result, `Expected shift to return a valid object, found nothing.`);
        TestHelpers.verify(result.applied === false, `Expected result.applied to be false, found ${result.applied}.`);
        TestHelpers.verify(result.conflict === expectConflict, `Expected result.conflict to be true, found ${result.conflict}.`);
        TestHelpers.verify(result.allMarkers instanceof Array, `Expected result.allMarkers to be an array.`);
        TestHelpers.verify(result.allMarkers.length === expectedMarkerCount, `Expected result.allMarkers.length to be ${expectedMarkerCount}, found ${result.allMarkers.length}.`);
        TestHelpers.verify(result.episodeData, `Expected non-applied shift to return episode data, didn't find any.`);
        const episodeCount = Object.keys(result.episodeData).length;
        TestHelpers.verify(episodeCount === expectedEpisodeCount, `Expected EpisodeData for ${expectedEpisodeCount} episode(s), found ${episodeCount}`);
        return result;
    }
}

export default ShiftTest;
