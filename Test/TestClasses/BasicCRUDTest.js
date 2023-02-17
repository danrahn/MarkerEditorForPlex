import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

/**
 * Integration test for basic Create, Update, and Delete operations.
 * No (R)enaming to do, but CRUD sounds better than CUD. */
class BasicCRUD extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.testSingleAdd,
            this.testAddFlippedStartAndEnd,
            this.testNegativeStart,
            this.testEqualStartAndEnd,
            this.testAddToSeason,
            this.testAddToShow,
            this.testSingleEdit,
            this.testEditOfNonexistentMarker,
            this.testEditFlippedStartAndEnd,
            this.testSingleDelete,
            this.testDeleteOfNonexistentMarker,
        ];
    }

    className() { return 'BasicCRUD'; }

    /**
     * Test adding a single marker to an episode that has no existing markers. */
    async testSingleAdd() {
        const show = TestBase.DefaultMetadata.Show1;
        let marker = await this.addMarker(show.Season1.Episode1.Id, 0, 1000);

        return TestHelpers.validateMarker(
            marker,
            'intro' /*expectedType*/,
            show.Season1.Episode1.Id,
            show.Season1.Id,
            show.Id,
            0 /*expectedStart*/,
            1000 /*expectedEnd*/,
            0 /*expectedIndex*/,
            false /*expectedFinal*/,
            this.testDb);
    }

    /**
     * Ensure attempting to add a marker with a start time greater than the end time fails.
     * It'd be interesting if flipped markers would allow us to seek back in time though, if
     * someone wanted to do that for whatever reason. */
    async testAddFlippedStartAndEnd() {
        const show = TestBase.DefaultMetadata.Show1;
        return this.#flippedTestHelper('add', {
            metadataId : show.Season1.Episode1.Id,
            start : 1000,
            end : 0
        });
    }

    /**
     * Ensure attempting to add a marker with a negative index fails. */
    async testNegativeStart() {
        this.expectFailure();
        const show = TestBase.DefaultMetadata.Show1;
        let response = await this.addMarkerRaw(show.Season1.Episode1.Id, -1, 10000);

        return TestHelpers.verifyBadRequest(response, 'add with negative startMs');
    }

    /**
     * A marker can't have the same start and end time. */
    async testEqualStartAndEnd() {
        this.expectFailure();
        const show = TestBase.DefaultMetadata.Show1;
        let response = await this.addMarkerRaw(show.Season1.Episode1.Id, 10000, 10000);

        return TestHelpers.verifyBadRequest(response, 'add with equal startMs and endMs');
    }

    /**
     * Ensure attempting to add a marker to a season fails. */
    async testAddToSeason() {
        return this.#addToWrongMetadataType(TestBase.DefaultMetadata.Show1.Season1.Id);
    }

    /**
     * Ensure attempting to add a marker to a show fails. */
    async testAddToShow() {
        return this.#addToWrongMetadataType(TestBase.DefaultMetadata.Show1.Id);
    }

    /**
     * Helper that tries to add a marker to an item with the given metadataId,
     * which isn't an episode. */
    async #addToWrongMetadataType(metadataId) {
        this.expectFailure();
        let response = await this.addMarkerRaw(metadataId, 0, 10000);

        return TestHelpers.verifyBadRequest(response);
    }

    /**
     * Test editing an existing marker for a single episode. */
    async testSingleEdit() {
        // With default config, taggings id 1 is a marker from 15 to 45 seconds.
        const show = TestBase.DefaultMetadata.Show1;
        let marker = await this.editMarker(show.Season1.Episode2.Marker1.Id, 14000, 46000);

        // Edit returns modified data
        return TestHelpers.validateMarker(marker,
            'intro' /*expectedType*/,
            show.Season1.Episode2.Id,
            show.Season1.Id,
            show.Id,
            14000 /*expectedStart*/,
            46000 /*expectedEnd*/,
            0 /*expectedIndex*/,
            false /*expectedFinal*/,
            this.testDb);
    }

    /**
     * Ensure we fail if we attempt to edit a marker that doesn't exist. */
    async testEditOfNonexistentMarker() {
        // Don't surface expected errors from the main application log
        this.expectFailure();
        /* MarkerId of 100 = arbitrary bad value */
        let response = await this.editMarkerRaw(100, 0, 10000);

        return TestHelpers.verifyBadRequest(response, 'edit of nonexistent marker');
    }

    /**
     * Ensure we fail to edit a marker to have a start time greater than the end time. */
    async testEditFlippedStartAndEnd() {
        const show = TestBase.DefaultMetadata.Show1;
        return this.#flippedTestHelper('edit', {
            id : show.Season1.Episode2.Marker1.Id,
            start : 10000,
            end : 0,
            userCreated : 0
        });
    }

    /**
     * Test deleting a single marker from an episode. */
    async testSingleDelete() {
        const show = TestBase.DefaultMetadata.Show1;
        let marker = await this.send('delete', {
            id : show.Season1.Episode2.Marker1.Id,
        });

        return TestHelpers.validateMarker(marker,
            'intro' /*expectedType*/,
            show.Season1.Episode2.Id,
            show.Season1.Id,
            show.Id,
            15000 /*expectedStart*/,
            45000 /*expectedEnd*/,
            0 /*expectedIndex*/,
            false /*expectedFinal*/,
            this.testDb,
            true /*isDeleted*/);
    }

    /**
     * Ensure we fail if we attempt to delete a marker that doesn't exist. */
    async testDeleteOfNonexistentMarker() {
        // Don't surface expected errors from the main application log
        this.expectFailure();
        let response = await this.send('delete', {
            id : 100, /* arbitrary bad value */
        }, true /*raw*/);

        return TestHelpers.verifyBadRequest(response, 'delete of nonexistent marker');
    }

    /** Small helper that tests start > end requests for adding and editing markers. */
    async #flippedTestHelper(endpoint, parameters) {
        this.expectFailure();
        let response = await this.send(endpoint, parameters, true /*raw*/);

        return TestHelpers.verifyBadRequest(response, `${endpoint} with startMs greater than endMs`);
    }
}

export default BasicCRUD;
