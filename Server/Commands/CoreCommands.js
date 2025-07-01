import { BulkMarkerResolveType, EpisodeData, MarkerData } from '../../Shared/PlexTypes.js';
import { MarkerEnum, MarkerType } from '../../Shared/MarkerType.js';
import { ContextualLog } from '../../Shared/ConsoleLog.js';

import { MetadataType, PlexQueries } from '../PlexQueryManager.js';
import { BackupManager } from '../MarkerBackupManager.js';
import LegacyMarkerBreakdown from '../LegacyMarkerBreakdown.js';
import { MarkerCache } from '../MarkerCacheManager.js';
import { PostCommands } from '../../Shared/PostCommands.js';
import { registerCommand } from './PostCommand.js';
import ServerError from '../ServerError.js';

/** @typedef {!import('../../Shared/PlexTypes').BulkAddResult} BulkAddResult */
/** @typedef {!import('../../Shared/PlexTypes').BulkDeleteResult} BulkDeleteResult */
/** @typedef {!import('../../Shared/PlexTypes').CustomBulkAddMap} CustomBulkAddMap */
/** @typedef {!import('../../Shared/PlexTypes').OldMarkerTimings} OldMarkerTimings */
/** @typedef {!import('../../Shared/PlexTypes').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes').SerializedMarkerData} SerializedMarkerData */
/** @typedef {!import('../../Shared/PlexTypes').ShiftResult} ShiftResult */
/** @typedef {!import('../PlexQueryManager').RawEpisodeData} RawEpisodeData */
/** @typedef {!import('../PlexQueryManager').RawMarkerData} RawMarkerData */
/** @typedef {!import('../QueryParse').QueryParser} QueryParser */


const Log = ContextualLog.Create('CoreCommands');

/*
 * Core add/edit/delete commands, including bulk operations
 */

/* *********
 * Helpers *
 ********* */

/**
 * Checks whether the given startMs-endMs bounds are valid, throwing
 * a ServerError on failure. Also check for a valid marker type.
 * @param {number} startMs
 * @param {number} endMs
 * @param {string} markerType
 * @throws {ServerError} */
function checkMarkerBounds(startMs, endMs, markerType) {
    if (startMs >= endMs) {
        throw new ServerError(`Start time (${startMs}) must be less than end time (${endMs}).`, 400);
    }

    if (startMs < 0) {
        throw new ServerError(`Start time (${startMs}) cannot be negative.`, 400);
    }

    if (Object.values(MarkerType).indexOf(markerType) === -1) {
        throw new ServerError(`Marker type "${markerType}" is not valid.`, 400);
    }
}

/**
 * @param {BulkAddResult} addResult
 * @param {RawMarkerData[]} previousMarkers */
async function bulkAddPostProcess(addResult, previousMarkers) {
    if (!addResult.applied) {
        // Nothing applied, nothing to do.
        return 0;
    }

    const episodes = Object.values(addResult.episodeMap);
    /** @type {MarkerData[]} */
    const adds = [];
    episodes.forEach(episodeData => {
        if (episodeData.changedMarker && episodeData.isAdd) adds.push(episodeData.changedMarker);
    });

    /** @type {MarkerData[]} */
    const edits = [];
    episodes.forEach(episodeData => {
        if (episodeData.changedMarker && !episodeData.isAdd) edits.push(episodeData.changedMarker);
    });

    /** @type {MarkerData[]} */
    const deletes = [];
    episodes.forEach(episodeData => {
        if (episodeData.deletedMarkers) deletes.push(...episodeData.deletedMarkers);
    });

    /** @type {{[episodeId: number]: RawMarkerData[]}} */
    const markerCounts = {};
    /** @type {OldMarkerTimings} */
    const oldMarkerTimings = {};
    for (const marker of previousMarkers) {
        markerCounts[marker.parent_id] ??= 0;
        ++markerCounts[marker.parent_id];
        oldMarkerTimings[marker.id] = { start : marker.start, end : marker.end };
    }

    for (const add of adds) {
        LegacyMarkerBreakdown.Update(add, markerCounts[add.parentId]++, 1);
        MarkerCache?.addMarkerToCache({
            // Gross, but need to convert from MarkerData to RawMarkerData
            id : add.id,
            start : add.start,
            end : add.end,
            section_id : add.sectionId,
            show_id : add.showId,
            season_id : add.seasonId,
            parent_id : add.parentId,
            marker_type : add.markerType,
        });
    }

    for (const deleted of deletes) {
        MarkerCache?.removeMarkerFromCache(deleted.id);
        // TODO: Remove LegacyMarkerBreakdown. Forcing full marker enumeration makes things much easier,
        //       but I don't have a large enough real-world database to test this on (100K+ episodes)
        LegacyMarkerBreakdown.Update(deleted, markerCounts[deleted.parentId]--, -1);
    }

    await BackupManager.recordAdds(adds);
    await BackupManager.recordEdits(edits, oldMarkerTimings);
    await BackupManager.recordDeletes(deletes);
    return adds.length;
}

/**
 * Verify that custom marker data retrieved from form-data is correctly formatted.
 * @param {string} markers
 * @returns {CustomBulkAddMap} */
function parseCustomMarkerData(markers) {
    if (!markers) {
        throw new ServerError('No marker data found', 400);
    }

    try {
        /** @type {{ [key: string]: any }} */
        const parsed = JSON.parse(markers);
        for (const [key, value] of Object.entries(parsed)) {
            if (isNaN(parseInt(key))) {
                throw new ServerError(`Non-integer episode id in custom marker data.`, 400);
            }

            const start = parseInt(value.start);
            const end = parseInt(value.end);
            if (Object.values(value).length !== 2 || isNaN(start) || isNaN(end)) {
                throw new ServerError(`Unexpected marker timestamp data in custom marker data.`, 400);
            }

            if (start < 0 || end <= start) {
                throw new ServerError(`Invalid marker timestamp data given [start=${start}, end=${end}]`, 400);
            }
        }

        return parsed;
    } catch (err) {
        throw new ServerError(`Failed to parse marker data: ${err.message}`, 400);
    }
}

/* **************
 * Core Methods *
 ************** */

/**
 * Adds the given marker to the database, rearranging indexes as necessary.
 * @param {string} markerType The type of marker
 * @param {number} metadataId The metadata id of the episode to add a marker to.
 * @param {number} startMs The start time of the marker, in milliseconds.
 * @param {number} endMs The end time of the marker, in milliseconds.
 * @param {number} final Whether this marker is the final marker (credits only).
 * @throws {ServerError} */
async function addMarker(markerType, metadataId, startMs, endMs, final) {
    checkMarkerBounds(startMs, endMs, markerType);

    if (markerType !== MarkerType.Credits && final) {
        // TODO: If a marker is final, and one is added after it, final should be removed.
        // That really shouldn't be possible though, since 'final' implies it goes to the end of the episode.
        Log.warn(`Got a request for a 'final' marker that isn't a credit marker!`);
        final = 0;
    }

    const addResult = await PlexQueries.addMarker(metadataId, startMs, endMs, markerType, final);
    const allMarkers = addResult.allMarkers;
    const newMarker = addResult.newMarker;
    const markerData = new MarkerData(newMarker);
    LegacyMarkerBreakdown.Update(markerData, allMarkers.length - 1, 1 /*delta*/);
    MarkerCache?.addMarkerToCache(newMarker);
    await BackupManager.recordAdds([markerData]);
    Log.info(`Added ${markerType} marker to item ${metadataId} [${startMs}-${endMs}]`);
    return markerData;
}

/**
 * Edit an existing marker, and update index order as needed.
 * @param {string} markerType The type of marker.
 * @param {number} markerId The id of the marker to edit.
 * @param {number} startMs The start time of the marker, in milliseconds.
 * @param {number} endMs The end time of the marker, in milliseconds.
 * @param {number} userCreated Whether the original marker was user created.
 * @param {number} final Whether this Credits marker goes until the end of the episode
 * @throws {ServerError} */
async function editMarker(markerType, markerId, startMs, endMs, final) {
    checkMarkerBounds(startMs, endMs, markerType);
    if (markerType !== MarkerType.Credits && final) {
        Log.warn(`Got a request for a 'final' marker that isn't a credit marker!`);
        final = 0;
    }

    const currentMarker = await PlexQueries.getSingleMarker(markerId);
    if (!currentMarker) {
        throw new ServerError('Marker not found', 400);
    }

    // Get all markers to adjust indexes if necessary
    const allMarkers = await PlexQueries.getBaseTypeMarkers(currentMarker.parent_id);
    Log.verbose(`Markers for this episode: ${allMarkers.length}`);

    const currentMarkerInAllMarkers = allMarkers.find(m => m.id === markerId);
    currentMarkerInAllMarkers.start = startMs;
    currentMarkerInAllMarkers.end = endMs;
    allMarkers.sort((a, b) => a.start - b.start);
    let newIndex = 0;

    for (let index = 0; index < allMarkers.length; ++index) {
        const marker = allMarkers[index];
        if (marker.end >= startMs && marker.start <= endMs && marker.id !== markerId) {
            // Overlap, this should be handled client-side
            const message = `Marker edit (${startMs}-${endMs}) overlaps with existing marker ${marker.start}-${marker.end}`;
            throw new ServerError(`${message}. The existing marker should be expanded to include this range instead.`, 400);
        }

        if (marker.id === markerId) {
            newIndex = index;
        }
    }

    // Make the edit, then adjust indexes
    // TODO: removeIndex: newIndex parameter shouldn't be necessary
    await PlexQueries.editMarker(markerId, newIndex, startMs, endMs, markerType, final);
    await PlexQueries.reindex(currentMarker.parent_id);

    const newMarkerRaw = await PlexQueries.getSingleMarker(markerId);
    const newMarker = new MarkerData(newMarkerRaw);
    const oldStart = currentMarker.start;
    const oldEnd = currentMarker.end;
    await BackupManager.recordEdits([newMarker], { [newMarker.id] : { start : oldStart, end : oldEnd } });
    Log.info(`Edited Marker for item ${currentMarker.parent_id}, ` +
        `was [${currentMarker.start}-${currentMarker.end}], now [${startMs}-${endMs}]`);
    return newMarker;
}

/**
 * Removes the given marker from the database, rearranging indexes as necessary.
 * @param {number} markerId The marker id to remove from the database. */
async function deleteMarker(markerId) {
    const markerToDelete = await PlexQueries.getSingleMarker(markerId);
    if (!markerToDelete) {
        throw new ServerError('Could not find marker', 400);
    }

    const allMarkers = await PlexQueries.getBaseTypeMarkers(markerToDelete.parent_id);
    let deleteIndex = 0;
    for (const marker of allMarkers) {
        if (marker.id === markerId) {
            deleteIndex = marker.index; // TODO: indexRemove: ok
        }
    }

    // Now that we're done rearranging, delete the original tag.
    await PlexQueries.deleteMarker(markerId);

    // If deletion was successful, now we can check to see whether we need to rearrange indexes to keep things contiguous
    if (deleteIndex < allMarkers.length - 1) {
        await PlexQueries.reindex(markerToDelete.parent_id);
    }

    const deletedMarker = new MarkerData(markerToDelete);
    MarkerCache?.removeMarkerFromCache(markerId);
    LegacyMarkerBreakdown.Update(deletedMarker, allMarkers.length, -1 /*delta*/);
    await BackupManager.recordDeletes([deletedMarker]);
    Log.info(`Deleted marker from item ${markerToDelete.parent_id} [${markerToDelete.start}-${markerToDelete.end}]`);
    return deletedMarker;
}

/**
 * Shift all markers for the given metadata id by the given number of milliseconds.
 * @param {number} metadataId show, season, or episode metadata id
 * @param {number} startShift The number of milliseconds to shift marker starts.
 * @param {number} endShift The number of milliseconds to shift marker ends.
 * @param {number} applyTo The marker type(s) to apply the shift to.
 * @param {number} applyType The ShiftApplyType
 * @param {number[]} ignoredMarkerIds Markers to ignore when shifting.
 * @returns {Promise<ShiftResult>} */
async function shiftMarkers(metadataId, startShift, endShift, applyTo, applyType, ignoredMarkerIds) {
    const markerInfo = await PlexQueries.getMarkersAuto(metadataId);
    if (markerInfo.typeInfo.metadata_type === MetadataType.Movie) {
        throw new ServerError(`Bulk delete doesn't support movies (yet?).`, 400);
    }

    /** @type {{ [episodeId: number]: RawMarkerData[] }} */
    const seen = {};

    const ignoreSet = new Set();
    for (const markerId of ignoredMarkerIds) {
        ignoreSet.add(markerId);
    }

    let foundConflict = false;
    for (const marker of markerInfo.markers) {
        if (ignoreSet.has(marker.id)) {
            continue;
        }

        // We want to ignore markers that aren't the right type,
        // but we still want to get episode info for all markers,
        // even if all of an episode's markers will end up being ignored.
        const typeMatch = MarkerEnum.typeMatch(marker.marker_type, applyTo);
        if (!typeMatch) {
            ignoreSet.add(marker.id);
        }

        if (!seen[marker.parent_id]) {
            seen[marker.parent_id] = [];
        } else if (seen[marker.parent_id].length > 0 && typeMatch) {
            foundConflict = true;
        }

        if (typeMatch) {
            seen[marker.parent_id].push(marker);
        }
    }

    const episodeIds = Object.keys(seen).map(k => parseInt(k));
    const rawEpisodeData = await PlexQueries.getEpisodesFromList(episodeIds);
    const foundOverflow = checkOverflow(seen, rawEpisodeData, startShift, endShift);

    if (applyType === ShiftApplyType.DontApply || foundOverflow || (applyType === ShiftApplyType.TryApply && foundConflict)) {
        /** @type {MarkerData[]} */
        const notRaw = [];
        markerInfo.markers.forEach(rm => notRaw.push(new MarkerData(rm)));
        /** @type {{[episodeId: number]: EpisodeData}} */
        const episodeData = {};
        rawEpisodeData.forEach(e => episodeData[e.id] = new EpisodeData(e));
        return {
            applied : false,
            conflict : foundConflict,
            overflow : foundOverflow,
            allMarkers : notRaw,
            episodeData : episodeData,
        };
    }

    if (foundConflict) {
        Log.verbose('Applying shift even though some episodes have multiple markers.');
    }

    // TODO: Check if shift causes overlap with ignored markers?
    const shifted = await PlexQueries.shiftMarkers(seen, rawEpisodeData, startShift, endShift);

    // Now make sure all indexes are in order
    const reindexResult = await PlexQueries.reindex(metadataId);
    /** @type {Record<number, RawMarkerData>} */
    const reindexMap = {};
    for (const marker of reindexResult.markers) {
        reindexMap[marker.id] = marker;
    }

    const markerData = [];
    /** @type {OldMarkerTimings} */
    const oldMarkerMap = {};
    markerInfo.markers.forEach(m => oldMarkerMap[m.id] = { start : m.start, end : m.end });
    for (const marker of shifted) {
        if (reindexMap[marker.id]) {
            marker.index = reindexMap[marker.id].index; // TODO: indexRemove: remove
        }

        const nonRaw = new MarkerData(marker);
        markerData.push(nonRaw);
    }

    await BackupManager.recordEdits(markerData, oldMarkerMap);
    Log.info(`Shifted ${markerData.length} markers for item ${metadataId} [startShift=${startShift}, endShift=${endShift}]`);

    return {
        applied : true,
        conflict : foundConflict,
        overflow : false,
        allMarkers : markerData,
    };
}

/**
 * Delete all markers associated with the given metadataId, unless its id is in `ignoredMarkerIds`
 * @param {number} metadataId Metadata id of the episode/season/show
 * @param {boolean} dryRun Whether we should just gather data about what we would delete.
 * @param {number} applyTo The type of marker(s) to delete.
 * @param {number[]} ignoredMarkerIds List of marker ids to not delete.
 * @returns {Promise<BulkDeleteResult>} */
async function bulkDelete(metadataId, dryRun, applyTo, ignoredMarkerIds) {
    const markerInfo = await PlexQueries.getMarkersAuto(metadataId);
    if (markerInfo.typeInfo.metadata_type === MetadataType.Movie) {
        throw new ServerError(`Bulk delete doesn't support movies (yet?).`, 400);
    }

    const ignoreSet = new Set();
    for (const markerId of ignoredMarkerIds) {
        ignoreSet.add(markerId);
    }

    const episodeIds = new Set();
    const toDelete = [];
    /** @type {{[episodeId: number]: RawMarkerData[]}} */
    const markerCounts = {};
    for (const marker of markerInfo.markers) {
        if (!ignoreSet.has(marker.id) && MarkerEnum.typeMatch(marker.marker_type, applyTo)) {
            episodeIds.add(marker.parent_id);
            toDelete.push(marker);
        }

        markerCounts[marker.parent_id] ??= 0;
        ++markerCounts[marker.parent_id];
    }

    if (dryRun) {
        // All we really do for a dry run is grab all markers for the given metadata item,
        // and associated episode data for the customization table
        /** @type {SerializedMarkerData[]} */
        const serializedMarkers = [];
        for (const marker of markerInfo.markers) {
            serializedMarkers.push(new MarkerData(marker));
        }

        /** @type {{ [episodeId: number]: EpisodeData }} */
        const serializedEpisodeData = {};
        const rawEpisodeData = await PlexQueries.getEpisodesFromList(Array.from(episodeIds));
        rawEpisodeData.forEach(e => serializedEpisodeData[e.id] = new EpisodeData(e));
        return {
            markers : serializedMarkers,
            deletedMarkers : [],
            episodeData : serializedEpisodeData
        };
    }

    await PlexQueries.bulkDelete(toDelete);

    // Now make sure all indexes are in order. Should only be needed if ignoredMarkerIds isn't empty,
    // but do it unconditionally since we can also get our updated marker info from it, as the return
    // value is any remaining markers associated with the id. Should line up with ignoredMarkerIds.
    const newMarkerInfo = await PlexQueries.reindex(metadataId);

    Log.assert( // Only valid when we're deleting all marker types.
        applyTo !== MarkerEnum.All || newMarkerInfo.markers.length === ignoredMarkerIds.length,
        `BulkDelete - expected new marker count (${newMarkerInfo.markers.length}) ` +
        `to equal ignoredMarkerIds count (${ignoredMarkerIds.length}). What went wrong?`);

    /** @type {MarkerData[]} */
    const serializedMarkers = [];
    newMarkerInfo.markers.forEach(m => serializedMarkers.push(new MarkerData(m)));
    /** @type {MarkerData[]} */
    const deleted = [];
    for (const deletedMarker of toDelete) {
        const nonRaw = new MarkerData(deletedMarker);
        MarkerCache?.removeMarkerFromCache(deletedMarker.id);
        LegacyMarkerBreakdown.Update(nonRaw, markerCounts[deletedMarker.parent_id]--, -1);
        deleted.push(nonRaw);
    }

    await BackupManager.recordDeletes(deleted);
    Log.info(`Deleted ${deleted.length} markers for item ${metadataId} (explicitly ignored ${ignoredMarkerIds.length})`);
    return {
        markers : serializedMarkers,
        deletedMarkers : deleted
    };
}

/**
 * Bulk add markers to a given show or season.
 * @param {string} markerType
 * @param {number} metadataId
 * @param {number} start
 * @param {number} end
 * @param {number} resolveType The `BulkMarkerResolveType`
 * @param {number[]} [ignored=[]] List of episode ids to not add markers to.
 * @returns {Promise<BulkAddResult>>} */
async function bulkAdd(markerType, metadataId, start, end, resolveType, ignored=[]) {
    const knownInvalid = start < 0 ? end <= start : (end > 0 && end <= start);
    if (resolveType !== BulkMarkerResolveType.DryRun && knownInvalid) {
        throw new ServerError(`Start cannot be negative or greater than end, found (start: ${start} end: ${end})`, 500);
    }

    if (Object.values(MarkerType).indexOf(markerType) === -1) {
        throw new ServerError(`Unknown marker type ${markerType} provided to bulkAdd`, 400);
    }

    const currentMarkers = await PlexQueries.getMarkersAuto(metadataId);
    const addResult = await PlexQueries.bulkAddSimple(currentMarkers, metadataId, start, end, markerType, resolveType, ignored);
    const adds = await bulkAddPostProcess(addResult, currentMarkers.markers);

    if (resolveType !== BulkMarkerResolveType.DryRun) {
        Log.info(`Added ${adds} markers to item ${metadataId} (explicitly ignored ${ignored.length})`);
    }

    return addResult;
}

/**
 * Bulk adds markers specified in newMarkers. Unlike bulkAdd, allows for custom per-marker timings.
 * @param {number} metadataId
 * @param {string} markerType
 * @param {CustomBulkAddMap} newMarkers
 * @param {number} resolveType */
async function bulkAddCustom(metadataId, markerType, newMarkers, resolveType) {
    if (Object.values(MarkerType).indexOf(markerType) === -1) {
        throw new ServerError(`Unknown marker type ${markerType} provided to bulkAdd`, 400);
    }

    const currentMarkers = await PlexQueries.getMarkersAuto(metadataId);
    const addResult = await PlexQueries.bulkAddCustom(currentMarkers, metadataId, markerType, resolveType, newMarkers);
    const adds = await bulkAddPostProcess(addResult, currentMarkers.markers);

    if (resolveType !== BulkMarkerResolveType.DryRun) {
        const ignored = addResult.ignoredEpisodes?.length || 0;
        Log.info(`Added ${adds} markers to item ${metadataId} (explicitly or implicitly ignored ${ignored})`);
    }

    return addResult;
}

/**
 * @param {{ [episodeId: string]: RawMarkerData[] }} seen
 * @param {RawEpisodeData[]} rawEpisodeData
 * @param {number} startShift
 * @param {number} endShift */
function checkOverflow(seen, rawEpisodeData, startShift, endShift) {
    /** @type {{ [baseId: number]: number }} */
    const limits = {};
    for (const episode of rawEpisodeData) {
        limits[episode.id] = episode.duration;
    }

    for (const episodeId of Object.keys(limits)) {
        for (const marker of seen[episodeId]) {
            const newStart = marker.start + startShift;
            const newEnd = marker.end + endShift;
            if (newEnd <= 0 || newStart >= limits[episodeId] || newEnd <= newStart) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Register all "core" POST commands. */
export function registerCoreCommands() {
    /* eslint-disable max-len */
    registerCommand(PostCommands.AddMarker, q => addMarker(q.s('type'), ...q.is('metadataId', 'start', 'end', 'final')));
    registerCommand(PostCommands.EditMarker, q => editMarker(q.s('type'), ...q.is('id', 'start', 'end', 'final')));
    registerCommand(PostCommands.DeleteMarker, q => deleteMarker(q.i('id')));
    registerCommand(PostCommands.CheckShift, q => shiftMarkers(q.i('id'), 0 /*startShift*/, 0 /*endShift*/, q.i('applyTo'), ShiftApplyType.DontApply, [] /*ignoredMarkerIds*/));
    registerCommand(PostCommands.ShiftMarkers, q => shiftMarkers(...q.is('id', 'startShift', 'endShift', 'applyTo'), q.i('force') ? ShiftApplyType.ForceApply : ShiftApplyType.TryApply, q.ia('ignored', true /*allowEmpty*/)));
    registerCommand(PostCommands.BulkDelete, q => bulkDelete(...q.is('id', 'dryRun', 'applyTo'), q.ia('ignored', true /*allowEmpty*/)));
    registerCommand(PostCommands.BulkAdd, q => bulkAdd(q.s('type'), ...q.is('id', 'start', 'end', 'resolveType'), q.ia('ignored')));
    registerCommand(PostCommands.BulkAddCustom, q => bulkAddCustom(q.fi('id'), q.fs('type'), q.fc('markers', parseCustomMarkerData), q.fi('resolveType')));
    /* eslint-enable max-len */
}


/**
 * Apply method when shifting markers. */
export const ShiftApplyType = {
    /** Don't shift anything, even if there aren't any conflicts. */
    DontApply : 1,
    /** Try to shift markers, but fail if an episode has multiple markers. */
    TryApply : 2,
    /** Force shift all markers, even if there are conflicts. */
    ForceApply : 3
};
