import { MarkerEnum, MarkerType } from '../../Shared/MarkerType.js';
import { PlexQueries } from '../../Server/PlexQueryManager.js';
import TestBase from '../TestBase.js';
import TestHelpers from '../TestHelpers.js';

class DeleteAllTest extends TestBase {
    constructor() {
        super();
        this.testMethods = [
            this.deleteAllMarkersTVTest,
            this.deleteAllMarkersMovieTest,
            this.deleteIntroMarkersTVTest,
            this.deleteIntroMarkersMovieTest,
            this.deleteCreditsMarkersTVTest,
            this.deleteCreditsMarkersMovieTest,
            this.deleteAdMarkersTest,
            this.deleteBadSectionNoOpTest,
        ];
    }

    className() { return 'DeleteAllTest'; }

    /**
     * Delete all markers from library section 1 (TV shows) */
    async deleteAllMarkersTVTest() {
        this.#verifyShowMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 1, deleteType : MarkerEnum.All });

        // TODO: Better tracking of '6' if/when it changes. It'd be much easier to have a single source of truth.
        TestHelpers.verify(data.deleted === 6, `Expected 6 markers to be deleted from section 1, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 6, `Expected 6 markers to be deleted from section 1 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Show1.Id, dm.Show2.Id, dm.Show3.Id);

        // Ensure the movie library was not affected
        this.#verifyMovieMarkerCountPrecondition();
    }

    /**
     * Delete all markers from library section 2 (Movies) */
    async deleteAllMarkersMovieTest() {
        this.#verifyMovieMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 2, deleteType : MarkerEnum.All });

        TestHelpers.verify(data.deleted === 5, `Expected 5 markers to be deleted from section 2, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 5, `Expected 5 markers to be deleted from section 2 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Movie1.Id, dm.Movie2.Id, dm.Movie3.Id);

        // Ensure the TV library was not affected
        this.#verifyShowMarkerCountPrecondition();
    }

    /**
     * Delete intro markers from library section 1 (TV shows) */
    async deleteIntroMarkersTVTest() {
        this.#verifyShowMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 1, deleteType : MarkerEnum.Intro });

        // TODO: Better tracking of '6' if/when it changes. It'd be much easier to have a single source of truth.
        TestHelpers.verify(data.deleted === 4, `Expected 4 markers to be deleted from section 1, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 4, `Expected 4 markers to be deleted from section 1 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Show1.Id, dm.Show2.Id);
        this.#verifyMarkerCount(dm.Show3.Id, 2, MarkerType.Credits);
        this.#verifyMovieMarkerCountPrecondition();
    }

    /**
     * Delete intro markers from library section 2 (Movies) */
    async deleteIntroMarkersMovieTest() {
        this.#verifyMovieMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 2, deleteType : MarkerEnum.Intro });

        TestHelpers.verify(data.deleted === 2, `Expected 2 markers to be deleted from section 2, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 2, `Expected 2 markers to be deleted from section 2 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Movie1.Id, dm.Movie3.Id);
        this.#verifyMarkerCount(dm.Movie2.Id, 3);
        this.#verifyShowMarkerCountPrecondition();
    }

    /**
     * Delete credits markers from library section 1 (TV shows) */
    async deleteCreditsMarkersTVTest() {
        this.#verifyShowMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 1, deleteType : MarkerEnum.Credits });

        // TODO: Better tracking of '6' if/when it changes. It'd be much easier to have a single source of truth.
        TestHelpers.verify(data.deleted === 2, `Expected 2 markers to be deleted from section 1, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 2, `Expected 2 markers to be deleted from section 1 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Show2.Id);
        this.#verifyMarkerCount(dm.Show1.Id, 1, MarkerType.Intro);
        this.#verifyMarkerCount(dm.Show3.Id, 3, MarkerType.Intro);
        this.#verifyMovieMarkerCountPrecondition();
    }

    /**
     * Delete credits markers from library section 2 (Movies) */
    async deleteCreditsMarkersMovieTest() {
        this.#verifyMovieMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 2, deleteType : MarkerEnum.Credits });

        TestHelpers.verify(data.deleted === 2, `Expected 2 markers to be deleted from section 2, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 2, `Expected 2 markers to be deleted from section 2 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Movie1.Id);
        this.#verifyMarkerCount(dm.Movie2.Id, 2);
        this.#verifyMarkerCount(dm.Movie3.Id, 1, MarkerType.Intro);
        this.#verifyShowMarkerCountPrecondition();
    }

    /**
     * Delete ad markers from library section 2 (Movies) */
    async deleteAdMarkersTest() {
        this.#verifyMovieMarkerCountPrecondition();

        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 2, deleteType : MarkerEnum.Ad });

        TestHelpers.verify(data.deleted === 1, `Expected 1 marker to be deleted from section 2, got ${data.deleted}`);
        TestHelpers.verify(data.cacheDeleted === 1, `Expected 1 marker to be deleted from section 2 cache, got ${data.cacheDeleted}`);

        // Nothing in our backup database
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);

        const dm = TestBase.DefaultMetadata;
        this.#verifyNoMarkers(dm.Movie1.Id);
        this.#verifyMarkerCount(dm.Movie2.Id, 3);
        this.#verifyMarkerCount(dm.Movie3.Id, 1, MarkerType.Intro);
        this.#verifyShowMarkerCountPrecondition();
    }

    /**
     * Don't do anything if a bad section is provided. */
    async deleteBadSectionNoOpTest() {
        /** @type {{ deleted : number, backupDeleted : number, cacheDeleted : number }} */
        const data = await this.send('nuke_section', { sectionId : 3, deleteType : MarkerEnum.Intro | MarkerEnum.Credits });
        TestHelpers.verify(data.deleted === 0, `Expected no deleted markers when nuking invalid section, got ${data.deleted}`);
        TestHelpers.verify(data.deleted === 0, `Expected no deleted cached markers when nuking invalid section, got ${data.cacheDeleted}`);
        TestHelpers.verify(data.backupDeleted === 0, `Didn't expect any backup markers to be deleted, got ${data.backupDeleted}`);
    }

    /**
     * Quick check to ensure our TV library has the expected number of markers. */
    #verifyShowMarkerCountPrecondition() {
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Show1.Id, 1);
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Show2.Id, 0);
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Show3.Id, 5);
    }

    /**
     * Quick check to ensure our TV library has the expected number of markers. */
    #verifyMovieMarkerCountPrecondition() {
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Movie1.Id, 0);
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Movie2.Id, 4);
        this.#verifyMarkerCount(TestBase.DefaultMetadata.Movie3.Id, 1);
    }

    /**
     * Verify that all the given metadata ids have no markers associated with them.
     * @param  {...number} metadataIds */
    #verifyNoMarkers(...metadataIds) {
        for (const metadataId of metadataIds) {
            this.#verifyMarkerCount(metadataId, 0);
        }
    }

    /**
     * Ensure the media item with the given metadata id has the given number of markers.
     * @param {number} metadataId
     * @param {number} expected
     * @param {string?} markerType Marker type. If not provided, marker type won't be checked */
    #verifyMarkerCount(metadataId, expected, markerType) {
        // TODO: Are we okay reaching into the service, or should this be a generic request for all markers for a given id?
        // That endpoint doesn't exist yet, so broadly it might be worth adding an endpoint (or adjusting the query endpoint)
        // to accept an arbitrary metadata id, not locked to a leaf type.
        const markers = PlexQueries.getMarkersAuto(metadataId);
        TestHelpers.verify(
            markers.markers.length === expected,
            `Expected metadataId ${metadataId} to have ${expected} markers, found ${markers.markers.length}`);

        if (!markerType) {
            return;
        }

        for (const marker of markers.markers) {
            TestHelpers.verify(marker.marker_type === markerType, `Expected marker type ${markerType}, found ${marker.marker_type}`);
        }
    }
}


export default DeleteAllTest;
