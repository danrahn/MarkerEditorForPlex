import { MarkerConflictResolution, MarkerData } from '../../Shared/PlexTypes.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { BackupManager } from '../MarkerBackupManager.js';
import { Config } from '../IntroEditorConfig.js';
import LegacyMarkerBreakdown from '../LegacyMarkerBreakdown.js';
import { MarkerCache } from '../MarkerCacheManager.js';
import { PlexQueries } from '../PlexQueryManager.js';
import ServerError from '../ServerError.js';

/** @typedef {!import('../../Shared/PlexTypes').MarkerDataMap} MarkerDataMap */


const Log = new ContextualLog('PurgeCommands');

class PurgeCommands {

    /**
     * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
     * @param {number} metadataId The episode/season/show id*/
    static async purgeCheck(metadataId) {
        PurgeCommands.#checkBackupManagerEnabled();

        const markers = await BackupManager.checkForPurges(metadataId);
        return markers;
    }

    /**
     * Find all purged markers for the given library section.
     * @param {number} sectionId The library section */
    static async allPurges(sectionId) {
        PurgeCommands.#checkBackupManagerEnabled();

        const purges = await BackupManager.purgesForSection(sectionId);
        return purges;
    }

    /**
     * Attempts to restore the last known state of the markers with the given ids.
     * @param {number[]} oldMarkerIds
     * @param {number} sectionId
     * @param {number} resolveType */
    static async restoreMarkers(oldMarkerIds, sectionId, resolveType) {
        PurgeCommands.#checkBackupManagerEnabled(); // TODO: Why does bulk overwrite keep the old markers around?

        if (Object.keys(MarkerConflictResolution).filter(k => MarkerConflictResolution[k] == resolveType).length == 0) {
            throw new ServerError(`Unexpected MarkerConflictResolution type: ${resolveType}`, 400);
        }

        const restoredMarkerData = await BackupManager.restoreMarkers(oldMarkerIds, sectionId, resolveType);
        const restoredMarkers = restoredMarkerData.restoredMarkers;
        const deletedMarkers = restoredMarkerData.deletedMarkers;
        const modifiedMarkers = restoredMarkerData.modifiedMarkers;

        if (restoredMarkers.length == 0) {
            Log.verbose(`restoreMarkers: No markers to restore, likely because they all already existed.`);
        }


        /** @type {MarkerDataMap} */
        const delMarkerMap = {};
        Log.tmi(`Removing ${deletedMarkers} from marker cache.`);
        for (const deletedMarker of deletedMarkers) {
            MarkerCache?.removeMarkerFromCache(deletedMarker.id);
            (delMarkerMap[deletedMarker.parentId] ??= []).push(deletedMarker);
        }

        /** @type {MarkerDataMap} */
        const newMarkerMap = {};
        Log.tmi(`Adding ${restoredMarkers.length} to marker cache.`);
        for (const restoredMarker of restoredMarkers) {
            MarkerCache?.addMarkerToCache(restoredMarker);
            (newMarkerMap[restoredMarker.parent_id] ??= []).push(new MarkerData(restoredMarker));
        }

        // TODO: If cache is ever broken down by intros/credits, we'll need
        //       to integrate with MarkerCache for edited markers here.
        /** @type {MarkerDataMap} */
        const modMarkerMap = {};
        for (const modMarker of modifiedMarkers) {
            (modMarkerMap[modMarker.parentId] ??= []).push(modMarker);
        }

        return {
            newMarkers : newMarkerMap,
            deletedMarkers : delMarkerMap,
            modifiedMarkers : modMarkerMap,
            ignoredMarkers : restoredMarkerData.ignoredMarkers };
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
     * Dangerous. Deletes _all_ markers for the given section and purges the
     * section from the backup database, making this completely unrecoverable.
     * @param {number} sectionId
     * @param {number} deleteType */
    static async nukeSection(sectionId, deleteType) {
        PurgeCommands.#checkBackupManagerEnabled();
        if (!MarkerCache) {
            throw new ServerError('Action is not enabled due to a configuration setting.', 400);
        }

        const dbDeleteCount = await PlexQueries.nukeSection(sectionId, deleteType);
        const backupDeleteCount = await BackupManager.nukeSection(sectionId, deleteType);
        const cacheRemoveCount = MarkerCache.nukeSection(sectionId, deleteType);

        // Don't bother doing anything special with this, just clear it out and force
        // repopulation. We shouldn't even be using this if this command is enabled anyway.
        LegacyMarkerBreakdown.Clear();

        return {
            deleted : dbDeleteCount,
            backupDeleted : backupDeleteCount,
            cacheDeleted : cacheRemoveCount, };
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
