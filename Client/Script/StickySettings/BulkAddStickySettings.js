import StickySettingsBase from './StickySettingsBase.js';

import { BulkMarkerResolveType } from '../../../Shared/PlexTypes.js';
import { MarkerType } from '../../../Shared/MarkerType.js';

/** @typedef {!import('./StickySettingsBase').StickySettingsBaseProtected} StickySettingsBaseProtected */

/**
 * Contains Bulk Add settings that can persist depending on client persistence setting.
 */
export default class BulkAddStickySettings extends StickySettingsBase {

    /** Bulk add settings that persist based on the user's stickiness setting. */
    static #keys = {
        /** @readonly */
        MarkerType : 'markerType',
        /** @readonly */
        ApplyType : 'applyType',
        /** @readonly */
        ChapterMode : 'chapterMode',
        /** @readonly */
        ChapterIndexMode : 'chapterIndexMode',
    };

    /**
     * Imitates "protected" methods from the base class.
     * @type {StickySettingsBaseProtected} */
    #protected = {};

    /** Create bulk add settings. */
    constructor() {
        const protectedMethods = {};
        super('bulkAdd', protectedMethods);
        this.#protected = protectedMethods;
    }

    /** Default values, used when the user doesn't want to persist settings, or they haven't changed the defaults. */
    defaultData() {
        const keys = BulkAddStickySettings.#keys;
        return {
            [keys.MarkerType] : MarkerType.Intro,
            [keys.ApplyType] : BulkMarkerResolveType.Fail,
            [keys.ChapterMode] : false,
            [keys.ChapterIndexMode] : false,
        };
    }

    /** The type of marker to add.
     * @returns {string} */
    markerType() { return this.#protected.get(BulkAddStickySettings.#keys.MarkerType); }
    /** Set the type of marker to add.
     * @param {string} markerType */
    setMarkerType(markerType) { this.#protected.set(BulkAddStickySettings.#keys.MarkerType, markerType); }

    /** The apply behavior (fail/overwrite/merge/ignore)
     * @returns {number} */
    applyType() { return this.#protected.get(BulkAddStickySettings.#keys.ApplyType); }
    /** Set the bulk apply behavior
     * @param {number} applyType */
    setApplyType(applyType) { this.#protected.set(BulkAddStickySettings.#keys.ApplyType, applyType); }

    /** Whether to use chapter data to bulk add markers instead of raw timestamp input.
     * @returns {boolean} */
    chapterMode() { return this.#protected.get(BulkAddStickySettings.#keys.ChapterMode); }
    /** Set whether to use chapter data to bulk add markers instead of raw timestamp input.
     * @param {boolean} chapterMode */
    setChapterMode(chapterMode) { this.#protected.set(BulkAddStickySettings.#keys.ChapterMode, chapterMode); }

    /** Returns whether to favor chapter indexes or timestamps for fuzzy matching.
     * @returns {boolean} */
    chapterIndexMode() { return this.#protected.get(BulkAddStickySettings.#keys.ChapterIndexMode); }
    /** Set whether to favor chapter indexes or timestamps for fuzzy matching.
     * @param {boolean} chapterIndexMode */
    setChapterIndexMode(chapterIndexMode) { this.#protected.set(BulkAddStickySettings.#keys.ChapterIndexMode, chapterIndexMode); }

    /** Custom validation for a stored key/value pair. */
    validateStorageKey(key, value) {
        switch (key) {
            case BulkAddStickySettings.#keys.MarkerType:
                return Object.values(MarkerType).includes(value);
            case BulkAddStickySettings.#keys.ApplyType:
                // Dry Run not available in bulk add.
                return value > BulkMarkerResolveType.DryRun && value <= BulkMarkerResolveType.Max;
            default:
                return true; // All other keys are handled by default validation
        }
    }
}
