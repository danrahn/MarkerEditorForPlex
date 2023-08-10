import { ContextualLog } from './ConsoleLog.js';

import { MarkerType } from './MarkerType.js';

const IntroMask =   0x0000FFFF;
const CreditsShift = 16;

/** @typedef {!import('./PlexTypes').MarkerBreakdownMap} MarkerBreakdownMap */


const Log = new ContextualLog('MarkerBreakdown');

/**
 * Manages marker statistics at an arbitrary level (section/series/season/episode)
 */
class MarkerBreakdown {
    /** @type {MarkerBreakdownMap} */
    #counts = { 0 : 0 };

    constructor() {}

    static deltaFromType(delta, markerType) {
        switch (markerType) {
            case MarkerType.Intro:
                return delta;
            case MarkerType.Credits:
                return delta << CreditsShift;
            default:
                // Silently fall back to an intro
                Log.error(`Invalid marker type "${markerType}"`);
                return delta;
        }
    }

    static markerCountFromKey(key) {
        return (key >> CreditsShift) + (key & IntroMask);
    }

    static keyFromMarkerCount(intros, credits) {
        return MarkerBreakdown.deltaFromType(intros, MarkerType.Intro) + MarkerBreakdown.deltaFromType(credits, MarkerType.Credits);
    }

    /**
     * Initialize a marker breakdown using a raw count dictionary.
     * @param {MarkerBreakdownMap} rawMarkerBreakdown */
    initFromRawBreakdown(rawMarkerBreakdown) {
        Log.assert(
            this.buckets() == 0 && this.#counts[0] === 0,
            `Trying to initialize a marker breakdown from raw data, but we've already set some data!`);
        this.#counts = rawMarkerBreakdown;
        return this;
    }

    buckets() { return Object.keys(this.#counts).filter(c => this.#counts[c] != 0).length; }

    /**
     * @returns {MarkerBreakdownMap} */
    collapsedBuckets() {
        const collapsed = {};
        let minify = false;
        for (const [key, value] of Object.entries(this.#counts)) {
            if (value === 0) {
                minify = true;
                continue;
            }

            const realKey = this.#ic(key) + this.#cc(key);
            collapsed[realKey] ??= 0;
            collapsed[realKey] += value;
        }

        if (minify) {
            this.#minify();
        }

        return collapsed;
    }

    /**
     * @returns {MarkerBreakdownMap} */
    introBuckets() {
        const collapsed = {};
        for (const [key, value] of Object.entries(this.#counts)) {
            if (value === 0) {
                continue;
            }

            const introKey = this.#ic(key);
            collapsed[introKey] ??= 0;
            collapsed[introKey] += value;
        }

        return collapsed;
    }

    /**
     * @returns {MarkerBreakdownMap} */
    creditsBuckets() {
        const collapsed = {};
        for (const [key, value] of Object.entries(this.#counts)) {
            if (value === 0) {
                continue;
            }

            const creditsKey = this.#cc(key);
            collapsed[creditsKey] ??= 0;
            collapsed[creditsKey] += value;
        }

        return collapsed;
    }

    #ic(v) { return v & IntroMask; }
    #cc(v) { return v >> CreditsShift; }

    /**
     * Return the total count of markers in this breakdown. */
    totalMarkers() {
        return Object.entries(this.#counts).reduce((acc, kv) => acc + ((this.#cc(kv[0]) + this.#ic(kv[0])) * kv[1]), 0);
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
     * The total number of items represented in this breakdown. */
    totalItems() {
        return Object.values(this.#counts).reduce((acc, v) => acc + v, 0);
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

    /** @returns {MarkerBreakdownMap} */
    data() {
        // Create a copy by stringifying/serializing to prevent underlying data from being overwritten.
        this.#minify();
        return JSON.parse(JSON.stringify(this.#counts));
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
            if (this.#counts[key] == 0) {
                delete this.#counts[key];
            }
        }
    }
}

export default MarkerBreakdown;
