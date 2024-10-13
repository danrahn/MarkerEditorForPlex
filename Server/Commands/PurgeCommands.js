import { MarkerConflictResolution, MarkerData } from '../../Shared/PlexTypes.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { BackupManager } from '../MarkerBackupManager.js';
import LegacyMarkerBreakdown from '../LegacyMarkerBreakdown.js';
import { MarkerCache } from '../MarkerCacheManager.js';
import { PlexQueries } from '../PlexQueryManager.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { registerCommand } from './PostCommand.js';
import ServerError from '../ServerError.js';

/** @typedef {!import('../../Shared/PlexTypes').BulkRestoreResponse} BulkRestoreResponse */
/** @typedef {!import('../../Shared/PlexTypes').MarkerDataMap} MarkerDataMap */


const Log = ContextualLog.Create('PurgeCommands');

/**
 * Checks for markers that the backup database thinks should exist, but aren't in the Plex database.
 * @param {number} metadataId The episode/season/show id*/
function purgeCheck(metadataId) {
    return BackupManager.checkForPurges(metadataId);
}

/**
 * Find all purged markers for the given library section.
 * @param {number} sectionId The library section */
function allPurges(sectionId) {
    return BackupManager.purgesForSection(sectionId);
}

/**
 * Attempts to restore the last known state of the markers with the given ids.
 * @param {{ restoreIds : number[], redeleteIds : { oldId : number, newId : number }[]}} restoreInfo
 * @param {number} sectionId
 * @param {number} resolveType
 * @returns {Promise<BulkRestoreResponse>} */
async function restoreMarkers(restoreInfo, sectionId, resolveType) {
    // TODO: Why does bulk overwrite keep the old markers around?
    if (Object.keys(MarkerConflictResolution).filter(k => MarkerConflictResolution[k] === resolveType).length === 0) {
        throw new ServerError(`Unexpected MarkerConflictResolution type: ${resolveType}`, 400);
    }

    // Handle re-added markers first - Plex-generated markers that were manually deleted, but were subsequently re-added to the database.
    const redeleted = await BackupManager.redeleteMarkers(restoreInfo.redeleteIds, sectionId);
    if (redeleted.length > 0) {
        await reindexAfterRedelete(redeleted);
    }

    const restoredMarkerData = await BackupManager.restoreMarkers(restoreInfo.restoreIds, sectionId, resolveType);
    const restoredMarkers = restoredMarkerData.restoredMarkers;
    const deletedMarkers = restoredMarkerData.deletedMarkers.concat(redeleted);
    const modifiedMarkers = restoredMarkerData.modifiedMarkers;

    if (restoredMarkers.length === 0) {
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
 * @param {number[]} purgedIds
 * @param {number[]} readdedIds
 * @param {number} sectionId */
function ignorePurgedMarkers(purgedIds, readdedIds, sectionId) {
    return BackupManager.ignorePurgedMarkers(purgedIds, readdedIds, sectionId);
}

/**
 * Dangerous. Deletes _all_ markers for the given section and purges the
 * section from the backup database, making this completely unrecoverable.
 * @param {number} sectionId
 * @param {number} deleteType */
async function nukeSection(sectionId, deleteType) {
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
 * Reindex markers after bulk deleting markers. Unlike the regular bulk delete operation,
 * we might have deleted markers from various unrelated metadata ids, which complicates things slightly.
 * @param {MarkerData[]} deletedMarkers */
async function reindexAfterRedelete(deletedMarkers) {
    // Reindex after delete. Group based on metadata id, rolling up as needed to avoid excessive DB calls.
    /** @type {{ [metadataId: number]: MarkerData[] }} */
    const reindexMovies = {};
    /** @type {{[showId: number]: {[seasonId: number]: {[episodeId: number]: MarkerData[]}}}} */
    const reindexEps = {};
    for (const del of deletedMarkers) {
        if (del.showId > 0) {
            (((reindexEps[del.showId] ??= {})[del.seasonId] ??= {})[del.parentId] ??= []).push(del);
        } else {
            (reindexMovies[del.parentId] ??= []).push(del);
        }
    }

    const reindexIds = new Set(Object.keys(reindexMovies));
    for (const [showId, seasons] of Object.entries(reindexEps)) {
        if (Object.values(seasons).length > 1) {
            reindexIds.add(+showId);
            continue;
        }

        for (const [seasonId, episodes] of Object.entries(seasons)) {
            if (Object.values(episodes).length > 1) {
                reindexIds.add(+seasonId);
                continue;
            }

            for (const episodeId of Object.keys(episodes)) {
                reindexIds.add(+episodeId);
            }
        }
    }

    Log.verbose(`Reindexing markers for ${reindexIds.size} metadataIds after re-deleting ${deletedMarkers.length} markers.`);

    // TODO: generalized query batching.
    const batchSize = 5;
    const reindexArray = Array.from(reindexIds);
    const batches = Math.ceil(reindexArray.length / batchSize);
    for (let batch = 0; batch < batches; ++batch) {
        /** @type {Promise<MarkersWithTypeInfo>[]} */
        const promises = [];
        for (let reindex = 0; reindex < batchSize; ++reindex) {
            const idx = batch * batchSize + reindex;
            if (idx >= reindexArray.length) {
                break;
            }

            promises.push(PlexQueries.reindex(reindexArray[idx]));
        }

        await Promise.all(promises);
    }
}

/**
 * Parse custom form data for purge restores.
 * @param {string} purgeInfo */
function parseRestoreData(purgeInfo) {
    if (!purgeInfo) {
        throw new ServerError('No purge info found', 400);
    }

    try {
        /** @type {{ restoreIds : number[], redeleteIds : { oldId : number, newId : number }[]}} */
        const parsed = JSON.parse(purgeInfo);
        if (!Object.prototype.hasOwnProperty.call(parsed, 'restoreIds') || !(parsed.restoreIds instanceof Array)) {
            throw new ServerError(`Expected purged field to be an array, found something else`, 400);
        }

        if (!Object.prototype.hasOwnProperty.call(parsed, 'redeleteIds') || !(parsed.redeleteIds instanceof Array)) {
            throw new ServerError(`Expected redeleteIds field to be an array, found something else`, 400);
        }

        for (const id of parsed.restoreIds) {
            if (typeof id !== 'number') {
                throw new ServerError(`Expected number for purged marker id, found ${typeof id}`, 400);
            }
        }

        for (const redelete of parsed.redeleteIds) {
            if (typeof redelete !== 'object' || !redelete.oldId || !redelete.newId
                || typeof redelete.oldId !== 'number' || typeof redelete.newId !== 'number') {
                throw new ServerError(`Expected redeleted objects to have an oldId and newId, found ${JSON.stringify(redelete)}`);
            }
        }

        return parsed;

    } catch (err) {
        throw new ServerError(`Failed to parse purge info data: ${err.message}`, 400);
    }
}

/**
 * Register all POST methods related to purged markers. */
export function registerPurgeCommands() {
    registerCommand(PostCommands.PurgeCheck, q => purgeCheck(q.i('id')));
    registerCommand(PostCommands.AllPurges, q => allPurges(q.i('sectionId')));
    registerCommand(PostCommands.RestorePurges, q => restoreMarkers(
        q.fc('restoreInfo', parseRestoreData),
        q.fi('sectionId'),
        q.fi('resolveType')));
    registerCommand(PostCommands.IgnorePurges, q => ignorePurgedMarkers(q.ia('purgedIds'), q.ia('readdedIds'), q.i('sectionId')));

    registerCommand(PostCommands.Nuke, q => nukeSection(...q.is('sectionId', 'deleteType')));
}
