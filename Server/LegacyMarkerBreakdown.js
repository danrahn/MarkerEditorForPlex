import { Log } from "../Shared/ConsoleLog.js";

/**
 * Manages cached marker breakdown stats, used when extendedMarkerStats are disabled.
 */
class LegacyMarkerBreakdown {

    /**
     * Map of section IDs to a map of marker counts X to the number episodes that have X markers.
     * @type {Object.<number, Object.<number, number>} */
    static Cache = {};

    /**
     * Clear out the current cache, e.g. in preparation for a server restart. */
    static Clear() {
        LegacyMarkerBreakdown.Cache = {};
    }

    /**
     * Ensure our marker bucketing stays up to date after the user adds or deletes markers.
     * @param {MarkerData} marker The marker that changed.
     * @param {number} oldMarkerCount The old marker count bucket.
     * @param {number} delta The change from the old marker count, -1 for marker removals, 1 for additions. */
    static Update(marker, oldMarkerCount, delta) {
        const section = marker.sectionId;
        const cache = LegacyMarkerBreakdown.Cache[section];
        if (!cache) {
            return;
        }

        if (!(oldMarkerCount in cache)) {
            Log.warn(`updateMarkerBreakdownCache: no bucket for oldMarkerCount. That's not right!`);
            cache[oldMarkerCount] = 1; // Bring it down to zero I guess.
        }

        cache[oldMarkerCount] -= 1;

        const newMarkerCount = oldMarkerCount + delta;
        if (!(newMarkerCount in cache)) {
            cache[newMarkerCount] = 0;
        }

        cache[newMarkerCount] += 1;
    }
}

export default LegacyMarkerBreakdown;
