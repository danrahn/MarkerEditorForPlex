import { Log } from "../../Shared/ConsoleLog.js";
import { EpisodeData, MarkerData } from "../../Shared/PlexTypes.js";
/** @typedef {!import('../../Shared/PlexTypes.js').ShiftResult} ShiftResult */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedEpisodeData} SerializedEpisodeData */
/** @typedef {!import('../../Shared/PlexTypes.js').SerializedMarkerData} SerializedMarkerData */

import LegacyMarkerBreakdown from "../LegacyMarkerBreakdown.js";
import { PlexQueries } from "../PlexQueryManager.js";
import { BackupManager } from "../MarkerBackupManager.js";
import { MarkerCache } from "../MarkerCacheManager.js";
import ServerError from "../ServerError.js";
/** @typedef {!import('../PlexQueryManager.js').RawMarkerData} RawMarkerData */
/** @typedef {!import('../PlexQueryManager.js').RawEpisodeData} RawEpisodeData */

/**
 * Core add/edit/delete commands
 */
class CoreCommands {
    /**
     * Adds the given marker to the database, rearranging indexes as necessary.
     * @param {number} metadataId The metadata id of the episode to add a marker to.
     * @param {number} startMs The start time of the marker, in milliseconds.
     * @param {number} endMs The end time of the marker, in milliseconds.
     * @throws {ServerError} */
    static async addMarker(metadataId, startMs, endMs) {
        CoreCommands.#checkMarkerBounds(startMs, endMs);

        const addResult = await PlexQueries.addMarker(metadataId, startMs, endMs);
        const allMarkers = addResult.allMarkers;
        const newMarker = addResult.newMarker;
        const markerData = new MarkerData(newMarker);
        LegacyMarkerBreakdown.Update(markerData, allMarkers.length - 1, 1 /*delta*/);
        MarkerCache?.addMarkerToCache(newMarker);
        await BackupManager?.recordAdd(markerData);
        return Promise.resolve(markerData);
    }

    /**
     * Edit an existing marker, and update index order as needed.
     * @param {number} markerId The id of the marker to edit.
     * @param {number} startMs The start time of the marker, in milliseconds.
     * @param {number} endMs The end time of the marker, in milliseconds.
     * @throws {ServerError} */
     static async editMarker(markerId, startMs, endMs, userCreated) {
        CoreCommands.#checkMarkerBounds(startMs, endMs);

        const currentMarker = await PlexQueries.getSingleMarker(markerId);
        if (!currentMarker) {
            throw new ServerError('Intro marker not found', 400);
        }

        const oldIndex = currentMarker.index;

        // Get all markers to adjust indexes if necessary
        const allMarkers = await PlexQueries.getEpisodeMarkers(currentMarker.episode_id);
        Log.verbose(`Markers for this episode: ${allMarkers.length}`);

        allMarkers[oldIndex].start = startMs;
        allMarkers[oldIndex].end = endMs;
        allMarkers.sort((a, b) => a.start - b.start);
        let newIndex = 0;

        for (let index = 0; index < allMarkers.length; ++index) {
            let marker = allMarkers[index];
            if (marker.end >= startMs && marker.start <= endMs && marker.id != markerId) {
                // Overlap, this should be handled client-side
                const message = `Marker edit (${startMs}-${endMs}) overlaps with existing marker ${marker.start}-${marker.end}`;
                throw new ServerError(`${message}. The existing marker should be expanded to include this range instead.`, 400);
            }

            if (marker.id == markerId) {
                newIndex = index;
            }
        }

        // Make the edit, then adjust indexes
        await PlexQueries.editMarker(markerId, newIndex, startMs, endMs, userCreated);
        await PlexQueries.reindex(currentMarker.episode_id);

        const newMarker = new MarkerData(currentMarker);
        const oldStart = newMarker.start;
        const oldEnd = newMarker.end;
        newMarker.start = startMs;
        newMarker.end = endMs;
        await BackupManager?.recordEdits([newMarker], { [newMarker.id]: { start : oldStart, end : oldEnd } });
        return newMarker;
    }

    /**
     * Removes the given marker from the database, rearranging indexes as necessary.
     * @param {number} markerId The marker id to remove from the database. */
    static async deleteMarker(markerId) {
        const markerToDelete = await PlexQueries.getSingleMarker(markerId);
        if (!markerToDelete) {
            throw new ServerError("Could not find intro marker", 400);
        }

        const allMarkers = await PlexQueries.getEpisodeMarkers(markerToDelete.episode_id);
        let deleteIndex = 0;
        for (const marker of allMarkers) {
            if (marker.id == markerId) {
                deleteIndex = marker.index;
            }
        }

        // Now that we're done rearranging, delete the original tag.
        await PlexQueries.deleteMarker(markerId);

        // If deletion was successful, now we can check to see whether we need to rearrange indexes to keep things contiguous
        if (deleteIndex < allMarkers.length - 1) {

            // Fire and forget, hopefully it worked, but it _shouldn't_ be the end of the world if it doesn't.
            for (const marker of allMarkers) {
                if (marker.index > deleteIndex) {
                    PlexQueries.updateMarkerIndex(marker.id, marker.index - 1);
                }
            }
        }

        const deletedMarker = new MarkerData(markerToDelete);
        MarkerCache?.removeMarkerFromCache(markerId);
        LegacyMarkerBreakdown.Update(deletedMarker, allMarkers.length, -1 /*delta*/);
        await BackupManager?.recordDeletes([deletedMarker]);
        return Promise.resolve(deletedMarker);
    }

    /**
     * Shift all markers for the given metadata id by the given number of milliseconds.
     * @param {number} metadataId show, season, or episode metadata id
     * @param {number} shift The number of milliseconds to shift markers
     * @param {number} applyType The ShiftApplyType
     * @param {number[]} ignoredMarkerIds Markers to ignore when shifting.
     * @returns {Promise<ShiftResult>} */
    static async shiftMarkers(metadataId, shift, applyType, ignoredMarkerIds) {
        const markers = await PlexQueries.getMarkersAuto(metadataId);
        /** @type {{ [episodeId: number]: RawMarkerData[] }} */
        const seen = {};

        const ignoreSet = new Set();
        for (const markerId of ignoredMarkerIds) {
            ignoreSet.add(markerId);
        }

        let foundConflict = false;
        for (const marker of markers.markers) {
            if (ignoreSet.has(marker.id)) {
                continue;
            }

            if (!seen[marker.episode_id]) {
                seen[marker.episode_id] = [];
            } else {
                foundConflict = true;
            }

            seen[marker.episode_id].push(marker);
        }

        /** @type {number[]} */
        const episodeIds = Object.keys(seen);
        const rawEpisodeData = await PlexQueries.getEpisodesFromList(episodeIds);
        const foundOverflow = CoreCommands.#checkOverflow(seen, rawEpisodeData, shift);

        if (applyType == ShiftApplyType.DontApply || foundOverflow || (applyType == ShiftApplyType.TryApply && foundConflict)) {
            /** @type {MarkerData[]} */
            const notRaw = [];
            Object.values(seen).forEach(markers => markers.forEach(m => notRaw.push(new MarkerData(m))));
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
        const shifted = await PlexQueries.shiftMarkers(seen, rawEpisodeData, shift);

        // Now make sure all indexes are in order
        await PlexQueries.reindex(metadataId);
        const markerData = [];
        /** @type {{[markerId: number]: RawMarkerData}} */
        const oldMarkerMap = {};
        markers.markers.forEach(m => oldMarkerMap[m.id] = m);
        for (const marker of shifted) {
            const nonRaw = new MarkerData(marker);
            markerData.push(nonRaw);
        }

        await BackupManager?.recordEdits(markerData, oldMarkerMap);

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
     * @param {number[]} ignoredMarkerIds List of marker ids to not delete.
     * @returns {Promise<{
     *               markers: SerializedMarkerData,
     *               deletedMarkers: SerializedMarkerData[],
     *               episodeData?: SerializedEpisodeData[]}>}
     */
    static async bulkDelete(metadataId, dryRun, ignoredMarkerIds) {
        const markerInfo = await PlexQueries.getMarkersAuto(metadataId);
        const ignoreSet = new Set();
        for (const markerId of ignoredMarkerIds) {
            ignoreSet.add(markerId);
        }

        const episodeIds = new Set();
        const toDelete = [];
        /** @type {{[episodeId: number]: RawMarkerData[]}} */
        const markerCounts = {};
        for (const marker of markerInfo.markers) {
            if (!ignoreSet.has(marker.id)) {
                episodeIds.add(marker.episode_id);
                toDelete.push(marker);
            }

            if (!markerCounts[marker.episode_id]) {
                markerCounts[marker.episode_id] = 0;
            }

            ++markerCounts[marker.episode_id];
        }

        if (dryRun) {
            // All we really do for a dry run is grab all markers for the given metadata item,
            // and associated episode data for the customization table

            const serializedMarkers = [];
            for (const marker of markerInfo.markers) {
                serializedMarkers.push(new MarkerData(marker));
            }

            const serializedEpisodeData = {};
            const rawEpisodeData = await PlexQueries.getEpisodesFromList(episodeIds);
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

        Log.assert(newMarkerInfo.markers.length == ignoredMarkerIds.length, `BulkDelete - expected new marker count to equal ignoredMarkerIds count. What went wrong?`);
        const serializedMarkers = [];
        newMarkerInfo.markers.forEach(m => serializedMarkers.push(new MarkerData(m)));
        const deleted = [];
        for (const deletedMarker of toDelete) {
            const nonRaw = new MarkerData(deletedMarker);
            MarkerCache?.removeMarkerFromCache(deletedMarker.id);
            LegacyMarkerBreakdown.Update(nonRaw, markerCounts[deletedMarker.episode_id]--, -1);
            deleted.push(nonRaw);
        }

        await BackupManager?.recordDeletes(deleted);
        return {
            markers : serializedMarkers,
            deletedMarkers : deleted
        }
    }

    /**
     * @param {{ [episodeId: string]: RawMarkerData[] }} seen
     * @param {RawEpisodeData[]} rawEpisodeData */
    static #checkOverflow(seen, rawEpisodeData, shift) {
        const limits = {};
        for (const episode of rawEpisodeData) {
            limits[episode.id] = episode.duration;
        }

        for (const episodeId of Object.keys(limits)) {
            for (const marker of seen[episodeId]) {
                const newStart = marker.start + shift;
                const newEnd = marker.end + shift;
                if (newEnd <= 0 || newStart >= limits[episodeId]) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Checks whether the given startMs-endMs bounds are valid, throwing
     * a ServerError on failure.
     * @param {number} startMs
     * @param {number} endMs
     * @throws {ServerError} */
    static #checkMarkerBounds(startMs, endMs) {
        if (startMs >= endMs) {
            throw new ServerError(`Start time (${startMs}) must be less than end time (${endMs}).`, 400);
        }

        if (startMs < 0) {
            throw new ServerError(`Start time (${startMs}) cannot be negative.`, 400);
        }
    }
}

/**
 * Apply method when shifting markers. */
const ShiftApplyType = {
    /** Don't shift anything, even if there aren't any conflicts. */
    DontApply : 1,
    /** Try to shift markers, but fail if an episode has multiple markers. */
    TryApply : 2,
    /** Force shift all markers, even if there are conflicts. */
    ForceApply : 3
};

export { CoreCommands, ShiftApplyType };
