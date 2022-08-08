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
            this.testSingleEdit,
            this.testEditOfNonexistentMarker,
            this.testSingleDelete,
            this.testDeleteOfNonexistentMarker,
        ];
    }

    className() { return 'BasicCRUD'; }

    /**
     * Test adding a single marker to an episode that has no existing markers. */
    async testSingleAdd() {
        const show = TestBase.DefaultMetadata.Show1;
        let marker = await this.send('add', {
            metadataId : show.Season1.Episode1.Id,
            start : 0,
            end : 1000
        });

        return TestHelpers.validateMarker(
            marker,
            show.Season1.Episode1.Id,
            show.Season1.Id,
            show.Id,
            0 /*expectedStart*/,
            1000 /*expectedEnd*/,
            0 /*expectedIndex*/,
            this.testDb);
    }

    /**
     * Test editing an existing marker for a single episode. */
    async testSingleEdit() {
        // With default config, taggings id 1 is a marker from 15 to 45 seconds.
        const show = TestBase.DefaultMetadata.Show1;
        let marker = await this.send('edit', {
            id : show.Season1.Episode2.Marker1.Id,
            start : 14000,
            end : 46000,
            userCreated : 0
        });

        // Edit returns modified data
        return TestHelpers.validateMarker(marker,
            show.Season1.Episode2.Id,
            show.Season1.Id,
            show.Id,
            14000 /*expectedStart*/,
            46000 /*expectedEnd*/,
            0 /*expectedIndex*/,
            this.testDb);
    }

    /**
     * Ensure we fail if we attempt to edit a marker that doesn't exist. */
    async testEditOfNonexistentMarker() {
        // Don't surface expected errors from the main application log
        this.expectFailure();
        let response = await this.send('edit', {
            id : 100, /* arbitrary bad value */
            start : 0,
            end : 10000,
            userCreated : 0
        }, true /*raw*/);

        TestHelpers.verify(response.status == 400, `Expected edit of nonexistent marker to return 400, got ${response.status}`);

        return response.json().then(message => {
            TestHelpers.verify(message.Error, `Expected an error message for edit of nonexistent marker, found nothing.`);
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
            show.Season1.Episode2.Id,
            show.Season1.Id,
            show.Id,
            15000 /*expectedStart*/,
            45000 /*expectedEnd*/,
            0 /*expectedIndex*/,
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

        TestHelpers.verify(response.status == 400, `Expected delete of nonexistent marker to return 400, got ${response.status}`);
        return response.json().then(message => {
            TestHelpers.verify(message.Error, `Expected an error message for delete of nonexistent marker, found nothing.`);
        });
    }
}

export default BasicCRUD;
