import { Log } from "../../Shared/ConsoleLog.js";
import { MarkerData } from "../../Shared/PlexTypes.js";

import MarkerBackupManager from "../MarkerBackupManager.js";
import MarkerCacheManager from "../MarkerCacheManager.js";
import ServerError from "../ServerError.js";

class PurgeCommands {
    #enabled = false;
    /** @type {MarkerBackupManager} */
    #backupManager;
    /** @type {MarkerCacheManager} */
    #markerCache;

    /**
     * @param {MarkerBackupManager} backupManager
     * @param {PlexIntroEditorConfig} config */
    constructor(backupManager, markerCache, config) {
        Log.tmi(`Setting up purge commands.`);
        if (config.backupActions()) {
            this.#enabled = true;
            this.#backupManager = backupManager;
            this.#markerCache = markerCache;
        }
    }

    /**
     * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
     * @param {number} metadataId The episode/season/show id*/
    async purgeCheck(metadataId) {
        this.#checkBackupManagerEnabled();

        const markers = await this.#backupManager.checkForPurges(metadataId);
        Log.info(markers, `Found ${markers.length} missing markers:`);
        return Promise.resolve(markers);
    }

    /**
     * Find all purged markers for the given library section.
     * @param {number} sectionId The library section */
    async allPurges(sectionId) {
        this.#checkBackupManagerEnabled();

        const purges = await this.#backupManager.purgesForSection(sectionId);
        return Promise.resolve(purges);
    }

    /**
     * Attempts to restore the last known state of the markers with the given ids.
     * @param {number[]} oldMarkerIds
     * @param {number} sectionId */
    async restoreMarkers(oldMarkerIds, sectionId) {
        this.#checkBackupManagerEnabled();

        const restoredMarkerData = await this.#backupManager.restoreMarkers(oldMarkerIds, sectionId);
        const restoredMarkers = restoredMarkerData.restoredMarkers;
        const existingMarkers = restoredMarkerData.existingMarkers;

        if (restoredMarkers.length == 0) {
            Log.verbose(`PlexIntroEditor::restoreMarkers: No markers to restore, likely because they all already existed.`);
        }

        let markerData = [];
        Log.tmi(`Adding ${restoredMarkers.length} to marker cache.`);
        for (const restoredMarker of restoredMarkers) {
            this.#markerCache?.addMarkerToCache(restoredMarker);
            markerData.push(new MarkerData(restoredMarker));
        }

        let existingMarkerData = [];
        for (const existingMarker of existingMarkers) {
            existingMarkerData.push(new MarkerData(existingMarker));
        }

        return Promise.resolve({ newMarkers : markerData, existingMarkers : existingMarkerData });
    }

    /**
     * Ignores the purged markers with the given ids, preventing the user from seeing them again.
     * @param {number[]} oldMarkerIds
     * @param {number} sectionId */
    async ignorePurgedMarkers(oldMarkerIds, sectionId) {
        this.#checkBackupManagerEnabled();

        await this.#backupManager.ignorePurgedMarkers(oldMarkerIds, sectionId);
        return Promise.resolve();
    }

    /**
     * Throw a ServerError if the backup manager is not enabled. */
    #checkBackupManagerEnabled() {
        if (!this.#enabled) {
            throw new ServerError('Action is not enabled due to configuration settings.', 400);
        }
    }
}

export default PurgeCommands;
