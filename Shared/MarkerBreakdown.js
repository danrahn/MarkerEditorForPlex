import { ContextualLog } from './ConsoleLog.js';

import { MarkerType } from './MarkerType.js';

// This isn't too expandable, but we really shouldn't have items with hundreds, or even tens of markers.
// As long as this is only used for individual items, we can probably handle 8 marker types (0-15 markers
// per type) before having to switch away from the shove-everything-in-a-32-bit-integer approach.
const IntroMask    = 0x000000FFF;
const CreditsMask  = 0x000FFF000;
const CreditsShift = 12;
const AdShift      = 24;

/** @typedef {{ [markerCount: number] : number }} MarkerBreakdownMap */

const Log = ContextualLog.Create('MarkerBreakdown');

/**
 * Manages marker statistics at an arbitrary level (section/series/season/episode)
 */
class MarkerBreakdown {
    /** @type {MarkerBreakdownMap} */
    #counts = { 0 : 0 };

    constructor() {}

    /**
     * Retrieve the key representing the given marker number and type.
     * @param {number} delta
     * @param {string} markerType */
    static deltaFromType(delta, markerType) {
        switch (markerType) {
            case MarkerType.Intro:
                return delta;
            case MarkerType.Credits:
                return delta << CreditsShift;
            case MarkerType.Ad:
                return delta << AdShift;
            default:
                // Silently fall back to an intro
                Log.error(`Invalid marker type "${markerType}"`);
                return delta;
        }
    }

    /**
     * Return the number of markers represented by the given key.
     * @param {number} key */
    static markerCountFromKey(key) {
        return (key >> AdShift) + ((key & CreditsMask) >> CreditsShift) + (key & IntroMask);
    }

    /**
     * Initialize a marker breakdown using a raw count dictionary.
     * @param {MarkerBreakdownMap} rawMarkerBreakdown */
    initFromRawBreakdown(rawMarkerBreakdown) {
        Log.assert(
            this.buckets() === 0 && this.#counts[0] === 0,
            `Trying to initialize a marker breakdown from raw data, but we've already set some data!`);
        this.#counts = rawMarkerBreakdown;
        return this;
    }

    /**
     * Return the number of unique marker type combinations for this breakdown.
     * E.g. 3 will be returned if 5 episodes have 1 intro and no credits, 10 have
     * no intros and 1 credits, and 2 have no intros and no credits. */
    buckets() { return Object.keys(this.#counts).filter(c => this.#counts[c] !== 0).length; }

    /**
     * Retrieve consolidated buckets that don't differentiate between marker types.
     * @returns {MarkerBreakdownMap} */
    collapsedBuckets() {
        /** @type {MarkerBreakdownMap} */
        const collapsed = {};
        let minify = false;
        for (const [key, value] of Object.entries(this.#counts)) {
            if (value === 0) {
                minify = true;
                continue;
            }

            const realKey = this.#ic(key) + this.#cc(key) + this.#ac(key);
            collapsed[realKey] ??= 0;
            collapsed[realKey] += value;
        }

        if (minify) {
            this.#minify();
        }

        return collapsed;
    }

    /**
     * Return a breakdown only consisting of intro markers.
     * @returns {MarkerBreakdownMap} */
    introBuckets() {
        return this.#buckets(this.#ic);
    }

    /**
     * Return a breakdown only consisting of credits markers.
     * @returns {MarkerBreakdownMap} */
    creditsBuckets() {
        return this.#buckets(this.#cc);
    }

    /**
     * Return a breakdown only consisting of ad markers.
     * @returns {MarkerBreakdownMap} */
    adBuckets() {
        return this.#buckets(this.#ac);
    }

    /** Return an integer key that represents the total number of each marker type in this breakdown. */
    key() {
        return MarkerBreakdown.deltaFromType(this.totalIntros(), MarkerType.Intro) +
            MarkerBreakdown.deltaFromType(this.totalCredits(), MarkerType.Credits) +
            MarkerBreakdown.deltaFromType(this.totalAds(), MarkerType.Ad);
    }

    /**
     * @param {(key: number|string) => number} keyFunc */
    #buckets(keyFunc) {
        const collapsed = {};
        for (const [key, value] of Object.entries(this.#counts)) {
            if (value === 0) {
                continue;
            }

            const typeKey = keyFunc(key);
            collapsed[typeKey] ??= 0;
            collapsed[typeKey] += value;
        }

        return collapsed;
    }

    /** Intro count from key */
    #ic(v) { return +v & IntroMask; }
    /** Credits count from key */
    #cc(v) { return (+v & CreditsMask) >> CreditsShift; }
    /** Ad count from key */
    #ac(v) { return +v >> AdShift; }

    /**
     * Return the total count of markers in this breakdown. */
    totalMarkers() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + ((this.#ac(kv[0]) + this.#cc(kv[0]) + this.#ic(kv[0])) * kv[1]), 0);
    }

    /**
     * Return the total number of intro markers in this breakdown. */
    totalIntros() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#ic(kv[0]) * kv[1]), 0);
    }

    /**
     * The total number of credits markers in this breakdown. */
    totalCredits() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#cc(kv[0]) * kv[1]), 0);
    }

    /**
     * The total number of ad markers in this breakdown. */
    totalAds() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#ac(kv[0]) * kv[1]), 0);
    }

    /**
     * The total number of items represented in this breakdown. */
    totalItems() {
        return Object.values(this.#counts).reduce((acc, v) => acc + v, 0);
    }

    /**
     * The total number of items that have at least one intro or credits marker. */
    itemsWithMarkers() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (kv[0] > 0 ? kv[1] : 0), 0);
    }

    /**
     * The total number of items that have an intro marker in this breakdown. */
    itemsWithIntros() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#ic(kv[0]) > 0 ? kv[1] : 0), 0);
    }

    /**
     * The total number of items that have a credits marker in this breakdown. */
    itemsWithCredits() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#cc(kv[0]) > 0 ? kv[1] : 0), 0);
    }

    /**
     * The total number of items that have an ad marker in this breakdown. */
    itemsWithAds() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + (this.#ac(kv[0]) > 0 ? kv[1] : 0), 0);
    }

    /**
     * Retrieve the full breakdown that includes marker type info.
     * @returns {MarkerBreakdownMap} */
    data() {
        // Create a copy to prevent underlying data from being overwritten.
        // Since it's just a number-to-number mapping, the spread operator is sufficient.
        this.#minify();
        return { ...this.#counts };
    }

    /** Adjust the marker count for an episode that previously had `oldCount` markers
     * @param {number} oldBucket The old bucket
     * @param {number} delta positive if a marker was added, negative if one was deleted. */
    delta(oldBucket, delta) {
        this.#counts[oldBucket + delta] ??= 0;
        --this.#counts[oldBucket];
        ++this.#counts[oldBucket + delta];
    }

    /**
     * Handles a new base item (movie/episode) in the database.
     * Adds to the 'items with 0 markers' bucket for the media item and all parent categories. */
    initBase() {
        ++this.#counts[0];
    }

    /** Removes any marker counts that have no episodes in `#counts` */
    #minify() {
        // Remove episode counts that have no episodes.
        const keys = Object.keys(this.#counts);
        for (const key of keys) {
            if (this.#counts[key] === 0) {
                delete this.#counts[key];
            }
        }
    }
}

export default MarkerBreakdown;
