import StickySettingsBase from './StickySettingsBase.js';

import { MarkerType } from '../../../Shared/MarkerType.js';

/** @typedef {!import('./StickySettingsBase').StickySettingsBaseProtected} StickySettingsBaseProtected */

/**
 * Contains marker add settings that can persist depending on client persistence setting.
 */
export default class MarkerAddStickySettings extends StickySettingsBase {
    /** Marker add settings that persist based on the user's stickiness setting. */
    static #keys = {
        /** @readonly */
        ChapterMode : 'chapterEditMode',
        /** @readonly */
        MarkerType : 'markerType',
    };

    /**
     * Imitates "protected" methods from the base class.
     * @type {StickySettingsBaseProtected} */
    #protected = {};

    /** Create marker add settings. */
    constructor() {
        const protectedMethods = {};
        super('markerAdd', protectedMethods);
        this.#protected = protectedMethods;
    }

    /** Default values, used when the user doesn't want to persist settings, or they haven't changed the defaults. */
    defaultData() {
        const keys = MarkerAddStickySettings.#keys;
        return {
            [keys.ChapterMode] : false,
            [keys.MarkerType] : MarkerType.Intro,
        };
    }

    /** Whether to use chapter data to add markers instead of raw timestamp input.
     * @returns {boolean} */
    chapterMode() { return this.#protected.get(MarkerAddStickySettings.#keys.ChapterMode); }
    /** Set whether to use chapter data to add markers instead of raw timestamp input.
     * @param {boolean} chapterMode */
    setChapterMode(chapterMode) { this.#protected.set(MarkerAddStickySettings.#keys.ChapterMode, chapterMode); }


    /** The type of marker to add.
     * @returns {string} */
    markerType() { return this.#protected.get(MarkerAddStickySettings.#keys.MarkerType); }
    /** Set the type of marker to add.
     * @param {string} markerType */
    setMarkerType(markerType) { this.#protected.set(MarkerAddStickySettings.#keys.MarkerType, markerType); }

    /** Custom validation for a stored key/value pair. */
    validateStorageKey(key, value) {
        const keys = MarkerAddStickySettings.#keys;
        switch (key) {
            case keys.MarkerType:
                return Object.values(MarkerType).includes(value);
            default:
                return true;
        }
    }
}
