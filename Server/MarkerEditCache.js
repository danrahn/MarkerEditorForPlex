import { ContextualLog } from '../Shared/ConsoleLog.js';

/** @typedef {!import('../Shared/PlexTypes').MarkerData} MarkerData */
/** @typedef {!import('./PlexQueryManager').RawMarkerData} RawMarkerData */

/**
 * @typedef {{
 *      userCreated: boolean,
 *      modifiedAt: number | null,
 * }} MarkerEditData
 * */


const Log = ContextualLog.Create('MarkerEditCache');

/**
 * Class that keeps track of marker created/modified dates.
 *
 * All of this information is stored in the backup database, but as
 * a performance optimization is kept in-memory to reduce db calls.
 */
class MarkerTimestamps {

    /** @type {Map<number, MarkerEditData>} */
    #cache = new Map();

    /**
     * Remove all cached marker data. */
    clear() {
        this.#cache.clear();
    }

    /**
     * Bulk set marker edit details.
     * @param {{[markerId: string]: MarkerEditData}} editData */
    setCache(editData) {
        for (const [markerId, data] of Object.entries(editData)) {
            this.#cache.set(parseInt(markerId), data);
        }
    }

    /**
     * Return whether the given marker was user created.
     * @param {number} markerId */
    getUserCreated(markerId) {
        return this.#cache.has(markerId) && this.#cache.get(markerId).userCreated;
    }

    /**
     * Return the marker modified date, or null if the marker has not been edited.
     * @param {number} markerId */
    getModifiedAt(markerId) {
        if (!this.#cache.has(markerId)) {
            return null;
        }

        return this.#cache.get(markerId).modifiedAt;
    }

    /**
     * Add marker edit data to the cache.
     * @param {number} markerId
     * @param {MarkerEditData} editData */
    addMarker(markerId, editData) {
        if (this.#cache.has(markerId)) {
            Log.warn(`addMarker - Cache already has a key for ${markerId}, overwriting with new data.`);
        }

        this.#cache.set(markerId, editData);
    }

    /**
     * Update (or set) the modified date for the given marker.
     * @param {number} markerId
     * @param {number} modifiedAt */
    updateMarker(markerId, modifiedAt) {
        if (!this.#cache.has(markerId)) {
            // Expected for the first edit of a Plex-generated marker
            Log.verbose(`updateMarker - Cache doesn't have a key for ${markerId}, adding a new entry and assuming it wasn't user created.`);
        }

        this.#cache.set(markerId, { userCreated : this.getUserCreated(markerId), modifiedAt : modifiedAt });
    }

    /**
     * Delete the given marker from the cache.
     * @param {number} markerId */
    deleteMarker(markerId) {
        if (!this.#cache.has(markerId)) {
            // Expected for the delete of a non-edited Plex-generated marker
            Log.verbose(`deleteMarker - Cache doesn't have a key for ${markerId}, nothing to delete`);
            return false;
        }

        return this.#cache.delete(markerId);
    }

    /**
     * Takes the raw marker data and updates the user created/modified dates
     * based on cached data. Used after adding/editing markers.
     * @param {MarkerData[]|MarkerData} markers */
    updateInPlace(markers) {
        const markerArr = (markers instanceof Array) ? markers : [markers];
        for (const marker of markerArr) {
            marker.createdByUser = this.getUserCreated(marker.id);
            marker.modifiedDate = this.getModifiedAt(marker.id);
        }
    }

    /**
     * Takes the raw marker data and updates the user created/modified dates
     * based on cached data. Used after adding/editing markers.
     * @param {RawMarkerData[]|RawMarkerData} markers */
    updateInPlaceRaw(markers) {
        markers = (markers instanceof Array) ? markers : [markers];
        for (const marker of markers) {
            marker.user_created = this.getUserCreated(marker.id);
            marker.modified_date = this.getModifiedAt(marker.id);
        }
    }
}

/**
 * @type {MarkerTimestamps} */
const MarkerEditCache = new MarkerTimestamps();

export default MarkerEditCache;
