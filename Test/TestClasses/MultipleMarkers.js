import TestBase from "../TestBase.js";
import TestHelpers from "../TestHelpers.js";
import { MarkerData } from '../../Shared/PlexTypes.js';

/**
 * Integration test that verifies correct behavior when performing operations that involve multiple markers
 * for a single episode.
 */
class MultipleMarkers extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.testAddAfterExisting,
            this.testAddBeforeExisting,
            this.testAddOverlapFails,
        ];
    }

    className() { return 'MultipleMarkers'; }

    /**
     * Verify that we can add a marker after an existing one, and existing indexes aren't adjusted */
    async testAddAfterExisting() {
        const show = TestBase.DefaultMetadata.Show1;
        const eid = show.Season1.Episode2.Id;
        let marker = await this.send('add', {
            metadataId : eid,
            start : 50000,
            end : 60000
        });

        await TestHelpers.validateMarker(
            marker,
            eid,
            show.Season1.Id,
            show.Id,
            50000 /*start*/,
            60000 /*end*/,
            1 /*index*/,
            this.testDb
        );

        /** @type {MarkerData[]} */
        let newMarkers = await this.send('query', { keys : eid });
        TestHelpers.checkError(newMarkers);

        // Single entry for the one episode queried
        TestHelpers.verify(Object.keys(newMarkers).length == 1, `Expected a single object key from 'query', found ${Object.keys(newMarkers).length}`);
        TestHelpers.verify(newMarkers[eid], `Expected an entry for Episode2 (${eid}), found ${Object.keys(newMarkers)[0]}`);

        newMarkers = newMarkers[eid];
        TestHelpers.verify(newMarkers.length == 2, `Did not find 2 markers after adding a new one, found ${newMarkers.length}`);

        // Markers should be returned in order of index
        for (const i of [0, 1]) {
            const idx = newMarkers[i].index;
            TestHelpers.verify(idx == i, `Expected marker ${i} to have index ${i}, found ${idx}.`);
        }
    }

    /**
     * Verify that we can add a marker before an existing one, and all indexes are properly readjusted */
    async testAddBeforeExisting() {
        // Essentially copy+paste from above, with order swapped
        const show = TestBase.DefaultMetadata.Show1;
        const eid = show.Season1.Episode2.Id;
        let marker = await this.send('add', {
            metadataId : eid,
            start : 0,
            end : 10000
        });

        await TestHelpers.validateMarker(
            marker,
            eid,
            show.Season1.Id,
            show.Id,
            0 /*start*/,
            10000 /*end*/,
            0 /*index*/,
            this.testDb
        );

        /** @type {MarkerData[]} */
        let newMarkers = await this.send('query', { keys : eid });
        TestHelpers.checkError(newMarkers);

        // Single entry for the one episode queried
        TestHelpers.verify(Object.keys(newMarkers).length == 1, `Expected a single object key from 'query', found ${Object.keys(newMarkers).length}`);
        TestHelpers.verify(newMarkers[eid], `Expected an entry for Episode2 (${eid}), found ${Object.keys(newMarkers)[0]}`);

        newMarkers = newMarkers[eid];
        TestHelpers.verify(newMarkers.length == 2, `Did not find 2 markers after adding a new one, found ${newMarkers.length}`);

        // Markers should be returned in order of index
        for (const i of [0, 1]) {
            const idx = newMarkers[i].index;
            TestHelpers.verify(idx == i, `Expected marker ${i} to have index ${i}, found ${idx}.`);
        }
    }

    /**
     * Ensure that attempting to add a marker that overlaps with an existing one fails */
     async testAddOverlapFails() {
        // We know this will error out, don't pollute the console
        this.expectFailure();

        // End overlaps existing beginning
        await this.#failOverlap(0, 15000);
        await this.#failOverlap(0, 15001);

        // Beginning overlaps existing end
        await this.#failOverlap(45000, 50000);
        await this.#failOverlap(44999, 50000);

        // Contains existing
        await this.#failOverlap(14000, 46000);

        // Contained within existing
        await this.#failOverlap(16000, 44000);

        // Identical
        await this.#failOverlap(15000, 45000);
    }

    /**
     * Helper that ensures an add operation fails due to marker overlap.
     * @param {number} start
     * @param {number} end */
    async #failOverlap(start, end) {
        const show = TestBase.DefaultMetadata.Show1;
        let error = await this.send('add', {
            metadataId : show.Season1.Episode2.Id,
            start : start,
            end : end
        }, true /*raw*/);

        TestHelpers.verify(error.status == 400, `Expected overlapping marker ${start}-${end} to return 400, got ${error.status}.`);

        return error.json().then(message => {
            TestHelpers.verify(message.Error, `Expected marker ${start}-${end} to overlap with 15000-45000 and return an error message, not none`);
        });
    }
}

export default MultipleMarkers
