import { Log } from "../../Shared/ConsoleLog.js";
import { MarkerData } from "../../Shared/PlexTypes.js";

import LegacyMarkerBreakdown from "../LegacyMarkerBreakdown.js";
import { PlexQueries } from "../PlexQueryManager.js";
import { BackupManager } from "../MarkerBackupManager.js";
import { MarkerCache } from "../MarkerCacheManager.js";
import ServerError from "../ServerError.js";

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

            marker.newIndex = index;
        }

        // Make the edit, then adjust indexes
        await PlexQueries.editMarker(markerId, newIndex, startMs, endMs, userCreated);
        for (const marker of allMarkers) {
            if (marker.index != marker.newIndex) {
                // No await, just fire and forget.
                // TODO: In some extreme case where an episode has dozens of
                // markers, it would be much more efficient to make this a transaction
                // instead of individual queries.
                PlexQueries.updateMarkerIndex(marker.id, marker.newIndex);
            }
        }

        const newMarker = new MarkerData(currentMarker);
        const oldStart = newMarker.start;
        const oldEnd = newMarker.end;
        newMarker.start = startMs;
        newMarker.end = endMs;
        await BackupManager?.recordEdit(newMarker, oldStart, oldEnd);
        return Promise.resolve(newMarker);
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
        await BackupManager?.recordDelete(deletedMarker);
        return Promise.resolve(deletedMarker);
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

export default CoreCommands;
