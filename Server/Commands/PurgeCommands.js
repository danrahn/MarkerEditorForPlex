import { Log } from "../../Shared/ConsoleLog.js";
import { MarkerData } from "../../Shared/PlexTypes.js";

import { BackupManager } from "../MarkerBackupManager.js";
import { MarkerCache } from "../MarkerCacheManager.js";
import { Config } from "../IntroEditorConfig.js";
import ServerError from "../ServerError.js";

class PurgeCommands {

    /**
     * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
     * @param {number} metadataId The episode/season/show id*/
    static async purgeCheck(metadataId) {
        PurgeCommands.#checkBackupManagerEnabled();

        const markers = await BackupManager.checkForPurges(metadataId);
        Log.info(markers, `Found ${markers.length} missing markers:`);
        return Promise.resolve(markers);
    }

    /**
     * Find all purged markers for the given library section.
     * @param {number} sectionId The library section */
    static async allPurges(sectionId) {
        PurgeCommands.#checkBackupManagerEnabled();

        const purges = await BackupManager.purgesForSection(sectionId);
        return Promise.resolve(purges);
    }

    /**
     * Attempts to restore the last known state of the markers with the given ids.
     * @param {number[]} oldMarkerIds
     * @param {number} sectionId */
    static async restoreMarkers(oldMarkerIds, sectionId) {
        PurgeCommands.#checkBackupManagerEnabled();

        const restoredMarkerData = await BackupManager.restoreMarkers(oldMarkerIds, sectionId);
        const restoredMarkers = restoredMarkerData.restoredMarkers;
        const existingMarkers = restoredMarkerData.existingMarkers;

        if (restoredMarkers.length == 0) {
            Log.verbose(`IntroEditor::restoreMarkers: No markers to restore, likely because they all already existed.`);
        }

        let markerData = [];
        Log.tmi(`Adding ${restoredMarkers.length} to marker cache.`);
        for (const restoredMarker of restoredMarkers) {
            MarkerCache?.addMarkerToCache(restoredMarker);
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
    static async ignorePurgedMarkers(oldMarkerIds, sectionId) {
        PurgeCommands.#checkBackupManagerEnabled();

        await BackupManager.ignorePurgedMarkers(oldMarkerIds, sectionId);
    }

    /**
     * Throw a ServerError if the backup manager is not enabled. */
    static #checkBackupManagerEnabled() {
        if (!BackupManager || !Config.backupActions()) {
            throw new ServerError('Action is not enabled due to configuration settings.', 400);
        }
    }
}

export default PurgeCommands;
